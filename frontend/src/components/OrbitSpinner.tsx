/**
 * OrbitSpinner — the app's loading mark: a luminous core with a binary pair of
 * planets circling it (and a slow warm satellite drifting the outer ring), in
 * the same orbital language as the logo and the onboarding backdrop. Use it
 * anywhere something takes a moment: file parsing, imports, the boot gate.
 *
 * `OrbitBootScreen` wraps it as the full-screen branded variant for the app's
 * loading gate and Suspense fallbacks.
 */
import { Show } from 'solid-js'
import { LogoMark } from './Logo'
import styles from './OrbitSpinner.module.css'

export interface OrbitSpinnerProps {
  /** Outer diameter in px (default 64). */
  size?: number
  /** Optional caption under the spinner. */
  label?: string
}

export function OrbitSpinner(props: OrbitSpinnerProps) {
  const size = () => props.size ?? 64
  return (
    <div class={styles.wrap} role="status" aria-live="polite" aria-label={props.label ?? 'Loading'}>
      <svg
        class={styles.spinner}
        width={size()}
        height={size()}
        viewBox="0 0 100 100"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="orb-sp-planet" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#93b4ff" />
            <stop offset="1" stop-color="#3b6fe0" />
          </linearGradient>
          <radialGradient id="orb-sp-core" cx="0.35" cy="0.35" r="0.75">
            <stop offset="0" stop-color="#93b4ff" />
            <stop offset="1" stop-color="#3b6fe0" />
          </radialGradient>
        </defs>

        {/* dotted orbit tracks */}
        <circle class={styles.track} cx="50" cy="50" r="44" stroke-dasharray="0.5 5" />
        <circle class={styles.track} cx="50" cy="50" r="28" stroke-dasharray="0.5 4" />

        {/* luminous core */}
        <circle class={styles.core} cx="50" cy="50" r="9" fill="url(#orb-sp-core)" />

        {/* binary pair on the inner orbit — a planet and its smaller partner
            opposite it, circling each other around the core */}
        <g class={styles.orbitInner}>
          <circle class={styles.planet} cx="50" cy="22" r="6" fill="url(#orb-sp-planet)" />
          <circle class={styles.partner} cx="50" cy="78" r="3.6" fill="url(#orb-sp-planet)" />
        </g>

        {/* slow warm satellite on the outer ring, drifting the other way */}
        <g class={styles.orbitOuter}>
          <circle class={styles.satellite} cx="50" cy="6" r="2.6" />
        </g>
      </svg>
      <Show when={props.label}>
        <span class={styles.label}>{props.label}</span>
      </Show>
    </div>
  )
}

/**
 * Full-screen branded loading gate: night-sky ground, wordmark, spinner.
 * Used for the app boot gate and the shell Suspense fallback.
 */
export function OrbitBootScreen(props: { label?: string }) {
  return (
    <div class={styles.boot} data-test-id="boot-loader">
      <div class={styles.bootInner}>
        <span class={styles.bootBrand}>
          <LogoMark size={34} />
          <span class={styles.bootName}>Token Circles</span>
        </span>
        <OrbitSpinner size={172} label={props.label ?? 'Preparing your orbit…'} />
      </div>
    </div>
  )
}

export default OrbitSpinner
