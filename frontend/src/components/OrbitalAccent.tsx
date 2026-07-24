import styles from './OrbitalAccent.module.css'

/** Compact decorative orbit used where the full section divider would be too large. */
export default function OrbitalAccent() {
  return (
    <span class={styles.orbit} aria-hidden="true">
      <svg class={styles.arc} viewBox="0 0 100 18" preserveAspectRatio="none">
        <path d="M0,13 Q50,2 100,13" />
      </svg>
      <span class={`${styles.planet} ${styles.planetWarm}`} />
      <span class={`${styles.planet} ${styles.planetPrimary}`} />
      <span class={`${styles.planet} ${styles.planetMuted}`} />
    </span>
  )
}
