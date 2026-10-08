/**
 * A form's values, its field errors and its notice, and the submit that ties them together.
 *
 * The behaviour is the point, so here it is in one place:
 *
 * - Nothing is checked while a person fills a field in for the first time.
 * - Submit runs `check`. Each field it names is marked, focus moves to the first of them in the
 *   page, and nothing is sent.
 * - A field that has been marked is re-checked on every change from then on, so its message goes
 *   the moment it is fixed (and comes back if it is broken again).
 * - `send` throws to refuse. An `ApiError` with `fields` marks the fields it names; one without
 *   `fields` puts its own words in the notice; anything else puts `failure` there, because a
 *   `TypeError` says nothing a person can act on.
 * - A marked field that is not on the page (one inside a closed "Show advanced options", or one
 *   this form has no field for) is said in the notice instead. Its words move under the field when
 *   the field appears, so they are never said twice, and they leave the notice when the field is
 *   fixed, as they leave the field.
 * - A server's mark goes on the field's next change: only the server knows whether it still holds.
 * - `mark` puts a field's words there from outside a submit, when something the field offers fails
 *   (creating an account from the account field). It goes the same way as a server's mark.
 * - While `send` runs, the form is `aria-busy` and a second submit does nothing. `SubmitButton`
 *   says so on the button.
 * - Closing the dialog after a save (`saved`) happens only while the form is still the one that
 *   sent. A reset in between, as when a dialog is cancelled and opened again, drops it, as it
 *   drops a refusal that lands late. A success toast does not wait for that: it reports a write
 *   that happened, which the reset did not undo, so it belongs in `send`, after the write.
 * - A value can be a list of rows (a loan's rate periods), each with fields of its own. A row's
 *   field is named `<list>.<index>.<field>`, as the runtimes name it in a refusal, and its marks
 *   follow the row when a row before it is removed. A server's mark on it goes when that field
 *   changes, as one on any field does.
 *
 * `Field` registers each control here, which is how the kit knows which fields this form shows and
 * where to move focus. See docs/plans/2026-10-07-form-errors.md.
 */
import { batch, createSignal } from 'solid-js'
import { createStore, produce, reconcile, unwrap } from 'solid-js/store'
import { ApiError } from '../../core/apiError'
import type { FieldErrors } from '../../../../shared/refusal'

/** Any object of named values: an interface works as well as a type literal. */
export type FormValues = object

/** The field of a row in each list value: `periods.0.rate` for `periods: { rate: string }[]`. */
type RowFieldName<T> = {
  [K in keyof T & string]: T[K] extends readonly (infer Row)[]
    ? `${K}.${number}.${keyof Row & string}`
    : never
}[keyof T & string]

/** What a field of a form is called: one of its values, or a field of a row in a list value. */
export type FieldName<T> = (keyof T & string) | RowFieldName<T>

export interface FormOptions<T extends FormValues, R = unknown> {
  /** What a fresh form holds, and what `reset()` with no argument returns to. */
  initial: T
  /** Each field's problem in words, or `{}` when the values can be sent. Pure and synchronous. */
  check?: (values: T) => FieldErrors
  /** Sends the values. Throw to refuse; it gets a plain copy, never the store. */
  send: (values: T) => R | Promise<R>
  /**
   * After `send` succeeds, with what it returned: close the dialog. Not run when the form was reset
   * while it sent: the dialog in front of the person by then is not the one that sent.
   */
  saved?: (result: R) => void
  /** The notice when `send` throws something that is not an `ApiError`. */
  failure: string
}

/** What a kit form's `<form>` element carries. Spread it: `<form class={...} {...form.attrs}>`. */
export interface FormAttributes {
  /** The kit says what is wrong, under the field. The browser's own bubbles would say it first. */
  readonly noValidate: true
  readonly onSubmit: (event?: Event) => Promise<void>
  /** 'true' while the form sends, so assistive tech knows its contents are about to change. */
  readonly 'aria-busy': 'true' | undefined
}

