import styles from './Toggle.module.css'

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
      classList={{ [styles.on]: isChecked() }}
      onClick={() => {
        props.onChange(!isChecked())
      }}
    >
      <span class={styles.knob} aria-hidden="true" />
    </button>
  )
}
