/**
 * OrbitalDivider — the brand's section separator. A thin orbit arc spans the row with a
 * few small planets resting on it; the section title sits at the left like a station
 * label, and section actions dock on the right. Sections read as stops along one orbit
 * instead of cards glued together.
 *
 * The arc draws itself in and the planets drift into place the first time the divider
 * scrolls into view (disabled under prefers-reduced-motion). Give it an `id` and list it
 * in a <SectionRail/> to make the section jumpable.
 */
import { onCleanup, onMount, Show } from 'solid-js'
import InfoTip from './InfoTip'
import styles from './OrbitalDivider.module.css'
import type { JSX } from 'solid-js'

interface OrbitalDividerProps {
  label: string
  /** Anchor id — SectionRail scrolls to it (scroll-margin is built in). */
  id?: string
  /** Small muted note after the label (a count, a monthly total, …). */
  meta?: string
  /** Tooltip copy — renders an InfoTip right after the label. */
  info?: string
  /** Right-side slot for section actions; use <OrbitalAction/> for brand styling. */
  actions?: JSX.Element
  testId?: string
}

export default function OrbitalDivider(props: OrbitalDividerProps) {
  let rootRef: HTMLDivElement | undefined

  onMount(() => {
    const el = rootRef
    if (!el) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      el.classList.add(styles.inView)
      return
    }
    // Reveal once when the divider enters the viewport. Plain rect checks on scroll
    // (capture sees inner scrollers too) instead of IntersectionObserver/rAF — those are
    // suspended in throttled/background contexts, and the divider must never get stuck
    // in its pre-reveal state. Dividers already on screen at mount appear settled; ones
    // below the fold animate in when scrolled to (the class flip triggers the CSS
    // transitions on its own — no frame staging needed).
    let done = false
    let heartbeat = 0
    const stop = () => {
      window.removeEventListener('scroll', check, true)
      window.removeEventListener('resize', check)
      if (heartbeat) window.clearInterval(heartbeat)
    }
    const check = () => {
      if (done) return
      const r = el.getBoundingClientRect()
      if (r.top < window.innerHeight * 0.92 && r.bottom > 0) {
        done = true
        stop()
        el.classList.add(styles.inView)
      }
    }
    window.addEventListener('scroll', check, { passive: true, capture: true })
    window.addEventListener('resize', check)
    // Defer the first check one tick so mount-visible dividers still transition in.
    const kickoff = window.setTimeout(check, 30)
    // Slow heartbeat backstop: scroll events can be suppressed entirely in throttled
    // contexts, and a divider must never stay stuck pre-reveal. Cleared once revealed.
    heartbeat = window.setInterval(check, 900)
    onCleanup(() => {
      stop()
      window.clearTimeout(kickoff)
    })
  })

  return (
    <div id={props.id} ref={rootRef} class={styles.divider} data-test-id={props.testId}>
      <div class={styles.labelWrap}>
        <span class={styles.sun} aria-hidden="true" />
        <h2 class={styles.label}>{props.label}</h2>
        <Show when={props.info}>
          <InfoTip text={props.info!} />
        </Show>
        <Show when={props.meta}>
          <span class={styles.meta}>{props.meta}</span>
        </Show>
      </div>
      {/* The orbit: a gently bowed arc (viewBox height is fixed, width stretches) with
          planets absolutely positioned ON the curve — y(t) = 17 - 28·t·(1-t). */}
      <div class={styles.orbit} aria-hidden="true">
        <svg class={styles.arc} viewBox="0 0 100 24" preserveAspectRatio="none">
          <path pathLength="1" d="M0,17 Q50,3 100,17" />
        </svg>
        <span class={`${styles.planet} ${styles.p1}`} />
        <span class={`${styles.planet} ${styles.p2}`} />
        <span class={`${styles.planet} ${styles.p3}`} />
      </div>
      <Show when={props.actions}>
        <div class={styles.actions}>{props.actions}</div>
      </Show>
    </div>
  )
}

interface OrbitalActionProps {
  onClick?: () => void
  disabled?: boolean
  title?: string
  /** primary = the section's main call to action (warm accent instead of plain blue). */
  variant?: 'default' | 'primary'
  icon?: JSX.Element
  testId?: string
  children: JSX.Element
}

/**
 * OrbitalAction — pill button meant to dock in an OrbitalDivider's action slot. A small
 * planet leads the label (or a passed icon); on hover it orbits once around its axis.
 */
export function OrbitalAction(props: OrbitalActionProps) {
  return (
    <button
      type="button"
      class={`${styles.action} ${props.variant === 'primary' ? styles.actionPrimary : ''}`}
      onClick={() => props.onClick?.()}
      disabled={props.disabled}
      title={props.title}
      data-test-id={props.testId}
    >
      <Show when={props.icon} fallback={<span class={styles.actionDot} aria-hidden="true" />}>
        <span class={styles.actionIcon} aria-hidden="true">
          {props.icon}
        </span>
      </Show>
      <span>{props.children}</span>
    </button>
  )
}
