/**
 * Analytics Component
 * Visualizes financial data with charts and insights
 */
import { createEffect,createSignal, onMount } from 'solid-js'
import styles from '../components/AnalyticsPage.module.css'
import Chart from '../components/Chart'
import { formatCurrency } from '../core/api'
import { apiGet, showToast } from '../utils/api'

interface AnalyticsData {
  byCategory: Array<{ category_id: number; category_name: string; amount: number }>
  byMonth: Array<{ month: string; income: number; expense: number }>
  recentTransactions: Array<any>
  savingsRate: number
}

export default function Analytics() {
  const [data, setData] = createSignal<AnalyticsData | null>(null)
  const [loading, setLoading] = createSignal(true)
  const [selectedChart, setSelectedChart] = createSignal<'category' | 'monthly' | 'savings' | 'heatmap'>(
    'category'
  )
  const [heatmapYear, setHeatmapYear] = createSignal(new Date().getFullYear())
  const [heatmapType, setHeatmapType] = createSignal<'income' | 'expense'>('expense')
  const [heatmapData, setHeatmapData] = createSignal<Map<string, number>>(new Map())

  // Load analytics data
  const loadData = async () => {
    setLoading(true)
    try {
      const [categoryRes, transactionsRes] = await Promise.all([
        apiGet<any>('/api/analytics/category-trends'),
        apiGet<any>('/api/transactions/summary'),
      ])

      // Transform category-trends response
      const byCategory = categoryRes.datasets.slice(0, 10).map((d: any, i: number) => ({
        category_id: i,
        category_name: d.category,
        amount: d.data[d.data.length - 1] || 0,
      }))

      // Recent transactions from summary
      const recentTransactions: any[] = []

      setData({
        byCategory,
        byMonth: [],
        recentTransactions,
        savingsRate: transactionsRes
          ? ((transactionsRes.total_income - transactionsRes.total_expense) /
              transactionsRes.total_income) *
            100
          : 0,
      })
    } catch (err) {
      console.error('Failed to load analytics', err)
      showToast('Failed to load analytics data', 'error')
    } finally {
      setLoading(false)
    }
  }

  // Load heatmap data
  const loadHeatmapData = async () => {
    try {
      const res = await apiGet<any>(`/api/analytics/daily-heatmap?year=${heatmapYear()}&type=${heatmapType()}`)
      const dataMap = new Map<string, number>()
      if (res.dates) {
        Object.entries(res.dates).forEach(([date, amount]) => {
          const numAmount = typeof amount === 'number' && !isNaN(amount) ? amount : 0
          if (numAmount > 0) {
            dataMap.set(date, numAmount)
          }
        })
      }
      setHeatmapData(dataMap)
    } catch (err) {
      console.error('Failed to load heatmap', err)
    }
  }

  // Get total income
  const totalIncome = () => {
    return data()?.byMonth.reduce((sum, m) => sum + m.income, 0) || 0
  }

  // Get total expense
  const totalExpense = () => {
    return data()?.byMonth.reduce((sum, m) => sum + m.expense, 0) || 0
  }

  // Format currency
  const formatAmount = (amount: number): string => {
    return formatCurrency(amount)
  }

  // Format percent
  const formatPercent = (value: number): string => {
    return `${value.toFixed(1)}%`
  }

  onMount(() => {
    loadData()
    // Load heatmap data on initial load
    loadHeatmapData()
  })

  // Load heatmap data when year or type changes
  const Effect = createEffect as any
  Effect(() => {
    if (selectedChart() === 'heatmap') {
      loadHeatmapData()
    }
  })

  return (
    <div class={`page page-analytics page-enter ${styles.analyticsPage}`}>
      <div class={styles.pageHeader}>
        <h1>Analytics</h1>
        <p class={styles.pageSubtitle}>Visualize your financial data and track trends</p>
      </div>

      {loading() ? (
        <div class={styles.emptyState}>Loading analytics...</div>
      ) : !data() ? (
        <div class={styles.emptyState}>
          <p>No data available</p>
          <p>Add some transactions to see analytics.</p>
        </div>
      ) : (
        <>
          {/* Summary Stats */}
          <div class={styles.analyticsStats}>
            <div class={styles.statCard}>
              <div class={styles.statLabel}>Savings Rate</div>
              <div
                class={`stat-value ${data()!.savingsRate >= 20 ? 'positive' : data()!.savingsRate >= 10 ? 'warning' : 'negative'}`}
              >
                {formatPercent(data()!.savingsRate)}
              </div>
              <div class={styles.statDesc}>Recommended: 20%+</div>
            </div>
            <div class={styles.statCard}>
              <div class={styles.statLabel}>Total Income</div>
              <div class={`stat-value positive`}>{formatAmount(totalIncome())}</div>
              <div class={styles.statDesc}>Last 6 months</div>
            </div>
            <div class={styles.statCard}>
              <div class={styles.statLabel}>Total Expense</div>
              <div class={`stat-value negative`}>{formatAmount(totalExpense())}</div>
              <div class={styles.statDesc}>Last 6 months</div>
            </div>
            <div class={styles.statCard}>
              <div class={styles.statLabel}>Net Savings</div>
              <div class={`stat-value positive`}>
                {formatAmount(totalIncome() - totalExpense())}
              </div>
              <div class={styles.statDesc}>Income - Expenses</div>
            </div>
          </div>

          {/* Chart Tabs */}
          <div class={styles.analyticsTabs}>
            <button
              class={`tab ${selectedChart() === 'category' ? 'active' : ''}`}
              onClick={() => setSelectedChart('category')}
            >
              Spending by Category
            </button>
            <button
              class={`tab ${selectedChart() === 'monthly' ? 'active' : ''}`}
              onClick={() => setSelectedChart('monthly')}
            >
              Monthly Trends
            </button>
            <button
              class={`tab ${selectedChart() === 'savings' ? 'active' : ''}`}
              onClick={() => setSelectedChart('savings')}
            >
              Savings Rate
            </button>
            <button
              class={`tab ${selectedChart() === 'heatmap' ? 'active' : ''}`}
              onClick={() => setSelectedChart('heatmap')}
            >
              Spending Heatmap
            </button>
          </div>

          {/* Category Chart */}
          {selectedChart() === 'category' && (
            <div class={styles.analyticsChart}>
              <h3 class={styles.chartTitle}>Spending by Category</h3>
              <div class={styles.chartContainer}>
                {data()!.byCategory.length === 0 ? (
                  <div class={styles.emptyState}>No expense data</div>
                ) : (
                  <Chart
                    id="analytics-category-chart"
                    type="doughnut"
                    data={{
                      labels: data()!.byCategory.map((item) => item.category_name),
                      datasets: [
                        {
                          data: data()!.byCategory.map((item) => item.amount),
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
                          borderWidth: 0,
                        },
                      ],
                    }}
                    options={{
                      responsive: true,
                      maintainAspectRatio: false,
                      plugins: {
                        legend: {
                          position: 'right',
                          labels: {
                            usePointStyle: true,
                            padding: 15,
                            font: { size: 12 },
                          },
                        },
                      },
                    }}
                    height={300}
                    width="100%"
                  />
                )}
              </div>
            </div>
          )}

          {/* Monthly Trend Chart */}
          {selectedChart() === 'monthly' && (
            <div class={styles.analyticsChart}>
              <h3 class={styles.chartTitle}>Monthly Income vs Expense</h3>
              <div class={styles.chartContainer}>
                {data()!.byMonth.length === 0 ? (
                  <div class={styles.emptyState}>No data available</div>
                ) : (
                  <Chart
                    id="analytics-monthly-chart"
                    type="line"
                    data={{
                      labels: data()!.byMonth.map((item) =>
                        new Date(item.month).toLocaleDateString('en-US', { month: 'short' })
                      ),
                      datasets: [
                        {
                          label: 'Income',
                          data: data()!.byMonth.map((item) => item.income),
                          borderColor: '#22c55e',
                          backgroundColor: 'rgba(34, 197, 94, 0.1)',
                          fill: true,
                          tension: 0.4,
                        },
                        {
                          label: 'Expense',
                          data: data()!.byMonth.map((item) => item.expense),
                          borderColor: '#dc2626',
                          backgroundColor: 'rgba(220, 38, 38, 0.1)',
                          fill: true,
                          tension: 0.4,
                        },
                      ],
                    }}
                    options={{
                      responsive: true,
                      maintainAspectRatio: false,
                      scales: {
                        y: {
                          beginAtZero: true,
                          ticks: {
                            callback: (value: any) => formatCurrency(value),
                          },
                        },
                      },
                      plugins: {
                        legend: {
                          position: 'top',
                          labels: {
                            usePointStyle: true,
                            padding: 15,
                            font: { size: 12 },
                          },
                        },
                      },
                    }}
                    height={300}
                    width="100%"
                  />
                )}
              </div>
            </div>
          )}

          {/* Savings Rate Chart */}
          {selectedChart() === 'savings' && (
            <div class={styles.analyticsChart}>
              <h3 class={styles.chartTitle}>Savings Rate History</h3>
              <div class={styles.chartContainer}>
                <div class={styles.savingsRateDisplay}>
                  <div class={styles.rateCircle}>
                    <span class={styles.rateValue}>{formatPercent(data()!.savingsRate)}</span>
                    <span class={styles.rateLabel}>Savings Rate</span>
                  </div>
                  <div class={styles.rateInfo}>
                    <div class={styles.rateRow}>
                      <span>Target: 20%</span>
                      <span
                        class={`rate-status ${data()!.savingsRate >= 20 ? 'good' : data()!.savingsRate >= 10 ? 'fair' : 'poor'}`}
                      >
                        {data()!.savingsRate >= 20
                          ? 'Good'
                          : data()!.savingsRate >= 10
                            ? 'Fair'
                            : 'Poor'}
                      </span>
                    </div>
                    <div class={styles.rateRow}>
                      <span>Projected Annual Savings</span>
                      <span>{formatAmount((totalIncome() - totalExpense()) * 12)}</span>
                    </div>
                  </div>
                </div>
                <div class={styles.savingsTips}>
                  <h4>Tips to Improve Savings</h4>
                  <ul>
                    {data()!.savingsRate < 20 && (
                      <li>
                        <strong>Reduce discretionary spending:</strong> Review subscriptions and
                        optional expenses
                      </li>
                    )}
                    {data()!.savingsRate < 10 && (
                      <>
                        <li>
                          <strong>Increase income:</strong> Consider side gigs or ask for a raise
                        </li>
                        <li>
                          <strong>Lower bills:</strong> Compare insurance rates and reduce energy
                          usage
                        </li>
                      </>
                    )}
                    <li>
                      <strong>Use the 50/30/20 rule:</strong> 50% needs, 30% wants, 20% savings
                    </li>
                    <li>
                      <strong>Build an emergency fund:</strong> Start with 3-6 months of expenses
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          )}

          {/* Heatmap Chart */}
          {selectedChart() === 'heatmap' && (
            <div class={styles.analyticsChart}>
              <div class={styles.heatmapHeader}>
                <h3 class={styles.chartTitle}>Spending Heatmap</h3>
                <div class={styles.heatmapControls}>
                  <select
                    class={styles.heatmapYearSelect}
                    value={heatmapYear()}
                    onchange={(e) => setHeatmapYear(Number(e.currentTarget.value))}
                  >
                    {Array.from({ length: 5 }, (_, i) => {
                      const year = heatmapYear() - 2 + i
                      return <option value={year}>{year}</option>
                    })}
                  </select>
                  <select
                    class={styles.heatmapTypeSelect}
                    value={heatmapType()}
                    onchange={(e) => setHeatmapType(e.currentTarget.value as 'income' | 'expense')}
                  >
                    <option value="expense">Expenses</option>
                    <option value="income">Income</option>
                  </select>
                </div>
              </div>
              <div class={styles.chartContainer}>
                {heatmapData().size === 0 ? (
                  <div class={styles.emptyState}>No data available for this year</div>
                ) : (
                  <>
                    <div class={styles.heatmapContainer}>
                      <div class={styles.heatmapCell} classList={{ [styles.dayLabel]: true }}>Mon</div>
                      <div class={styles.heatmapCell} classList={{ [styles.dayLabel]: true }}></div>
                      <div class={styles.heatmapCell} classList={{ [styles.dayLabel]: true }}>Wed</div>
                      <div class={styles.heatmapCell} classList={{ [styles.dayLabel]: true }}></div>
                      <div class={styles.heatmapCell} classList={{ [styles.dayLabel]: true }}>Fri</div>
                      <div class={styles.heatmapCell} classList={{ [styles.dayLabel]: true }}></div>
                      <div class={styles.heatmapCell} classList={{ [styles.dayLabel]: true }}></div>

                      {/* Week container */}
                      <div class={styles.heatmapWeeks}>
                        {Array.from({ length: 52 }, (_, weekIndex) => {
                          const weekCells: Array<{
                            day: number
                            date: Date
                            amount: number
                          }> = []
                          for (let d = 0; d < 7; d++) {
                            const date = new Date(heatmapYear(), 0, 1)
                            date.setDate(date.getDate() + weekIndex * 7 + d + 1)
                            const dateStr = date.toISOString().split('T')[0]
                            const amount = heatmapData().get(dateStr) || 0
                            if (date.getFullYear() === heatmapYear()) {
                              weekCells.push({ day: d, date, amount })
                            }
                          }
                          if (weekCells.length === 0) return null

                          return (
                            <div class={styles.heatmapWeek}>
                              {weekCells.map((cell) => {
                                const maxAmount = Math.max(...Array.from(heatmapData().values()), 0)
                                const cellSize = 14
                                const intensity =
                                  maxAmount > 0 && cell.amount > 0
                                    ? Math.round((cell.amount / maxAmount) * 100)
                                    : 0
                                const bgColor =
                                  heatmapType() === 'income'
                                    ? `rgba(74, 222, 128, ${0.1 + intensity / 400})`
                                    : intensity > 0
                                      ? `rgba(34, 197, 94, ${0.1 + intensity / 400})`
                                      : 'rgba(239, 68, 68, 0.1)'
                                return (
                                  <div
                                    class={styles.heatmapCell}
                                    style={{
                                      width: `${cellSize}px`,
                                      height: `${cellSize}px`,
                                      backgroundColor: bgColor,
                                    }}
                                    title={`${cell.date.toLocaleDateString()}: ${formatCurrency(cell.amount)}`}
                                  />
                                )
                              })}
                            </div>
                          )
                        })}
                      </div>

                      {/* Month labels */}
                      <div class={styles.monthLabel}></div>
                    </div>

                    {/* Legend */}
                    <div class={styles.heatmapLegend}>
                      <span class={styles.heatmapLegendLabel}>{heatmapType()} Amount</span>
                      <div class={styles.heatmapScale}>
                        <span
                          class={styles.heatmapScaleColor}
                          style={{ backgroundColor: heatmapType() === 'income' ? 'rgba(74, 222, 128, 0.1)' : 'rgba(34, 197, 94, 0.1)' }}
                        />
                        <span
                          class={styles.heatmapScaleColor}
                          style={{ backgroundColor: heatmapType() === 'income' ? 'rgba(74, 222, 128, 0.4)' : 'rgba(34, 197, 94, 0.4)' }}
                        />
                        <span
                          class={styles.heatmapScaleColor}
                          style={{ backgroundColor: heatmapType() === 'income' ? 'rgba(74, 222, 128, 0.7)' : 'rgba(34, 197, 94, 0.7)' }}
                        />
                        <span
                          class={styles.heatmapScaleColor}
                          style={{ backgroundColor: heatmapType() === 'income' ? 'rgba(74, 222, 128, 1)' : 'rgba(34, 197, 94, 1)' }}
                        />
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Recent Transactions */}
          <div class={styles.analyticsRecent}>
            <h3 class={styles.sectionTitle}>Recent Transactions</h3>
            <div class={styles.transactionList}>
              {data()!.recentTransactions.map((tx: any) => (
                <div class={styles.transactionItem}>
                  <div
                    class={styles.transactionIcon}
                    style={{
                      background: tx.type === 'expense' ? 'var(--danger)' : 'var(--income)',
                    }}
                  >
                    {tx.type === 'expense' ? '↓' : '↑'}
                  </div>
                  <div class={styles.transactionDetails}>
                    <div class={styles.transactionName}>{tx.description}</div>
                    <div class={styles.transactionMeta}>
                      {new Date(tx.date).toLocaleDateString()} • {tx.category_name || 'No category'}
                    </div>
                  </div>
                  <div class={`transaction-amount ${tx.type === 'expense' ? 'expense' : 'income'}`}>
                    {tx.type === 'expense' ? '-' : '+'}
                    {formatAmount(tx.amount)}
                  </div>
                </div>
              ))}
            </div>
            <div class={styles.viewAllLink}>
              <a href="#transactions">View All Transactions →</a>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
