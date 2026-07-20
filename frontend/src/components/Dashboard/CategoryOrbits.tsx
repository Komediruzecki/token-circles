/**
 * CategoryOrbits — spending by category as concentric orbital arcs.
 * The brand made literal: every category is a ring around the spending
 * core; its glowing arc sweep is its share of the period's spending
 * (angle ∝ share, launch angles staggered evenly so arcs interleave like
 * orbits). Reads better than a pie — shares compare as sweep angles on
 * separate tracks instead of squeezed wedges — and it speaks the same
 * instrument language as the budget radar and the hero orbits.
 */
import { createMemo, createSignal, createUniqueId, For, Show } from 'solid-js'
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
// With only 2-3 rows (e.g. a small portfolio's allocation) the standard tight
// spacing reads as one broken blob — spread the few rings out and bolden them
// so the chart looks intentional at low counts too.
const R_STEP_SPARSE = 24
const STROKE_SPARSE = 10
// Dense charts (Budgets/Loans pass maxRings 7-8, plus the "Other" row) must
// never march the rings into the core: with the fixed 13px step, 9 rows put
// the innermost ring at r=0 and the core circle at a NEGATIVE radius. Keep
// the innermost ring at a readable radius and shrink the step instead.
const R_INNER_MIN = 46

export default function CategoryOrbits(props: CategoryOrbitsProps) {
  const [hover, setHover] = createSignal<number | null>(null)

  // Per-instance SVG ids. The keep-alive page host keeps every visited page —
  // and thus every CategoryOrbits (Analytics, Budgets, Loans, Portfolio,
  // Dashboard) — mounted at once, only hidden with `display:none`. Hardcoded
  // ids made every orbit define the SAME `#co-glow`/`#co-core`, so an arc's
  // `url(#co-glow)` resolved to the FIRST match in the document — frequently a
  // definition inside a `display:none` page. Referencing a filter from a hidden
  // subtree yields a degenerate filter region that clips the arc to a stub in
  // Chrome/Firefox/Safari (the sweep angle is right, but only a sliver paints).
  // Unique ids keep every arc pointed at its own instance's filter.
  const uid = createUniqueId()
  const glowId = `co-glow-${uid}`
  const coreId = `co-core-${uid}`

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

  const sparse = () => rings().rows.length <= 3
  const ringStep = () => {
    const rows = rings().rows.length
    if (sparse()) return R_STEP_SPARSE
    // Adaptive: fit every ring between R_OUTER and R_INNER_MIN.
    return Math.min(R_STEP, (R_OUTER - R_INNER_MIN) / Math.max(1, rows - 1))
  }
  // Slim the arcs when rings sit closer together so tracks stay distinct.
  const strokeW = () => (sparse() ? STROKE_SPARSE : Math.min(STROKE, Math.max(5, ringStep() - 2.5)))
  // Launch angles stagger evenly around the circle (i-th ring starts at
  // i/rows of a turn from 12 o'clock): shares still read as sweep angles,
  // but big arcs interleave like orbits instead of piling onto one side —
  // the "broken donut" look on 2-row portfolios and 8-row budget charts.
  const launch = (i: number) => -90 + (i * 360) / Math.max(1, rings().rows.length)

  const dash = (r: number, share: number) => {
    const c = 2 * Math.PI * r
    // Floor tiny shares to a visible dot (a 6% holding must still read), and
    // cap near-full sweeps so the round end cap never collides with its own
    // start cap — a ~95%+ arc used to look like a glitched, notched ring.
    const minLen = strokeW() * 1.5
    const maxLen = c - strokeW() * 2.4
    const len = Math.min(Math.max(share * c, minLen), maxLen)
    return `${len} ${c}`
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
            <filter id={glowId} x="-60%" y="-60%" width="220%" height="220%">
              <feGaussianBlur stdDeviation="2.2" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <radialGradient id={coreId} cx="50%" cy="44%" r="60%">
              <stop offset="0%" stop-color="var(--primary)" stop-opacity="0.14" />
              <stop offset="100%" stop-color="var(--primary)" stop-opacity="0" />
            </radialGradient>
          </defs>

          <For each={rings().rows}>
            {(row, i) => {
              const r = R_OUTER - i() * ringStep()
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
                    stroke-width={strokeW()}
                    stroke-linecap="round"
                    stroke-dasharray={dash(r, row.share)}
                    transform={`rotate(${launch(i())} ${C} ${C})`}
                    filter={`url(#${glowId})`}
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
            r={Math.max(30, R_OUTER - (rings().rows.length - 1) * ringStep() - strokeW() - 8)}
            fill={`url(#${coreId})`}
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
