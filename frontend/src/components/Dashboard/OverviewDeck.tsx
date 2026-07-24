/**
 * OverviewDeck — the Direction A dashboard bento, mirroring the approved
 * concept render: Cash-flow Sankey (top left), spending heatmap (top
 * right), budget radar (bottom left), glowing trend lines (bottom middle),
 * portfolio list (bottom right), and a transactions strip across the
 * bottom. Each panel is individually hideable through the dashboard's
 * widget settings; everything not in the deck lives below the fold.
 */
import { createMemo, createResource, For, Show } from 'solid-js'
import { apiHouseholdGet, formatCurrency, formatDate, getLocalCurrency } from '../../core/api'
import { useAppState } from '../../core/appStore'
import SankeyChart from '../SankeyChart'
import styles from './OverviewDeck.module.css'
import Sparkline from './Sparkline'
import type { SankeyData, Transaction } from '../../types/models'

const money = (amount: number) => formatCurrency(amount, getLocalCurrency())

interface BudgetAlert {
  budgetAmount: number
  spent: number
}

interface Holding {
  id: number
  ticker: string
  shares: number
  purchase_price: number
}

export interface OverviewDeckProps {
  visible: (id: string) => boolean
  year: number
  month: number
  periodText: string
  sankeyData: SankeyData | null
  monthlyData: { income: number[]; expenses: number[]; netWorth: number[] } | null
  totalIncome: number
  totalExpenses: number
  recentTransactions: Transaction[]
}

const MONTH_LETTERS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D']
const HOLDING_DOTS = ['#6e9bff', '#f0a860', '#59d2a2', '#c9a0ff', '#4fb3d9']

