/**
 * CategoryOrbits — spending by category as concentric orbital arcs.
 * The brand made literal: every category is a ring around the spending
 * core; its glowing arc sweep is its share of the period's spending
 * (angle ∝ share, all arcs launch from 12 o'clock). Reads better than a
 * pie — shares compare as sweep angles on separate tracks instead of
 * squeezed wedges — and it speaks the same instrument language as the
 * budget radar and the hero orbits.
 */
import { createMemo, createSignal, For, Show } from 'solid-js'
import { formatCurrency, getLocalCurrency } from '../../core/api'
import { OTHER_COLOR, paletteColor } from '../../core/brandPalette'
import styles from './CategoryOrbits.module.css'

const money = (amount: number) => formatCurrency(amount, getLocalCurrency())

export interface CategoryOrbitsProps {
  categories: { category_name: string; category_color?: string | null; amount: number }[]
  /** Shown under the total in the core, e.g. "July 2026". */
  periodText?: string
  /** Core verb — "spent" (default) or "earned" for income breakdowns. */
  label?: string
  maxRings?: number
}

const C = 130 // svg center
const R_OUTER = 104
const R_STEP = 13
const STROKE = 7.5

export default function CategoryOrbits(props: CategoryOrbitsProps) {
  const [hover, setHover] = createSignal<number | null>(null)

  const rings = createMemo(() => {
    const max = props.maxRings ?? 6
    const sorted = [...(props.categories || [])]
      .filter((c) => c.amount > 0)
      .sort((a, b) => b.amount - a.amount)
    const total = sorted.reduce((s, c) => s + c.amount, 0)
    if (total <= 0) return { total: 0, rows: [] }
    const top = sorted.slice(0, max)
    const rest = sorted.slice(max)
    const rows = top.map((c, i) => ({
      name: c.category_name || 'Uncategorized',
      color: c.category_color || paletteColor(i),
      amount: c.amount,
      share: c.amount / total,
    }))
    if (rest.length) {
      const restAmount = rest.reduce((s, c) => s + c.amount, 0)
      rows.push({
        name: `Other (${rest.length})`,
        color: OTHER_COLOR,
        amount: restAmount,
        share: restAmount / total,
      })
    }
    return { total, rows }
  })

  const dash = (r: number, share: number) => {
    const c = 2 * Math.PI * r
    return `${Math.max(0.02, share) * c} ${c}`
  }

  const dimmed = (i: number) => hover() !== null && hover() !== i

  return (
    <Show
      when={rings().rows.length > 0}
      fallback={<p class={styles.empty}>No spending recorded for this period.</p>}
    >
      <div class={styles.wrap}>
        <svg
          viewBox="0 0 260 260"
          class={styles.orbits}
          role="img"
          aria-label={`Spending by category, total ${money(rings().total)}`}
        >
          <defs>
            <filter id="co-glow" x="-60%" y="-60%" width="220%" height="220%">
              <feGaussianBlur stdDeviation="2.2" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <radialGradient id="co-core" cx="50%" cy="44%" r="60%">
              <stop offset="0%" stop-color="var(--primary)" stop-opacity="0.14" />
              <stop offset="100%" stop-color="var(--primary)" stop-opacity="0" />
            </radialGradient>
          </defs>

          <For each={rings().rows}>
            {(row, i) => {
              const r = R_OUTER - i() * R_STEP
              return (
                <g
                  class={styles.ring}
                  classList={{ [styles.ringDim]: dimmed(i()) }}
                  onMouseEnter={() => setHover(i())}
                  onMouseLeave={() => setHover(null)}
                >
                  {/* dotted orbit track */}
                  <circle
                    cx={C}
                    cy={C}
                    r={r}
                    fill="none"
                    stroke="var(--budget-bar-bg)"
                    stroke-width="2"
                    stroke-dasharray="1 5"
                    stroke-linecap="round"
                  />
                  {/* category arc: sweep angle = share of total spending */}
                  <circle
                    cx={C}
                    cy={C}
                    r={r}
                    fill="none"
                    stroke={row.color}
                    stroke-width={STROKE}
                    stroke-linecap="round"
                    stroke-dasharray={dash(r, row.share)}
                    transform={`rotate(-90 ${C} ${C})`}
                    filter="url(#co-glow)"
                    opacity="0.92"
                  >
                    <title>
                      {row.name}: {money(row.amount)} ({(row.share * 100).toFixed(1)}%)
                    </title>
                  </circle>
                </g>
              )
            }}
          </For>

          {/* spending core */}
          <circle
            cx={C}
            cy={C}
            r={R_OUTER - rings().rows.length * R_STEP - 4}
            fill="url(#co-core)"
          />
          <text x={C} y={C - 4} text-anchor="middle" class={styles.coreValue}>
            {money(rings().total)}
          </text>
          <text x={C} y={C + 14} text-anchor="middle" class={styles.coreLabel}>
            {`${props.label ?? 'spent'}${props.periodText ? ` · ${props.periodText}` : ''}`.toUpperCase()}
          </text>
        </svg>

        <ul class={styles.legend}>
          <For each={rings().rows}>
            {(row, i) => (
              <li
                class={styles.legendRow}
                classList={{ [styles.legendDim]: dimmed(i()) }}
                onMouseEnter={() => setHover(i())}
                onMouseLeave={() => setHover(null)}
              >
                <i class={styles.legendDot} style={{ background: row.color }} />
                <span class={styles.legendName}>{row.name}</span>
                <span class={styles.legendPct}>{(row.share * 100).toFixed(1)}%</span>
                <span class={styles.legendAmount}>{money(row.amount)}</span>
              </li>
            )}
          </For>
        </ul>
      </div>
    </Show>
  )
}
