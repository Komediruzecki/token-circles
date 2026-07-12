/**
 * AccountConstellation — net worth as an orbital system.
 * The brand made literal for accounts: a luminous net-worth core with each
 * account orbiting it as a glowing satellite, sized by its share of total
 * balance and colored by account type (giro / savings / investment / cash).
 * Satellites distribute around one or two orbit rings; an interactive legend
 * lists each account with balance and share. Speaks the same orbital
 * language as CategoryOrbits and the hero.
 */
import { createMemo, createSignal, For, Show } from 'solid-js'
import { formatCurrency, getLocalCurrency } from '../core/api'
import styles from './AccountConstellation.module.css'

const money = (amount: number) => formatCurrency(amount, getLocalCurrency())

export interface ConstellationAccount {
  id: number | string
  name: string
  type: string
  balance: number
  bank_name?: string | null
}

export interface AccountConstellationProps {
  accounts: ConstellationAccount[]
}

// Account type → brand hue + label.
const TYPE_META: Record<string, { color: string; label: string }> = {
  giro: { color: '#6e9bff', label: 'Checking' },
  savings: { color: '#59d2a2', label: 'Savings' },
  ib: { color: '#f0a860', label: 'Investment' },
  investment: { color: '#f0a860', label: 'Investment' },
  cash: { color: '#c9a0ff', label: 'Cash' },
}
const typeMeta = (t: string) => TYPE_META[t] ?? { color: '#93b4ff', label: t || 'Account' }

const C = 160 // svg center
const CORE_R = 40

export default function AccountConstellation(props: AccountConstellationProps) {
  const [hover, setHover] = createSignal<number | string | null>(null)

  const model = createMemo(() => {
    const accts = (props.accounts || []).filter((a) => Number.isFinite(a.balance))
    const total = accts.reduce((s, a) => s + a.balance, 0)
    const maxAbs = Math.max(1, ...accts.map((a) => Math.abs(a.balance)))
    // Sort largest-first so big satellites sit on the inner ring.
    const sorted = [...accts].sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance))
    // Split across up to two rings for legibility.
    const ringRadii = sorted.length > 6 ? [92, 132] : [110]
    const nodes = sorted.map((a, i) => {
      const ring = i % ringRadii.length
      const idxOnRing = Math.floor(i / ringRadii.length)
      const perRing = Math.ceil(sorted.length / ringRadii.length)
      const angle = (idxOnRing / Math.max(1, perRing)) * Math.PI * 2 - Math.PI / 2 + ring * 0.5
      const r = ringRadii[ring]
      const meta = typeMeta(a.type)
      return {
        ...a,
        meta,
        x: C + Math.cos(angle) * r,
        y: C + Math.sin(angle) * r,
        // Satellite radius scales with balance share (sqrt for area-fairness).
        rad: 7 + Math.sqrt(Math.abs(a.balance) / maxAbs) * 15,
        orbitR: r,
      }
    })
    return { total, nodes, ringRadii }
  })

  const dimmed = (id: number | string) => hover() !== null && hover() !== id

  return (
    <Show
      when={model().nodes.length > 0}
      fallback={<p class={styles.empty}>No accounts yet — add one to map your net worth.</p>}
    >
      <div class={styles.wrap}>
        <svg
          viewBox="0 0 320 320"
          class={styles.svg}
          role="img"
          aria-label={`Net worth ${money(model().total)}`}
        >
          <defs>
            <radialGradient id="ac-core" cx="50%" cy="42%" r="60%">
              <stop offset="0%" stop-color="var(--primary)" stop-opacity="0.35" />
              <stop offset="100%" stop-color="var(--primary)" stop-opacity="0" />
            </radialGradient>
            <filter id="ac-glow" x="-70%" y="-70%" width="240%" height="240%">
              <feGaussianBlur stdDeviation="2.4" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* orbit tracks */}
          <For each={model().ringRadii}>
            {(r) => (
              <circle
                cx={C}
                cy={C}
                r={r}
                fill="none"
                stroke="var(--budget-bar-bg)"
                stroke-width="1.5"
                stroke-dasharray="1 6"
                stroke-linecap="round"
              />
            )}
          </For>

          {/* connector lines from core to each satellite */}
          <For each={model().nodes}>
            {(n) => (
              <line
                x1={C}
                y1={C}
                x2={n.x}
                y2={n.y}
                stroke={n.meta.color}
                stroke-width="1"
                opacity={dimmed(n.id) ? 0.05 : 0.18}
              />
            )}
          </For>

          {/* core halo + net worth */}
          <circle cx={C} cy={C} r={CORE_R + 46} fill="url(#ac-core)" />
          <circle
            cx={C}
            cy={C}
            r={CORE_R}
            fill="var(--card-bg)"
            stroke="var(--primary)"
            stroke-width="1.2"
            opacity="0.95"
          />
          <text x={C} y={C - 3} text-anchor="middle" class={styles.coreValue}>
            {money(model().total)}
          </text>
          <text x={C} y={C + 12} text-anchor="middle" class={styles.coreLabel}>
            NET WORTH
          </text>

          {/* satellites */}
          <For each={model().nodes}>
            {(n) => (
              <g
                class={styles.node}
                classList={{ [styles.nodeDim]: dimmed(n.id) }}
                onMouseEnter={() => setHover(n.id)}
                onMouseLeave={() => setHover(null)}
              >
                <circle cx={n.x} cy={n.y} r={n.rad + 4} fill={n.meta.color} opacity="0.14" />
                <circle
                  cx={n.x}
                  cy={n.y}
                  r={n.rad}
                  fill={n.meta.color}
                  filter="url(#ac-glow)"
                  opacity="0.92"
                >
                  <title>
                    {n.name}: {money(n.balance)}
                  </title>
                </circle>
              </g>
            )}
          </For>
        </svg>

        <ul class={styles.legend}>
          <For each={model().nodes}>
            {(n) => (
              <li
                class={styles.legendRow}
                classList={{ [styles.legendDim]: dimmed(n.id) }}
                onMouseEnter={() => setHover(n.id)}
                onMouseLeave={() => setHover(null)}
              >
                <i class={styles.legendDot} style={{ background: n.meta.color }} />
                <span class={styles.legendName}>
                  {n.name}
                  <span class={styles.legendType}>{n.meta.label}</span>
                </span>
                <span class={styles.legendAmount}>{money(n.balance)}</span>
              </li>
            )}
          </For>
        </ul>
      </div>
    </Show>
  )
}
