/**
 * PeriodBar — the slim, brand-native period control that replaces every page's
 * bespoke date selector. Steppers + a clickable label (opens the PeriodOrbit) +
 * the trimmed quick-pills, all driven by the global period store.
 */
import { createSignal, For, Show } from 'solid-js'
import { usePeriod } from '../core/periodStore'
import { PERIOD_PILLS } from '../utils/period'
import styles from './PeriodBar.module.css'
import PeriodOrbit from './PeriodOrbit'
import type { PeriodPreset } from '../utils/period'

interface Props {
  /** Hide the pill row (e.g. a page that only wants month stepping). */
  showPills?: boolean
  /** Preserve an existing `data-tour` anchor (dashboard-period, budgets-month, …). */
  tourAnchor?: string
  class?: string
}

export default function PeriodBar(props: Props) {
  const { period, setPeriod, step, helpers } = usePeriod()
  const [orbitOpen, setOrbitOpen] = createSignal(false)
  const [pulse, setPulse] = createSignal<'l' | 'r' | null>(null)

  const doStep = (dir: -1 | 1) => {
    setPulse(dir === 1 ? 'r' : 'l')
    step(dir)
    setTimeout(() => setPulse(null), 440)
  }

  const activePill = (): PeriodPreset | null => {
    const p = period().preset
    return p && p !== 'custom' ? p : null
  }

  return (
    <div
      class={`${styles.bar} ${props.class ?? ''}`}
      data-test-id="period-bar"
      data-tour={props.tourAnchor}
    >
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

      <Show when={props.showPills !== false}>
        <div class={styles.pills} role="group" aria-label="Quick periods">
          <For each={PERIOD_PILLS}>
            {(pill) => (
              <button
                type="button"
                class={styles.pill}
                classList={{ [styles.pillActive]: activePill() === pill.id }}
                title={pill.label}
                data-test-id={`period-pill-${pill.id}`}
                onClick={() => {
                  setPeriod(helpers.fromPill(pill.id))
                }}
              >
                <span class={styles.pillFull}>{pill.label}</span>
                <span class={styles.pillShort}>{pill.short}</span>
              </button>
            )}
          </For>
        </div>
      </Show>

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
