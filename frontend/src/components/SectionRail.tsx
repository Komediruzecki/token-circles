/**
 * SectionRail — a fixed vertical orbit on the right edge listing the page's sections as
 * small planets. The planet nearest the viewport focus lights up with an orbit ring;
 * clicking one glides the page to that section (anchors are OrbitalDivider ids).
 * Desktop-only (hidden below 1280px) — on phones you just scroll.
 */
import { createSignal, For, onCleanup, onMount } from 'solid-js'
import styles from './SectionRail.module.css'

export interface RailSection {
  id: string
  label: string
}

export default function SectionRail(props: { sections: RailSection[] }) {
  const [active, setActive] = createSignal(props.sections[0]?.id ?? '')
  let pending = 0

  // The section whose anchor last crossed the focus line (38% down the viewport) is
  // active. Timer-throttled (not rAF — suspended in throttled/background contexts);
  // the capture-phase scroll listener sees inner scrollers too.
  const measure = () => {
    pending = 0
    const focusY = window.innerHeight * 0.38
    let current = props.sections[0]?.id ?? ''
    for (const s of props.sections) {
      const el = document.getElementById(s.id)
      if (!el) continue
      if (el.getBoundingClientRect().top <= focusY) current = s.id
    }
    setActive(current)
  }
  const schedule = () => {
    if (!pending) pending = window.setTimeout(measure, 80)
  }

  onMount(() => {
    measure()
    window.addEventListener('scroll', schedule, { passive: true, capture: true })
    window.addEventListener('resize', schedule)
    // Heartbeat backstop for contexts that suppress scroll events (throttled tabs):
    // seven rect reads a second keep the active planet honest at negligible cost.
    const heartbeat = window.setInterval(measure, 900)
    onCleanup(() => {
      window.removeEventListener('scroll', schedule, true)
      window.removeEventListener('resize', schedule)
      window.clearInterval(heartbeat)
      if (pending) window.clearTimeout(pending)
    })
  })

  const jump = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <nav class={styles.rail} aria-label="Page sections">
      <span class={styles.line} aria-hidden="true" />
      <For each={props.sections}>
        {(s) => (
          <button
            type="button"
            class={`${styles.stop} ${active() === s.id ? styles.stopActive : ''}`}
            onClick={() => {
              jump(s.id)
            }}
            aria-label={`Jump to ${s.label}`}
            aria-current={active() === s.id ? 'true' : undefined}
          >
            <span class={styles.planet} aria-hidden="true" />
            <span class={styles.tip}>{s.label}</span>
          </button>
        )}
      </For>
    </nav>
  )
}
