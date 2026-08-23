/**
 * RangeField — a slider with a live readout.
 *
 * For a value where the point is the trade-off rather than the digits: dragging shows
 * what moves, which a number box cannot. The readout keeps the exact figure visible so
 * nothing is lost, and the input stays a real `<input type="range">` so keyboard and
 * screen-reader support come for free.
 */
import styles from './RangeField.module.css'

interface RangeFieldProps {
  id?: string
  min: number
  max: number
  step: number
  value: number
  onChange: (value: number) => void
  /** Appended to the readout, e.g. '%'. */
  suffix?: string
  /** Decimals in the readout. Defaults to whatever the step implies. */
  decimals?: number
  /**
   * Hide the built-in readout when the caller pairs the slider with its own number
   * field. Two boxes showing the same figure is worse than one.
   */
  showReadout?: boolean
  testId?: string
  ariaLabel?: string
  disabled?: boolean
}

export default function RangeField(props: RangeFieldProps) {
  const decimals = () => props.decimals ?? (props.step < 1 ? 1 : 0)

  /**
   * Where the filled part of the track ends. Clamped because the bound value can sit
   * outside the slider's range — it is also editable as a number elsewhere — and a
   * gradient stop past 100% paints the whole track as filled either way.
   */
  const fillPct = () => {
    const span = props.max - props.min
    if (span <= 0) return 0
    const ratio = (props.value - props.min) / span
    return Math.min(100, Math.max(0, ratio * 100))
  }

  return (
    <div class={styles.wrap}>
      <div class={styles.row}>
        <input
          id={props.id}
          type="range"
          class={styles.input}
          min={props.min}
          max={props.max}
          step={props.step}
          value={props.value}
          disabled={props.disabled}
          aria-label={props.ariaLabel}
          data-test-id={props.testId}
          style={{ '--fill': `${fillPct()}%` }}
          onInput={(e) => {
            const parsed = Number(e.currentTarget.value)
            if (Number.isFinite(parsed)) props.onChange(parsed)
          }}
        />
        {props.showReadout === false ? null : (
          <span
            class={styles.readout}
            data-test-id={props.testId ? `${props.testId}-readout` : undefined}
          >
            {props.value.toFixed(decimals())}
            {props.suffix ?? ''}
          </span>
        )}
      </div>
    </div>
  )
}
