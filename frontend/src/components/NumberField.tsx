/**
 * NumberField — a numeric input that lets you finish typing.
 *
 * Binding `value={someNumber}` and writing back `Number(e.currentTarget.value)` on every
 * keystroke means the model fights the keyboard. Clear the box and `Number('')` is 0, so
 * the effect writes "0" straight back in and the field cannot be emptied.
 *
 * It is worse than cosmetic on a number input, because a partly-typed number is not a
 * number: while you are typing "3.75", the moment the text reads "3." the element reports
 * an empty value and enters its bad-input state. Anything that writes to `value` at that
 * instant discards the "3." you can still see in the box.
 *
 * So the element owns its text for as long as it has focus, and the model owns it the rest
 * of the time. Keystrokes still parse and still report upward — the projection stays live
 * — but nothing is written back under the caret. On blur the canonical number is displayed,
 * which is also what turns "007" into "7".
 */
import { createEffect, untrack } from 'solid-js'

export interface NumberFieldProps {
  value: number
  onChange: (value: number) => void
  /** What an emptied field means. Defaults to 0. */
  emptyValue?: number
  step?: string
  min?: string
  max?: string
  class?: string
  ariaLabel?: string
  testId?: string
  id?: string
  disabled?: boolean
}

export default function NumberField(props: NumberFieldProps) {
  let el!: HTMLInputElement

  // Deliberately not `value={String(props.value)}`: that compiles to an effect that writes
  // on every model change, including the ones this field just caused.
  createEffect(() => {
    const next = String(props.value)
    if (document.activeElement === el) return
    if (el.value !== next) el.value = next
  })

  return (
    <input
      ref={el}
      id={props.id}
      type="number"
      step={props.step}
      min={props.min}
      max={props.max}
      class={props.class}
      data-test-id={props.testId}
      aria-label={props.ariaLabel}
      disabled={props.disabled}
      value={untrack(() => String(props.value))}
      onInput={(e) => {
        const text = e.currentTarget.value
        if (text === '') {
          // Either the box is genuinely empty or it holds something not yet a number
          // ("3.", "-"). Both read as ''. Treating the first as a value and the second as
          // a pause is impossible from here, so both leave the text alone and report the
          // empty reading; a half-typed decimal lands on its real value one keystroke on.
          props.onChange(props.emptyValue ?? 0)
          return
        }
        const parsed = Number(text)
        if (Number.isFinite(parsed)) props.onChange(parsed)
      }}
      onBlur={() => {
        // Show the canonical number now that the caret has gone.
        el.value = String(props.value)
      }}
    />
  )
}
