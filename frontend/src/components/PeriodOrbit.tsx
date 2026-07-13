/**
 * PeriodOrbit — the novel period picker: the twelve months laid out on a ring
 * around a year core, the quick-pills, and a collapsible two-month range
 * calendar. Command-Bar-style popup (centered dialog on desktop, bottom sheet on
 * mobile) with full keyboard control:
 *   ←/→ move around the ring · ↑/↓ change year · 1–9 jump month · Enter apply · Esc close
 */
import { createMemo, createSignal, For, onCleanup, onMount, Show } from 'solid-js'
import { Portal } from 'solid-js/web'
import { setOrbitOpen, usePeriod } from '../core/periodStore'
import { isoDate, MONTH_NAMES, MONTH_NAMES_SHORT, monthPeriod, PERIOD_PILLS } from '../utils/period'
import styles from './PeriodOrbit.module.css'
import type { Period } from '../utils/period'

interface Props {
  onClose: () => void
}

const RING_R = 104
const RING_C = 132 // container centre (264 / 2)
const BTN = 46
const CIRC = 2 * Math.PI * RING_R

function ringPos(i: number): { left: number; top: number } {
  const angle = ((i * 30 - 90) * Math.PI) / 180
  return {
    left: RING_C + RING_R * Math.cos(angle) - BTN / 2,
    top: RING_C + RING_R * Math.sin(angle) - BTN / 2,
  }
}

/** Monday-first grid of the given month; null cells pad the leading offset. */
function monthMatrix(year: number, month: number): Array<{ day: number; iso: string } | null> {
  const first = new Date(year, month, 1)
  const offset = (first.getDay() + 6) % 7 // Mon = 0
  const days = new Date(year, month + 1, 0).getDate()
  const cells: Array<{ day: number; iso: string } | null> = []
  for (let i = 0; i < offset; i++) cells.push(null)
  for (let d = 1; d <= days; d++) cells.push({ day: d, iso: isoDate(new Date(year, month, d)) })
  return cells
}

