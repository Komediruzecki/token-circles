/**
 * GoalRing — a savings goal as an orbital progress ring.
 * Dotted orbit track + glowing progress arc (share of target saved), a dawn
 * satellite that lands at the 12-o'clock start once the goal is met, and the
 * saved amount in the luminous core. The same instrument language as the
 * budget radar and account constellation, tuned for one goal.
 */
import { createMemo, Show } from 'solid-js'
import { formatCurrency, getLocalCurrency } from '../core/api'
import styles from './GoalRing.module.css'

const money = (amount: number) => formatCurrency(amount, getLocalCurrency())

export interface GoalRingProps {
  name: string
  current: number
  target: number
  deadline?: string | null
  /** Ring diameter in px. */
  size?: number
  /** Ring only, no name/target/remaining meta (host card already shows them). */
  compact?: boolean
}

const R = 52
const C = 68

export default function GoalRing(props: GoalRingProps) {
  const pct = createMemo(() => {
    if (!Number.isFinite(props.target) || props.target <= 0) return 0
    return Math.max(0, Math.min(100, (props.current / props.target) * 100))
  })
  const met = () => props.current >= props.target && props.target > 0
  const circ = 2 * Math.PI * R
  const dash = () => `${(pct() / 100) * circ} ${circ}`

  const remaining = () => Math.max(0, props.target - props.current)
  const deadlineLabel = createMemo(() => {
    if (!props.deadline) return null
    const d = new Date(props.deadline)
    if (Number.isNaN(d.getTime())) return null
    return d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
  })

  return (
    <div class={styles.ring}>
      <svg
        viewBox="0 0 136 136"
        width={props.size ?? 136}
        height={props.size ?? 136}
        role="img"
        aria-label={`${props.name}: ${pct().toFixed(0)}% of ${money(props.target)}`}
      >
        <defs>
          <linearGradient id="gr-arc" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="var(--primary-hover, #93b4ff)" />
            <stop offset="1" stop-color="var(--primary, #6e9bff)" />
          </linearGradient>
          <radialGradient id="gr-core" cx="50%" cy="42%" r="60%">
            <stop offset="0%" stop-color="var(--primary)" stop-opacity="0.16" />
            <stop offset="100%" stop-color="var(--primary)" stop-opacity="0" />
          </radialGradient>
        </defs>

        <circle
          cx={C}
          cy={C}
          r={R}
          fill="none"
          stroke="var(--budget-bar-bg)"
          stroke-width="3"
          stroke-dasharray="1 6"
          stroke-linecap="round"
        />
        <circle
          cx={C}
          cy={C}
          r={R}
          fill="none"
          stroke={met() ? 'var(--text-positive, #7dffb0)' : 'url(#gr-arc)'}
          stroke-width="5"
          stroke-linecap="round"
          stroke-dasharray={dash()}
          transform={`rotate(-90 ${C} ${C})`}
          style={{ transition: 'stroke-dasharray 0.6s cubic-bezier(0.22, 1, 0.36, 1)' }}
        />
        {/* goal satellite at the start point (turns mint when met) */}
        <circle
          cx={C}
          cy={C - R}
          r="4.5"
          fill={met() ? 'var(--text-positive, #7dffb0)' : 'var(--accent-warm, #f0a860)'}
          stroke="var(--card-bg)"
          stroke-width="1.5"
        />

        <circle cx={C} cy={C} r="36" fill="url(#gr-core)" />
        <text x={C} y={C - 4} text-anchor="middle" class={styles.coreValue}>
          {money(props.current)}
        </text>
        <text x={C} y={C + 12} text-anchor="middle" class={styles.corePct}>
          {pct().toFixed(0)}%
        </text>
      </svg>

      <Show when={!props.compact}>
        <div class={styles.meta}>
          <p class={styles.name} title={props.name}>
            {props.name}
          </p>
          <p class={styles.target}>
            of {money(props.target)}
            <Show when={deadlineLabel()}>
              {(d) => <span class={styles.deadline}> · by {d()}</span>}
            </Show>
          </p>
          <p class={styles.remaining} classList={{ [styles.done]: met() }}>
            {met() ? 'Goal reached' : `${money(remaining())} to go`}
          </p>
        </div>
      </Show>
    </div>
  )
}
