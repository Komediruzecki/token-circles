/**
 * OrbitalToggle — the brand's celestial switch. The knob is a body on a tiny orbit:
 * OFF is the sun riding a daylight track; ON slides it across the arc into a
 * star-flecked night where it becomes a planet with a slowly turning orbit ring.
 * Built for the light/dark theme switch, but a plain controlled switch anywhere.
 */
import styles from './OrbitalToggle.module.css'

export interface OrbitalToggleProps {
  /** Current state — either a boolean or a reactive accessor returning one. */
  checked: (() => boolean) | boolean
  /** Called with the next value when the user flips the switch. */
  onChange: (value: boolean) => void
  disabled?: boolean
  id?: string
  'aria-label'?: string
}

export default function OrbitalToggle(props: OrbitalToggleProps) {
  const isChecked = (): boolean =>
    typeof props.checked === 'function' ? props.checked() : props.checked

  return (
    <button
      type="button"
      role="switch"
      id={props.id}
      aria-checked={isChecked()}
      aria-label={props['aria-label']}
      disabled={props.disabled}
      class={styles.orbitalToggle}
      classList={{ [styles.on]: isChecked() }}
      onClick={() => {
        props.onChange(!isChecked())
      }}
    >
      {/* The orbit path the knob travels along. */}
      <svg class={styles.track} viewBox="0 0 64 30" preserveAspectRatio="none" aria-hidden="true">
        <path d="M6,17 Q32,9 58,17" />
      </svg>
      {/* Night sky — stars fade in when on. */}
      <span class={`${styles.star} ${styles.s1}`} aria-hidden="true" />
      <span class={`${styles.star} ${styles.s2}`} aria-hidden="true" />
      <span class={`${styles.star} ${styles.s3}`} aria-hidden="true" />
      <span class={styles.knob} aria-hidden="true">
        <span class={styles.ring} />
      </span>
    </button>
  )
}