export default function PeriodOrbit(props: Props) {
  const { period, setPeriod, helpers } = usePeriod()
  const now = new Date()

  const [workYear, setWorkYear] = createSignal(period().year)
  const [focusMonth, setFocusMonth] = createSignal(period().month ?? now.getMonth())
  const [showRange, setShowRange] = createSignal(
    period().mode === 'range' && period().preset === 'custom'
  )

  // Range-calendar view + selection.
  const [viewYear, setViewYear] = createSignal(period().year)
  const [viewMonth, setViewMonth] = createSignal(period().month ?? now.getMonth())
  const [rangeStart, setRangeStart] = createSignal<string | null>(
    period().mode === 'range' ? (period().from ?? null) : null
  )
  const [rangeEnd, setRangeEnd] = createSignal<string | null>(
    period().mode === 'range' ? (period().to ?? null) : null
  )

  const activePill = () => {
    const p = period().preset
    return p && p !== 'custom' ? p : null
  }

  const isCurrentMonth = (i: number) =>
    period().mode === 'month' && period().year === workYear() && period().month === i

  const applyMonth = (i: number) => {
    setPeriod(monthPeriod(workYear(), i))
    props.onClose()
  }

  const applyPill = (id: (typeof PERIOD_PILLS)[number]['id']) => {
    setPeriod(helpers.fromPill(id))
    props.onClose()
  }

  const applyRange = () => {
    const from = rangeStart()
    const to = rangeEnd() ?? rangeStart()
    if (!from || !to) return
    const p: Period = { mode: 'range', year: Number(from.slice(0, 4)), from, to, preset: 'custom' }
    setPeriod(p)
    props.onClose()
  }

  const pickDay = (iso: string) => {
    const start = rangeStart()
    const end = rangeEnd()
    if (!start || (start && end)) {
      setRangeStart(iso)
      setRangeEnd(null)
    } else if (iso >= start) {
      setRangeEnd(iso)
    } else {
      setRangeStart(iso)
    }
  }

  const inRange = (iso: string) => {
    const s = rangeStart()
    const e = rangeEnd()
    if (!s) return false
    if (!e) return iso === s
    return iso >= s && iso <= e
  }

  const stepViewMonth = (dir: -1 | 1) => {
    const d = new Date(viewYear(), viewMonth() + dir, 1)
    setViewYear(d.getFullYear())
    setViewMonth(d.getMonth())
  }

  // Arc that sweeps from 12-o'clock to the focused month.
  const arcDash = createMemo(() => {
    const frac = (focusMonth() + 1) / 12
    return `${(CIRC * frac).toFixed(1)} ${CIRC.toFixed(1)}`
  })

  const onKeyDown = (e: KeyboardEvent) => {
    switch (e.key) {
      case 'Escape':
        e.preventDefault()
        props.onClose()
        break
      case 'ArrowLeft':
        e.preventDefault()
        setFocusMonth((m) => (m + 11) % 12)
        break
      case 'ArrowRight':
        e.preventDefault()
        setFocusMonth((m) => (m + 1) % 12)
        break
      case 'ArrowUp':
        e.preventDefault()
        setWorkYear((y) => y + 1)
        break
      case 'ArrowDown':
        e.preventDefault()
        setWorkYear((y) => y - 1)
        break
      case 'Enter':
        e.preventDefault()
        applyMonth(focusMonth())
        break
      default:
        if (/^[1-9]$/.test(e.key)) {
          e.preventDefault()
          setFocusMonth(Number(e.key) - 1)
        }
    }
  }

  onMount(() => {
    setOrbitOpen(true)
    document.addEventListener('keydown', onKeyDown)
  })
  onCleanup(() => {
    setOrbitOpen(false)
    document.removeEventListener('keydown', onKeyDown)
  })

  const months = () => [
    { y: viewYear(), m: viewMonth() },
    { y: new Date(viewYear(), viewMonth() + 1, 1).getFullYear(), m: (viewMonth() + 1) % 12 },
  ]

  return (
    <Portal>
      <div
        class={styles.overlay}
        onClick={() => {
          props.onClose()
        }}
      >
        <div
          class={styles.panel}
          role="dialog"
          aria-label="Choose period"
          onClick={(e) => {
            e.stopPropagation()
          }}
        >
          <div class={styles.header}>
            <span class={styles.title}>Jump to period</span>
            <button
              type="button"
              class={styles.close}
              onClick={() => {
                props.onClose()
              }}
              aria-label="Close"
            >
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2" />
              </svg>
            </button>
          </div>

          <Show when={!showRange()}>
            <div
              class={styles.ring}
              style={{ width: `${RING_C * 2}px`, height: `${RING_C * 2}px` }}
            >
              <svg
                class={styles.ringSvg}
                viewBox={`0 0 ${RING_C * 2} ${RING_C * 2}`}
                aria-hidden="true"
              >
                <circle
                  cx={RING_C}
                  cy={RING_C}
                  r={RING_R}
                  class={styles.ringTrack}
                  fill="none"
                  stroke-width="2"
                />
                <circle
                  cx={RING_C}
                  cy={RING_C}
                  r={RING_R}
                  class={styles.ringArc}
                  fill="none"
                  stroke-width="3"
                  stroke-linecap="round"
                  stroke-dasharray={arcDash()}
                  transform={`rotate(-90 ${RING_C} ${RING_C})`}
                />
              </svg>

              <For each={MONTH_NAMES_SHORT}>
                {(name, i) => {
                  const p = ringPos(i())
                  return (
                    <button
                      type="button"
                      class={styles.monthBtn}
                      classList={{
                        [styles.monthCurrent]: isCurrentMonth(i()),
                        [styles.monthFocus]: focusMonth() === i(),
                      }}
                      style={{ left: `${p.left}px`, top: `${p.top}px` }}
                      title={`${MONTH_NAMES[i()]} ${workYear()}`}
                      onClick={() => {
                        applyMonth(i())
                      }}
                      onMouseEnter={() => {
                        setFocusMonth(i())
                      }}
                    >
                      {name}
                    </button>
                  )
                }}
              </For>

              <div class={styles.core}>
                <button
                  type="button"
                  class={styles.yearStep}
                  onClick={() => {
                    setWorkYear((y) => y - 1)
                  }}
                  aria-label="Previous year"
                >
                  ‹
                </button>
                <span class={styles.coreYear}>{workYear()}</span>
                <button
                  type="button"
                  class={styles.yearStep}
                  onClick={() => {
                    setWorkYear((y) => y + 1)
                  }}
                  aria-label="Next year"
                >
                  ›
                </button>
              </div>
            </div>
          </Show>

          <Show when={showRange()}>
            <div class={styles.calendars}>
              <div class={styles.calNav}>
                <button
                  type="button"
                  class={styles.calNavBtn}
                  onClick={() => {
                    stepViewMonth(-1)
                  }}
                  aria-label="Previous month"
                >
                  ‹
                </button>
                <span class={styles.calNavLabel}>
                  {rangeStart()
                    ? `${rangeStart()}${rangeEnd() ? `  →  ${rangeEnd()}` : '  →  …'}`
                    : 'Pick a start day'}
                </span>
                <button
                  type="button"
                  class={styles.calNavBtn}
                  onClick={() => {
                    stepViewMonth(1)
                  }}
                  aria-label="Next month"
                >
                  ›
                </button>
              </div>
              <div class={styles.calGrid}>
                <For each={months()}>
                  {(mv, idx) => (
                    <div class={styles.cal} classList={{ [styles.calSecond]: idx() === 1 }}>
                      <div class={styles.calMonthLabel}>
                        {MONTH_NAMES[mv.m]} {mv.y}
                      </div>
                      <div class={styles.calDow}>
                        <For each={['M', 'T', 'W', 'T', 'F', 'S', 'S']}>
                          {(d) => <span>{d}</span>}
                        </For>
                      </div>
                      <div class={styles.calDays}>
                        <For each={monthMatrix(mv.y, mv.m)}>
                          {(cell) => (
                            <Show when={cell} fallback={<span class={styles.calEmpty} />}>
                              <button
                                type="button"
                                class={styles.calDay}
                                classList={{
                                  [styles.calIn]: inRange(cell!.iso),
                                  [styles.calEdge]:
                                    cell!.iso === rangeStart() || cell!.iso === rangeEnd(),
                                }}
                                onClick={() => {
                                  pickDay(cell!.iso)
                                }}
                              >
                                {cell!.day}
                              </button>
                            </Show>
                          )}
                        </For>
                      </div>
                    </div>
                  )}
                </For>
              </div>
              <button
                type="button"
                class={styles.applyBtn}
                disabled={!rangeStart()}
                onClick={() => {
                  applyRange()
                }}
              >
                Apply range
              </button>
            </div>
          </Show>

          <div class={styles.pills} role="group" aria-label="Quick periods">
            <For each={PERIOD_PILLS}>
              {(pill) => (
                <button
                  type="button"
                  class={styles.pill}
                  classList={{ [styles.pillActive]: activePill() === pill.id }}
                  onClick={() => {
                    applyPill(pill.id)
                  }}
                >
                  {pill.label}
                </button>
              )}
            </For>
          </div>

          <div class={styles.footer}>
            <button
              type="button"
              class={styles.rangeToggle}
              classList={{ [styles.rangeToggleOn]: showRange() }}
              onClick={() => {
                setShowRange((v) => !v)
              }}
            >
              {showRange() ? '← Month ring' : 'Custom range →'}
            </button>
            <span class={styles.hint}>←/→ month · ↑/↓ year · Enter apply · Esc close</span>
          </div>
        </div>
      </div>
    </Portal>
  )
}
