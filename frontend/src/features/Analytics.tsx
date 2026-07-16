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
import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  For,
  onMount,
  Show,
} from 'solid-js'
import CalcTracer, { isCalcTracerEnabled } from '../components/CalcTracer'
import Chart from '../components/Chart'
import { compactLegendLabels, mobileXTicks } from '../components/chartMobile'
import D3HeatmapChart from '../components/D3HeatmapChart'
import CategoryOrbits from '../components/Dashboard/CategoryOrbits'
import ExportChartButton from '../components/ExportChartButton'
import InfoTip from '../components/InfoTip'
import OrbitalDivider from '../components/OrbitalDivider'
import SankeyChart from '../components/SankeyChart'
import SectionRail from '../components/SectionRail'
import { api, formatCurrency } from '../core/api'
import { apiGet, showToast } from '../core/api'
import { useAppState } from '../core/appStore'
import { gatedSource } from '../core/pageVisibility'
import { usePeriod } from '../core/periodStore'
import { theme } from '../core/theme'
import { downloadBlob } from '../utils/chartExport'
import styles from './AnalyticsPage.module.css'
import type { Chart as ChartJS } from 'chart.js'
import type { CalcTrace } from '../components/CalcTracer'
import type { SankeyData, Transaction } from '../types/models'

interface CategoryTrendsRow {
  category: string
  category_name?: string
  color?: string
  data: number[]
}

interface MonthlyStatsRow {
  month: string
  income: number
  expense: number
}

interface WeekData {
  week: number
  label: string
  income: number
  expense: number
}

interface SankeyResponse {
  nodes: SankeyData['nodes']
  links: SankeyData['links']
  /** False when the month has spending but no budgets (diagram uses spending as the budget). */
  hasBudgets?: boolean
}

interface CategoryTrendsResponse {
  labels: string[]
  datasets: CategoryTrendsRow[]
  numDays?: number
}

interface HeatmapResponse {
  dates: Record<string, number>
}

