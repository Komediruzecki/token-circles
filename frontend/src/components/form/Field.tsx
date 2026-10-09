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
 */
import { createUniqueId, onCleanup, Show } from 'solid-js'
import ErrorGlyph from './ErrorGlyph'
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
  /** The page's own class for the field's wrapper. */
  class?: string
  labelClass?: string
  hintClass?: string
  children: (control: FieldControl) => JSX.Element
}

export default function Field<T extends FormValues>(props: FieldProps<T>): JSX.Element {
  const controlId = `field-${createUniqueId()}`
  const labelId = `${controlId}-label`
  const errorId = `${controlId}-error`
  const hintId = `${controlId}-hint`

  // A Field's form and name are fixed for its life, so it registers once.
  onCleanup(props.form.register(props.name, controlId))

  const message = () => props.form.error(props.name)
  const describedBy = () =>
    [message() ? errorId : null, props.hint ? hintId : null].filter(Boolean).join(' ') || undefined

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
  }

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

  return (
    <div class={props.class ? `${styles.field} ${props.class}` : styles.field}>
      <Show when={props.tip} fallback={label(props.labelClass)}>
        <div class={props.labelClass}>
          {label(undefined)}
          {props.tip}
        </div>
      </Show>
      {props.children(control)}
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
    </div>
  )
}
