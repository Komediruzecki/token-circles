import styles from './Toggle.module.css'
import type { JSX } from 'solid-js'

export interface ToggleProps {
  /** Current state — either a boolean or a reactive accessor returning one. */
  checked: (() => boolean) | boolean
  /** Called with the next value when the user flips the switch. */
  onChange: (value: boolean) => void
  disabled?: boolean
  id?: string
  'aria-label'?: string
  'aria-labelledby'?: string
  'aria-describedby'?: string
  'data-test-id'?: string
  /** Fallback accessible label if `aria-label` is not provided. */
  label?: string
  /**
   * Text rendered beside the switch, inside the control. Use it where the switch and its
   * wording belong together on one line — a row of chart options, say — rather than in a
   * settings list with a separate description column, which is what ToggleField is for.
   * The text is inside the button, so clicking the words flips the switch and it names
   * the control for a screen reader without a second element to point at.
   */
  children?: JSX.Element
  /**
   * 'compact' is a smaller pill for places where several switches sit together and the
   * full-size one would dominate the thing it is annotating.
   */
  size?: 'default' | 'compact'
}

/**
 * Controlled branded switch (role="switch"). Replaces native on/off checkboxes so the
 * on-state picks up the brand primary + glow and stays correct in both themes.
 */
export default function Toggle(props: ToggleProps) {
  const isChecked = (): boolean =>
    typeof props.checked === 'function' ? props.checked() : props.checked

  return (
    <button
      type="button"
      role="switch"
      id={props.id}
      aria-checked={isChecked()}
      aria-label={props['aria-label'] ?? props.label}
      aria-labelledby={props['aria-labelledby']}
      aria-describedby={props['aria-describedby']}
      data-test-id={props['data-test-id']}
      disabled={props.disabled}
      class={styles.toggle}
      classList={{
        [styles.on]: isChecked(),
        [styles.compact]: props.size === 'compact',
      }}
      onClick={() => {
        props.onChange(!isChecked())
      }}
    >
      <span class={styles.pill} aria-hidden="true">
        <span class={styles.knob} />
      </span>
      {props.children === undefined ? null : <span class={styles.text}>{props.children}</span>}
    </button>
  )
}