export default function Analytics() {
  const state = useAppState()
  const { period } = usePeriod()

  // ── Signals used by resources (declared first to avoid forward references) ──
  const [categoryType, setCategoryType] = createSignal<'expense' | 'income'>('expense')
  const [stackedYear, setStackedYear] = createSignal(new Date().getFullYear())

  // The page-level trends year follows the global focus period; the per-chart
  // selectors below (heatmap, sankey, compare, monthly) keep their own local year.
  createEffect(() => {
    setStackedYear(period().year)
  })

  // ── Resources (declarative data fetching, race-condition safe) ──────────
  const [analyticsData] = createResource(
    // Gated on visibility: period (→ stackedYear) and profile changes refetch now only
    // while Analytics is visible; hidden, it is deferred and refetched once on show.
    gatedSource('analytics', () => ({
      year: stackedYear(),
      type: categoryType(),
      pv: state.profileVersion,
    })),
    async ({ year, type }) => {
      const now = new Date()
      const monthsNeeded = (now.getFullYear() - year) * 12 + now.getMonth() + 1
      const months = Math.max(24, monthsNeeded)
      const [categoryRes, , monthlyRes] = await Promise.all([
        apiGet<{ datasets: CategoryTrendsRow[] }>(
          `/api/analytics/category-trends?type=${type}&year=${year}`
        ),
        apiGet<Record<string, unknown>>('/api/transactions/summary'),
        apiGet<MonthlyStatsRow[]>(`/api/stats/monthly?months=${months}`),
      ])

      const byCategory = (categoryRes.datasets || []).slice(0, 10).map((d, i) => {
        const dataArr = d.data || []
        const total = dataArr.reduce((a: number, b: number) => a + b, 0)
        return {
          category_id: i,
          category_name: (d.category as string) || (d.category_name as string) || 'Unknown',
          category_color: d.color,
          amount: total,
        }
      })

      const byMonth = Array.isArray(monthlyRes)
        ? monthlyRes
            .filter((m) => m.month.startsWith(String(year)))
            .map((m) => ({
              month: m.month,
              income: m.income || 0,
              expense: m.expense || 0,
            }))
        : []

      const totalInc = byMonth.reduce((s, m) => s + m.income, 0)
      const totalExp = byMonth.reduce((s, m) => s + m.expense, 0)
      return {
        byCategory,
        byMonth,
        savingsRate: totalInc > 0 ? ((totalInc - totalExp) / totalInc) * 100 : 0,
        recentTransactions: [] as Transaction[],
      }
    }
  )

  // Derived: loading when resource is in initial fetch and no data yet
  // `.latest` keeps the previous value during a refetch and never re-triggers the page-level
  // <Suspense>, so period/profile changes update in place instead of flashing the fallback.
  const loading = () => analyticsData.loading && !analyticsData.latest
  const data = () => analyticsData.latest ?? null

  // Surface fetch errors to the user (restores toast lost during createResource migration)
  createEffect(() => {
    if (analyticsData.error) {
      console.error('Failed to load analytics', analyticsData.error)
      showToast('Failed to load analytics data', 'error')
    }
  })

  const [heatmapYear, setHeatmapYear] = createSignal(new Date().getFullYear())
  const chartColors = () => theme.getChartColors()
  const [heatmapType, setHeatmapType] = createSignal<'income' | 'expense'>('expense')
  const [heatmapData, setHeatmapData] = createSignal<Map<string, number>>(new Map())
  const [sankeyYear, setSankeyYear] = createSignal(
    new Date().getMonth() === 0 ? new Date().getFullYear() - 1 : new Date().getFullYear()
  )
  const [sankeyMonth, setSankeyMonth] = createSignal(
    new Date().getMonth() === 0 ? 12 : new Date().getMonth()
  )
  const [sankeyData, setSankeyData] = createSignal<SankeyData>({
    nodes: [],
    links: [],
  })
  // False when the selected month has spending but no budgets set — the diagram
  // then uses spending as the budget and we nudge the user to set real budgets.
  const [sankeyHasBudgets, setSankeyHasBudgets] = createSignal(true)
  // categoryType and stackedYear are declared above (before resources that depend on them)
  const [stackedView, setStackedView] = createSignal<'year' | 'month'>('year')
  const [stackedMonth, setStackedMonth] = createSignal(new Date().getMonth() + 1)
  const [stackedData, setStackedData] = createSignal<{
    labels: string[]
    datasets: Array<{ category: string; color: string; data: number[] }>
    numDays: number
  }>({ labels: [], datasets: [], numDays: 0 })
  const [compareEnabled, setCompareEnabled] = createSignal(false)
  const [compareYear, setCompareYear] = createSignal(new Date().getFullYear())
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
    transactions: Transaction[]
    loading: boolean
  } | null>(null)
  const [stackedChart, setStackedChart] = createSignal<ChartJS | undefined>(undefined)
  // Trends chart category focus: '' = all visible. Kept in a signal so the mobile-friendly
  // dropdown and the legend double-click solo stay one mechanism.
  const [soloCategory, setSoloCategory] = createSignal('')

  // Dev-mode calculation tracer: clicking an instrumented stat card opens the trace modal
  const tracerOn = isCalcTracerEnabled()
  const [trace, setTrace] = createSignal<CalcTrace | null>(null)
  const monthRows = () => ({
    columns: ['Month', 'Income', 'Expense'],
    data: (data()?.byMonth ?? []).map((m) => [
      m.month,
      formatAmount(m.income),
      formatAmount(m.expense),
    ]),
  })
  const traceCardProps = (build: () => CalcTrace) =>
    tracerOn
      ? {
          onClick: () => setTrace(build()),
          style: { cursor: 'pointer' },
          title: 'Click to trace this calculation (dev mode)',
        }
      : {}

  // Show only the datasets belonging to one category (matches the compare-mode
  // "Category (2026)" labels too); '' restores all.
  const applySoloCategory = (category: string) => {
    setSoloCategory(category)
    const chart = stackedChart()
    if (!chart) return
    chart.data.datasets.forEach((ds, i) => {
      const label = ds.label ?? ''
      const matches = !category || label === category || label.startsWith(`${category} (`)
      chart.setDatasetVisibility(i, matches)
    })
    chart.update()
  }

  // Legend click: single toggles a category, double-click within 350ms solos it
  // (or restores everything if it is already solo).
  let lastLegendClick = { index: -1, time: 0 }
  const handleLegendClick = (datasetIndex: number) => {
    const chart = stackedChart()
    if (!chart) return
    const now = Date.now()
    const isDouble = lastLegendClick.index === datasetIndex && now - lastLegendClick.time < 350
    lastLegendClick = { index: datasetIndex, time: now }
    if (isDouble) {
      const alreadySolo = chart.data.datasets.every(
        (_, i) => chart.isDatasetVisible(i) === (i === datasetIndex)
      )
      const label = chart.data.datasets[datasetIndex]?.label ?? ''
      // Strip the compare-mode " (2026)" suffix so solo keeps both series of the category
      const category = label.replace(/ \(\w+ ?\d{4}\)$| \(\d{4}\)$/, '')
      applySoloCategory(alreadySolo ? '' : category)
    } else {
      chart.setDatasetVisibility(datasetIndex, !chart.isDatasetVisible(datasetIndex))
      setSoloCategory('')
      chart.update()
    }
  }
  const [monthlyChart, setMonthlyChart] = createSignal<ChartJS | undefined>(undefined)
  const [sankeyContainer, setSankeyContainer] = createSignal<HTMLDivElement | undefined>(undefined)
  const [heatmapContainer, setHeatmapContainer] = createSignal<HTMLDivElement | undefined>(
    undefined
  )
  const [availableYears, setAvailableYears] = createSignal<number[]>([new Date().getFullYear()])
  const [monthlyMonth, setMonthlyMonth] = createSignal(new Date().getMonth() + 1)

  // Monthly stats resource — auto-fetches when year/month change
  const [monthlyStatsResource] = createResource(
    gatedSource('analytics', () => ({ year: stackedYear(), month: monthlyMonth() })),
    async ({ year, month }) => {
      const mKey = `${year}-${String(month).padStart(2, '0')}`
      const now = new Date()
      const monthsNeeded = (now.getFullYear() - year) * 12 + now.getMonth() + 1
      const monthlyRes = await apiGet<MonthlyStatsRow[]>(
        `/api/stats/monthly?months=${Math.max(24, monthsNeeded)}`
      )
      const months = Array.isArray(monthlyRes) ? monthlyRes : []
      const found = months.find((m) => m.month === mKey)
      if (found) {
        const income = found.income || 0
        const expense = found.expense || 0
        return {
          income,
          expense,
          savingsRate: income > 0 ? ((income - expense) / income) * 100 : 0,
        }
      }
      return { income: 0, expense: 0, savingsRate: 0 }
    }
  )
  const monthlyStats = () => monthlyStatsResource.latest ?? null

  // Available years resource — auto-fetches on profile change
  const [yearsResource] = createResource(
    gatedSource('analytics', () => state.profileVersion),
    async () => {
      const { years } = await api.getTransactionYears()
      if (years.length > 0) return [...years].sort((a, b) => b - a)
      return [new Date().getFullYear()]
    }
  )
  // Propagate years to signal and validate selections
  createEffect(() => {
    const sorted = yearsResource.latest
    if (sorted && sorted.length > 0) {
      setAvailableYears(sorted)
      if (!sorted.includes(stackedYear())) setStackedYear(sorted[0])
      if (!sorted.includes(heatmapYear())) setHeatmapYear(sorted[0])
      if (!sorted.includes(sankeyYear())) setSankeyYear(sorted[0])
    }
  })

  // Load weeks for month drill-down
  const loadWeeks = async () => {
    const year = stackedYear()
    const month = stackedMonth()
    if (!month) {
      setWeeks([])
      return
    }
    try {
      const res = await apiGet<{ weeks: WeekData[] }>(
        `/api/analytics/weeks?year=${year}&month=${month}`
      )
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
      const res = await apiGet<{ transactions?: Transaction[]; rows?: Transaction[] }>(
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

  // Load heatmap data
  const loadHeatmapData = async () => {
    try {
      const res = await apiGet<HeatmapResponse>(
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

  // Month/year the Sankey is showing, e.g. "April 2026".
  const sankeyMonthLabel = () =>
    new Date(sankeyYear(), sankeyMonth() - 1, 1).toLocaleDateString('en-US', {
      month: 'long',
      year: 'numeric',
    })

  // Send the user to the Budgets page to set budgets for the flow diagram.
  const goToBudgets = () => {
    window.location.hash = '#budgets'
  }

  // Load sankey data
  const loadSankeyData = async () => {
    try {
      const res = await apiGet<SankeyResponse>(
        `/api/analytics/sankey?year=${sankeyYear()}&month=${sankeyMonth()}`
      )
      setSankeyData({ nodes: res.nodes || [], links: res.links || [] })
      // Older responses omit the flag; assume budgeted so we don't nag wrongly.
      setSankeyHasBudgets(res.hasBudgets !== false)
    } catch (err) {
      console.error('Failed to load sankey data', err)
      setSankeyData({ nodes: [], links: [] })
      setSankeyHasBudgets(true)
    }
  }

  // Load stacked trend data
  const loadStackedData = async () => {
    try {
      // New data arrives with every dataset visible again — reflect that in the dropdown
      setSoloCategory('')
      const isYearView = stackedView() === 'year'
      const params = new URLSearchParams({
        year: String(stackedYear()),
        type: categoryType(),
      })
      if (!isYearView) {
        params.set('month', String(stackedMonth()))
      }
      const week = selectedWeek()
      if (week) params.set('week', week)
      const res = await apiGet<CategoryTrendsResponse>(
        `/api/analytics/category-trends?${params.toString()}`
      )
      setStackedData({
        labels: res.labels || [],
        datasets: (res.datasets || []).map((d) => ({ ...d, color: d.color || '#6366f1' })),
        numDays: res.numDays || 0,
      })

      if (compareEnabled()) {
        const cmpParams = new URLSearchParams({
          year: isYearView ? String(compareYear()) : String(stackedYear()),
          type: categoryType(),
        })
        if (!isYearView) {
          cmpParams.set('month', String(compareMonth()))
        }
        const cmpWeek = selectedWeek()
        if (cmpWeek) cmpParams.set('week', cmpWeek)
        try {
          const cmpRes = await apiGet<CategoryTrendsResponse>(
            `/api/analytics/category-trends?${cmpParams.toString()}`
          )
          setCompareData({
            labels: cmpRes.labels || [],
            datasets: (cmpRes.datasets || []).map((d) => ({ ...d, color: d.color || '#6366f1' })),
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
      setStackedData({ labels: [], datasets: [], numDays: 0 })
      setCompareData(null)
    }
  }

  // Get total income
  const totalIncome = createMemo(() => {
    return data()?.byMonth.reduce((sum, m) => sum + m.income, 0) || 0
  })

  // Get total expense
  const totalExpense = createMemo(() => {
    return data()?.byMonth.reduce((sum, m) => sum + m.expense, 0) || 0
  })

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
    loadStackedData()
    loadHeatmapData()
  })

  return (
    <div class={`page page-analytics page-enter instrument-deck ${styles.analyticsPage}`}>
      <div class={styles.pageHeader}>
        <h1 data-test-id="analytics-header" data-tour="analytics-header">
          Analytics
          {/* Subtitle copy lives in a tooltip (a text line wraps badly on phones). */}
          <InfoTip text="Visualize your financial data and track trends" />
        </h1>
      </div>

      {/* Jump-to-section orbit rail (desktop) — anchors are the OrbitalDividers below. */}
      <SectionRail
        sections={[
          { id: 'analytics-sec-overview', label: 'Overview' },
          { id: 'analytics-sec-trends', label: 'Category Trends' },
          { id: 'analytics-sec-by-category', label: 'By Category' },
          { id: 'analytics-sec-monthly', label: 'Monthly Income vs Expense' },
          { id: 'analytics-sec-heatmap', label: 'Spending Heatmap' },
          { id: 'analytics-sec-flow', label: 'Budget Flow' },
          { id: 'analytics-sec-savings', label: 'Savings Rate' },
          { id: 'analytics-sec-top-categories', label: 'Top Categories' },
          { id: 'analytics-sec-recent', label: 'Recent Transactions' },
        ]}
      />

      {loading() && !data() ? (
        <div class={styles.emptyState}>Loading analytics...</div>
      ) : !data() ? (
        <div class={styles.emptyState}>
          <p>No data available</p>
          <p>Add some transactions to see analytics.</p>
        </div>
      ) : (
        <>
          {/* Summary Stats */}
          <div
            id="analytics-sec-overview"
            class={styles.analyticsStats}
            style={{ 'scroll-margin-top': '18px' }}
          >
            <div
              class={styles.statCard}
              {...traceCardProps(() => ({
                title: 'Savings Rate',
                formula: `(Total income − Total expenses) ÷ Total income × 100\n= (${formatAmount(totalIncome())} − ${formatAmount(totalExpense())}) ÷ ${formatAmount(totalIncome())} × 100\n= ${formatPercent(data()!.savingsRate)}`,
                inputs: [
                  { label: 'Year', value: stackedYear() },
                  { label: 'Total income', value: formatAmount(totalIncome()) },
                  { label: 'Total expenses', value: formatAmount(totalExpense()) },
                ],
                rows: monthRows(),
                note: 'Monthly totals come from /api/stats/monthly filtered to the selected year.',
              }))}
            >
              <div class={styles.statLabel}>
                Savings Rate
                <InfoTip text={`(Income − Expenses) ÷ Income × 100, across ${stackedYear()}`} />
              </div>
              <div
                class={`${styles.statValue} ${data()!.savingsRate >= 20 ? styles.positive : data()!.savingsRate >= 10 ? styles.warning : styles.negative}`}
              >
                {formatPercent(data()!.savingsRate)}
              </div>
              <div class={styles.statDesc}>{stackedYear()}</div>
            </div>
            <div
              class={styles.statCard}
              {...traceCardProps(() => ({
                title: 'Total Income',
                formula: `Sum of monthly income totals in ${stackedYear()}\n= ${formatAmount(totalIncome())}`,
                inputs: [
                  { label: 'Year', value: stackedYear() },
                  { label: 'Months with data', value: data()!.byMonth.length },
                ],
                rows: monthRows(),
                note: 'Monthly totals come from /api/stats/monthly filtered to the selected year.',
              }))}
            >
              <div class={styles.statLabel}>
                Total Income
                <InfoTip text={`Sum of all income transactions in ${stackedYear()}`} />
              </div>
              <div class={`${styles.statValue} ${styles.positive}`}>
                {formatAmount(totalIncome())}
              </div>
              <div class={styles.statDesc}>{stackedYear()}</div>
            </div>
            <div
              class={styles.statCard}
              {...traceCardProps(() => ({
                title: 'Total Expense',
                formula: `Sum of monthly expense totals in ${stackedYear()}\n= ${formatAmount(totalExpense())}`,
                inputs: [
                  { label: 'Year', value: stackedYear() },
                  { label: 'Months with data', value: data()!.byMonth.length },
                ],
                rows: monthRows(),
                note: 'Monthly totals come from /api/stats/monthly filtered to the selected year.',
              }))}
            >
              <div class={styles.statLabel}>
                Total Expense
                <InfoTip text={`Sum of all expense transactions in ${stackedYear()}`} />
              </div>
              <div class={`${styles.statValue} ${styles.negative}`}>
                {formatAmount(totalExpense())}
              </div>
              <div class={styles.statDesc}>{stackedYear()}</div>
            </div>
            <div
              class={styles.statCard}
              {...traceCardProps(() => ({
                title: 'Net Savings',
                formula: `Total income − Total expenses\n= ${formatAmount(totalIncome())} − ${formatAmount(totalExpense())}\n= ${formatAmount(totalIncome() - totalExpense())}`,
                inputs: [
                  { label: 'Year', value: stackedYear() },
                  { label: 'Total income', value: formatAmount(totalIncome()) },
                  { label: 'Total expenses', value: formatAmount(totalExpense()) },
                ],
                rows: monthRows(),
              }))}
            >
              <div class={styles.statLabel}>
                Net Savings
                <InfoTip text={`Total income − total expenses in ${stackedYear()}`} />
              </div>
              <div class={`${styles.statValue} ${styles.positive}`}>
                {formatAmount(totalIncome() - totalExpense())}
              </div>
              <div class={styles.statDesc}>Income - Expenses</div>
            </div>
          </div>

          {/* Monthly Savings Card */}
          <div class={styles.analyticsStats} style="margin-bottom:24px">
            <div
              class={styles.statCard}
              style="border-left:3px solid var(--primary)"
              data-test-id="analytics-monthly-savings"
            >
              <div class={styles.statLabel}>
                Monthly Savings (
                {new Date(stackedYear(), monthlyMonth() - 1).toLocaleDateString('en-US', {
                  month: 'long',
                  year: 'numeric',
                })}
                )
              </div>
              <div class={styles.heatmapControls} style="justify-content:flex-start;margin-top:8px">
                <select
                  class={styles.heatmapTypeSelect}
                  value={monthlyMonth()}
                  onchange={(e) => setMonthlyMonth(Number(e.currentTarget.value))}
                  data-test-id="analytics-monthly-month"
                >
                  {Array.from({ length: 12 }, (_, i) => (
                    <option value={i + 1}>
                      {new Date(2024, i, 1).toLocaleDateString('en-US', { month: 'long' })}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {monthlyStats() && (
              <>
                {(() => {
                  const monthLabel = () =>
                    new Date(stackedYear(), monthlyMonth() - 1).toLocaleDateString('en-US', {
                      month: 'long',
                      year: 'numeric',
                    })
                  const monthTrace = (title: string, formulaLine: string): CalcTrace => ({
                    title,
                    formula: formulaLine,
                    inputs: [
                      { label: 'Month', value: monthLabel() },
                      { label: 'Income', value: formatAmount(monthlyStats()!.income) },
                      { label: 'Expenses', value: formatAmount(monthlyStats()!.expense) },
                    ],
                    note: 'Totals come from /api/stats/monthly for the selected month.',
                  })
                  return (
                    <>
                      <div
                        class={styles.statCard}
                        data-test-id="analytics-monthly-income"
                        {...traceCardProps(() =>
                          monthTrace(
                            'Monthly Income',
                            `Sum of income transactions in ${monthLabel()}\n= ${formatAmount(monthlyStats()!.income)}`
                          )
                        )}
                      >
                        <div class={styles.statLabel}>
                          Monthly Income
                          <InfoTip text={`Sum of income transactions in ${monthLabel()}`} />
                        </div>
                        <div class={`${styles.statValue} ${styles.positive}`}>
                          {formatAmount(monthlyStats()!.income)}
                        </div>
                      </div>
                      <div
                        class={styles.statCard}
                        data-test-id="analytics-monthly-expense"
                        {...traceCardProps(() =>
                          monthTrace(
                            'Monthly Expense',
                            `Sum of expense transactions in ${monthLabel()}\n= ${formatAmount(monthlyStats()!.expense)}`
                          )
                        )}
                      >
                        <div class={styles.statLabel}>
                          Monthly Expense
                          <InfoTip text={`Sum of expense transactions in ${monthLabel()}`} />
                        </div>
                        <div class={`${styles.statValue} ${styles.negative}`}>
                          {formatAmount(monthlyStats()!.expense)}
                        </div>
                      </div>
                      <div
                        class={styles.statCard}
                        {...traceCardProps(() =>
                          monthTrace(
                            'Monthly Net',
                            `Income − Expenses\n= ${formatAmount(monthlyStats()!.income)} − ${formatAmount(monthlyStats()!.expense)}\n= ${formatAmount(monthlyStats()!.income - monthlyStats()!.expense)}`
                          )
                        )}
                      >
                        <div class={styles.statLabel}>
                          Monthly Net
                          <InfoTip text={`Income − expenses in ${monthLabel()}`} />
                        </div>
                        <div
                          class={`${styles.statValue} ${monthlyStats()!.income - monthlyStats()!.expense >= 0 ? styles.positive : styles.negative}`}
                        >
                          {formatAmount(monthlyStats()!.income - monthlyStats()!.expense)}
                        </div>
                      </div>
                      <div
                        class={styles.statCard}
                        {...traceCardProps(() =>
                          monthTrace(
                            'Monthly Savings Rate',
                            `(Income − Expenses) ÷ Income × 100\n= (${formatAmount(monthlyStats()!.income)} − ${formatAmount(monthlyStats()!.expense)}) ÷ ${formatAmount(monthlyStats()!.income)} × 100\n= ${formatPercent(monthlyStats()!.savingsRate)}`
                          )
                        )}
                      >
                        <div class={styles.statLabel}>
                          Monthly Savings Rate
                          <InfoTip
                            text={`(Income − Expenses) ÷ Income × 100, for ${monthLabel()}`}
                          />
                        </div>
                        <div
                          class={`${styles.statValue} ${monthlyStats()!.savingsRate >= 20 ? styles.positive : monthlyStats()!.savingsRate >= 10 ? styles.warning : styles.negative}`}
                        >
                          {formatPercent(monthlyStats()!.savingsRate)}
                        </div>
                        <div class={styles.statDesc}>Target: 20%+</div>
                      </div>
                    </>
                  )
                })()}
              </>
            )}
          </div>

          {/* Stacked Trends - Full Width */}
          <div class={styles.chartsFullWidth}>
            <OrbitalDivider
              id="analytics-sec-trends"
              label="Category Trends"
              meta={`${
                stackedView() === 'year'
                  ? stackedYear()
                  : new Date(stackedYear(), stackedMonth() - 1).toLocaleDateString('en-US', {
                      month: 'long',
                      year: 'numeric',
                    })
              }${
                compareEnabled()
                  ? stackedView() === 'year'
                    ? ` vs ${compareYear()}`
                    : ` vs ${new Date(stackedYear(), compareMonth() - 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`
                  : ''
              }`}
            />
            <div class={styles.analyticsChart}>
              <div class={`${styles.heatmapHeader} ${styles.heatmapHeaderEnd}`}>
                <div class={styles.heatmapControls}>
                  <ExportChartButton
                    chart={stackedChart()}
                    filename="category-trends"
                    variant="inline"
                  />
                  {stackedData().datasets.length > 0 && (
                    <select
                      class={styles.heatmapTypeSelect}
                      value={soloCategory()}
                      onchange={(e) => {
                        applySoloCategory(e.currentTarget.value)
                      }}
                      title="Focus the chart on a single category"
                    >
                      <option value="">All categories</option>
                      <For each={stackedData().datasets}>
                        {(d) => <option value={d.category}>{d.category}</option>}
                      </For>
                    </select>
                  )}
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
                    data-test-id="analytics-trends-year"
                  >
                    <For each={availableYears()}>
                      {(year) => <option value={year}>{year}</option>}
                    </For>
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
                          <For each={weeks()}>
                            {(w) => <option value={w.week}>{w.label}</option>}
                          </For>
                        </select>
                      )}
                    </>
                  )}
                  <button
                    class={styles.compareBtn}
                    classList={{ [styles.compareActive!]: compareEnabled() }}
                    onclick={() => {
                      setCompareEnabled(!compareEnabled())
                      loadStackedData()
                    }}
                    title={
                      stackedView() === 'year'
                        ? 'Compare category spending with another year'
                        : 'Compare category spending with another month'
                    }
                  >
                    {compareEnabled() ? 'Hide Compare' : 'Compare'}
                  </button>
                  {compareEnabled() && stackedView() === 'year' && (
                    <select
                      class={styles.heatmapTypeSelect}
                      value={compareYear()}
                      onchange={(e) => {
                        setCompareYear(Number(e.currentTarget.value))
                        loadStackedData()
                      }}
                      title="Select year to compare against"
                    >
                      <For each={availableYears().filter((y) => y !== stackedYear())}>
                        {(year) => <option value={year}>{year}</option>}
                      </For>
                    </select>
                  )}
                  {compareEnabled() && stackedView() === 'month' && (
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
                  Dashed outlines show{' '}
                  {stackedView() === 'year'
                    ? compareYear()
                    : new Date(stackedYear(), compareMonth() - 1).toLocaleDateString('en-US', {
                        month: 'long',
                        year: 'numeric',
                      })}{' '}
                  data for comparison
                </div>
              )}
              <div class={styles.chartContainer} data-tour="analytics-trends">
                {stackedData().datasets.length === 0 ? (
                  <div class={styles.emptyState}>No category trend data available</div>
                ) : (
                  <Chart
                    type="bar"
                    onReady={setStackedChart}
                    data={{
                      labels:
                        compareEnabled() && stackedView() === 'year'
                          ? stackedData().labels.map((l: string) => l.replace(/\s+\d{4}$/, ''))
                          : stackedData().labels,
                      datasets: [
                        ...stackedData().datasets.map((ds) => ({
                          label:
                            compareEnabled() && stackedView() === 'year'
                              ? `${ds.category} (${stackedYear()})`
                              : compareEnabled()
                                ? `${ds.category} (${new Date(stackedYear(), stackedMonth() - 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })})`
                                : ds.category,
                          data: ds.data,
                          backgroundColor: ds.color || '#6366f1',
                          borderWidth: 0,
                        })),
                        ...(compareData()
                          ? compareData()!.datasets.map((ds) => ({
                              label:
                                stackedView() === 'year'
                                  ? `${ds.category} (${compareYear()})`
                                  : `${ds.category} (${new Date(stackedYear(), compareMonth() - 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })})`,
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
                        x: {
                          stacked: true,
                          ticks: mobileXTicks(chartColors().text),
                          grid: { color: chartColors().border },
                        },
                        y: {
                          stacked: true,
                          beginAtZero: true,
                          ticks: {
                            callback: (value: string | number) => formatCurrency(value as number),
                            color: chartColors().text,
                          },
                          grid: { color: chartColors().border },
                        },
                      },
                      plugins: {
                        legend: {
                          position: 'bottom',
                          onClick: (_e, legendItem) => {
                            if (legendItem.datasetIndex !== undefined)
                              handleLegendClick(legendItem.datasetIndex)
                          },
                          labels: compactLegendLabels(chartColors().text),
                        },
                        tooltip: {
                          callbacks: {
                            label: (ctx) =>
                              `${ctx.dataset.label}: ${formatCurrency(ctx.raw as number)}`,
                          },
                        },
                      },
                    }}
                    height={350}
                    width="100%"
                  />
                )}
              </div>
              {stackedData().datasets.length > 0 && (
                <div style="font-size:12px;color:var(--text-secondary);margin-top:6px;padding:0 4px;">
                  Tip: click a category in the legend to hide it, double-click to show only that
                  category. On small screens use the category dropdown above.
                </div>
              )}
              {/* Averages below stacked chart */}
              {stackedData().numDays > 0 && (
                <div class={styles.averages}>
                  <div class={styles.avgCard}>
                    <div class={styles.avgLabel}>
                      Daily Average
                      <InfoTip
                        text={`Chart total ÷ ${stackedData().numDays} days in the selected period`}
                      />
                    </div>
                    <div class={styles.avgValue}>
                      {formatAmount(
                        stackedData().datasets.reduce(
                          (sum, ds) => sum + ds.data.reduce((a, b) => a + b, 0),
                          0
                        ) / stackedData().numDays
                      )}
                    </div>
                  </div>
                  <div class={styles.avgCard}>
                    <div class={styles.avgLabel}>
                      Weekly Average
                      <InfoTip text="Daily average × 7" />
                    </div>
                    <div class={styles.avgValue}>
                      {formatAmount(
                        (stackedData().datasets.reduce(
                          (sum, ds) => sum + ds.data.reduce((a, b) => a + b, 0),
                          0
                        ) /
                          stackedData().numDays) *
                          7
                      )}
                    </div>
                  </div>
                  <div class={styles.avgCard}>
                    <div class={styles.avgLabel}>
                      Monthly Average
                      <InfoTip text="Daily average × 30" />
                    </div>
                    <div class={styles.avgValue}>
                      {formatAmount(
                        (stackedData().datasets.reduce(
                          (sum, ds) => sum + ds.data.reduce((a, b) => a + b, 0),
                          0
                        ) /
                          stackedData().numDays) *
                          30
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Two Column: Category Doughnut + Monthly Trends */}
          <div class={styles.chartsTwoCol}>
            <div class={styles.chartCol}>
              <OrbitalDivider
                id="analytics-sec-by-category"
                label={categoryType() === 'expense' ? 'Spending by Category' : 'Income by Category'}
                meta={String(stackedYear())}
              />
              <div class={styles.analyticsChart}>
                <div class={`${styles.heatmapHeader} ${styles.heatmapHeaderEnd}`}>
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
                  </div>
                </div>
                <div class={styles.chartContainer}>
                  {data()!.byCategory.length === 0 ? (
                    <div class={styles.emptyState}>No {categoryType()} data</div>
                  ) : (
                    <CategoryOrbits
                      categories={data()!.byCategory}
                      periodText={String(stackedYear())}
                      label={categoryType() === 'income' ? 'earned' : 'spent'}
                      maxRings={7}
                    />
                  )}
                </div>
              </div>
            </div>

            <div class={styles.chartCol}>
              <OrbitalDivider
                id="analytics-sec-monthly"
                label="Monthly Income vs Expense"
                meta={String(stackedYear())}
              />
              <div class={styles.analyticsChart}>
                <div class={`${styles.heatmapHeader} ${styles.heatmapHeaderEnd}`}>
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
                          x: {
                            ticks: { color: chartColors().text },
                            grid: { color: chartColors().border },
                          },
                          y: {
                            beginAtZero: true,
                            ticks: {
                              callback: (value: string | number) => formatCurrency(value as number),
                              color: chartColors().text,
                            },
                            grid: { color: chartColors().border },
                          },
                        },
                        plugins: {
                          legend: {
                            position: 'top',
                            labels: {
                              usePointStyle: true,
                              padding: 15,
                              font: { size: 12 },
                              color: chartColors().text,
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
          </div>

          {/* Heatmap - Full Width */}
          <div class={styles.chartsFullWidth}>
            <OrbitalDivider id="analytics-sec-heatmap" label="Spending Heatmap" />
            <div class={styles.analyticsChart}>
              <div class={`${styles.heatmapHeader} ${styles.heatmapHeaderEnd}`}>
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
                    <For each={availableYears()}>
                      {(year) => <option value={year}>{year}</option>}
                    </For>
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
              <div
                class={styles.chartContainer}
                ref={setHeatmapContainer}
                data-tour="analytics-heatmap"
              >
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
                          {(tx: Transaction) => (
                            <div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid var(--border);font-size:13px;">
                              <span style="color:var(--text);">
                                {tx.description || tx.category_name || '-'}
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
            <OrbitalDivider id="analytics-sec-flow" label="Budget Flow Diagram" />
            <div class={styles.analyticsChart}>
              <div class={`${styles.heatmapHeader} ${styles.heatmapHeaderEnd}`}>
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
                    <For each={availableYears()}>
                      {(year) => <option value={year}>{year}</option>}
                    </For>
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
              <div
                class={styles.chartContainer}
                ref={setSankeyContainer}
                data-tour="analytics-sankey"
              >
                {sankeyData().nodes.length === 0 ? (
                  <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:32px;color:var(--text-secondary);text-align:center;">
                    <span>No transactions for {sankeyMonthLabel()}.</span>
                    <button
                      style="padding:8px 16px;background:var(--primary);color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:13px;font-weight:500;"
                      onClick={goToBudgets}
                    >
                      Set budgets
                    </button>
                  </div>
                ) : (
                  <>
                    <SankeyChart data={sankeyData()} height={400} />
                    <Show when={!sankeyHasBudgets()}>
                      <div style="margin-top:10px;padding:10px 14px;background:var(--bg-secondary,rgba(99,102,241,0.08));border:1px solid var(--border);border-radius:8px;color:var(--text-secondary);font-size:13px;display:flex;flex-wrap:wrap;align-items:center;gap:8px;">
                        <span>
                          No budgets set for {sankeyMonthLabel()} — showing this month's spending as
                          the budget.
                        </span>
                        <button
                          style="padding:4px 10px;background:var(--primary);color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:12px;font-weight:500;"
                          onClick={goToBudgets}
                        >
                          Set budgets
                        </button>
                      </div>
                    </Show>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Savings Rate - Full Width */}
          <div class={styles.chartsFullWidth}>
            <OrbitalDivider id="analytics-sec-savings" label="Savings Rate" />
            <div class={styles.analyticsChart}>
              <div class={styles.chartContainer}>
                <div class={styles.savingsRateDisplay}>
                  {/* Hero stat: big value with the label + period stacked beneath it — the
                      old 100px "circle" crammed the % and label side by side and wrapped. */}
                  <div class={styles.rateHero}>
                    <span class={styles.rateHeroValue}>{formatPercent(data()!.savingsRate)}</span>
                    <span class={styles.rateHeroLabel}>Savings Rate</span>
                    <span class={styles.rateHeroPeriod}>across {stackedYear()}</span>
                  </div>
                  <div class={styles.rateInfo}>
                    <div class={styles.rateRow}>
                      <span>Period Income</span>
                      <span>{formatAmount(totalIncome())}</span>
                    </div>
                    <div class={styles.rateRow}>
                      <span>Period Expenses</span>
                      <span>{formatAmount(totalExpense())}</span>
                    </div>
                    <div class={styles.rateRow}>
                      <span>Period Savings</span>
                      <span
                        class={
                          data()!.savingsRate >= 20
                            ? styles.good
                            : data()!.savingsRate >= 10
                              ? styles.fair
                              : styles.poor
                        }
                      >
                        {formatAmount(totalIncome() - totalExpense())}
                      </span>
                    </div>
                    <div class={styles.rateRow}>
                      <span>Avg Monthly Savings</span>
                      <span>
                        {formatAmount(
                          (totalIncome() - totalExpense()) /
                            Math.max((data()?.byMonth || []).length, 1)
                        )}
                      </span>
                    </div>
                    <div class={styles.rateRow}>
                      <span>Projected Annual Savings</span>
                      <span class={styles.rateValue}>
                        {formatAmount(
                          ((totalIncome() - totalExpense()) /
                            Math.max((data()?.byMonth || []).length, 1)) *
                            12
                        )}
                      </span>
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
              <OrbitalDivider
                id="analytics-sec-top-categories"
                label="Top Categories Breakdown"
                meta={String(stackedYear())}
                info={`Top ${data()!.byCategory.length} ${categoryType()} categories of ${stackedYear()}, ranked by yearly total. Follows the year selected on the Category Trends chart.`}
              />
              <div class={styles.analyticsChart}>
                <div class={styles.chartContainer}>
                  <div class={styles.categoryBars}>
                    {(() => {
                      const total =
                        data()!.byCategory.reduce(
                          (s: number, c: { amount: number }) => s + c.amount,
                          0
                        ) || 1
                      return (
                        <For each={data()!.byCategory}>
                          {(item) => {
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
                          }}
                        </For>
                      )
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
                      const total = data()!.byCategory.reduce(
                        (s: number, c: { amount: number }) => s + c.amount,
                        0
                      )
                      const count = data()!.byCategory.length
                      const avg = count > 0 ? total / count : 0
                      // Divide by the period the data actually covers: full months/days
                      // for past years, elapsed months/days for the current year
                      // (the old hardcoded /6 and /30 were wrong for any year view).
                      const year = stackedYear()
                      const now = new Date()
                      const isCurrentYear = year === now.getFullYear()
                      const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
                      const dayOfYear = Math.floor(
                        (now.getTime() - new Date(year, 0, 0).getTime()) / 86400000
                      )
                      const monthsCovered = Math.max(1, isCurrentYear ? now.getMonth() + 1 : 12)
                      const daysCovered = Math.max(
                        1,
                        isCurrentYear ? dayOfYear : isLeap(year) ? 366 : 365
                      )
                      const monthly = total / monthsCovered
                      const daily = total / daysCovered
                      return (
                        <>
                          <div>
                            <div class={styles.statLabel}>
                              Total {categoryType()}
                              <InfoTip
                                text={`Sum of the top ${count} ${categoryType()} categories in ${year}`}
                              />
                            </div>
                            <div class={styles.statValue}>{formatAmount(total)}</div>
                          </div>
                          <div>
                            <div class={styles.statLabel}>
                              Monthly Average
                              <InfoTip
                                text={`Total ÷ ${monthsCovered} month${monthsCovered === 1 ? '' : 's'}${isCurrentYear ? ` elapsed in ${year}` : ` of ${year}`}`}
                              />
                            </div>
                            <div class={styles.statValue}>{formatAmount(monthly)}</div>
                          </div>
                          <div>
                            <div class={styles.statLabel}>
                              Daily Average
                              <InfoTip
                                text={`Total ÷ ${daysCovered} day${daysCovered === 1 ? '' : 's'}${isCurrentYear ? ` elapsed in ${year}` : ` of ${year}`}`}
                              />
                            </div>
                            <div class={styles.statValue}>{formatAmount(daily)}</div>
                          </div>
                          <div>
                            <div class={styles.statLabel}>
                              Per-Category Avg
                              <InfoTip text={`Total ÷ ${count} categories shown`} />
                            </div>
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
            <OrbitalDivider id="analytics-sec-recent" label="Recent Transactions" />
            <div class={styles.transactionList}>
              <For each={data()!.recentTransactions}>
                {(tx: Transaction) => (
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
      <CalcTracer trace={trace()} onClose={() => setTrace(null)} />
    </div>
  )
}
