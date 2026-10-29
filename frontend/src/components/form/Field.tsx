/**
 * One field of a `createForm` form: its label, its control, the message when it is wrong, and its
 * hint.
 *
 * The control is the caller's, so a page keeps its own inputs and its own look. It spreads
 * `control` onto the element that takes the input:
 *
 *   <Field form={form} name="name" label="Category Name" class={styles.formGroup}>
 *     {(control) => <input {...control} value={form.values.name} onInput={...} />}
 *   </Field>
 *
 * which gives it the `id` the label points at, `aria-invalid` while the field is marked, and
 * `aria-describedby` naming the message first and the hint second. A `group` (a row of swatch
 * buttons) is labelled by `aria-labelledby` instead, since a `<label>` can only name one control.
 *
 * A `tip` (an InfoTip) sits beside the label, outside it. Inside a `<label>` its whole explanation
 * would become part of the control's name, and a screen reader would read a paragraph where the
 * field's name belongs.
 *
 * `floating` puts the label inside the box, where the value will go, and moves it to the box's top
 * edge once the field has focus or a value (Form.module.css). It is still a `<label for>`; it
 * follows the control in the markup only so the stylesheet can move it from the control's state.
 * The control gets a blank placeholder for that, unless the page gives it a hint of its own, which
 * shows only while the field has focus and is empty. A floating field's tip goes under it.
 *
 * `reveal` is for a password: a button at the box's right end shows it and hides it again, and
 * the field goes back to a password whenever its form is sent, so a password manager still finds
 * a password field to save. The control takes its `type` from `control`, so the page sets none.
 *
 * `floating` and `reveal` are fixed for the field's life, like its form and name.
 */
import { createSignal, createUniqueId, onCleanup, onMount, Show } from 'solid-js'
import ErrorGlyph from './ErrorGlyph'
import EyeGlyph from './EyeGlyph'
import styles from './Form.module.css'
import type { JSX } from 'solid-js'
import type { FieldName, Form, FormValues } from './createForm'

/** What to spread onto the control. The getters keep it current as the field is marked. */
export interface FieldControl {
  readonly id: string
  readonly 'aria-invalid': 'true' | undefined
  readonly 'aria-describedby': string | undefined
  readonly role?: 'group'
  readonly 'aria-labelledby'?: string
  /** A floating field's: blank, so the stylesheet can tell an empty box (`:placeholder-shown`). */
  readonly placeholder?: string
  /** A field with `reveal`: `password`, or `text` while the password is shown. */
  readonly type?: 'password' | 'text'
}

export interface FieldProps<T extends FormValues> {
  form: Form<T>
  /** One of the form's values, or `<list>.<index>.<field>` for a field of a row in a list. */
  name: FieldName<T>
  label: JSX.Element
  /** Help that stays under the field, after the message. */
  hint?: JSX.Element
  /** An explanation beside the label (an InfoTip), kept out of the control's name. */
  tip?: JSX.Element
  /** The control is a set of controls (a row of buttons), labelled as a group. */
  group?: boolean
  /** The label sits inside the box until the field has focus or a value. */
  floating?: boolean
  /** A password, with a button that shows it. The control must not set its own `type`. */
  reveal?: boolean
  /**
   * The control's id, when something outside the form names it: a password manager or a test that
   * finds the sign-in fields by theirs. Unique otherwise, which is almost always what is wanted.
   */
  id?: string
  /** The page's own class for the field's wrapper. */
  class?: string
  labelClass?: string
  hintClass?: string
  children: (control: FieldControl) => JSX.Element
}

/** Both classes, or the one that is set. */
const both = (first: string, second: string | undefined) => (second ? `${first} ${second}` : first)

