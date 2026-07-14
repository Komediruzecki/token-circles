/**
 * Dashboard Component
 */

import { createEffect, createSignal, For, Show } from 'solid-js'
import CalcTracer, { isCalcTracerEnabled } from '../components/CalcTracer'
import { getCategorySvg } from '../components/CategoryIcon'
import { ChartErrorBoundary } from '../components/ChartErrorBoundary'
import ChartWrapper from '../components/ChartWrapper'
import BudgetAlertsCard from '../components/Dashboard/BudgetAlertsCard'
import CategoryOrbits from '../components/Dashboard/CategoryOrbits'
import OverviewDeck from '../components/Dashboard/OverviewDeck'
import RecurringInsightsCard from '../components/Dashboard/RecurringInsightsCard'
import SavingsRateCard from '../components/Dashboard/SavingsRateCard'
import Sparkline from '../components/Dashboard/Sparkline'
import { DashboardSettings } from '../components/DashboardSettings'
import InfoTip from '../components/InfoTip'
import PeriodBar from '../components/PeriodBar'
import { api, apiGet, formatCurrency, formatDate, getLocalCurrency, toast } from '../core/api'
import { useAppState } from '../core/appStore'
import { usePeriod } from '../core/periodStore'
import { theme } from '../core/theme'
import { toRange, toYYYYMM } from '../utils/period'
import styles from './DashboardPage.module.css'
import { matchBrand } from './subscriptionBrands'
import type { CalcTrace } from '../components/CalcTracer'
import type { SankeyData } from '../types/models'
import type * as Models from '../types/models'

// Format money in the user's selected currency (not the EUR default of formatCurrency).
const money = (amount: number) => formatCurrency(amount, getLocalCurrency())

// The 'deck-*' ids form the Direction A overview deck (a fixed bento at the
// top of the page, rendered by OverviewDeck); they support show/hide but not
// reordering. Everything after them is the scroll-down tail, reorderable as
// before.
const DEFAULT_WIDGET_ORDER = [
  'metrics',
  'deck-sankey',
  'deck-heatmap',
  'deck-radar',
  'deck-trends',
  'deck-portfolio',
  'deck-transactions',
  'category-chart',
  'recent-transactions',
  'upcoming-bills',
  'savings-rate',
  'budget-alerts',
  'recurring-insights',
  'income-vs-expenses',
]

const DEFAULT_VISIBLE = [
  'metrics',
  'deck-sankey',
  'deck-heatmap',
  'deck-radar',
  'deck-trends',
  'deck-portfolio',
  'deck-transactions',
  'category-chart',
  'upcoming-bills',
  'budget-alerts',
]

function loadWidgetPrefs() {
  const saved = localStorage.getItem('dashboard_widgets')
  if (saved) {
    try {
      const parsed = JSON.parse(saved)
      const visible =
        parsed.visibleWidgets && Array.isArray(parsed.visibleWidgets)
          ? parsed.visibleWidgets
          : DEFAULT_VISIBLE
      const order =
        parsed.widgetOrder && Array.isArray(parsed.widgetOrder) && parsed.widgetOrder.length > 0
          ? parsed.widgetOrder
          : DEFAULT_WIDGET_ORDER
      // Widgets added after the user saved their layout: splice them in (a saved
      // order that predates a widget would otherwise hide it forever). An id
      // missing from the saved order is new — user-hidden ids stay in order.
      const newIds = DEFAULT_WIDGET_ORDER.filter((id) => !order.includes(id))
      for (const id of newIds) {
        order.splice(DEFAULT_WIDGET_ORDER.indexOf(id), 0, id)
        if (DEFAULT_VISIBLE.includes(id) && !visible.includes(id)) visible.push(id)
      }
      return { visible, order }
    } catch {
      /* ignore */
    }
  }
  return { visible: DEFAULT_VISIBLE, order: DEFAULT_WIDGET_ORDER }
}

