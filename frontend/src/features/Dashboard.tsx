/**
 * Dashboard Component
 */

import { createSignal, onMount } from 'solid-js'
import Chart from '../components/Chart'
import ChartWrapper from '../components/ChartWrapper'
import BudgetAlertsCard from '../components/Dashboard/BudgetAlertsCard'
import { PeriodNavigator } from '../components/Dashboard/PeriodNavigator'
import RecurringInsightsCard from '../components/Dashboard/RecurringInsightsCard'
import SavingsRateCard from '../components/Dashboard/SavingsRateCard'
import { StatCard } from '../components/Dashboard/StatCard'
import { PeriodPills } from '../components/PeriodPills'
import styles from '../components/DashboardPage.module.css'
import { DashboardSettings } from '../components/DashboardSettings'
import { api, formatCurrency, formatDate, toast } from '../core/api'
import type {PeriodPreset} from '../components/Dashboard/PeriodNavigator';
import type * as Models from '../types/models'

export default function Dashboard() {
  const [month, setMonth] = createSignal(5)
  const [year, setYear] = createSignal(2026)
  const [metrics, setMetrics] = createSignal<Models.DashboardMetrics | null>(null)
  const [momMetrics, setMomMetrics] = createSignal<Models.DashboardMetrics | null>(null)
  const [monthlyData, setMonthlyData] = createSignal<Models.DashboardChartData | null>(null)
  const [loading, setLoading] = createSignal(true)
  const [selectedPeriod, setSelectedPeriod] = createSignal<PeriodPreset>('this-month')
  const [pillPeriod, setPillPeriod] = createSignal('month')

  onMount(() => {
    void loadDashboard()
    void loadMonthlyData()
  })

  const loadDashboard = async () => {
    setLoading(true)
    try {
      const data = await api.getDashboard()
      setMetrics(data)
    } catch {
      toast('Failed to load dashboard', 'error')
    } finally {
      setLoading(false)
    }
  }

  const loadMonthlyData = async () => {
    try {
      const data = await api.getDashboardByMonth(month(), year())
      setMonthlyData(data)
    } catch {
      // Don't show error for monthly data - it's optional
    }
  }

  const handleMonthChange = (newMonth: number) => {
    setMonth(newMonth)
    void loadMonthlyData()
  }

  const handleYearChange = (newYear: number) => {
    setYear(newYear)
    void loadMonthlyData()
  }

  const handlePrev = () => {
    if (month() === 1) {
      setMonth(12)
      setYear(year() - 1)
    } else {
      setMonth(month() - 1)
    }
    void loadMonthlyData()
  }

  const handleNext = () => {
    if (month() === 12) {
      setMonth(1)
      setYear(year() + 1)
    } else {
      setMonth(month() + 1)
    }
    void loadMonthlyData()
  }

  const handlePresetChange = async (preset: PeriodPreset) => {
    setSelectedPeriod(preset)
    const now = new Date()
    let m = now.getMonth() + 1
    const y = now.getFullYear()

    switch (preset) {
      case 'this-month':
        setMonth(m)
        setYear(y)
        break
      case 'last-month':
        m = m === 1 ? 12 : m - 1
        setMonth(m)
        setYear(y)
        break
      case 'last-3':
        m = m <= 3 ? 12 : m - 3
        setYear(y)
        break
      case 'last-6':
        m = m <= 6 ? 12 : m - 6
        setYear(y)
        break
      case 'this-year':
        setMonth(1)
        setYear(y)
        break
      case 'last-year':
        setMonth(1)
        setYear(y - 1)
        break
      case 'all':
        setMonth(1)
        setYear(2020)
        break
    }

    void loadMonthlyData()
  }

  const handlePillChange = async (pillId: string) => {
    setPillPeriod(pillId)
    const now = new Date()
    let m = now.getMonth() + 1
    const y = now.getFullYear()
    const today = now.getDate()

    switch (pillId) {
      case 'today':
        setMonth(m)
        setYear(y)
        break
      case 'week':
        setMonth(m)
        setYear(y)
        break
      case 'month':
        setMonth(m)
        setYear(y)
        break
      case 'quarter':
        setMonth(m)
        setYear(y)
        break
      case 'year':
        setMonth(m)
        setYear(y)
        break
      case 'last7':
        setMonth(m)
        setYear(y)
        break
      case 'last30':
        setMonth(m)
        setYear(y)
        break
      case 'last90':
        setMonth(m)
        setYear(y)
        break
    }

    void loadMonthlyData()
  }

  const showSettings = () => {
    const settings = document.getElementById('dashboard-settings-modal')
    if (settings) {
      const overlay = settings.parentElement
      if (overlay) {
        overlay.classList.add('visible')
        overlay.style.display = 'block'
      }
    }
  }

  return (
    <div class={`page page-dashboard page-enter ${styles.dashboardPage}`}>
      <div class={styles.pageHeader}>
        <div class={styles.pageTitle}>
          <h2>Dashboard</h2>
          <p>Your financial overview</p>
        </div>
        <div class={styles.pageHeaderActions}>
          <button class={styles.btnSecondary} onClick={showSettings}>
            <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
              />
              <circle cx="12" cy="12" r="3" />
            </svg>
            Settings
          </button>
          <button class={styles.btnPrimary} onClick={loadDashboard}>
            <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
            Refresh
          </button>
          <div class={styles.periodPills}>
            <PeriodPills
              value={pillPeriod()}
              onChange={handlePillChange}
            />
          </div>
        </div>
      </div>

      {loading() ? (
        <div class={styles.emptyState}>Loading...</div>
      ) : metrics() ? (
        <>
          {/* Period Navigator */}
          <div class={styles.card}>
            <div class={styles.cardHeader}>
              <div class={styles.cardTitle}>Period Navigator</div>
            </div>
            <div class={styles.periodNavigatorContainer}>
              <PeriodNavigator
                month={month}
                year={year}
                onMonthChange={setMonth}
                onYearChange={setYear}
                onPrev={() => {
                  const m = month()
                  const y = year()
                  setMonth(m === 1 ? 12 : m - 1)
                  setYear(y === 1 ? y - 1 : y)
                }}
                onNext={() => {
                  const m = month()
                  const y = year()
                  setMonth(m === 12 ? 1 : m + 1)
                  setYear(m === 12 ? y + 1 : y)
                }}
              />
            </div>
          </div>

          {/* Metrics Grid */}
          <div class={styles.metricsGrid}>
            <div class={styles.metricCard}>
              <div class={styles.metricLabel}>Net Worth</div>
              <div class={`${styles.metricValue} ${styles.networth}`}>
                {formatCurrency(metrics()!.balance)}
              </div>
              <div class={styles.metricSubtext}>Total available</div>
              {momMetrics() && (
                <div class={styles.metricDelta}>
                  <span class={momMetrics()!.momBalanceDelta! > 0 ? styles.positive : momMetrics()!.momBalanceDelta! < 0 ? styles.negative : styles.neutral}>
                    {momMetrics()!.momBalanceDelta! > 0 ? '↑' : momMetrics()!.momBalanceDelta! < 0 ? '↓' : '→'}
                    {Math.abs(momMetrics()!.momBalanceDelta!).toFixed(2)}
                  </span>
                  <span class={styles.metricDeltaLabel}>vs last month</span>
                </div>
              )}
            </div>
            <div class={styles.metricCard}>
              <div class={styles.metricLabel}>Income</div>
              <div class={`${styles.metricValue} ${styles.positive}`}>
                {formatCurrency(metrics()!.totalIncome)}
              </div>
              <div class={styles.metricSubtext}>For this period</div>
              {momMetrics() && (
                <div class={styles.metricDelta}>
                  <span class={momMetrics()!.momIncomeDelta! > 0 ? styles.positive : momMetrics()!.momIncomeDelta! < 0 ? styles.negative : styles.neutral}>
                    {momMetrics()!.momIncomeDelta! > 0 ? '↑' : momMetrics()!.momIncomeDelta! < 0 ? '↓' : '→'}
                    {Math.abs(momMetrics()!.momIncomeDelta!).toFixed(2)}
                  </span>
                  <span class={styles.metricDeltaLabel}>vs last month</span>
                </div>
              )}
            </div>
            <div class={styles.metricCard}>
              <div class={styles.metricLabel}>Expenses</div>
              <div class={`${styles.metricValue} ${styles.expense}`}>
                {formatCurrency(metrics()!.totalExpenses)}
              </div>
              <div class={styles.metricSubtext}>For this period</div>
              {momMetrics() && (
                <div class={styles.metricDelta}>
                  <span class={momMetrics()!.momExpenseDelta! > 0 ? styles.positive : momMetrics()!.momExpenseDelta! < 0 ? styles.negative : styles.neutral}>
                    {momMetrics()!.momExpenseDelta! > 0 ? '↑' : momMetrics()!.momExpenseDelta! < 0 ? '↓' : '→'}
                    {Math.abs(momMetrics()!.momExpenseDelta!).toFixed(2)}
                  </span>
                  <span class={styles.metricDeltaLabel}>vs last month</span>
                </div>
              )}
            </div>
          </div>

          {/* Charts Section */}
          <div class={styles.chartsGrid}>
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
            <div class={styles.widgetCard}>
              <div class={styles.widgetHeader}>
                <div class={styles.widgetTitle}>Budget Alerts</div>
                <a href="#budgets" class={styles.widgetLink}>View All</a>
              </div>
              <BudgetAlertsCard />
            </div>

            <div class={styles.widgetCard}>
              <div class={styles.widgetHeader}>
                <div class={styles.widgetTitle}>Savings Rate</div>
                <a href="#budgets" class={styles.widgetLink}>Details</a>
              </div>
              <SavingsRateCard />
            </div>

            <div class={styles.widgetCard}>
              <div class={styles.widgetHeader}>
                <div class={styles.widgetTitle}>Recurring Insights</div>
              </div>
              <RecurringInsightsCard />
            </div>
          </div>

          {/* Charts Section */}
          <div class={styles.chartsGrid}>
            <div class={styles.card}>
              <div class={styles.cardHeader}>
                <div class={styles.cardTitle}>Spending by Category</div>
              </div>
              <div class={styles.chartContainer}>
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
                    height={300}
                    showExport
                    filename="spending-by-category"
                  />
                ) : (
                  <div class={styles.emptyState}>No expense data to display</div>
                )}
              </div>
            </div>

            <div class={styles.card}>
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
                  height={250}
                  showExport
                  filename="income-vs-expenses"
                />
              </div>
            </div>
          </div>

          {/* Recent Transactions */}
          {metrics()!.recentTransactions && metrics()!.recentTransactions.length > 0 && (
            <div class={styles.card}>
              <div class={styles.cardHeader}>
                <div class={styles.cardTitle}>Recent Transactions</div>
                <a href="#transactions" class={styles.btnLink}>
                  View All →
                </a>
              </div>
              <div class={styles.transactionList}>
                {metrics()!
                  .recentTransactions.slice(0, 5)
                  .map((tx) => (
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
                          {tx.category_name || tx.category_id
                            ? `#${tx.category_id}`
                            : 'No category'}
                        </div>
                      </div>
                      <div
                        class={`transaction-amount ${tx.type === 'expense' ? 'expense' : 'income'}`}
                      >
                        {tx.type === 'expense' ? '-' : '+'}
                        {formatCurrency(tx.amount)}
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {/* Upcoming Bills */}
          {(metrics()!.upcomingBills?.length ?? 0) > 0 && (
            <div class={styles.card}>
              <div class={styles.cardHeader}>
                <div class={styles.cardTitle}>Upcoming Bills</div>
                <a href="#bills" class={styles.btnLink}>
                  View All →
                </a>
              </div>
              <div class={styles.transactionList}>
                {metrics()!
                  .upcomingBills.slice(0, 5)
                  .map((bill: any) => (
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
                  ))}
              </div>
            </div>
          )}

          {/* Widget Settings Modal */}
          <div class={styles.modalOverlay} id="dashboard-settings-modal">
            <div class={`${styles.modal} ${styles.modalMd}`}>
              <div class={styles.modalHeader}>
                <div class={styles.modalTitle}>Dashboard Settings</div>
                <button
                  class={styles.modalClose}
                  onClick={() => {
                    const modal = document.getElementById('dashboard-settings-modal')
                    if (modal) {
                      const overlay = modal.parentElement
                      if (overlay) {
                        overlay.style.display = 'none'
                      }
                    }
                  }}
                >
                  <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div class={styles.modalBody}>
                <DashboardSettings />
              </div>
            </div>
          </div>
        </>
      ) : (
        <div class={styles.emptyState}>Failed to load data</div>
      )}
    </div>
  )
}

function getIcon(type: 'income' | 'expense') {
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
