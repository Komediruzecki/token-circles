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
import { createEffect, createSignal, For, onMount } from 'solid-js'
import styles from '../components/AnalyticsPage.module.css'
import Chart from '../components/Chart'
import D3HeatmapChart from '../components/D3HeatmapChart'
import ExportChartButton from '../components/ExportChartButton'
import SankeyChart from '../components/SankeyChart'
import { formatCurrency } from '../core/api'
import { apiGet, showToast } from '../utils/api'
import { downloadBlob } from '../utils/chartExport'

interface AnalyticsData {
  byCategory: Array<{ category_id: number; category_name: string; amount: number }>
  byMonth: Array<{ month: string; income: number; expense: number }>
  recentTransactions: Array<any>
  savingsRate: number
}

export default function Analytics() {
  const [data, setData] = createSignal<AnalyticsData | null>(null)
  const [loading, setLoading] = createSignal(true)
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
  const [weeks, setWeeks] = createSignal<Array<{ week: number; label: string }>>([])
  const [selectedWeek, setSelectedWeek] = createSignal('')
  const [heatmapModal, setHeatmapModal] = createSignal<{
    dateStr: string
    amount: number
    transactions: any[]
    loading: boolean
  } | null>(null)
  const [categoryChart, setCategoryChart] = createSignal<any>(undefined)
  const [stackedChart, setStackedChart] = createSignal<any>(undefined)
  const [monthlyChart, setMonthlyChart] = createSignal<any>(undefined)
  const [sankeyContainer, setSankeyContainer] = createSignal<HTMLDivElement | undefined>(undefined)
  const [heatmapContainer, setHeatmapContainer] = createSignal<HTMLDivElement | undefined>(
    undefined
  )
  const [availableYears, setAvailableYears] = createSignal<number[]>([new Date().getFullYear()])

  // Load available years from data
  const loadYears = async () => {
    try {
      const res = await apiGet<{ years: number[] }>('/api/analytics/distinct-years')
      const years = res.years || []
      const currentYear = new Date().getFullYear()
      if (!years.includes(currentYear)) years.unshift(currentYear)
      setAvailableYears(years.sort((a: number, b: number) => b - a))
    } catch (_e) {
      // keep default
    }
  }

  // Load weeks for month drill-down
  const loadWeeks = async () => {
    const year = stackedYear()
    const month = stackedMonth()
    if (!month) {
      setWeeks([])
      return
    }
    try {
      const res = await apiGet<any>(`/api/analytics/weeks?year=${year}&month=${month}`)
      setWeeks(res.weeks || [])
    } catch (_e) {
      console.error('Failed to load weeks')
      setWeeks([])
    }
  }

  // Handle heatmap day click drill-down
  const handleHeatmapDayClick = async (dateStr: string, amount: number) => {
    setHeatmapModal({ dateStr, amount, transactions: [], loading: true })
    try {
      const type = heatmapType()
      const res = await apiGet<any>(
        `/api/transactions?startDate=${dateStr}&endDate=${dateStr}&type=${type}&limit=20`
      )
      const list = Array.isArray(res?.transactions)
        ? res.transactions
        : Array.isArray(res?.rows)
          ? res.rows
          : []
      setHeatmapModal({ dateStr, amount, transactions: list, loading: false })
    } catch (_e) {
      console.error('Failed to load day transactions')
      setHeatmapModal({ dateStr, amount, transactions: [], loading: false })
    }
  }

  const closeHeatmapModal = () => setHeatmapModal(null)

  // Load analytics data
  const loadData = async () => {
    setLoading(true)
    try {
      const [categoryRes, transactionsRes, monthlyRes] = await Promise.all([
        apiGet<any>(`/api/analytics/category-trends?type=${categoryType()}`),
        apiGet<any>('/api/transactions/summary'),
        apiGet<any>('/api/stats/monthly?months=24'),
      ])

      // Transform category-trends response
      const byCategory = (categoryRes.datasets || []).slice(0, 10).map((d: any, i: number) => ({
        category_id: i,
        category_name: d.category,
        amount: Array.isArray(d.data) ? d.data.reduce((sum: number, v: number) => sum + v, 0) : 0,
      }))

      // Monthly data from /api/stats/monthly
      const byMonth = Array.isArray(monthlyRes)
        ? monthlyRes.map((m: any) => ({
            month: m.month,
            income: m.income || 0,
            expense: m.expense || 0,
          }))
        : []

      // Recent transactions from summary
      const recentTransactions: any[] = []

      setData({
        byCategory,
        byMonth,
        recentTransactions,
        savingsRate:
          transactionsRes?.total_income > 0
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
      const week = selectedWeek()
      if (week) params.set('week', week)
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
        const week = selectedWeek()
        if (week) cmpParams.set('week', week)
        try {
          const cmpRes = await apiGet<any>(`/api/analytics/category-trends?${cmpParams.toString()}`)
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

  // Export SVG (D3 charts) as PNG
  const exportSvgAsPng = (container: HTMLDivElement | undefined, filename: string) => {
    const svg = container?.querySelector('svg')
    if (!svg) return
    const svgData = new XMLSerializer().serializeToString(svg)
    const canvas = document.createElement('canvas')
    const rect = svg.getBoundingClientRect()
    canvas.width = rect.width || 800
    canvas.height = rect.height || 400
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const img = new Image()
    img.onload = () => {
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, 0, 0)
      canvas.toBlob((blob) => {
        if (blob) downloadBlob(blob, `${filename}.png`)
      })
    }
    const bytes = new TextEncoder().encode(svgData)
    const binary = Array.from(bytes, (b) => String.fromCharCode(b)).join('')
    img.src = `data:image/svg+xml;base64,${btoa(binary)}`
  }

  onMount(() => {
    loadYears()
    loadData()
    loadStackedData()
    loadHeatmapData()
  })

  // Reload data when relevant signals change
  createEffect(() => {
    loadData()
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

          {/* Stacked Trends - Full Width */}
          <div class={styles.chartsFullWidth}>
            <div class={styles.analyticsChart}>
              <div class={styles.heatmapHeader}>
                <h3 class={styles.chartTitle}>
                  Category Trends (
                  {stackedView() === 'year'
                    ? stackedYear()
                    : new Date(stackedYear(), stackedMonth() - 1).toLocaleDateString('en-US', {
                        month: 'long',
                        year: 'numeric',
                      })}
                  {compareEnabled() &&
                    ` vs ${new Date(stackedYear(), compareMonth() - 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`}
                  )
                </h3>
                <div class={styles.heatmapControls}>
                  <ExportChartButton
                    chart={stackedChart()}
                    filename="category-trends"
                    variant="inline"
                  />
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
                    {availableYears().map((year) => (
                      <option value={year}>{year}</option>
                    ))}
                  </select>
                  {stackedView() === 'month' && (
                    <>
                      <select
                        class={styles.heatmapTypeSelect}
                        value={stackedMonth()}
                        onchange={(e) => {
                          setStackedMonth(Number(e.currentTarget.value))
                          setSelectedWeek('')
                          loadStackedData()
                          loadWeeks()
                        }}
                      >
                        {Array.from({ length: 12 }, (_, i) => (
                          <option value={i + 1}>
                            {new Date(2024, i, 1).toLocaleDateString('en-US', { month: 'long' })}
                          </option>
                        ))}
                      </select>
                      {weeks().length > 0 && (
                        <select
                          class={styles.heatmapTypeSelect}
                          value={selectedWeek()}
                          onchange={(e) => {
                            setSelectedWeek(e.currentTarget.value)
                            loadStackedData()
                          }}
                        >
                          <option value="">All Weeks</option>
                          {weeks().map((w) => (
                            <option value={w.week}>{w.label}</option>
                          ))}
                        </select>
                      )}
                    </>
                  )}
                  <button
                    class={`${styles.tab} ${compareEnabled() ? styles.active : ''}`}
                    onclick={() => {
                      setCompareEnabled(!compareEnabled())
                      loadStackedData()
                    }}
                    title="Compare category spending with another month"
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
                      title="Select month to compare against"
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
              {compareEnabled() && compareData() && (
                <div style="font-size:12px;color:var(--text-secondary);margin-bottom:12px;padding:0 4px;">
                  Dashed outlines show {new Date(stackedYear(), compareMonth() - 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })} data for comparison
                </div>
              )}
              <div class={styles.chartContainer}>
                {stackedData().datasets.length === 0 ? (
                  <div class={styles.emptyState}>No category trend data available</div>
                ) : (
                  <Chart
                    type="bar"
                    onReady={setStackedChart}
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
                              backgroundColor: ds.color ? `${ds.color}66` : '#6366f166',
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
                        x: { stacked: true, ticks: { color: 'var(--text)' }, grid: { color: 'var(--border)' } },
                        y: {
                          stacked: true,
                          beginAtZero: true,
                          ticks: {
                            callback: (value: any) => formatCurrency(value),
                            color: 'var(--text)',
                          },
                          grid: { color: 'var(--border)' },
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
                            color: 'var(--text)',
                          },
                        },
                        tooltip: {
                          callbacks: {
                            label: (ctx: any) => `${ctx.dataset.label}: ${formatCurrency(ctx.raw)}`,
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
          </div>

          {/* Two Column: Category Doughnut + Monthly Trends */}
          <div class={styles.chartsTwoCol}>
            <div class={styles.analyticsChart}>
              <div class={styles.heatmapHeader}>
                <h3 class={styles.chartTitle}>
                  {categoryType() === 'expense' ? 'Spending' : 'Income'} by Category
                </h3>
                <div class={styles.heatmapControls}>
                  <ExportChartButton
                    chart={categoryChart()}
                    filename="category-breakdown"
                    variant="inline"
                  />
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
                            color: 'var(--text)',
                          },
                        },
                      },
                    }}
                    height={300}
                    width="100%"
                    onReady={setCategoryChart}
                  />
                )}
              </div>
            </div>

            <div class={styles.analyticsChart}>
              <div class={styles.heatmapHeader}>
                <h3 class={styles.chartTitle}>Monthly Income vs Expense</h3>
                <div class={styles.heatmapControls}>
                  <ExportChartButton
                    chart={monthlyChart()}
                    filename="monthly-trends"
                    variant="inline"
                  />
                </div>
              </div>
              <div class={styles.chartContainer}>
                {data()!.byMonth.length === 0 ? (
                  <div class={styles.emptyState}>No data available</div>
                ) : (
                  <Chart
                    type="line"
                    onReady={setMonthlyChart}
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
                        x: { ticks: { color: 'var(--text)' }, grid: { color: 'var(--border)' } },
                        y: {
                          beginAtZero: true,
                          ticks: {
                            callback: (value: any) => formatCurrency(value),
                            color: 'var(--text)',
                          },
                          grid: { color: 'var(--border)' },
                        },
                      },
                      plugins: {
                        legend: {
                          position: 'top',
                          labels: {
                            usePointStyle: true,
                            padding: 15,
                            font: { size: 12 },
                            color: 'var(--text)',
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
          </div>

          {/* Heatmap - Full Width */}
          <div class={styles.chartsFullWidth}>
            <div class={styles.analyticsChart}>
              <div class={styles.heatmapHeader}>
                <h3 class={styles.chartTitle}>Spending Heatmap</h3>
                <div class={styles.heatmapControls}>
                  <button
                    class={styles.exportButton}
                    onClick={() => {
                      exportSvgAsPng(heatmapContainer(), 'spending-heatmap')
                    }}
                    title="Export as PNG"
                  >
                    <svg
                      width="14"
                      height="14"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width={2}
                        d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                      />
                    </svg>
                  </button>
                  <select
                    class={styles.heatmapYearSelect}
                    value={heatmapYear()}
                    onchange={(e) => {
                      setHeatmapYear(Number(e.currentTarget.value))
                      loadHeatmapData()
                    }}
                  >
                    {availableYears().map((year) => (
                      <option value={year}>{year}</option>
                    ))}
                  </select>
                  <select
                    class={styles.heatmapTypeSelect}
                    value={heatmapType()}
                    onchange={(e) => {
                      setHeatmapType(e.currentTarget.value as 'income' | 'expense')
                      loadHeatmapData()
                    }}
                  >
                    <option value="expense">Expenses</option>
                    <option value="income">Income</option>
                  </select>
                </div>
              </div>
              <div class={styles.chartContainer} ref={setHeatmapContainer}>
                {heatmapData().size === 0 ? (
                  <div class={styles.emptyState}>No data available for this year</div>
                ) : (
                  <D3HeatmapChart
                    data={heatmapData()}
                    year={heatmapYear()}
                    type={heatmapType()}
                    height={180}
                    onDayClick={handleHeatmapDayClick}
                  />
                )}
              </div>
            </div>
          </div>

          {/* Heatmap Day Detail Modal */}
          {heatmapModal() && (
            <>
              <div
                style="position:fixed;inset:0;background:rgba(0,0,0,0.3);z-index:9998;"
                onClick={closeHeatmapModal}
              />
              <div style="position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:var(--card-bg);border:1px solid var(--border);border-radius:12px;padding:20px;box-shadow:var(--shadow-lg,0 4px 20px rgba(0,0,0,0.3));z-index:9999;min-width:300px;max-width:400px;max-height:80vh;overflow-y:auto;">
                {heatmapModal()!.loading ? (
                  <div style="text-align:center;padding:20px;color:var(--text-secondary);">
                    Loading...
                  </div>
                ) : (
                  <>
                    <div style="font-weight:600;font-size:14px;margin-bottom:10px;border-bottom:1px solid var(--border);padding-bottom:8px;color:var(--text);">
                      {new Date(heatmapModal()!.dateStr).toLocaleDateString('en-US', {
                        month: 'long',
                        day: 'numeric',
                        year: 'numeric',
                      })}{' '}
                      &mdash; {formatAmount(heatmapModal()!.amount)}
                    </div>
                    {heatmapModal()!.transactions.length === 0 ? (
                      <p style="color:var(--text-secondary);font-size:13px;">
                        No {heatmapType()} transactions for this day
                      </p>
                    ) : (
                      <div style="max-height:200px;overflow-y:auto;">
                        <For each={heatmapModal()!.transactions.slice(0, 10)}>
                          {(tx: any) => (
                            <div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid var(--border);font-size:13px;">
                              <span style="color:var(--text);">
                                {tx.description || tx.category || '-'}
                              </span>
                              <span
                                style={`font-weight:600;color:${tx.type === 'income' ? 'var(--income)' : 'var(--expense)'};`}
                              >
                                {tx.type === 'income' ? '+' : '-'}
                                {formatAmount(Math.abs(tx.amount || 0))}
                              </span>
                            </div>
                          )}
                        </For>
                        {heatmapModal()!.transactions.length > 10 && (
                          <div style="padding:5px 0;font-size:12px;color:var(--text-secondary);">
                            +{heatmapModal()!.transactions.length - 10} more
                          </div>
                        )}
                      </div>
                    )}
                    <button
                      style="margin-top:12px;width:100%;padding:8px;background:var(--btn-secondary-bg,var(--bg-secondary));color:var(--text);border:1px solid var(--border);border-radius:8px;cursor:pointer;font-size:13px;font-weight:500;"
                      onClick={closeHeatmapModal}
                    >
                      Close
                    </button>
                  </>
                )}
              </div>
            </>
          )}

          {/* Budget Flow Diagram - Full Width */}
          <div class={styles.chartsFullWidth}>
            <div class={styles.analyticsChart}>
              <div class={styles.heatmapHeader}>
                <h3 class={styles.chartTitle}>Budget Flow Diagram</h3>
                <div class={styles.heatmapControls}>
                  <button
                    class={styles.exportButton}
                    onclick={() => {
                      exportSvgAsPng(sankeyContainer(), 'budget-flow')
                    }}
                    title="Export as PNG"
                  >
                    <svg
                      width="14"
                      height="14"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width={2}
                        d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                      />
                    </svg>
                  </button>
                  <select
                    class={styles.heatmapYearSelect}
                    value={sankeyYear()}
                    onchange={(e) => {
                      setSankeyYear(Number(e.currentTarget.value))
                      loadSankeyData()
                    }}
                  >
                    {availableYears().map((year) => (
                      <option value={year}>{year}</option>
                    ))}
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
              <div class={styles.chartContainer} ref={setSankeyContainer}>
                {sankeyData().nodes.length === 0 ? (
                  <div class={styles.emptyState}>
                    No budget data for this month. Set budgets to see the flow diagram.
                  </div>
                ) : (
                  <SankeyChart data={sankeyData()} height={400} />
                )}
              </div>
            </div>
          </div>

          {/* Savings Rate - Full Width */}
          <div class={styles.chartsFullWidth}>
            <div class={styles.analyticsChart}>
              <h3 class={styles.chartTitle}>Savings Rate</h3>
              <div class={styles.chartContainer}>
                <div class={styles.savingsRateDisplay}>
                  <div class={styles.rateCircle}>
                    <span class={styles.rateValue}>{formatPercent(data()!.savingsRate)}</span>
                    <span class={styles.rateLabel}>Savings Rate</span>
                  </div>
                  <div class={styles.rateInfo}>
                    <div class={styles.rateRow}>
                      <span>Monthly Income</span>
                      <span>{formatAmount(totalIncome())}</span>
                    </div>
                    <div class={styles.rateRow}>
                      <span>Monthly Expenses</span>
                      <span>{formatAmount(totalExpense())}</span>
                    </div>
                    <div class={styles.rateRow}>
                      <span>Monthly Savings</span>
                      <span class={data()!.savingsRate >= 20 ? styles.good : data()!.savingsRate >= 10 ? styles.fair : styles.poor}>
                        {formatAmount(totalIncome() - totalExpense())}
                      </span>
                    </div>
                    <div class={styles.rateRow}>
                      <span>Projected Annual Savings</span>
                      <span class={styles.rateValue}>{formatAmount((totalIncome() - totalExpense()) * 12)}</span>
                    </div>
                    <div class={styles.rateRow}>
                      <span>Status vs 20% Target</span>
                      <span
                        class={`${styles.rateStatus} ${data()!.savingsRate >= 20 ? styles.good : data()!.savingsRate >= 10 ? styles.fair : styles.poor}`}
                      >
                        {data()!.savingsRate >= 20
                          ? 'Above target'
                          : data()!.savingsRate >= 10
                            ? 'Below target'
                            : 'Critical'}
                      </span>
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
          </div>

          {/* Top Categories Breakdown - Full Width */}
          {data()!.byCategory.length > 0 && (
            <div class={styles.chartsFullWidth}>
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
                      const monthly = total / 6
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
            </div>
          )}

          {/* Recent Transactions */}
          <div class={styles.analyticsRecent}>
            <h3 class={styles.sectionTitle}>Recent Transactions</h3>
            <div class={styles.transactionList}>
              <For each={data()!.recentTransactions}>
                {(tx: any) => (
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
                        {new Date(tx.date).toLocaleDateString()} •{' '}
                        {tx.category_name || 'No category'}
                      </div>
                    </div>
                    <div
                      class={`${styles.transactionAmount} ${tx.type === 'expense' ? styles.expense : styles.income}`}
                    >
                      {tx.type === 'expense' ? '-' : '+'}
                      {formatAmount(tx.amount)}
                    </div>
                  </div>
                )}
              </For>
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
