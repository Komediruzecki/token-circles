/**
 * Dashboard Component
 */

import { createEffect, createSignal, For, onMount, Show } from 'solid-js'
import CalcTracer, { isCalcTracerEnabled } from '../components/CalcTracer'
import { ChartErrorBoundary } from '../components/ChartErrorBoundary'
import ChartWrapper from '../components/ChartWrapper'
import BudgetAlertsCard from '../components/Dashboard/BudgetAlertsCard'
import { PeriodNavigator } from '../components/Dashboard/PeriodNavigator'
import RecurringInsightsCard from '../components/Dashboard/RecurringInsightsCard'
import SavingsRateCard from '../components/Dashboard/SavingsRateCard'
import { DashboardSettings } from '../components/DashboardSettings'
import InfoTip from '../components/InfoTip'
import { PeriodPills } from '../components/PeriodPills'
import { api, formatCurrency, formatDate, getLocalCurrency, toast } from '../core/api'
import { useAppState } from '../core/appStore'
import { theme } from '../core/theme'
import styles from './DashboardPage.module.css'
import type { CalcTrace } from '../components/CalcTracer'
import type * as Models from '../types/models'

// Format money in the user's selected currency (not the EUR default of formatCurrency).
const money = (amount: number) => formatCurrency(amount, getLocalCurrency())

const DEFAULT_WIDGET_ORDER = [
  'metrics',
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
  'category-chart',
  'recent-transactions',
  'upcoming-bills',
  'savings-rate',
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
      return { visible, order }
    } catch {
      /* ignore */
    }
  }
  return { visible: DEFAULT_VISIBLE, order: DEFAULT_WIDGET_ORDER }
}

// Constellation palette for categorical charts — azure-anchored with warm
// and mint counterpoints, readable on both the night and daylight grounds.
const CATEGORY_PALETTE = [
  '#6e9bff',
  '#f0a860',
  '#59d2a2',
  '#e0708a',
  '#93b4ff',
  '#e8c268',
  '#4fb3d9',
  '#c9a0ff',
  '#7182a8',
  '#3b6fe0',
]