export interface Form<T extends FormValues> {
  /** The current values, as a store: read them in JSX and they stay current. */
  readonly values: T
  /**
   * Changes one value, and returns it, as a Solid setter does. Re-checks the fields a submit
   * marked; a server's mark on this field goes.
   */
  set: <K extends keyof T & string>(name: K, value: T[K]) => T[K]
  /** Starts over from `values` (or `initial`) with nothing marked. */
  reset: (values?: T) => void
  /** The message under a field, or `undefined`. */
  error: (name: FieldName<T>) => string | undefined
  /** The form-level message, or `undefined`. */
  notice: () => string | undefined
  /**
   * Puts `message` under a field from outside a submit: something the field offers failed, like
   * creating an account from the account field. Like a server's mark, it goes on the field's next
   * change, and on the next submit or reset. Words for a field this form does not show go in the
   * notice. `undefined` takes the mark away. Focus stays where the person is.
   */
  mark: (name: FieldName<T>, message: string | undefined) => void
  /** True while `send` runs. */
  submitting: () => boolean
  /** The `<form>`'s `onSubmit`. */
  submit: (event?: Event) => Promise<void>
  /** Spread on the `<form>`: no browser bubbles, `submit` on submit, `aria-busy` while it sends. */
  readonly attrs: FormAttributes
  /** For `Field`: this form shows `name` in the control with this id. Returns the undo. */
  register: (name: string, controlId: string) => () => void
}

const FOCUSABLE =
  'input:not([type="hidden"]):not([disabled]), select:not([disabled]), ' +
  'textarea:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** The entries that actually say something. */
function messages(errors: Readonly<Record<string, string | undefined>>): [string, string][] {
  return Object.entries(errors).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].trim() !== ''
  )
}

/** `name` as the field of a row of `list`, `<list>.<index>.<field>`, or null when it is not one. */
function rowField(list: string, name: string): { index: number; field: string } | null {
  if (!name.startsWith(`${list}.`)) return null
  const rest = name.slice(list.length + 1)
  const dot = rest.indexOf('.')
  const index = Number(rest.slice(0, dot))
  if (dot <= 0 || !Number.isInteger(index) || index < 0) return null
  return { index, field: rest.slice(dot + 1) }
}

function fieldOf(row: unknown, field: string): unknown {
  return row !== null && typeof row === 'object'
    ? (row as Record<string, unknown>)[field]
    : undefined
}