export default function Field<T extends FormValues>(props: FieldProps<T>): JSX.Element {
  // Fixed for the field's life, like its form and name: the id is what it registers.
  const controlId = props.id ?? `field-${createUniqueId()}`
  const labelId = `${controlId}-label`
  const errorId = `${controlId}-error`
  const hintId = `${controlId}-hint`
  const floating = props.floating === true
  const revealable = props.reveal === true

  // A Field's form and name are fixed for its life, so it registers once.
  onCleanup(props.form.register(props.name, controlId))

  const message = () => props.form.error(props.name)
  const describedBy = () =>
    [message() ? errorId : null, props.hint ? hintId : null].filter(Boolean).join(' ') || undefined

  /** The field's value in the form, by its name: `email`, or `<list>.<index>.<field>`. */
  const value = () =>
    props.name
      .split('.')
      .reduce<unknown>(
        (at, key) =>
          at !== null && typeof at === 'object' ? (at as Record<string, unknown>)[key] : undefined,
        props.form.values
      )
  const filled = () => {
    const now = value()
    return now !== undefined && now !== null && now !== ''
  }

  // Whether a revealable password is shown as text.
  const [shown, setShown] = createSignal(false)
  let box: HTMLDivElement | undefined
  const input = () => box?.querySelector('input') ?? undefined

  const control: FieldControl = {
    id: controlId,
    get 'aria-invalid'() {
      return message() ? 'true' : undefined
    },
    get 'aria-describedby'() {
      return describedBy()
    },
    get role() {
      return props.group ? 'group' : undefined
    },
    get 'aria-labelledby'() {
      return props.group ? labelId : undefined
    },
    get placeholder() {
      return floating ? ' ' : undefined
    },
    get type() {
      if (!revealable) return undefined
      return shown() ? 'text' : 'password'
    },
  }

  /** Show the password, or hide it again, with the caret where it was. */
  const toggle = () => {
    const field = input()
    const focused = field !== undefined && field === document.activeElement
    const start = field?.selectionStart ?? null
    const end = field?.selectionEnd ?? null
    const direction = field?.selectionDirection ?? undefined
    setShown(!shown())
    if (!field || !focused || start === null || end === null) return
    // A new type can move the caret, and someone halfway through typing wants it where it was.
    // Chromium moves it to the start once a mouse click that changed the type is over, so it goes
    // back on the next frame too, unless the person has typed since.
    const putBack = () => {
      field.setSelectionRange(start, end, direction)
    }
    putBack()
    const typed = field.value
    requestAnimationFrame(() => {
      if (field === document.activeElement && field.value === typed) putBack()
    })
  }

  // A form sent with the password showing sends it as a password: the password manager looks for
  // one to save, and a text field's value can go into the browser's autocomplete history.
  onMount(() => {
    const owner = revealable ? input()?.form : null
    if (!owner) return
    const hide = () => setShown(false)
    owner.addEventListener('submit', hide)
    onCleanup(() => {
      owner.removeEventListener('submit', hide)
    })
  })

  /** The label, with the page's class unless a wrapper beside a tip carries it. */
  const label = (labelClass: string | undefined) => (
    <Show
      when={props.group}
      fallback={
        <label for={controlId} class={labelClass}>
          {props.label}
        </label>
      }
    >
      <span id={labelId} class={labelClass}>
        {props.label}
      </span>
    </Show>
  )

  /** The control in a box of its own, with the label inside it, the reveal button, or both. */
  const boxed = () => {
    const classes = [
      styles.box,
      floating ? styles.floating : '',
      revealable ? styles.revealable : '',
    ]
    return (
      <div
        ref={box}
        class={classes.filter(Boolean).join(' ')}
        data-filled={floating && filled() ? 'true' : undefined}
      >
        {props.children(control)}
        {floating ? label(both(styles.floatLabel, props.labelClass)) : null}
        {revealable ? (
          <button
            type="button"
            class={styles.reveal}
            aria-controls={controlId}
            aria-pressed={shown() ? 'true' : 'false'}
            aria-label={shown() ? 'Hide password' : 'Show password'}
            title={shown() ? 'Hide password' : 'Show password'}
            // A press would take focus from the field, and the caret with it.
            onMouseDown={(event) => {
              event.preventDefault()
            }}
            onClick={toggle}
          >
            <EyeGlyph crossed={shown()} />
          </button>
        ) : null}
      </div>
    )
  }

  return (
    <div class={props.class ? `${styles.field} ${props.class}` : styles.field}>
      {floating ? null : (
        <Show when={props.tip} fallback={label(props.labelClass)}>
          <div class={props.labelClass}>
            {label(undefined)}
            {props.tip}
          </div>
        </Show>
      )}
      {floating || revealable ? boxed() : props.children(control)}
      <Show when={message()}>
        {(text) => (
          <p id={errorId} class={styles.error}>
            <ErrorGlyph />
            <span>{text()}</span>
          </p>
        )}
      </Show>
      <Show when={props.hint}>
        <span id={hintId} class={props.hintClass ?? styles.hint}>
          {props.hint}
        </span>
      </Show>
      <Show when={floating && props.tip}>
        <div class={styles.floatTip}>{props.tip}</div>
      </Show>
    </div>
  )
}
