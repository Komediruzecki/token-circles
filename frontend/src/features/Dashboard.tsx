/**
 * Dashboard Component - EARS Specification
 *
 * GIVEN: A user is on the Dashboard page
 * WHEN: The page loads with valid data
 * THEN: The header displays "Dashboard" and "Your financial overview"
 *
 * GIVEN: A user is viewing the Dashboard with monthly data
 * WHEN: They navigate to different months or years
 * THEN: All metrics, charts, and widgets update to reflect the selected period
 *
 * GIVEN: A user has spent more than their budget
 * WHEN: The Dashboard displays Budget Alerts widget
 * THEN: It shows overdue budgets with amounts and due dates
 *
 * GIVEN: A user has savings goals with target amounts
 * WHEN: The Dashboard displays Savings Rate widget
 * THEN: It shows current savings rate and progress toward goals
 *
 * GIVEN: A user has recurring payments setup
 * WHEN: The Dashboard displays Recurring Insights widget
 * THEN: It shows upcoming bill reminders and payment frequency summaries
 *
 * GIVEN: A user wants to see transaction history
 * WHEN: The Dashboard shows Recent Transactions
 * THEN: It displays up to 5 most recent transactions with amounts and categories
 */

/**
 * Dashboard Component
 */

import { createEffect, createSignal, For, onMount, Show } from 'solid-js'
import ChartWrapper from '../components/ChartWrapper'
import BudgetAlertsCard from '../components/Dashboard/BudgetAlertsCard'
import { PeriodNavigator } from '../components/Dashboard/PeriodNavigator'
import RecurringInsightsCard from '../components/Dashboard/RecurringInsightsCard'
import SavingsRateCard from '../components/Dashboard/SavingsRateCard'
import styles from '../components/DashboardPage.module.css'
import { DashboardSettings } from '../components/DashboardSettings'
import { PeriodPills } from '../components/PeriodPills'
import { api, formatCurrency, formatDate, toast } from '../core/api'
import type * as Models from '../types/models'

