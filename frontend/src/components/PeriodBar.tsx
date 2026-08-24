/**
 * PeriodBar — the slim, brand-native period control that replaces every page's
 * bespoke date selector. Steppers + a clickable label (opens the PeriodOrbit) +
 * the trimmed quick-pills, all driven by the global period store.
 */
import { createSignal, For, onCleanup, onMount, Show } from 'solid-js'
import { usePeriod } from '../core/periodStore'
import { stickyPeriodBar } from '../core/uiPrefs'
import { periodPills } from '../utils/period'
import styles from './PeriodBar.module.css'
import PeriodOrbit from './PeriodOrbit'
import type { PeriodPreset } from '../utils/period'

/*
 * The pills, split where the mobile layout needs them: everything up to the last one, and the
 * last one on its own. Derived rather than written out, so adding a pill cannot leave the two
 * halves disagreeing about what is in the list.
 *
 * Built per render rather than once at import: the first two are named for the current and
 * previous month, and a tab left open across midnight on the 1st would otherwise keep naming
 * the month it was opened in.
 */
const pills = () => {
  const all = periodPills()
  return { row: all.slice(0, -1), trailing: all[all.length - 1]! }
}

interface Props {
  /** Hide the pill row (e.g. a page that only wants month stepping). */
  showPills?: boolean
  /** Preserve an existing `data-tour` anchor (dashboard-period, budgets-month, …). */
  tourAnchor?: string
  /**
   * `data-test-id` for the outer host, where a page used to wrap this in a div carrying one
   * (Budgets' `month-selector`). The bar itself always keeps `period-bar`.
   */
  hostTestId?: string
  class?: string
}

export default function PeriodBar(props: Props) {
  const { period, setPeriod, step, helpers } = usePeriod()
  const [orbitOpen, setOrbitOpen] = createSignal(false)
  const [pulse, setPulse] = createSignal<'l' | 'r' | null>(null)
  const [stuck, setStuck] = createSignal(false)
  let host!: HTMLDivElement

  /**
   * Is the bar currently pinned rather than sitting in the flow?
   *
   * No sentinel element: an element observed at `threshold: 1` with the root shrunk past its own
   * sticky offset stops fully intersecting at exactly the moment it starts sticking. The offset is
   * read from the element instead of hardcoded, because it differs between desktop and a phone —
   * where the bar has to clear the fixed menu button.
   *
   * Cosmetic only. If IntersectionObserver is missing the bar still pins; it just does not gain
   * the shadow that separates it from the content sliding underneath.
   */
  onMount(() => {
    if (typeof IntersectionObserver === 'undefined') return
    const top = parseFloat(window.getComputedStyle(host).top)
    const observer = new IntersectionObserver(
      ([entry]) => {
        setStuck(entry !== undefined && entry.intersectionRatio < 1)
      },
      { threshold: [1], rootMargin: `-${Number.isFinite(top) ? top + 1 : 1}px 0px 0px 0px` }
    )
    observer.observe(host)
    onCleanup(() => {
      observer.disconnect()
    })
  })

  const doStep = (dir: -1 | 1) => {
    setPulse(dir === 1 ? 'r' : 'l')
    step(dir)
    setTimeout(() => setPulse(null), 440)
  }

  const activePill = (): PeriodPreset | null => {
    const p = period().preset
    return p && p !== 'custom' ? p : null
  }

  /** One quick-period pill. Rendered from both groups, so its markup lives in one place. */
  const Pill = (p: { pill: ReturnType<typeof periodPills>[number] }) => (
    <button
      type="button"
      class={styles.pill}
      classList={{ [styles.pillActive]: activePill() === p.pill.id }}
      title={p.pill.title}
      data-test-id={`period-pill-${p.pill.id}`}
      onClick={() => {
        setPeriod(helpers.fromPill(p.pill.id))
      }}
    >
      <span class={styles.pillFull}>{p.pill.label}</span>
      <span class={styles.pillShort}>{p.pill.short}</span>
    </button>
  )

  return (
    <div
      ref={host}
      class={`${styles.host} ${props.class ?? ''}`}
      classList={{
        [styles.hostSticky]: stickyPeriodBar(),
        [styles.hostStuck]: stickyPeriodBar() && stuck(),
      }}
      data-test-id={props.hostTestId}
      data-tour={props.tourAnchor}
      data-sticky={stickyPeriodBar() ? 'on' : 'off'}
      data-stuck={stickyPeriodBar() && stuck() ? 'true' : 'false'}
    >
      <div class={styles.bar} data-test-id="period-bar">
        <div class={styles.stepperGroup}>
          <button
            type="button"
            class={styles.step}
            onClick={() => {
              doStep(-1)
            }}
            aria-label="Previous period"
            data-test-id="period-prev"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path d="M15 6l-6 6 6 6" fill="none" stroke="currentColor" stroke-width="2" />
            </svg>
          </button>

          <button
            type="button"
            class={styles.label}
            classList={{ [styles.pulseL]: pulse() === 'l', [styles.pulseR]: pulse() === 'r' }}
            onClick={() => {
              setOrbitOpen(true)
            }}
            aria-haspopup="dialog"
            data-test-id="period-label"
          >
            <span class={styles.orbitDot} aria-hidden="true" />
            <span class={styles.labelText}>{helpers.label(period())}</span>
            <svg class={styles.caret} viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
              <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" />
            </svg>
          </button>

          <button
            type="button"
            class={styles.step}
            onClick={() => {
              doStep(1)
            }}
            aria-label="Next period"
            data-test-id="period-next"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" />
            </svg>
          </button>
        </div>

        {/*
          Two groups, not one list. On a phone the pills wrap, and six of them wrap to three rows
          with the last one stranded alone across the full width -- a whole row spent on "All".
          Splitting the trailing pill out lets the mobile rules lift it up beside the steppers, so
          the bar is two rows instead of three. On a desktop the two groups sit adjacent with the
          same gap as the pills inside them, and the split is invisible.
        */}
        <Show when={props.showPills !== false}>
          <div class={styles.pills} role="group" aria-label="Quick periods">
            <For each={pills().row}>{(pill) => <Pill pill={pill} />}</For>
          </div>
          <div class={styles.pillsTrailing}>
            <Pill pill={pills().trailing} />
          </div>
        </Show>
      </div>

      <Show when={orbitOpen()}>
        <PeriodOrbit
          onClose={() => {
            setOrbitOpen(false)
          }}
        />
      </Show>
    </div>
  )
}
