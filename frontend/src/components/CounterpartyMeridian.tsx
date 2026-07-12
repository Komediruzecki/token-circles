/**
 * CounterpartyMeridian — the "who owes who" ledger as a balance beam.
 * A glowing central meridian is the break-even axis; each counterparty is a
 * track that diverges from it — left in salmon when we owe them, right in
 * mint when they owe us — its bar length set by the net amount and its node
 * sized by how many transactions built that balance. Each side is scaled to
 * its own largest balance so the ranking within a direction stays legible
 * even when one counterparty dwarfs the rest. The same instrument language
 * as the account constellation and category orbits, tuned for a two-sided
 * ledger.
 */
import { createMemo, createSignal, For, Show } from 'solid-js'
import { formatCurrency, getLocalCurrency } from '../core/api'
import styles from './CounterpartyMeridian.module.css'

export interface CounterpartyMeridianRow {
  name: string
  net: number
  transaction_count: number
}

export interface CounterpartyMeridianProps {
  rows: CounterpartyMeridianRow[]
  /** Max counterparties to plot (largest |net| first). */
  maxRows?: number
}

const money = (amount: number) => formatCurrency(amount, getLocalCurrency())

/** Short axis label — "€297K", "€2.6M" — so bars, not digits, carry the width. */
const compact = (amount: number) => {
  const currency = getLocalCurrency()
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(amount)
  } catch {
    return money(amount)
  }
}

// Layout grid (viewBox units). Columns are sized so compact labels at the
// node tips never reach the name gutter.
const W = 560
const AXIS = 330 // central meridian x
const TRACK = 140 // half-width available to a bar
const NAME_X = 116 // right edge of the name gutter
const HEAD = 34 // header band height
const ROW_H = 34
const PAD_B = 10

const truncate = (name: string) => (name.length > 15 ? `${name.slice(0, 14)}…` : name)

export default function CounterpartyMeridian(props: CounterpartyMeridianProps) {
  const [hover, setHover] = createSignal<number | null>(null)

  const model = createMemo(() => {
    const max = props.maxRows ?? 8
    const sorted = [...(props.rows || [])]
      .filter((r) => Number.isFinite(r.net) && r.net !== 0)
      .sort((a, b) => Math.abs(b.net) - Math.abs(a.net))
    const shown = sorted.slice(0, max)
    const hidden = sorted.length - shown.length
    // Scale each side independently so the smaller side isn't flattened by a
    // single dominant balance on the other side.
    const maxOwed = shown.reduce((m, r) => (r.net > 0 ? Math.max(m, r.net) : m), 0) || 1
    const maxOwe = shown.reduce((m, r) => (r.net < 0 ? Math.max(m, -r.net) : m), 0) || 1
    const maxTx = shown.reduce((m, r) => Math.max(m, r.transaction_count), 0) || 1
    return { shown, hidden, maxOwed, maxOwe, maxTx }
  })

  const height = createMemo(() => HEAD + model().shown.length * ROW_H + PAD_B)

  const barLen = (net: number) => {
    const m = model()
    const scale = net > 0 ? m.maxOwed : m.maxOwe
    return 8 + (Math.abs(net) / scale) * (TRACK - 8)
  }
  const nodeR = (tx: number) => 3 + Math.sqrt(tx / model().maxTx) * 4
  const dimmed = (i: number) => hover() !== null && hover() !== i

  return (
    <Show
      when={model().shown.length > 0}
      fallback={<p class={styles.empty}>No outstanding balances to plot.</p>}
    >
      <div class={styles.wrap}>
        <svg
          viewBox={`0 0 ${W} ${height()}`}
          class={styles.svg}
          role="img"
          aria-label="Counterparty balances around break-even"
        >
          <defs>
            <filter id="cm-glow" x="-40%" y="-60%" width="180%" height="220%">
              <feGaussianBlur stdDeviation="2" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* header band */}
          <text x={AXIS - 12} y="18" text-anchor="end" class={styles.axisLabel}>
            ◀ WE OWE
          </text>
          <text x={AXIS + 12} y="18" text-anchor="start" class={styles.axisLabel}>
            OWED TO US ▶
          </text>

          {/* central meridian (crisp — a horizontal/vertical line has an empty
              bbox, so the objectBoundingBox glow filter can't apply to it) */}
          <line
            x1={AXIS}
            y1={HEAD - 6}
            x2={AXIS}
            y2={height() - 4}
            stroke="var(--primary)"
            stroke-width="1.5"
            opacity="0.5"
          />

          <For each={model().shown}>
            {(row, i) => {
              const owed = row.net > 0
              const color = owed ? 'var(--text-positive, #7dffb0)' : 'var(--text-negative, #ff9d9d)'
              const cy = HEAD + i() * ROW_H + ROW_H / 2
              const len = barLen(row.net)
              const endX = owed ? AXIS + len : AXIS - len
              const r = nodeR(row.transaction_count)
              const labelX = owed ? endX + r + 6 : endX - r - 6
              return (
                <g
                  class={styles.row}
                  classList={{ [styles.dim]: dimmed(i()) }}
                  onMouseEnter={() => setHover(i())}
                  onMouseLeave={() => setHover(null)}
                >
                  <title>
                    {row.name}: {owed ? 'owes us ' : 'we owe '}
                    {money(Math.abs(row.net))} · {row.transaction_count} txns
                  </title>
                  {/* name gutter */}
                  <text x={NAME_X} y={cy + 4} text-anchor="end" class={styles.name}>
                    {truncate(row.name)}
                  </text>
                  {/* dotted track across this side */}
                  <line
                    x1={AXIS}
                    y1={cy}
                    x2={owed ? AXIS + TRACK : AXIS - TRACK}
                    y2={cy}
                    stroke="var(--budget-bar-bg)"
                    stroke-width="2"
                    stroke-dasharray="1 5"
                    stroke-linecap="round"
                    opacity="0.6"
                  />
                  {/* net bar — the beam from break-even out to the balance.
                      A rect (not a line) so the glow filter has a real bbox. */}
                  <rect
                    x={Math.min(AXIS, endX)}
                    y={cy - 3}
                    width={len}
                    height="6"
                    rx="3"
                    fill={color}
                    filter="url(#cm-glow)"
                  />
                  {/* node sized by transaction count */}
                  <circle cx={endX} cy={cy} r={r} fill={color} filter="url(#cm-glow)" />
                  {/* compact net amount just past the node */}
                  <text
                    x={labelX}
                    y={cy + 4}
                    text-anchor={owed ? 'start' : 'end'}
                    class={styles.amount}
                    style={{ fill: color }}
                  >
                    {compact(Math.abs(row.net))}
                  </text>
                </g>
              )
            }}
          </For>
        </svg>
        <Show when={model().hidden > 0}>
          <p class={styles.more}>+{model().hidden} smaller balances not shown</p>
        </Show>
      </div>
    </Show>
  )
}