export default function Dashboard() {
  const [month, setMonth] = createSignal(5)
  const [year, setYear] = createSignal(2026)
  const [metrics, setMetrics] = createSignal<Models.DashboardMetrics | null>(null)
  const [monthlyData, setMonthlyData] = createSignal<Models.DashboardChartData | null>(null)
  const [loading, setLoading] = createSignal(true)
  const [pillPeriod, setPillPeriod] = createSignal('month')
  const [showSettingsModal, setShowSettingsModal] = createSignal(false)
  const [visibleWidgets, setVisibleWidgets] = createSignal<string[]>(
    (() => {
      const saved = localStorage.getItem('dashboard_widgets')
      if (saved) {
        try {
          const parsed = JSON.parse(saved)
          if (parsed.visibleWidgets && Array.isArray(parsed.visibleWidgets)) {
            return parsed.visibleWidgets
          }
        } catch {
          /* ignore */
        }
      }
      return [
        'metrics',
        'category-chart',
        'recent-transactions',
        'upcoming-bills',
        'savings-rate',
        'budget-alerts',
      ]
    })()
  )
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
  })

  createEffect(() => {
    month()
    year() // track dependencies
    // When PeriodNavigator changes month/year, use standard month-based filtering
    void loadDashboard()
  })

  const loadDashboard = async (dateFrom?: string, dateTo?: string) => {
    setLoading(true)
    try {
      const data = await api.getDashboard(month(), year(), dateFrom, dateTo)
      setMetrics(data)
    } catch {
      toast('Failed to load dashboard', 'error')
    } finally {
      setLoading(false)
    }
  }

  const loadMonthlyData = async () => {
    try {
      const [_chartsData, netWorthData] = await Promise.all([
        api.getDashboardCharts(12),
        api.getNetWorth(),
      ])
      const labels = netWorthData.timeline.map((t) => {
        const [y, m] = t.month.split('-')
        const date = new Date(parseInt(y), parseInt(m) - 1)
        return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
      })
      const netWorth = netWorthData.timeline.map((t) => t.balance)
      const income = netWorthData.timeline.map((t) => (t.netChange > 0 ? t.netChange : 0))
      const expenses = netWorthData.timeline.map((t) =>
        t.netChange < 0 ? Math.abs(t.netChange) : 0
      )
      setMonthlyData({ labels, income, expenses, netWorth })
    } catch {
      // Don't show error for monthly data - it's optional
    }
  }

  const handlePillChange = async (pillId: string) => {
    setPillPeriod(pillId)
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
    }

    setMonth(m)
    setYear(y)
    await loadDashboard(dateFrom, dateTo)
  }

  const showSettings = () => setShowSettingsModal(true)

  const handleSettingsSave = () => {
    const saved = localStorage.getItem('dashboard_widgets')
    if (saved) {
      try {
        const parsed = JSON.parse(saved)
        if (parsed.visibleWidgets && Array.isArray(parsed.visibleWidgets)) {
          setVisibleWidgets(parsed.visibleWidgets)
        }
      } catch {
        /* ignore */
      }
    }
    setShowSettingsModal(false)
  }

  const isWidgetVisible = (id: string) => visibleWidgets().includes(id)

  return (
    <div data-test-id="dashboard-container">
      <div class={styles.pageHeader} data-test-id="dashboard-header">
        <div class={styles.pageTitle}>
          <h2>Dashboard</h2>
          <p>Your financial overview</p>
        </div>
        <div class={styles.pageHeaderActions}>
          <PeriodNavigator
            month={month}
            year={year}
            onMonthChange={setMonth}
            onYearChange={setYear}
            onPrev={() => {
              const m = month()
              const y = year()
              setPillPeriod('custom')
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
              if (m === 12) {
                setMonth(1)
                setYear(y + 1)
              } else {
                setMonth(m + 1)
              }
            }}
          />
          <div class={styles.periodPills}>
            <PeriodPills value={pillPeriod()} onChange={handlePillChange} />
          </div>
          <button class={styles.btnSecondary} onClick={showSettings}>
            <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
              />
              <circle cx="12" cy="12" r="3" />
            </svg>
            Dashboard Views
          </button>
          <button class={styles.btnPrimary} onClick={() => loadDashboard()}>
            <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
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

      {loading() ? (
        <div class={styles.emptyState}>Loading...</div>
      ) : metrics() ? (
        <>
          {/* Metrics Grid */}
          <Show when={isWidgetVisible('metrics')}>
            <div class={styles.metricsGrid} data-test-id="dashboard-metrics">
              <div class={`${styles.metricCard} ${styles.networth}`}>
                <div class={styles.metricLabel}>Net Worth</div>
                <div class={styles.metricValue}>{formatCurrency(metrics()!.balance)}</div>
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
              <div class={`${styles.metricCard} ${styles.income}`}>
                <div class={styles.metricLabel}>Income</div>
                <div class={`${styles.metricValue} ${styles.positive}`}>
                  {formatCurrency(metrics()!.totalIncome)}
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
              <div class={`${styles.metricCard} ${styles.expense}`}>
                <div class={styles.metricLabel}>Expenses</div>
                <div class={`${styles.metricValue} ${styles.expense}`}>
                  {formatCurrency(metrics()!.totalExpenses)}
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
              <div class={`${styles.metricCard} ${styles.balance}`}>
                <div class={styles.metricLabel}>Balance</div>
                <div
                  class={`${styles.metricValue} ${
                    metrics()!.totalIncome - metrics()!.totalExpenses >= 0
                      ? styles.positive
                      : styles.expense
                  }`}
                >
                  {formatCurrency(metrics()!.totalIncome - metrics()!.totalExpenses)}
                </div>
                <div class={styles.metricSubtext}>Monthly net</div>
              </div>
            </div>
          </Show>

          {/* Charts Section */}
          <div class={styles.chartsGrid} role="region" aria-label="charts overview">
            <div class={styles.card}>
              <div class={styles.cardHeader}>
                <div class={styles.cardTitle}>Net Worth Over Time</div>
              </div>
              <div class={styles.chartContainerTall}>
                {monthlyData() ? (
                  <ChartWrapper
                    type="line"
                    data={{
                      labels: monthlyData()!.labels,
                      datasets: [
                        {
                          label: 'Net Worth',
                          data: monthlyData()!.netWorth,
                          borderColor: '#8B5CF6',
                          backgroundColor: 'rgba(139, 92, 246, 0.1)',
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
                  <ChartWrapper
                    type="line"
                    data={{
                      labels: monthlyData()!.labels,
                      datasets: [
                        {
                          label: 'Income',
                          data: monthlyData()!.income,
                          borderColor: '#22C55E',
                          backgroundColor: 'rgba(34, 197, 94, 0.1)',
                          fill: true,
                          tension: 0.4,
                        },
                        {
                          label: 'Expenses',
                          data: monthlyData()!.expenses,
                          borderColor: '#EF4444',
                          backgroundColor: 'rgba(239, 68, 68, 0.1)',
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
                ) : (
                  <div class={styles.emptyState}>Loading chart data...</div>
                )}
              </div>
            </div>
          </div>

          {/* Widget Cards */}
          <div class={styles.widgetsGrid}>
            <Show when={isWidgetVisible('budget-alerts')}>
              <div class={styles.widgetCard}>
                <div class={styles.widgetHeader}>
                  <div class={styles.widgetTitle}>Budget Alerts</div>
                  <a href="#budgets" class={styles.widgetLink}>
                    View All
                  </a>
                </div>
                <BudgetAlertsCard />
              </div>
            </Show>

            <Show when={isWidgetVisible('savings-rate')}>
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
                      ? ((metrics()!.totalIncome - metrics()!.totalExpenses) /
                          metrics()!.totalIncome) *
                        100
                      : 0
                  }
                  monthlySavings={metrics()!.totalIncome - metrics()!.totalExpenses}
                  goal={savingsGoal()}
                  onGoalChange={handleSavingsGoalChange}
                />
              </div>
            </Show>
          </div>

          {/* Recurring Insights — full-width row */}
          <div class={styles.card}>
            <div class={styles.cardHeader}>
              <div class={styles.cardTitle}>Recurring Insights</div>
            </div>
            <RecurringInsightsCard />
          </div>

          {/* Spending by Category — full-width with taller chart */}
          <div class={styles.chartsRow}>
            <Show when={isWidgetVisible('category-chart')}>
              <div class={styles.card}>
                <div class={styles.cardHeader}>
                  <div class={styles.cardTitle}>Spending by Category</div>
                </div>
                <div class={styles.chartContainerTall}>
                  {metrics()!.expenseByCategory && metrics()!.expenseByCategory.length > 0 ? (
                    <ChartWrapper
                      type="doughnut"
                      data={{
                        labels: metrics()!.expenseByCategory.map(
                          (item: any) => item.category_name || 'Uncategorized'
                        ),
                        datasets: [
                          {
                            data: metrics()!.expenseByCategory.map((item: any) => item.total),
                            backgroundColor: [
                              '#dc2626',
                              '#f97316',
                              '#eab308',
                              '#22c55e',
                              '#06b6d4',
                              '#3b82f6',
                              '#8b5cf6',
                              '#ec4899',
                              '#6b7280',
                              '#14b8a6',
                            ],
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
                  ) : (
                    <div class={styles.emptyState}>No expense data to display</div>
                  )}
                </div>
              </div>
            </Show>
          </div>

          {/* Income vs Expenses */}
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
                        '#22C55E',
                        '#DC2626',
                        (metrics()!.totalIncome || 0) - (metrics()!.totalExpenses || 0) >= 0
                          ? '#22C55E'
                          : '#DC2626',
                      ],
                      borderRadius: 8,
                    },
                  ],
                }}
                options={{
                  scales: {
                    y: {
                      grace: '10%',
                    },
                  },
                }}
                height={250}
                showExport
                filename="income-vs-expenses"
              />
            </div>
          </div>

          {/* Recent Transactions */}
          <Show
            when={
              isWidgetVisible('recent-transactions') &&
              metrics()!.recentTransactions &&
              metrics()!.recentTransactions.length > 0
            }
          >
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
                        {formatCurrency(tx.amount)}
                      </div>
                    </div>
                  )}
                </For>
              </div>
            </div>
          </Show>

          {/* Upcoming Bills */}
          <Show
            when={isWidgetVisible('upcoming-bills') && (metrics()!.upcomingBills?.length ?? 0) > 0}
          >
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
                        {formatCurrency(bill.amount)}
                      </div>
                    </div>
                  )}
                </For>
              </div>
            </div>
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
                  <button class={styles.modalClose} onClick={() => setShowSettingsModal(false)}>
                    <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                  </button>
                </div>
                <div class={styles.modalBody}>
                  <DashboardSettings onSave={handleSettingsSave} />
                </div>
              </div>
            </div>
          </Show>
        </>
      ) : (
        <div class={styles.emptyState}>Failed to load data</div>
      )}
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