export function createForm<T extends FormValues, R = unknown>(options: FormOptions<T, R>): Form<T> {
  const [values, setValues] = createStore<T>({ ...options.initial })
  /** Every marked field's words, whether or not its field is on the page right now. */
  const [errors, setErrors] = createStore<Record<string, string | undefined>>({})
  /** What belongs to no field: a refusal without fields, offline, a failure with no words. */
  const [said, setSaid] = createSignal<string>()
  const [submitting, setSubmitting] = createSignal(false)

  /** Field name -> the id of the control a `Field` rendered for it. */
  const controls = new Map<string, string>()
  /** The names in `controls`, as a signal: the notice follows fields as they come and go. */
  const [shown, setShown] = createSignal<ReadonlySet<string>>(new Set())
  /** Fields a submit's check marked: re-checked on every change until the next reset. */
  let watched = new Set<string>()
  /** Fields the server marked: the mark goes on the field's next change. */
  let fromServer = new Set<string>()
  /** Bumped by reset, so an answer to a send from before it is dropped. */
  let generation = 0

  const snapshot = (): T => ({ ...unwrap(values) })
  const check = (): FieldErrors => options.check?.(snapshot()) ?? {}

  /**
   * The notice: what belongs to no field, then the words of each marked field no `Field` shows
   * right now. A field inside a closed section is said here until the section opens, and from
   * then on only under the field; fixed, it goes from both.
   */
  const notice = (): string | undefined => {
    const onPage = shown()
    const parts = [
      said(),
      ...messages(errors)
        .filter(([name]) => !onPage.has(name))
        .map(([, m]) => m),
    ]
    const text = parts.filter((part): part is string => !!part).join(' ')
    return text || undefined
  }

  /** Focus the first marked control in page order (for a group, the first control inside it). */
  const focusFirstMarked = () => {
    const marked = [...controls]
      .filter(([name]) => errors[name] !== undefined)
      .map(([, id]) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null)
      .sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))
    const first = marked.at(0)
    if (!first) return
    const target = first.matches(FOCUSABLE) ? first : first.querySelector<HTMLElement>(FOCUSABLE)
    target?.focus()
  }

  /**
   * A list value was set: each row's marks follow the row to its place in the new list. A row is
   * found by identity, so removing one moves the rows after it up, and by its place when the list
   * kept its length, since the row a person changed is a new object. A row that is gone takes its
   * marks with it, and a server's mark goes when its field changed.
   */
  const followRows = (list: string, before: readonly unknown[], after: readonly unknown[]) => {
    const rows = after.map((row) => unwrap(row))
    const placeOf = (index: number): number | undefined => {
      const found = rows.indexOf(before[index])
      if (found >= 0) return found
      return before.length === after.length ? index : undefined
    }
    const names = [...new Set([...Object.keys(errors), ...watched, ...fromServer])].filter(
      (name) => rowField(list, name) !== null
    )
    if (names.length === 0) return
    const nextWatched: string[] = []
    const nextServer: string[] = []
    const words: [string, string | undefined][] = []
    for (const name of names) {
      const { index, field } = rowField(list, name)!
      const place = placeOf(index)
      if (place === undefined) continue
      const server = fromServer.has(name)
      if (server && fieldOf(before[index], field) !== fieldOf(rows[place], field)) continue
      const to = `${list}.${place}.${field}`
      if (watched.has(name)) nextWatched.push(to)
      if (server) nextServer.push(to)
      words.push([to, errors[name]])
    }
    for (const name of names) {
      watched.delete(name)
      fromServer.delete(name)
      setErrors(name, undefined)
    }
    for (const name of nextWatched) watched.add(name)
    for (const name of nextServer) fromServer.add(name)
    for (const [name, text] of words) if (text !== undefined) setErrors(name, text)
  }

  const set: Form<T>['set'] = (name, value) => {
    batch(() => {
      const before: unknown = unwrap(values)[name]
      setValues(
        produce((draft: T) => {
          draft[name] = value
        })
      )
      if (fromServer.delete(name)) setErrors(name, undefined)
      if (Array.isArray(before) && Array.isArray(value)) followRows(name, before, value)
      if (watched.size === 0) return
      const found = check()
      for (const field of watched) {
        if (!fromServer.has(field))
          setErrors(field, found[field]?.trim() ? found[field] : undefined)
      }
    })
    return value
  }

  const mark: Form<T>['mark'] = (name, message) => {
    const text = message?.trim() ? message : undefined
    if (text) fromServer.add(name)
    else fromServer.delete(name)
    setErrors(name, text)
  }

  const reset: Form<T>['reset'] = (next) => {
    generation++
    watched = new Set()
    fromServer = new Set()
    batch(() => {
      setValues(reconcile({ ...(next ?? options.initial) }))
      setErrors(reconcile({}))
      setSaid(undefined)
      setSubmitting(false)
    })
  }

  const refused = (error: unknown) => {
    if (!(error instanceof ApiError)) {
      console.error('[form] the save failed with no words for a person:', error)
      setSaid(options.failure)
      return
    }
    const found = messages(error.fields)
    if (found.length === 0) {
      setSaid(error.message)
      return
    }
    fromServer = new Set(found.map(([name]) => name))
    batch(() => {
      setErrors(reconcile(Object.fromEntries(found)))
      setSaid(undefined)
    })
    focusFirstMarked()
  }

  const submit: Form<T>['submit'] = async (event) => {
    event?.preventDefault()
    if (submitting()) return
    const found = messages(check())
    if (found.length > 0) {
      for (const [name] of found) watched.add(name)
      fromServer = new Set()
      batch(() => {
        setErrors(reconcile(Object.fromEntries(found)))
        setSaid(undefined)
      })
      focusFirstMarked()
      return
    }
    fromServer = new Set()
    batch(() => {
      setErrors(reconcile({}))
      setSaid(undefined)
      setSubmitting(true)
    })
    const mine = generation
    let result: R
    try {
      result = await options.send(snapshot())
    } catch (error) {
      if (mine === generation) {
        refused(error)
        setSubmitting(false)
      }
      return
    }
    // A reset while it sent means this answer is about a form no longer on screen.
    if (mine !== generation) return
    setSubmitting(false)
    options.saved?.(result)
  }

  const register: Form<T>['register'] = (name, controlId) => {
    controls.set(name, controlId)
    setShown(new Set(controls.keys()))
    return () => {
      if (controls.get(name) !== controlId) return
      controls.delete(name)
      setShown(new Set(controls.keys()))
    }
  }

  const attrs: FormAttributes = {
    noValidate: true,
    onSubmit: submit,
    get 'aria-busy'() {
      return submitting() ? 'true' : undefined
    },
  }

  return {
    values,
    set,
    reset,
    error: (name) => errors[name],
    notice,
    mark,
    submitting,
    submit,
    attrs,
    register,
  }
}