export default function OverviewDeck(props: OverviewDeckProps) {
  const state = useAppState()

  // ── Spending heatmap: month × week-of-month intensity for the year ──
  const [heatmap] = createResource(
    () => ({ year: props.year, pv: state.profileVersion }),
    async ({ year }) => {
      const res = await apiHouseholdGet<{ dates: Record<string, number> }>(
        `/api/analytics/daily-heatmap?year=${year}&type=expense`
      )
      const cells: number[][] = Array.from({ length: 5 }, () => Array(12).fill(0))
      for (const [date, amount] of Object.entries(res.dates || {})) {
        const m = Number(date.slice(5, 7)) - 1
        const week = Math.min(4, Math.floor((Number(date.slice(8, 10)) - 1) / 7))
        if (m >= 0 && m < 12) cells[week][m] += amount
      }
      const max = Math.max(1, ...cells.flat())
      return { cells, max }
    }
  )

  // `.latest` keeps the previous data rendered during refetches and never re-triggers
  // the page-level <Suspense> (a plain resource read would flash the whole page).
  const heat = () => heatmap.latest

  // ── Budget radar: total budgeted vs spent (threshold=0 → all budgets) ──
  const [budgets] = createResource(
    () => ({ pv: state.profileVersion }),
    async () => {
      const data = (await apiHouseholdGet<{ alerts: BudgetAlert[] }>(
        '/api/budgets/alerts?threshold=0'
      )) as {
        alerts?: BudgetAlert[]
      }
      const alerts = Array.isArray(data?.alerts) ? data.alerts : []
      const budget = alerts.reduce((s, a) => s + (a.budgetAmount || 0), 0)
      const spent = alerts.reduce((s, a) => s + (a.spent || 0), 0)
      return { budget, spent, pct: budget > 0 ? (spent / budget) * 100 : 0 }
    }
  )

  // ── Portfolio list ──
  const [portfolio] = createResource(
    () => ({ pv: state.profileVersion }),
    async () => {
      const holdings = await apiHouseholdGet<Holding[]>('/api/portfolio/holdings')
      const rows = (Array.isArray(holdings) ? holdings : [])
        .map((h) => ({ ...h, value: h.shares * h.purchase_price }))
        .sort((a, b) => b.value - a.value)
      const total = rows.reduce((s, h) => s + h.value, 0)
      return { rows: rows.slice(0, 5), total }
    }
  )

  // Same `.latest` treatment as the heatmap for the other two deck resources.
  const radar = () => budgets.latest
  const folio = () => portfolio.latest

  const expenseRatio = createMemo(() =>
    props.totalIncome > 0 ? (props.totalExpenses / props.totalIncome) * 100 : 0
  )

  const trendRows = createMemo(() => {
    const md = props.monthlyData
    if (!md) return []
    const last = (a: number[]) => a[a.length - 1] ?? 0
    const prev = (a: number[]) => a[a.length - 2] ?? last(a)
    const delta = (a: number[]) => {
      const p = prev(a)
      return p !== 0 ? ((last(a) - p) / Math.abs(p)) * 100 : 0
    }
    return [
      {
        label: 'Net worth',
        series: md.netWorth.slice(-12),
        color: 'var(--primary)',
        d: delta(md.netWorth),
      },
      {
        label: 'Income',
        series: md.income.slice(-12),
        color: 'var(--income)',
        d: delta(md.income),
      },
      {
        label: 'Expenses',
        series: md.expenses.slice(-12),
        color: 'var(--expense)',
        d: delta(md.expenses),
        badIfUp: true,
      },
    ]
  })

  // Budget radar geometry: two concentric arcs (outer: budget spent, inner:
  // expenses vs income) on dotted tracks, with an animated sweep line.
  const arc = (r: number, pct: number) => {
    const c = 2 * Math.PI * r
    return `${(Math.max(0, Math.min(100, pct)) / 100) * c} ${c}`
  }

  const txIcon = (type: string) => (type === 'income' ? '↑' : type === 'expense' ? '↓' : '⇄')

  return (
    <div class={styles.deck} data-test-id="dashboard-overview-deck" data-tour="overview-deck">
      {/* ── Cash flow Sankey ── */}
      <Show when={props.visible('deck-sankey')}>
        <section class={`${styles.panel} ${styles.sankey}`}>
          <header class={styles.panelHeader}>
            <h3 class={styles.panelTitle}>Cash flow</h3>
            <a href="#analytics" class={styles.panelMore}>
              {props.periodText} →
            </a>
          </header>
          <Show
            when={props.sankeyData?.nodes?.length && props.sankeyData?.links?.length}
            fallback={<p class={styles.empty}>No flows for {props.periodText} yet.</p>}
          >
            <SankeyChart data={props.sankeyData!} height={280} />
          </Show>
        </section>
      </Show>

      {/* ── Spending heatmap ── */}
      <Show when={props.visible('deck-heatmap')}>
        <section class={`${styles.panel} ${styles.heatmap}`}>
          <header class={styles.panelHeader}>
            <h3 class={styles.panelTitle}>Spending heatmap</h3>
            <a href="#analytics" class={styles.panelMore}>
              {props.year} →
            </a>
          </header>
          <Show when={heat()} fallback={<p class={styles.empty}>Loading…</p>}>
            <div class={styles.heatGrid}>
              <span></span>
              <For each={MONTH_LETTERS}>{(m) => <span class={styles.heatMonth}>{m}</span>}</For>
              <For each={heat()!.cells}>
                {(row, w) => (
                  <>
                    <span class={styles.heatWeek}>{w() + 1}</span>
                    <For each={row}>
                      {(v) => {
                        const t = v / heat()!.max
                        return (
                          <span
                            class={styles.heatCell}
                            classList={{ [styles.heatHot]: t > 0.72 }}
                            style={{
                              background:
                                t === 0
                                  ? 'rgba(110,155,255,0.06)'
                                  : `rgba(110,155,255,${0.14 + t * 0.78})`,
                            }}
                            title={money(v)}
                          />
                        )
                      }}
                    </For>
                  </>
                )}
              </For>
            </div>
          </Show>
        </section>
      </Show>

      {/* ── Budget radar ── */}
      <Show when={props.visible('deck-radar')}>
        <section class={`${styles.panel} ${styles.radar}`}>
          <header class={styles.panelHeader}>
            <h3 class={styles.panelTitle}>Budget radar</h3>
            <a href="#budgets" class={styles.panelMore}>
              Budgets →
            </a>
          </header>
          <div class={styles.radarBody}>
            <svg viewBox="0 0 150 150" class={styles.radarSvg} aria-hidden="true">
              <defs>
                <linearGradient id="deck-arc" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0" stop-color="var(--primary-hover, #93b4ff)" />
                  <stop offset="1" stop-color="var(--primary, #6e9bff)" />
                </linearGradient>
              </defs>
              <circle
                cx="75"
                cy="75"
                r="62"
                fill="none"
                stroke="var(--budget-bar-bg)"
                stroke-width="3"
                stroke-dasharray="1 5"
                stroke-linecap="round"
              />
              <circle
                cx="75"
                cy="75"
                r="46"
                fill="none"
                stroke="var(--budget-bar-bg)"
                stroke-width="3"
                stroke-dasharray="1 5"
                stroke-linecap="round"
              />
              <circle
                cx="75"
                cy="75"
                r="30"
                fill="none"
                stroke="var(--budget-bar-bg)"
                stroke-width="2.5"
                stroke-dasharray="1 4"
                stroke-linecap="round"
              />
              <circle
                cx="75"
                cy="75"
                r="62"
                fill="none"
                stroke="url(#deck-arc)"
                stroke-width="4.5"
                stroke-linecap="round"
                stroke-dasharray={arc(62, radar()?.pct ?? 0)}
                transform="rotate(-90 75 75)"
              />
              <circle
                cx="75"
                cy="75"
                r="46"
                fill="none"
                stroke="var(--accent-warm, #f0a860)"
                opacity="0.85"
                stroke-width="4"
                stroke-linecap="round"
                stroke-dasharray={arc(46, expenseRatio())}
                transform="rotate(-90 75 75)"
              />
              <line
                x1="75"
                y1="75"
                x2="75"
                y2="16"
                stroke="var(--primary)"
                stroke-width="1"
                opacity="0.55"
                class={styles.radarSweep}
              />
              <circle cx="75" cy="75" r="3.5" fill="var(--primary)" />
            </svg>
            <div class={styles.radarStats}>
              <p class={styles.radarPct}>{(radar()?.pct ?? 0).toFixed(0)}%</p>
              <p class={styles.radarPctLabel}>of budget spent</p>
              <ul class={styles.radarLegend}>
                <li>
                  <i style={{ background: 'var(--primary)' }} />
                  Budget · {money(radar()?.spent ?? 0)} of {money(radar()?.budget ?? 0)}
                </li>
                <li>
                  <i style={{ background: 'var(--accent-warm)' }} />
                  Expenses · {expenseRatio().toFixed(0)}% of income
                </li>
              </ul>
            </div>
          </div>
        </section>
      </Show>

      {/* ── Trends (glowing lines) ── */}
      <Show when={props.visible('deck-trends')}>
        <section class={`${styles.panel} ${styles.trends}`}>
          <header class={styles.panelHeader}>
            <h3 class={styles.panelTitle}>Trends</h3>
            <a href="#analytics" class={styles.panelMore}>
              12 months →
            </a>
          </header>
          <div class={styles.trendList}>
            <For each={trendRows()}>
              {(row) => (
                <div class={styles.trendRow}>
                  <div class={styles.trendMeta}>
                    <p class={styles.trendLabel}>{row.label}</p>
                    <p class={styles.trendValue}>{money(row.series[row.series.length - 1] ?? 0)}</p>
                  </div>
                  <div class={styles.trendSpark}>
                    <Sparkline data={row.series} color={row.color} glow height={34} />
                  </div>
                  <p
                    class={styles.trendDelta}
                    classList={{
                      [styles.up]: row.badIfUp ? row.d < 0 : row.d >= 0,
                      [styles.down]: row.badIfUp ? row.d >= 0 : row.d < 0,
                    }}
                  >
                    {row.d >= 0 ? '▲' : '▼'} {Math.abs(row.d).toFixed(1)}%
                  </p>
                </div>
              )}
            </For>
          </div>
        </section>
      </Show>

      {/* ── Portfolio ── */}
      <Show when={props.visible('deck-portfolio')}>
        <section class={`${styles.panel} ${styles.portfolio}`}>
          <header class={styles.panelHeader}>
            <h3 class={styles.panelTitle}>Portfolio</h3>
            <a href="#portfolio" class={styles.panelMore}>
              {money(folio()?.total ?? 0)} →
            </a>
          </header>
          <Show
            when={folio()?.rows.length}
            fallback={<p class={styles.empty}>No holdings yet — add one on the Portfolio page.</p>}
          >
            <ul class={styles.holdingList}>
              <For each={folio()!.rows}>
                {(h, i) => (
                  <li class={styles.holdingRow}>
                    <i
                      class={styles.holdingDot}
                      style={{ background: HOLDING_DOTS[i() % HOLDING_DOTS.length] }}
                    />
                    <div class={styles.holdingMeta}>
                      <p class={styles.holdingTicker}>{h.ticker}</p>
                      <p class={styles.holdingShares}>{h.shares} shares</p>
                    </div>
                    <p class={styles.holdingValue}>{money(h.value)}</p>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </section>
      </Show>

      {/* ── Transactions strip ── */}
      <Show when={props.visible('deck-transactions') && props.recentTransactions.length > 0}>
        <section class={`${styles.panel} ${styles.txStrip}`} data-test-id="dashboard-transactions">
          <header class={styles.panelHeader}>
            <h3 class={styles.panelTitle}>Transactions</h3>
            <a href="#transactions" class={styles.panelMore}>
              View all →
            </a>
          </header>
          <div class={styles.txRow}>
            <For each={props.recentTransactions.slice(0, 4)}>
              {(tx) => (
                <div class={styles.txItem} data-test-id="dashboard-transaction-item">
                  <span
                    class={styles.txIcon}
                    classList={{
                      [styles.txIncome]: tx.type === 'income',
                      [styles.txExpense]: tx.type === 'expense',
                    }}
                  >
                    {txIcon(tx.type)}
                  </span>
                  <div class={styles.txMeta}>
                    <p class={styles.txName}>{tx.description}</p>
                    <p class={styles.txDate}>{formatDate(tx.date)}</p>
                  </div>
                  <p
                    class={styles.txAmount}
                    classList={{
                      [styles.up]: tx.type === 'income',
                      [styles.down]: tx.type === 'expense',
                    }}
                  >
                    {tx.type === 'expense' ? '-' : '+'}
                    {money(tx.amount)}
                  </p>
                </div>
              )}
            </For>
          </div>
        </section>
      </Show>
    </div>
  )
}
