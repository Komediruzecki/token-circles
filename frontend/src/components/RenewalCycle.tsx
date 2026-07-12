/**
 * RenewalCycle — the monthly billing cycle drawn as an orbit.
 * The ring is the current month (day 1 at 12 o'clock, sweeping clockwise);
 * every subscription is a satellite parked at its renewal day, its size set
 * by cost and its color by category. A brighter tick marks today, so the
 * gap to the next renewal reads at a glance, and the luminous core holds the
 * month's total. Same instrument language as the account constellation and
 * category orbits, tuned for recurring bills.
 */
import { createMemo, createSignal, For, Show } from 'solid-js'
import { formatCurrency, getLocalCurrency } from '../core/api'
import { paletteColor } from '../core/brandPalette'
import styles from './RenewalCycle.module.css'

export interface RenewalCycleSub {
  name: string
  amount: number
  due_date?: string | null
  category_color?: string | null
}

export interface RenewalCycleProps {
  subs: RenewalCycleSub[]
  /** Total shown in the core; defaults to the sum of `subs`. */
  total?: number
}

const money = (amount: number) => formatCurrency(amount, getLocalCurrency())

const C = 120
const R = 86

/** Day-of-month (1-based) from a date string, or null if unparseable. */
const dayOf = (iso?: string | null): number | null => {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.getDate()
}

export default function RenewalCycle(props: RenewalCycleProps) {
  const [hover, setHover] = createSignal<number | null>(null)

  // "Now" only pins the today-marker and the month length; it never feeds a
  // reactive computation that must survive a resume, so new Date() is fine here.
  const now = new Date()
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  const todayDay = now.getDate()

  const angleRad = (day: number) => {
    const frac = (Math.min(Math.max(day, 1), daysInMonth) - 1) / daysInMonth
    return (frac * 360 - 90) * (Math.PI / 180)
  }
  const point = (day: number, r: number) => {
    const a = angleRad(day)
    return { x: C + r * Math.cos(a), y: C + r * Math.sin(a) }
  }

  const model = createMemo(() => {
    const list = (props.subs || []).filter((s) => s.amount > 0)
    const maxAmount = list.reduce((m, s) => Math.max(m, s.amount), 0) || 1
    const sats = list.map((s, i) => {
      const day = dayOf(s.due_date) ?? 1
      const r = 4 + Math.sqrt(s.amount / maxAmount) * 8
      const p = point(day, R)
      return {
        name: s.name,
        amount: s.amount,
        day,
        color: s.category_color || paletteColor(i),
        r,
        x: p.x,
        y: p.y,
      }
    })
    const total = props.total ?? list.reduce((sum, s) => sum + s.amount, 0)
    return { sats, total }
  })

  const today = point(todayDay, R)
  const dimmed = (i: number) => hover() !== null && hover() !== i

  return (
    <Show when={model().sats.length > 0}>
      <div class={styles.wrap}>
        <svg
          viewBox="0 0 240 240"
          class={styles.svg}
          role="img"
          aria-label={`Subscription renewals this month, total ${money(model().total)}`}
        >
          <defs>
            <filter id="rc-glow" x="-60%" y="-60%" width="220%" height="220%">
              <feGaussianBlur stdDeviation="2.2" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <radialGradient id="rc-core" cx="50%" cy="44%" r="60%">
              <stop offset="0%" stop-color="var(--primary)" stop-opacity="0.16" />
              <stop offset="100%" stop-color="var(--primary)" stop-opacity="0" />
            </radialGradient>
          </defs>

          {/* month cycle track */}
          <circle
            cx={C}
            cy={C}
            r={R}
            fill="none"
            stroke="var(--budget-bar-bg)"
            stroke-width="2"
            stroke-dasharray="1 5"
            stroke-linecap="round"
          />

          {/* today marker — a bright tick on the ring */}
          <circle cx={today.x} cy={today.y} r="3" fill="var(--primary)" filter="url(#rc-glow)" />
          <text x={today.x} y={today.y - 8} text-anchor="middle" class={styles.todayLabel}>
            TODAY
          </text>

          {/* subscription satellites */}
          <For each={model().sats}>
            {(s, i) => (
              <g
                class={styles.sat}
                classList={{ [styles.dim]: dimmed(i()) }}
                onMouseEnter={() => setHover(i())}
                onMouseLeave={() => setHover(null)}
              >
                <title>
                  {s.name}: {money(s.amount)} · renews day {s.day}
                </title>
                <line
                  x1={C}
                  y1={C}
                  x2={s.x}
                  y2={s.y}
                  stroke={s.color}
                  stroke-width="1"
                  opacity="0.18"
                />
                <circle cx={s.x} cy={s.y} r={s.r} fill={s.color} filter="url(#rc-glow)" />
              </g>
            )}
          </For>

          {/* core total */}
          <circle cx={C} cy={C} r="46" fill="url(#rc-core)" />
          <text x={C} y={C - 2} text-anchor="middle" class={styles.coreValue}>
            {money(model().total)}
          </text>
          <text x={C} y={C + 15} text-anchor="middle" class={styles.coreLabel}>
            PER MONTH
          </text>
        </svg>
      </div>
    </Show>
  )
}
