/**
 * Analytics Component - EARS Specification
 *
 * GIVEN: A user is on the Analytics page
 * WHEN: The page loads
 * THEN: The header displays "Analytics" and shows category breakdown and savings rate
 *
 * GIVEN: A user views the category breakdown
 * WHEN: They select the "Category Trends" chart
 * THEN: A doughnut chart displays expense breakdown by category with percentages
 *
 * GIVEN: A user views monthly trends
 * WHEN: They switch to "Monthly Trends" chart
 * THEN: A bar chart shows income vs expenses for each month
 *
 * GIVEN: A user has recent transactions
 * WHEN: They view the analytics page
 * THEN: The recent transactions list displays the last 5 transactions
 *
 * GIVEN: A user views the savings rate
 * WHEN: They look at the analytics page
 * THEN: The savings rate is calculated and displayed as a percentage
 */

/**
 * Analytics Component
 * Visualizes financial data with charts and insights
 */
import { createEffect, createSignal, onMount } from 'solid-js'
import styles from '../components/AnalyticsPage.module.css'
import Chart from '../components/Chart'
import D3HeatmapChart from '../components/D3HeatmapChart'
import SankeyChart from '../components/SankeyChart'
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
  const [selectedChart, setSelectedChart] = createSignal<
    'category' | 'stacked' | 'monthly' | 'savings' | 'heatmap' | 'sankey'
  >('category')
  const [heatmapYear, setHeatmapYear] = createSignal(new Date().getFullYear())
  const [heatmapType, setHeatmapType] = createSignal<'income' | 'expense'>('expense')
  const [heatmapData, setHeatmapData] = createSignal<Map<string, number>>(new Map())
  const [sankeyYear, setSankeyYear] = createSignal(new Date().getFullYear())
  const [sankeyMonth, setSankeyMonth] = createSignal(new Date().getMonth() + 1)
  const [sankeyData, setSankeyData] = createSignal<{ nodes: any[]; links: any[] }>({
    nodes: [],
    links: [],
  })
  const [categoryType, setCategoryType] = createSignal<'expense' | 'income'>('expense')
  const [stackedYear, setStackedYear] = createSignal(new Date().getFullYear())
  const [stackedView, setStackedView] = createSignal<'year' | 'month'>('year')
  const [stackedMonth, setStackedMonth] = createSignal(new Date().getMonth() + 1)
  const [stackedData, setStackedData] = createSignal<{
    labels: string[]
    datasets: Array<{ category: string; color: string; data: number[] }>
  }>({ labels: [], datasets: [] })
  const [compareEnabled, setCompareEnabled] = createSignal(false)
  const [compareMonth, setCompareMonth] = createSignal(new Date().getMonth() + 1)
  const [compareData, setCompareData] = createSignal<{
    labels: string[]
    datasets: Array<{ category: string; color: string; data: number[] }>
  } | null>(null)

  // Load analytics data
  const loadData = async () => {
    setLoading(true)
    try {
      const [categoryRes, transactionsRes] = await Promise.all([
        apiGet<any>(`/api/analytics/category-trends?type=${categoryType()}`),
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
      const res = await apiGet<any>(
        `/api/analytics/daily-heatmap?year=${heatmapYear()}&type=${heatmapType()}`
      )
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

  // Load sankey data
  const loadSankeyData = async () => {
    try {
      const res = await apiGet<any>(
        `/api/analytics/sankey?year=${sankeyYear()}&month=${sankeyMonth()}`
      )
      setSankeyData({ nodes: res.nodes || [], links: res.links || [] })
    } catch (err) {
      console.error('Failed to load sankey data', err)
      setSankeyData({ nodes: [], links: [] })
    }
  }

  // Load stacked trend data
  const loadStackedData = async () => {
    try {
      const params = new URLSearchParams({
        year: String(stackedYear()),
        type: categoryType(),
      })
      if (stackedView() === 'month') {
        params.set('month', String(stackedMonth()))
      }
      const res = await apiGet<any>(`/api/analytics/category-trends?${params.toString()}`)
      setStackedData({
        labels: res.labels || [],
        datasets: res.datasets || [],
      })

      if (compareEnabled()) {
        const cmpParams = new URLSearchParams({
          year: String(stackedYear()),
          type: categoryType(),
        })
        cmpParams.set('month', String(compareMonth()))
        try {
          const cmpRes = await apiGet<any>(
            `/api/analytics/category-trends?${cmpParams.toString()}`
          )
          setCompareData({
            labels: cmpRes.labels || [],
            datasets: cmpRes.datasets || [],
          })
        } catch (_e) {
          console.error('Failed to load comparison data')
          setCompareData(null)
        }
      } else {
        setCompareData(null)
      }
    } catch (err) {
      console.error('Failed to load stacked data', err)
      setStackedData({ labels: [], datasets: [] })
      setCompareData(null)
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
    if (selectedChart() === 'sankey') {
      loadSankeyData()
    }
    if (selectedChart() === 'stacked') {
      loadStackedData()
    }
    if (selectedChart() === 'category') {
      loadData()
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
                class={`${styles.statValue} ${data()!.savingsRate >= 20 ? styles.positive : data()!.savingsRate >= 10 ? styles.warning : styles.negative}`}
              >
                {formatPercent(data()!.savingsRate)}
              </div>
              <div class={styles.statDesc}>Recommended: 20%+</div>
            </div>
            <div class={styles.statCard}>
              <div class={styles.statLabel}>Total Income</div>
              <div class={`${styles.statValue} ${styles.positive}`}>
                {formatAmount(totalIncome())}
              </div>
              <div class={styles.statDesc}>Last 6 months</div>
            </div>
            <div class={styles.statCard}>
              <div class={styles.statLabel}>Total Expense</div>
              <div class={`${styles.statValue} ${styles.negative}`}>
                {formatAmount(totalExpense())}
              </div>
              <div class={styles.statDesc}>Last 6 months</div>
            </div>
            <div class={styles.statCard}>
              <div class={styles.statLabel}>Net Savings</div>
              <div class={`${styles.statValue} ${styles.positive}`}>
                {formatAmount(totalIncome() - totalExpense())}
              </div>
              <div class={styles.statDesc}>Income - Expenses</div>
            </div>
          </div>

          {/* Chart Tabs */}
          <div class={styles.analyticsTabs}>
            <button
              class={`${styles.tab} ${selectedChart() === 'category' ? styles.active : ''}`}
              onClick={() => setSelectedChart('category')}
            >
              By Category
            </button>
            <button
              class={`${styles.tab} ${selectedChart() === 'stacked' ? styles.active : ''}`}
              onClick={() => {
                setSelectedChart('stacked')
                loadStackedData()
              }}
            >
              Stacked Trends
            </button>
            <button
              class={`${styles.tab} ${selectedChart() === 'monthly' ? styles.active : ''}`}
              onClick={() => setSelectedChart('monthly')}
            >
              Monthly
            </button>
            <button
              class={`${styles.tab} ${selectedChart() === 'savings' ? styles.active : ''}`}
              onClick={() => setSelectedChart('savings')}
            >
              Savings
            </button>
            <button
              class={`${styles.tab} ${selectedChart() === 'heatmap' ? styles.active : ''}`}
              onClick={() => setSelectedChart('heatmap')}
            >
              Heatmap
            </button>
            <button
              class={`${styles.tab} ${selectedChart() === 'sankey' ? styles.active : ''}`}
              onClick={() => {
                setSelectedChart('sankey')
                loadSankeyData()
              }}
            >
              Budget Flow
            </button>
          </div>

          {/* Category Chart */}
          {selectedChart() === 'category' && (
            <>
              <div class={styles.analyticsChart}>
                <div class={styles.heatmapHeader}>
                  <h3 class={styles.chartTitle}>
                    {categoryType() === 'expense' ? 'Spending' : 'Income'} by Category
                  </h3>
                  <div class={styles.heatmapControls}>
                    <select
                      class={styles.heatmapTypeSelect}
                      value={categoryType()}
                      onchange={(e) => {
                        setCategoryType(e.currentTarget.value as 'expense' | 'income')
                        loadData()
                      }}
                    >
                      <option value="expense">Expenses</option>
                      <option value="income">Income</option>
                    </select>
                  </div>
                </div>
                <div class={styles.chartContainer}>
                  {data()!.byCategory.length === 0 ? (
                    <div class={styles.emptyState}>No {categoryType()} data</div>
                  ) : (
                    <Chart
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

              {/* Top Categories Breakdown */}
              {data()!.byCategory.length > 0 && (
                <div class={styles.analyticsChart}>
                  <h3 class={styles.chartTitle}>Top Categories Breakdown</h3>
                  <div class={styles.chartContainer}>
                    <div class={styles.categoryBars}>
                      {(() => {
                        const total = data()!.byCategory.reduce((s, c) => s + c.amount, 0) || 1
                        return data()!.byCategory.map((item) => {
                          const pct = ((item.amount / total) * 100).toFixed(1)
                          return (
                            <div class={styles.categoryBarItem}>
                              <div class={styles.barInfo}>
                                <div class={styles.barName}>{item.category_name}</div>
                                <div class={styles.barPercent}>{pct}%</div>
                              </div>
                              <div class={styles.barTrack}>
                                <div
                                  class={styles.barFill}
                                  style={{ width: `${Math.min(Number(pct), 100)}%` }}
                                />
                              </div>
                              <div class={styles.barAmount}>{formatAmount(item.amount)}</div>
                            </div>
                          )
                        })
                      })()}
                    </div>
                    {/* Averages */}
                    <div
                      style={{
                        margin: '20px 0 0',
                        display: 'flex',
                        gap: '20px',
                        'flex-wrap': 'wrap',
                        'border-top': '1px solid var(--border)',
                        'padding-top': '16px',
                      }}
                    >
                      {(() => {
                        const total = data()!.byCategory.reduce((s, c) => s + c.amount, 0)
                        const count = data()!.byCategory.length
                        const avg = count > 0 ? total / count : 0
                        const monthly = total / 6 // last 6 months
                        const daily = monthly / 30
                        return (
                          <>
                            <div>
                              <div class={styles.statLabel}>Total {categoryType()}</div>
                              <div class={styles.statValue}>{formatAmount(total)}</div>
                            </div>
                            <div>
                              <div class={styles.statLabel}>Monthly Average</div>
                              <div class={styles.statValue}>{formatAmount(monthly)}</div>
                            </div>
                            <div>
                              <div class={styles.statLabel}>Daily Average</div>
                              <div class={styles.statValue}>{formatAmount(daily)}</div>
                            </div>
                            <div>
                              <div class={styles.statLabel}>Per-Category Avg</div>
                              <div class={styles.statValue}>{formatAmount(avg)}</div>
                            </div>
                          </>
                        )
                      })()}
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

          {/* Stacked Trends Chart */}
          {selectedChart() === 'stacked' && (
            <div class={styles.analyticsChart}>
              <div class={styles.heatmapHeader}>
                <h3 class={styles.chartTitle}>
                  Category Trends ({stackedView() === 'year' ? stackedYear() : new Date(stackedYear(), stackedMonth() - 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                  {compareEnabled() && ` vs ${new Date(stackedYear(), compareMonth() - 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`})
                </h3>
                <div class={styles.heatmapControls}>
                  <select
                    class={styles.heatmapTypeSelect}
                    value={categoryType()}
                    onchange={(e) => {
                      setCategoryType(e.currentTarget.value as 'expense' | 'income')
                      loadStackedData()
                    }}
                  >
                    <option value="expense">Expenses</option>
                    <option value="income">Income</option>
                  </select>
                  <select
                    class={styles.heatmapTypeSelect}
                    value={stackedView()}
                    onchange={(e) => {
                      setStackedView(e.currentTarget.value as 'year' | 'month')
                      loadStackedData()
                    }}
                  >
                    <option value="year">Year View</option>
                    <option value="month">Month View</option>
                  </select>
                  <select
                    class={styles.heatmapYearSelect}
                    value={stackedYear()}
                    onchange={(e) => {
                      setStackedYear(Number(e.currentTarget.value))
                      loadStackedData()
                    }}
                  >
                    {Array.from({ length: 5 }, (_, i) => {
                      const year = new Date().getFullYear() - 2 + i
                      return <option value={year}>{year}</option>
                    })}
                  </select>
                  {stackedView() === 'month' && (
                    <select
                      class={styles.heatmapTypeSelect}
                      value={stackedMonth()}
                      onchange={(e) => {
                        setStackedMonth(Number(e.currentTarget.value))
                        loadStackedData()
                      }}
                    >
                      {Array.from({ length: 12 }, (_, i) => (
                        <option value={i + 1}>
                          {new Date(2024, i, 1).toLocaleDateString('en-US', { month: 'long' })}
                        </option>
                      ))}
                    </select>
                  )}
                  <button
                    class={`${styles.tab} ${compareEnabled() ? styles.active : ''}`}
                    onClick={() => {
                      setCompareEnabled(!compareEnabled())
                      loadStackedData()
                    }}
                    style="white-space:nowrap;padding:8px 12px;font-size:13px;"
                  >
                    Compare
                  </button>
                  {compareEnabled() && (
                    <select
                      class={styles.heatmapTypeSelect}
                      value={compareMonth()}
                      onchange={(e) => {
                        setCompareMonth(Number(e.currentTarget.value))
                        loadStackedData()
                      }}
                    >
                      {Array.from({ length: 12 }, (_, i) => (
                        <option value={i + 1}>
                          {new Date(2024, i, 1).toLocaleDateString('en-US', { month: 'long' })}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </div>
              <div class={styles.chartContainer}>
                {stackedData().datasets.length === 0 ? (
                  <div class={styles.emptyState}>No category trend data available</div>
                ) : (
                  <Chart
                    type="bar"
                    data={{
                      labels: stackedData().labels,
                      datasets: [
                        ...stackedData().datasets.map((ds) => ({
                          label: ds.category,
                          data: ds.data,
                          backgroundColor: ds.color || '#6366f1',
                          borderWidth: 0,
                        })),
                        ...(compareData()
                          ? compareData()!.datasets.map((ds) => ({
                              label: `${ds.category} (Compare)`,
                              data: ds.data,
                              backgroundColor: ds.color ? `${ds.color  }66` : '#6366f166',
                              borderColor: ds.color || '#6366f1',
                              borderWidth: 2,
                              borderDash: [4, 4],
                            }))
                          : []),
                      ],
                    }}
                    options={{
                      responsive: true,
                      maintainAspectRatio: false,
                      scales: {
                        x: { stacked: true },
                        y: {
                          stacked: true,
                          beginAtZero: true,
                          ticks: {
                            callback: (value: any) => formatCurrency(value),
                          },
                        },
                      },
                      plugins: {
                        legend: {
                          position: 'bottom',
                          labels: {
                            usePointStyle: true,
                            padding: 10,
                            font: { size: 11 },
                            boxWidth: 10,
                          },
                        },
                        tooltip: {
                          callbacks: {
                            label: (ctx: any) =>
                              `${ctx.dataset.label}: ${formatCurrency(ctx.raw)}`,
                          },
                        },
                      },
                    }}
                    height={350}
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
                        class={`${styles.rateStatus} ${data()!.savingsRate >= 20 ? styles.good : data()!.savingsRate >= 10 ? styles.fair : styles.poor}`}
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
                  <D3HeatmapChart
                    data={heatmapData()}
                    year={heatmapYear()}
                    type={heatmapType()}
                    height={180}
                  />
                )}
              </div>
            </div>
          )}

          {/* Sankey Diagram */}
          {selectedChart() === 'sankey' && (
            <div class={styles.analyticsChart}>
              <div class={styles.heatmapHeader}>
                <h3 class={styles.chartTitle}>Budget Flow Diagram</h3>
                <div class={styles.heatmapControls}>
                  <select
                    class={styles.heatmapYearSelect}
                    value={sankeyYear()}
                    onchange={(e) => {
                      setSankeyYear(Number(e.currentTarget.value))
                      loadSankeyData()
                    }}
                  >
                    {Array.from({ length: 5 }, (_, i) => {
                      const year = new Date().getFullYear() - 2 + i
                      return <option value={year}>{year}</option>
                    })}
                  </select>
                  <select
                    class={styles.heatmapTypeSelect}
                    value={sankeyMonth()}
                    onchange={(e) => {
                      setSankeyMonth(Number(e.currentTarget.value))
                      loadSankeyData()
                    }}
                  >
                    {Array.from({ length: 12 }, (_, i) => (
                      <option value={i + 1}>
                        {new Date(2024, i, 1).toLocaleDateString('en-US', { month: 'long' })}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div class={styles.chartContainer}>
                {sankeyData().nodes.length === 0 ? (
                  <div class={styles.emptyState}>
                    No budget data for this month. Set budgets to see the flow diagram.
                  </div>
                ) : (
                  <SankeyChart data={sankeyData()} height={400} />
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
                  <div
                    class={`${styles.transactionAmount} ${tx.type === 'expense' ? styles.expense : styles.income}`}
                  >
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