export default function Dashboard() {
  const state = useAppState()
  const { period, helpers } = usePeriod()
  // Month/year and the "all time" flag derive from the global focus period.
  const focus = () => {
    const [y, m] = toYYYYMM(period()).split('-').map(Number)
    return { year: y, month: m } // month is 1-based
  }
  const month = () => focus().month
  const year = () => focus().year
  const [metrics, setMetrics] = createSignal<Models.DashboardMetrics | null>(null)
  const [monthlyData, setMonthlyData] = createSignal<Models.DashboardChartData | null>(null)
  const [initialLoad, setInitialLoad] = createSignal(true)

  // Human-readable label for the currently selected dashboard period
  const periodText = () => helpers.label(period())

  // Dev-mode calculation tracer (click an instrumented metric card to see the math)
  const tracerOn = isCalcTracerEnabled()
  const [trace, setTrace] = createSignal<CalcTrace | null>(null)
  const traceCardProps = (build: () => CalcTrace) =>
    tracerOn
      ? {
          onClick: () => setTrace(build()),
          style: { cursor: 'pointer' },
          title: 'Click to trace this calculation (dev mode)',
        }
      : {}
  const [showSettingsModal, setShowSettingsModal] = createSignal(false)
  // DashboardSettings registers its reset action here so the modal header can host the button.
  const [resetViews, setResetViews] = createSignal<(() => void) | null>(null)

  // The overview deck is the default view; the classic charts + widgets live
  // below a "show more" toggle (choice persisted).
  const [showMore, setShowMore] = createSignal(localStorage.getItem('dashboard_showMore') === '1')
  const toggleShowMore = () => {
    const next = !showMore()
    setShowMore(next)
    localStorage.setItem('dashboard_showMore', next ? '1' : '0')
  }

  const prefs = loadWidgetPrefs()
  const [visibleWidgets, setVisibleWidgets] = createSignal<string[]>(prefs.visible)
  const [widgetOrder, setWidgetOrder] = createSignal<string[]>(prefs.order)

  const [savingsGoal, setSavingsGoal] = createSignal(
    (() => {
      const stored = localStorage.getItem('savingsGoal')
      return stored ? parseFloat(stored) : 20
    })()
  )

  const handleSavingsGoalChange = (num: number) => {
    if (!isNaN(num) && num >= 0) {
      setSavingsGoal(num)
      localStorage.setItem('savingsGoal', String(num))
    }
  }

  // Everything follows the global focus period (and profile). Month/year modes
  // show the full net-worth trend; range/preset windows filter the timeline.
  createEffect(() => {
    const p = period()
    void state.profileVersion
    void loadDashboard()
    if (p.mode === 'range' && p.preset !== 'all') {
      const r = toRange(p)
      void loadMonthlyData(r.from, r.to)
    } else {
      void loadMonthlyData()
    }
  })

  const loadDashboard = async () => {
    try {
      const p = period()
      const isAll = p.preset === 'all'
      // Month mode passes month/year (keeps month-over-month deltas); range/year
      // modes pass an explicit date window.
      let dateFrom: string | undefined
      let dateTo: string | undefined
      if (!isAll && p.mode !== 'month') {
        const r = toRange(p)
        dateFrom = r.from
        dateTo = r.to
      }
      const data = await api.getDashboard(month(), year(), dateFrom, dateTo, isAll)
      setMetrics(data)
    } catch {
      toast('Failed to load dashboard', 'error')
    } finally {
      setInitialLoad(false)
    }
  }

  const loadMonthlyData = async (dateFrom?: string, dateTo?: string) => {
    try {
      const [chartsData, netWorthData] = await Promise.all([
        api.getDashboardCharts(12),
        api.getNetWorth(),
      ])
      let timeline = netWorthData.timeline
      if (dateFrom && dateTo) {
        timeline = timeline.filter((t) => {
          const [y, m] = t.month.split('-')
          const tDate = `${y}-${m.padStart(2, '0')}-01`
          const fromKey = `${dateFrom.slice(0, 7)}-01`
          const toKey = `${dateTo.slice(0, 7)}-31`
          return tDate >= fromKey && tDate <= toKey
        })
      }
      const fmtMonth = (month: string) => {
        const [y, m] = month.split('-')
        return new Date(parseInt(y), parseInt(m) - 1).toLocaleDateString('en-US', {
          month: 'short',
          year: 'numeric',
        })
      }
      const labels = timeline.map((t) => fmtMonth(t.month))
      const netWorth = timeline.map((t) => t.balance)
      // Real monthly income/expense stats (the net-worth timeline only knows
      // net change, which zeroes out whichever side is smaller).
      const monthly = chartsData.monthly || []
      setMonthlyData({
        labels,
        monthlyLabels: monthly.map((m) => fmtMonth(m.month)),
        income: monthly.map((m) => m.income || 0),
        expenses: monthly.map((m) => m.expense || 0),
        netWorth,
      })
    } catch {
      /* optional */
    }
  }

  const showSettings = () => setShowSettingsModal(true)

  const handleSettingsSave = () => {
    const prefs = loadWidgetPrefs()
    setVisibleWidgets(prefs.visible)
    setWidgetOrder(prefs.order)
    setShowSettingsModal(false)
  }

  const isWidgetVisible = (id: string) => visibleWidgets().includes(id)

  // Cash-flow Sankey (income → categories) for the selected month — the same
  // instrument as on Analytics, following the dashboard's period navigator.
  const [sankeyData, setSankeyData] = createSignal<SankeyData | null>(null)
  createEffect(() => {
    const y = year()
    const m = month()
    void state.profileVersion
    apiGet<{ nodes: SankeyData['nodes']; links: SankeyData['links'] }>(
      `/api/analytics/sankey?year=${y}&month=${m}`
    )
      .then((res) => setSankeyData({ nodes: res.nodes || [], links: res.links || [] }))
      .catch(() => setSankeyData(null))
  })

  const renderWidget = (id: string) => {
    switch (id) {
      case 'budget-alerts':
        return (
          <div class={styles.widgetCard}>
            <div class={styles.widgetHeader}>
              <div class={styles.widgetTitle}>Budget Alerts</div>
              <a href="#budgets" class={styles.widgetLink}>
                View All
              </a>
            </div>
            <BudgetAlertsCard />
          </div>
        )
      case 'savings-rate':
        return (
          <div class={styles.widgetCard}>
            <div class={styles.widgetHeader}>
              <div class={styles.widgetTitle}>Savings Rate</div>
              <a href="#budgets" class={styles.widgetLink}>
                Details
              </a>
            </div>
            <SavingsRateCard
              savingsRate={
                metrics()!.totalIncome > 0
                  ? ((metrics()!.totalIncome - metrics()!.totalExpenses) / metrics()!.totalIncome) *
                    100
                  : 0
              }
              monthlySavings={metrics()!.totalIncome - metrics()!.totalExpenses}
              goal={savingsGoal()}
              onGoalChange={handleSavingsGoalChange}
            />
          </div>
        )
      case 'category-chart':
        return (
          <div class={styles.card}>
            <div class={styles.cardHeader}>
              <div class={styles.cardTitle}>Spending by Category</div>
              <a href="#analytics" class={styles.widgetLink}>
                Trends →
              </a>
            </div>
            <ChartErrorBoundary title="Spending by Category chart">
              <CategoryOrbits
                categories={(metrics()!.expenseByCategory || []).map((item: any) => ({
                  category_name: item.category_name,
                  category_color: item.category_color,
                  amount: item.amount ?? item.total ?? 0,
                }))}
                periodText={periodText()}
              />
            </ChartErrorBoundary>
          </div>
        )
      case 'recent-transactions':
        return (
          <Show when={(metrics()!.recentTransactions?.length ?? 0) > 0}>
            <div class={styles.card}>
              <div class={styles.cardHeader}>
                <div class={styles.cardTitle}>Recent Transactions</div>
                <a href="#transactions" class={styles.btnLink}>
                  View All →
                </a>
              </div>
              <div class={styles.transactionList}>
                <For each={metrics()!.recentTransactions.slice(0, 5)}>
                  {(tx) => (
                    <div class={styles.transactionItem}>
                      <div
                        class={styles.transactionIcon}
                        style={{ background: getIconColor(tx.type) }}
                      >
                        {getIcon(tx.type)}
                      </div>
                      <div class={styles.transactionDetails}>
                        <div class={styles.transactionName}>{tx.description}</div>
                        <div class={styles.transactionMeta}>
                          {formatDate(tx.date)} •{' '}
                          {tx.category_name ||
                            (tx.category_id ? `#${tx.category_id}` : 'No category')}
                        </div>
                      </div>
                      <div
                        class={`${styles.transactionAmount} ${tx.type === 'expense' ? styles.expense : styles.income}`}
                      >
                        {tx.type === 'expense' ? '-' : '+'}
                        {money(tx.amount)}
                      </div>
                    </div>
                  )}
                </For>
              </div>
            </div>
          </Show>
        )
      case 'upcoming-bills':
        return (
          <Show when={(metrics()!.upcomingBills?.length ?? 0) > 0}>
            <div class={styles.card}>
              <div class={styles.cardHeader}>
                <div class={styles.cardTitle}>Upcoming Bills</div>
                <a href="#bills" class={styles.btnLink}>
                  View All →
                </a>
              </div>
              <div class={styles.transactionList}>
                <For each={metrics()!.upcomingBills.slice(0, 5)}>
                  {(bill: any) => {
                    const brand = matchBrand(bill.name, bill.category_color)
                    const isBrand = !!brand.displayName || bill.type === 'subscription'
                    const hasCategoryIcon = !!(bill.category_icon || bill.category_color)
                    return (
                      <div class={styles.transactionItem}>
                        <div
                          class={styles.transactionIcon}
                          style={
                            isBrand
                              ? { background: brand.bgColor, color: brand.color }
                              : hasCategoryIcon
                                ? { background: bill.category_color || getIconColor('expense') }
                                : { background: getIconColor('expense') }
                          }
                        >
                          <Show
                            when={isBrand}
                            fallback={
                              hasCategoryIcon ? (
                                getCategorySvg(bill.name, 18, bill.category_icon)
                              ) : (
                                <svg
                                  fill="none"
                                  stroke="currentColor"
                                  stroke-width="2"
                                  viewBox="0 0 24 24"
                                >
                                  <path
                                    stroke-linecap="round"
                                    stroke-linejoin="round"
                                    d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                                  />
                                </svg>
                              )
                            }
                          >
                            {brand.icon()}
                          </Show>
                        </div>
                        <div class={styles.transactionDetails}>
                          <div class={styles.transactionName}>{bill.name}</div>
                          <div class={styles.transactionMeta}>
                            Due {formatDate(bill.due_date)} • Due in {daysUntil(bill.due_date)}
                          </div>
                        </div>
                        <div class={`${styles.transactionAmount} ${styles.expense}`}>
                          {money(bill.amount)}
                        </div>
                      </div>
                    )
                  }}
                </For>
              </div>
            </div>
          </Show>
        )
      case 'recurring-insights':
        return (
          <div class={styles.card}>
            <div class={styles.cardHeader}>
              <div class={styles.cardTitle}>Recurring Insights</div>
            </div>
            <RecurringInsightsCard />
          </div>
        )
      case 'income-vs-expenses':
        return (
          <div class={styles.card} style="margin-bottom: 16px;">
            <div class={styles.cardHeader}>
              <div class={styles.cardTitle}>Income vs Expenses</div>
            </div>
            <div class={styles.chartContainer}>
              <ChartWrapper
                type="bar"
                data={{
                  labels: ['Income', 'Expenses', 'Net'],
                  datasets: [
                    {
                      label: 'Amount',
                      data: [
                        metrics()!.totalIncome || 0,
                        metrics()!.totalExpenses || 0,
                        (metrics()!.totalIncome || 0) - (metrics()!.totalExpenses || 0),
                      ],
                      backgroundColor: [
                        theme.getChartColors().income,
                        theme.getChartColors().expense,
                        (metrics()!.totalIncome || 0) - (metrics()!.totalExpenses || 0) >= 0
                          ? theme.getChartColors().income
                          : theme.getChartColors().expense,
                      ],
                      borderRadius: 8,
                    },
                  ],
                }}
                options={{ scales: { y: { grace: '10%' } } }}
                height={250}
                showExport
                filename="income-vs-expenses"
              />
            </div>
          </div>
        )
      default:
        return null
    }
  }

  return (
    <div data-test-id="dashboard-container">
      <div class={styles.pageHeader} data-test-id="dashboard-header" data-tour="dashboard-header">
        {/* Row 1: title left, view actions right. Row 2: all period controls. Keeping the
            period selectors off the title row is what lets everything breathe at any width. */}
        <div class={styles.headerTopRow}>
          <div class={styles.pageTitle}>
            <h2>Dashboard</h2>
            <p data-test-id="dashboard-subtitle">Your financial overview</p>
          </div>
          <div class={styles.headerButtons}>
            <button
              class={styles.btnSecondary}
              onClick={showSettings}
              data-test-id="dashboard-views"
              title="Show, hide and reorder dashboard widgets"
            >
              <svg
                width="16"
                height="16"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.964-7.178z"
                />
                <circle cx="12" cy="12" r="3" />
              </svg>
              Views
            </button>
            <button
              class={styles.btnPrimary}
              onClick={() => loadDashboard()}
              data-test-id="dashboard-refresh"
            >
              <svg
                width="16"
                height="16"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
              Refresh
            </button>
          </div>
        </div>
        <div class={styles.headerPeriodRow} data-tour="dashboard-period">
          <PeriodBar />
        </div>
      </div>

      {initialLoad() && !metrics() ? (
        <div class={styles.emptyState}>Loading...</div>
      ) : metrics() ? (
        <>
          {/* Metrics Grid — always visible */}
          <Show when={isWidgetVisible('metrics')}>
            <div
              class={styles.metricsGrid}
              data-test-id="dashboard-metrics"
              data-tour="dashboard-metrics"
            >
              <div
                class={`${styles.metricCard} ${styles.networth}`}
                data-test-id="dashboard-metric-networth"
                {...traceCardProps(() => ({
                  title: 'Net Worth',
                  formula: `Sum of all account balances (current)\n= ${money(metrics()!.balance)}`,
                  inputs: [
                    { label: 'Value', value: money(metrics()!.balance) },
                    { label: 'Scope', value: 'All accounts in the selected profiles' },
                  ],
                  note: 'From /api/dashboard — account balances are maintained per transaction and not filtered by the selected period.',
                }))}
              >
                <div class={styles.metricLabel}>
                  Net Worth
                  <InfoTip text="Sum of all account balances right now (not period-filtered)" />
                </div>
                <div class={styles.metricValue} data-test-id="dashboard-metric-networth-value">
                  {money(metrics()!.balance)}
                </div>
                <div class={styles.metricSubtext}>Total account balances</div>
                {/* eslint-disable-next-line eqeqeq */}
                {metrics()!.momBalanceDelta != null && (
                  <div class={styles.metricDelta}>
                    <span
                      class={
                        metrics()!.momBalanceDelta! > 0
                          ? styles.positive
                          : metrics()!.momBalanceDelta! < 0
                            ? styles.negative
                            : styles.neutral
                      }
                    >
                      {metrics()!.momBalanceDelta! > 0
                        ? '↑'
                        : metrics()!.momBalanceDelta! < 0
                          ? '↓'
                          : '→'}
                      {Math.abs(metrics()!.momBalanceDelta!).toFixed(2)}
                    </span>
                    <span class={styles.metricDeltaLabel}>vs last month</span>
                  </div>
                )}
                <Show when={monthlyData()}>
                  <div class={styles.metricSpark}>
                    <Sparkline
                      data={monthlyData()!.netWorth.slice(-12)}
                      color="var(--accent-warm)"
                    />
                  </div>
                </Show>
              </div>
              <div
                class={`${styles.metricCard} ${styles.income}`}
                data-test-id="dashboard-metric-income"
                {...traceCardProps(() => ({
                  title: 'Income',
                  formula: `Sum of income transactions in ${periodText()}\n= ${money(metrics()!.totalIncome)}`,
                  inputs: [
                    { label: 'Period', value: periodText() },
                    { label: 'Total', value: money(metrics()!.totalIncome) },
                  ],
                  note: 'From /api/dashboard for the selected period. See the Transactions page filtered to income for the contributing rows.',
                }))}
              >
                <div class={styles.metricLabel}>
                  Income
                  <InfoTip text={`Sum of income transactions in ${periodText()}`} />
                </div>
                <div class={`${styles.metricValue} ${styles.positive}`}>
                  {money(metrics()!.totalIncome)}
                </div>
                <div class={styles.metricSubtext}>For this period</div>
                {/* eslint-disable-next-line eqeqeq */}
                {metrics()!.momIncomeDelta != null && (
                  <div class={styles.metricDelta}>
                    <span
                      class={
                        metrics()!.momIncomeDelta! > 0
                          ? styles.positive
                          : metrics()!.momIncomeDelta! < 0
                            ? styles.negative
                            : styles.neutral
                      }
                    >
                      {metrics()!.momIncomeDelta! > 0
                        ? '↑'
                        : metrics()!.momIncomeDelta! < 0
                          ? '↓'
                          : '→'}
                      {Math.abs(metrics()!.momIncomeDelta!).toFixed(2)}
                    </span>
                    <span class={styles.metricDeltaLabel}>vs last month</span>
                  </div>
                )}
                <Show when={monthlyData()}>
                  <div class={styles.metricSpark}>
                    <Sparkline data={monthlyData()!.income.slice(-12)} color="var(--income)" />
                  </div>
                </Show>
              </div>
              <div
                class={`${styles.metricCard} ${styles.expense}`}
                data-test-id="dashboard-metric-expenses"
                {...traceCardProps(() => ({
                  title: 'Expenses',
                  formula: `Sum of expense transactions in ${periodText()}\n= ${money(metrics()!.totalExpenses)}`,
                  inputs: [
                    { label: 'Period', value: periodText() },
                    { label: 'Total', value: money(metrics()!.totalExpenses) },
                  ],
                  note: 'From /api/dashboard for the selected period. See the Transactions page filtered to expenses for the contributing rows.',
                }))}
              >
                <div class={styles.metricLabel}>
                  Expenses
                  <InfoTip text={`Sum of expense transactions in ${periodText()}`} />
                </div>
                <div class={`${styles.metricValue} ${styles.expense}`}>
                  {money(metrics()!.totalExpenses)}
                </div>
                <div class={styles.metricSubtext}>For this period</div>
                {/* eslint-disable-next-line eqeqeq */}
                {metrics()!.momExpenseDelta != null && (
                  <div class={styles.metricDelta}>
                    <span
                      class={
                        metrics()!.momExpenseDelta! > 0
                          ? styles.positive
                          : metrics()!.momExpenseDelta! < 0
                            ? styles.negative
                            : styles.neutral
                      }
                    >
                      {metrics()!.momExpenseDelta! > 0
                        ? '↑'
                        : metrics()!.momExpenseDelta! < 0
                          ? '↓'
                          : '→'}
                      {Math.abs(metrics()!.momExpenseDelta!).toFixed(2)}
                    </span>
                    <span class={styles.metricDeltaLabel}>vs last month</span>
                  </div>
                )}
                <Show when={monthlyData()}>
                  <div class={styles.metricSpark}>
                    <Sparkline data={monthlyData()!.expenses.slice(-12)} color="var(--expense)" />
                  </div>
                </Show>
              </div>
              <div
                class={`${styles.metricCard} ${styles.balance}`}
                {...traceCardProps(() => ({
                  title: 'Balance',
                  formula: `Income − Expenses for ${periodText()}\n= ${money(metrics()!.totalIncome)} − ${money(metrics()!.totalExpenses)}\n= ${money(metrics()!.totalIncome - metrics()!.totalExpenses)}`,
                  inputs: [
                    { label: 'Period', value: periodText() },
                    { label: 'Income', value: money(metrics()!.totalIncome) },
                    { label: 'Expenses', value: money(metrics()!.totalExpenses) },
                  ],
                }))}
              >
                <div class={styles.metricLabel}>
                  Balance
                  <InfoTip text={`Income − expenses in ${periodText()}`} />
                </div>
                <div
                  class={`${styles.metricValue} ${metrics()!.totalIncome - metrics()!.totalExpenses >= 0 ? styles.positive : styles.expense}`}
                >
                  {money(metrics()!.totalIncome - metrics()!.totalExpenses)}
                </div>
                <div class={styles.metricSubtext}>Monthly net</div>
                <Show when={monthlyData()}>
                  <div class={styles.metricSpark}>
                    <Sparkline
                      data={monthlyData()!
                        .income.slice(-12)
                        .map((v, i) => v - monthlyData()!.expenses.slice(-12)[i])}
                      color="var(--primary)"
                    />
                  </div>
                </Show>
              </div>
            </div>
          </Show>

          {/* Direction A overview deck — the default "mission control" view.
              Panels are individually hideable via Views; the classic widgets
              and charts continue below the fold. */}
          <OverviewDeck
            visible={isWidgetVisible}
            year={year()}
            month={month()}
            periodText={periodText()}
            sankeyData={sankeyData()}
            monthlyData={monthlyData()}
            totalIncome={metrics()!.totalIncome || 0}
            totalExpenses={metrics()!.totalExpenses || 0}
            recentTransactions={metrics()!.recentTransactions || []}
          />

          {/* Show more — reveals the classic charts + widget tail below the deck. */}
          <button
            type="button"
            class={styles.showMoreToggle}
            data-test-id="dashboard-show-more"
            onClick={toggleShowMore}
            aria-expanded={showMore()}
          >
            {showMore() ? 'Show less' : 'Show more'}
            <svg
              viewBox="0 0 16 16"
              class={styles.showMoreChevron}
              classList={{ [styles.showMoreChevronOpen]: showMore() }}
              fill="none"
              stroke="currentColor"
              stroke-width="1.6"
              aria-hidden="true"
            >
              <path d="M4 6l4 4 4-4" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </button>

          <Show when={showMore()}>
            {/* Charts Section */}
            <div
              class={styles.chartsGrid}
              role="region"
              aria-label="charts overview"
              data-test-id="dashboard-charts"
              data-tour="dashboard-charts"
            >
              <div class={styles.card}>
                <div class={styles.cardHeader}>
                  <div class={styles.cardTitle}>Net Worth Over Time</div>
                </div>
                <div class={styles.chartContainerTall}>
                  {monthlyData() ? (
                    <ChartErrorBoundary title="Net Worth chart">
                      <ChartWrapper
                        type="line"
                        data={{
                          labels: monthlyData()!.labels,
                          datasets: [
                            {
                              label: 'Net Worth',
                              data: monthlyData()!.netWorth,
                              borderColor: theme.getChartColors().primary,
                              backgroundColor: theme.getChartColors().primaryBg,
                              fill: true,
                              tension: 0.4,
                            },
                          ],
                        }}
                        height={320}
                        variant="tall"
                        showExport
                        filename="net-worth-over-time"
                      />
                    </ChartErrorBoundary>
                  ) : (
                    <div class={styles.emptyState}>Loading chart data...</div>
                  )}
                </div>
              </div>
              <div class={styles.card}>
                <div class={styles.cardHeader}>
                  <div class={styles.cardTitle}>Cash Flow (12 Months)</div>
                </div>
                <div class={styles.chartContainerMedium}>
                  {monthlyData() ? (
                    <ChartErrorBoundary title="Cash Flow chart">
                      <ChartWrapper
                        type="line"
                        data={{
                          labels: monthlyData()!.monthlyLabels,
                          datasets: [
                            {
                              label: 'Income',
                              data: monthlyData()!.income,
                              borderColor: theme.getChartColors().income,
                              backgroundColor: theme.getChartColors().incomeBg,
                              fill: true,
                              tension: 0.4,
                            },
                            {
                              label: 'Expenses',
                              data: monthlyData()!.expenses,
                              borderColor: theme.getChartColors().expense,
                              backgroundColor: theme.getChartColors().expenseBg,
                              fill: true,
                              tension: 0.4,
                            },
                          ],
                        }}
                        height={300}
                        variant="medium"
                        showExport
                        filename="cash-flow-12months"
                      />
                    </ChartErrorBoundary>
                  ) : (
                    <div class={styles.emptyState}>Loading chart data...</div>
                  )}
                </div>
              </div>
            </div>

            {/* Dynamic Widgets — rendered in saved order, only visible widgets shown */}
            <For each={widgetOrder()}>
              {(widgetId) => (
                <>
                  {isWidgetVisible(widgetId) &&
                  widgetId !== 'metrics' &&
                  !widgetId.startsWith('deck-')
                    ? renderWidget(widgetId)
                    : null}
                </>
              )}
            </For>
          </Show>

          {/* Widget Settings Modal */}
          <Show when={showSettingsModal()}>
            <div class={styles.modalOverlay} onClick={() => setShowSettingsModal(false)}>
              <div
                class={`${styles.modal} ${styles.modalMd}`}
                onClick={(e) => {
                  e.stopPropagation()
                }}
              >
                <div class={styles.modalHeader}>
                  <div class={styles.modalTitle}>Dashboard Views</div>
                  <div class={styles.modalHeaderActions}>
                    <button class={styles.headerResetBtn} onClick={() => resetViews()?.()}>
                      Reset Default
                    </button>
                    <button
                      class={styles.modalClose}
                      onClick={() => setShowSettingsModal(false)}
                      aria-label="Close"
                    >
                      <svg
                        width="20"
                        height="20"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        viewBox="0 0 24 24"
                      >
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          d="M6 18L18 6M6 6l12 12"
                        />
                      </svg>
                    </button>
                  </div>
                </div>
                <div class={styles.modalBody}>
                  <DashboardSettings
                    onSave={handleSettingsSave}
                    registerReset={(fn) => setResetViews(() => fn)}
                  />
                </div>
              </div>
            </div>
          </Show>
        </>
      ) : (
        <div class={styles.emptyState}>Failed to load data</div>
      )}
      <CalcTracer trace={trace()} onClose={() => setTrace(null)} />
    </div>
  )
}

function getIcon(type: string) {
  if (type === 'income') {
    return (
      <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M7 11l5-5m0 0l5 5m-5-5v12"
        />
      </svg>
    )
  }
  return (
    <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke-width="2"
        d="M17 13l-5 5m0 0l-5-5m5 5V6"
      />
    </svg>
  )
}

function getIconColor(type: string): string {
  return type === 'expense' ? 'var(--danger)' : 'var(--income)'
}

function daysUntil(dateStr: string): string {
  const target = new Date(dateStr)
  const today = new Date()
  const diff = target.getTime() - today.getTime()
  const days = Math.ceil(diff / (1000 * 60 * 60 * 24))
  if (days < 0) return `${Math.abs(days)} days overdue`
  if (days === 0) return 'Due today'
  if (days === 1) return 'Due tomorrow'
  return `Due in ${days} days`
}
