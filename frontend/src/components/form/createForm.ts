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
 * - `send` throws to refuse. An `ApiError` with `fields` marks the fields this form shows and puts
 *   the rest in the notice; one without `fields` puts its own words in the notice; anything else
 *   puts `failure` there, because a `TypeError` says nothing a person can act on.
 * - A server's mark goes on the field's next change: only the server knows whether it still holds.
 * - `mark` puts a field's words there from outside a submit, when something the field offers fails
 *   (creating an account from the account field). It goes the same way as a server's mark.
 * - While `send` runs, the form is `aria-busy` and a second submit does nothing. `SubmitButton`
 *   says so on the button.
 * - Closing the dialog after a save (`saved`) happens only while the form is still the one that
 *   sent. A reset in between, as when a dialog is cancelled and opened again, drops it, as it
 *   drops a refusal that lands late. A success toast does not wait for that: it reports a write
 *   that happened, which the reset did not undo, so it belongs in `send`, after the write.
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
  error: (name: keyof T & string) => string | undefined
  /** The form-level message, or `undefined`. */
  notice: () => string | undefined
  /**
   * Puts `message` under a field from outside a submit: something the field offers failed, like
   * creating an account from the account field. Like a server's mark, it goes on the field's next
   * change, and on the next submit or reset. Words for a field this form does not show go in the
   * notice. `undefined` takes the mark away. Focus stays where the person is.
   */
  mark: (name: keyof T & string, message: string | undefined) => void
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
function messages(errors: FieldErrors): [string, string][] {
  return Object.entries(errors).filter(([, message]) => message.trim() !== '')
}

export function createForm<T extends FormValues, R = unknown>(options: FormOptions<T, R>): Form<T> {
  const [values, setValues] = createStore<T>({ ...options.initial })
  const [errors, setErrors] = createStore<Record<string, string | undefined>>({})
  const [notice, setNotice] = createSignal<string>()
  const [submitting, setSubmitting] = createSignal(false)

  /** Field name -> the id of the control a `Field` rendered for it. */
  const controls = new Map<string, string>()
  /** Fields a submit's check marked: re-checked on every change until the next reset. */
  let watched = new Set<string>()
  /** Fields the server marked: the mark goes on the field's next change. */
  let fromServer = new Set<string>()
  /** Bumped by reset, so an answer to a send from before it is dropped. */
  let generation = 0

  const snapshot = (): T => ({ ...unwrap(values) })
  const check = (): FieldErrors => options.check?.(snapshot()) ?? {}

  /** What no `Field` on this form shows still has to be said somewhere: the notice. */
  const unshown = (found: [string, string][]): string | undefined => {
    const rest = found.filter(([name]) => !controls.has(name)).map(([, message]) => message)
    return rest.length > 0 ? rest.join(' ') : undefined
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

  const set: Form<T>['set'] = (name, value) => {
    batch(() => {
      setValues(
        produce((draft: T) => {
          draft[name] = value
        })
      )
      if (fromServer.delete(name)) setErrors(name, undefined)
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
    if (!controls.has(name)) {
      setNotice(text)
      return
    }
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
      setNotice(undefined)
      setSubmitting(false)
    })
  }

  const refused = (error: unknown) => {
    if (!(error instanceof ApiError)) {
      console.error('[form] the save failed with no words for a person:', error)
      setNotice(options.failure)
      return
    }
    const found = messages(error.fields)
    if (found.length === 0) {
      setNotice(error.message)
      return
    }
    const shown = found.filter(([name]) => controls.has(name))
    fromServer = new Set(shown.map(([name]) => name))
    batch(() => {
      setErrors(reconcile(Object.fromEntries(shown)))
      setNotice(unshown(found))
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
        setNotice(unshown(found))
      })
      focusFirstMarked()
      return
    }
    fromServer = new Set()
    batch(() => {
      setErrors(reconcile({}))
      setNotice(undefined)
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
    return () => {
      if (controls.get(name) === controlId) controls.delete(name)
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