export default function Dashboard() {
  const state = useAppState()
  // Default to the current month/year (previously hard-coded to May 2026, which
  // left the dashboard stuck on a past month once the real date moved on).
  const [month, setMonth] = createSignal(new Date().getMonth() + 1)
  const [year, setYear] = createSignal(new Date().getFullYear())
  const [metrics, setMetrics] = createSignal<Models.DashboardMetrics | null>(null)
  const [monthlyData, setMonthlyData] = createSignal<Models.DashboardChartData | null>(null)
  const [loading, setLoading] = createSignal(true)
  const [pillPeriod, setPillPeriod] = createSignal('month')
  const [allTime, setAllTime] = createSignal(false)

  // Human-readable label for the currently selected dashboard period
  const periodText = () =>
    allTime()
      ? 'all time'
      : new Date(year(), month() - 1).toLocaleDateString('en-US', {
          month: 'long',
          year: 'numeric',
        })

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
  const [dataMinYear, setDataMinYear] = createSignal<number | undefined>(undefined)
  const [dataMaxYear, setDataMaxYear] = createSignal<number | undefined>(undefined)
  const [dataYears, setDataYears] = createSignal<number[] | undefined>(undefined)
  const [showSettingsModal, setShowSettingsModal] = createSignal(false)
  // DashboardSettings registers its reset action here so the modal header can host the button.
  const [resetViews, setResetViews] = createSignal<(() => void) | null>(null)

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

  onMount(() => {
    void loadMonthlyData()
    void loadYearRange()
  })

  createEffect(() => {
    void state.profileVersion
    void loadMonthlyData()
    void loadYearRange()
  })

  createEffect(() => {
    month()
    year()
    if (!allTime()) {
      void loadDashboard()
    }
  })

  const loadDashboard = async (dateFrom?: string, dateTo?: string) => {
    setLoading(true)
    try {
      const data = await api.getDashboard(month(), year(), dateFrom, dateTo, allTime())
      setMetrics(data)
    } catch {
      toast('Failed to load dashboard', 'error')
    } finally {
      setLoading(false)
    }
  }

  const loadYearRange = async () => {
    try {
      const { minYear, maxYear, years } = await api.getTransactionYears()
      setDataMinYear(minYear)
      setDataMaxYear(maxYear)
      setDataYears(years.length > 0 ? years : undefined)
    } catch {
      /* keep defaults */
    }
  }

  const loadMonthlyData = async (dateFrom?: string, dateTo?: string) => {
    try {
      const [_chartsData, netWorthData] = await Promise.all([
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
      const labels = timeline.map((t) => {
        const [y, m] = t.month.split('-')
        const date = new Date(parseInt(y), parseInt(m) - 1)
        return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
      })
      const netWorth = timeline.map((t) => t.balance)
      const income = timeline.map((t) => (t.netChange > 0 ? t.netChange : 0))
      const expenses = timeline.map((t) => (t.netChange < 0 ? Math.abs(t.netChange) : 0))
      setMonthlyData({ labels, income, expenses, netWorth })
    } catch {
      /* optional */
    }
  }

  const handlePillChange = async (pillId: string) => {
    setPillPeriod(pillId)
    setAllTime(pillId === 'all')
    const now = new Date()
    const fmt = (d: Date) => d.toISOString().slice(0, 10)

    let dateFrom = ''
    let dateTo = ''
    let m = now.getMonth() + 1
    const y = now.getFullYear()

    switch (pillId) {
      case 'today':
        dateFrom = fmt(now)
        dateTo = fmt(now)
        break
      case 'week': {
        const dayOfWeek = now.getDay()
        const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek
        const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + mondayOffset)
        const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6)
        dateFrom = fmt(monday)
        dateTo = fmt(sunday)
        break
      }
      case 'month':
        dateFrom = fmt(new Date(y, m - 1, 1))
        dateTo = fmt(new Date(y, m, 0))
        break
      case 'quarter': {
        const qStartMonth = Math.floor((m - 1) / 3) * 3
        dateFrom = fmt(new Date(y, qStartMonth, 1))
        dateTo = fmt(new Date(y, qStartMonth + 3, 0))
        m = qStartMonth + 1
        break
      }
      case 'year':
        dateFrom = fmt(new Date(y, 0, 1))
        dateTo = fmt(new Date(y, 11, 31))
        break
      case 'last7':
        dateFrom = fmt(new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000))
        dateTo = fmt(now)
        break
      case 'last30':
        dateFrom = fmt(new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000))
        dateTo = fmt(now)
        break
      case 'last90':
        dateFrom = fmt(new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000))
        dateTo = fmt(now)
        break
      case 'all':
        dateFrom = ''
        dateTo = ''
        m = now.getMonth() + 1
        break
    }

    setMonth(m)
    setYear(y)
    await Promise.all([
      loadDashboard(dateFrom, dateTo),
      loadMonthlyData(dateFrom || undefined, dateTo || undefined),
    ])
  }

  const showSettings = () => setShowSettingsModal(true)

  const handleSettingsSave = () => {
    const prefs = loadWidgetPrefs()
    setVisibleWidgets(prefs.visible)
    setWidgetOrder(prefs.order)
    setShowSettingsModal(false)
  }

  const isWidgetVisible = (id: string) => visibleWidgets().includes(id)

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
            </div>
            <div class={styles.chartContainerTall}>
              {metrics()!.expenseByCategory && metrics()!.expenseByCategory.length > 0 ? (
                <ChartErrorBoundary title="Spending by Category chart">
                  <ChartWrapper
                    type="doughnut"
                    data={{
                      labels: metrics()!.expenseByCategory.map(
                        (item: any) => item.category_name || 'Uncategorized'
                      ),
                      datasets: [
                        {
                          data: metrics()!.expenseByCategory.map((item: any) => item.total),
                          backgroundColor: CATEGORY_PALETTE,
                        },
                      ],
                    }}
                    options={{
                      plugins: {
                        legend: {
                          position: 'right',
                          align: 'start',
                          labels: {
                            padding: 8,
                            font: { size: 11 },
                            usePointStyle: true,
                            boxWidth: 8,
                          },
                        },
                      },
                    }}
                    height={400}
                    showExport
                    filename="spending-by-category"
                  />
                </ChartErrorBoundary>
              ) : (
                <div class={styles.emptyState}>No expense data to display</div>
              )}
            </div>
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
                  {(bill: any) => (
                    <div class={styles.transactionItem}>
                      <div
                        class={styles.transactionIcon}
                        style={{ background: getIconColor('expense') }}
                      >
                        <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                          <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                          />
                        </svg>
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
                  )}
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
            <p>Your financial overview</p>
          </div>
          <div class={styles.headerButtons}>
            <button
              class={styles.btnSecondary}
              onClick={showSettings}
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
            <button class={styles.btnPrimary} onClick={() => loadDashboard()}>
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
        <div class={styles.headerPeriodRow}>
          <PeriodNavigator
            month={month}
            year={year}
            minYear={dataMinYear()}
            maxYear={dataMaxYear()}
            years={dataYears()}
            onMonthChange={(m) => {
              setMonth(m)
              setAllTime(false)
            }}
            onYearChange={(y) => {
              setYear(y)
              setAllTime(false)
            }}
            onPrev={() => {
              const m = month()
              const y = year()
              setPillPeriod('custom')
              setAllTime(false)
              if (m === 1) {
                setMonth(12)
                setYear(y - 1)
              } else {
                setMonth(m - 1)
              }
            }}
            onNext={() => {
              const m = month()
              const y = year()
              setPillPeriod('custom')
              setAllTime(false)
              if (m === 12) {
                setMonth(1)
                setYear(y + 1)
              } else {
                setMonth(m + 1)
              }
            }}
          />
          <div class={styles.periodPills} data-tour="dashboard-period">
            <PeriodPills value={pillPeriod()} onChange={handlePillChange} />
          </div>
        </div>
      </div>

      {loading() ? (
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
                <div class={styles.metricValue}>{money(metrics()!.balance)}</div>
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
              </div>
              <div
                class={`${styles.metricCard} ${styles.income}`}
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
              </div>
              <div
                class={`${styles.metricCard} ${styles.expense}`}
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
              </div>
            </div>
          </Show>

          {/* Charts Section — always visible */}
          <div
            class={styles.chartsGrid}
            role="region"
            aria-label="charts overview"
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
                        labels: monthlyData()!.labels,
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
                {isWidgetVisible(widgetId) && widgetId !== 'metrics'
                  ? renderWidget(widgetId)
                  : null}
              </>
            )}
          </For>

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
