/**
 * Budgets Component - EARS Specification
 *
 * GIVEN: A user is viewing the Budgets page
 * WHEN: The page loads
 * THEN: The header displays "Budgets" and shows all budget categories with progress
 *
 * GIVEN: A user wants to create a new budget
 * WHEN: They click the "Create Budget" button
 * THEN: A budget creation modal opens with form fields for category and amount
 *
 * GIVEN: A user creates a budget
 * WHEN: They enter a category name and monthly amount
 * THEN: The new budget appears in the budget list with a progress indicator
 *
 * GIVEN: A user has spent more than their budget
 * WHEN: The page displays their spending vs budget
 * THEN: The progress bar and color indicator show they are over budget (red)
 *
 * GIVEN: A user has budget rollover enabled
 * WHEN: A budget category has unspent remaining budget
 * THEN: The remaining amount rolls over to the next month
 *
 * GIVEN: A user wants to set a budget from expenses
 * WHEN: They click "Set from Expenses"
 * THEN: The budget is calculated based on past spending in that category
 */

/**
 * Budgets Component
 * Includes traditional budgeting view, zero-based budgeting (envelope-style), and forecasting
 */
import { createEffect, createSignal, For, onMount } from 'solid-js'
import Badge from '../components/Badge'
import styles from '../components/BudgetsPage.module.css'
import Button from '../components/Button'
import { getCategorySvg } from '../components/CategoryIcon'
import Chart from '../components/Chart'
import { getLocalCurrency } from '../core/api'
import { theme } from '../core/theme'
import { apiGet, apiPost, apiPut, showToast } from '../utils/api'

type AllocationStatus = 'ok' | 'warning' | 'over'

interface ForecastMonth {
  month: string
  label: string
  budget_amount: number
  predicted_spent: number
  adherence: number
  status: 'ok' | 'warning' | 'over'
  forecast_remaining: number
}

interface ForecastData {
  period: string
  history: unknown[]
  forecast: ForecastMonth[]
  total_budget: number
  avg_adherence: number
}

interface CategoryAllocation {
  budget_id: number | null
  category_id: number
  category_name: string
  category_color: string
  category_icon: string | null
  allocated: number
  spent: number
  remaining_budget: number
  percent_used: number
  status: AllocationStatus
  can_allocate: boolean
  is_budgeted: boolean
  is_fully_allocated: boolean
  rollover_enabled: boolean
}

interface ZeroBasedSummary {
  categories: CategoryAllocation[]
  remaining_income: number
  already_budgeted: number
  unassigned_budget: number
  period: string
  can_allocate: boolean
  total_budget: number
  total_spent: number
  remaining: number
  zero_based_remaining: number
  income: number
}

export default function Budgets() {
  const [month, setMonth] = createSignal(new Date().toISOString().slice(0, 7))
  const [loading, setLoading] = createSignal(true)
  const [error, setError] = createSignal<string | null>(null)
  const [allocations, setAllocations] = createSignal<CategoryAllocation[]>([])
  const [summary, setSummary] = createSignal<ZeroBasedSummary | null>(null)
  const [showAllocateModal, setShowAllocateModal] = createSignal(false)
  const [selectedCategory, setSelectedCategory] = createSignal<CategoryAllocation | null>(null)
  const [allocateAmount, setAllocateAmount] = createSignal('')
  const [budgetMessage, setBudgetMessage] = createSignal<string>('')
  const [forecastData, setForecastData] = createSignal<ForecastData | null>(null)
  const [showForecast, setShowForecast] = createSignal(false)
  const [improvements, setImprovements] = createSignal<any[]>([])
  const [showCharts, setShowCharts] = createSignal(true)
  const [showMonthPicker, setShowMonthPicker] = createSignal(false)
  const [showYearPicker, setShowYearPicker] = createSignal(false)

  const MONTHS = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ]
  const currentYear = new Date().getFullYear()
  const years = Array.from({ length: 21 }, (_, i) => currentYear - 10 + i)

  const currentMonthNum = () => parseInt(month().split('-')[1])
  const currentYearNum = () => parseInt(month().split('-')[0])

  const setMonthNum = (m: number) => {
    const y = currentYearNum()
    setMonth(`${y}-${String(m).padStart(2, '0')}`)
  }
  const setYearNum = (y: number) => {
    const m = currentMonthNum()
    setMonth(`${y}-${String(m).padStart(2, '0')}`)
  }
  const goToPrevMonth = () => {
    const date = new Date(`${month()}-01`)
    date.setMonth(date.getMonth() - 1)
    setMonth(date.toISOString().slice(0, 7))
  }
  const goToNextMonth = () => {
    const date = new Date(`${month()}-01`)
    date.setMonth(date.getMonth() + 1)
    setMonth(date.toISOString().slice(0, 7))
  }

  // Get current allocations and summary
  const loadData = async () => {
    setLoading(true)
    setError(null)

    try {
      const [allocationsRes, summaryRes, forecastDataRaw] = await Promise.all([
        apiGet<any>(`/api/budgets/zero-based?month=${month()}`),
        apiGet<any>(`/api/budgets/zero-based/summary?month=${month()}`),
        apiGet<ForecastData>(`/api/budgets/forecast?month=${month()}`).catch(() => null),
      ])

      const allocationsList = (allocationsRes?.allocations || allocationsRes?.categories || []).map(
        (item: any) => ({
          ...item,
          amount: item.amount || item.allocated || 0,
          allocated: item.amount || item.allocated || 0,
          status:
            item.status ||
            (item.percent_used > 100 ? 'over' : item.percent_used >= 90 ? 'warning' : 'ok'),
          is_fully_allocated: item.is_fully_allocated ?? (item.is_budgeted && item.amount > 0),
        })
      )
      setAllocations(allocationsList)
      setSummary({
        ...summaryRes,
        categories: summaryRes?.allocations || summaryRes?.categories || [],
      })
      const unallocated = summaryRes?.zero_based_remaining || summaryRes?.zeroBasedRemaining || 0
      setBudgetMessage(
        unallocated > 0
          ? `Unallocated: ${new Intl.NumberFormat(undefined, { style: 'currency', currency: getLocalCurrency() }).format(unallocated)}`
          : `All income allocated!`
      )

      if (forecastDataRaw) {
        setForecastData(forecastDataRaw)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load budget data')
      showToast('Failed to load budget data', 'error')
    } finally {
      setLoading(false)
    }
  }

  // Toggle forecast view
  const toggleForecast = () => {
    setShowForecast(!showForecast())
    if (!showForecast() && !forecastData()) {
      loadData()
    }
  }

  // Load historical improvements data for trend chart
  const loadImprovements = async () => {
    try {
      const data = await apiGet<any[]>(`/api/budgets/improvements?months=6`)
      setImprovements(data || [])
    } catch {
      // History loading is best-effort
    }
  }

  // Duplicate budgets from previous month
  const duplicateLastMonth = async () => {
    const [year, mon] = month().split('-')
    try {
      const result = await apiPost<{ ok: boolean; count?: number; message?: string }>(
        '/api/budgets/duplicate-last',
        {
          year: parseInt(year),
          month: parseInt(mon),
        }
      )
      if (result.ok) {
        showToast(`Duplicated ${result.count} budgets from last month`, 'success')
        await loadData()
      } else {
        showToast(result.message || 'Nothing to duplicate', 'info')
      }
    } catch (_err) {
      showToast('Failed to duplicate budgets', 'error')
    }
  }

  // Set budgets from previous month's expenses
  const setFromExpenses = async () => {
    const [year, mon] = month().split('-')
    try {
      const result = await apiPost<{ ok: boolean; count?: number; message?: string }>(
        '/api/budgets/from-expenses',
        {
          year: parseInt(year),
          month: parseInt(mon),
        }
      )
      if (result.ok) {
        showToast(`Set ${result.count} budgets from last month's expenses`, 'success')
        await loadData()
      } else {
        showToast(result.message || 'No expenses found', 'info')
      }
    } catch (_err) {
      showToast('Failed to set budgets from expenses', 'error')
    }
  }

  // Toggle rollover for a budget
  const toggleRollover = async (budgetId: number, enabled: boolean) => {
    try {
      await apiPut(`/api/budgets/${budgetId}/rollover`, {
        rollover_enabled: enabled,
      })
      showToast(enabled ? 'Rollover enabled' : 'Rollover disabled', 'success')
      await loadData()
    } catch {
      showToast('Failed to update rollover', 'error')
    }
  }

  // Allocate budget to a category
  const allocateBudget = async () => {
    const allocNum = parseFloat(allocateAmount()) || 0
    if (!selectedCategory() || allocNum <= 0) {
      return
    }

    try {
      await apiPost('/api/budgets/allocate', {
        category_id: selectedCategory()!.category_id,
        amount: allocNum,
        period: 'monthly',
      })

      showToast('Budget allocated successfully!', 'success')
      setShowAllocateModal(false)
      setAllocateAmount('')
      loadData()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to allocate budget')
      showToast('Failed to allocate budget', 'error')
    }
  }

  // Theme-aware chart colors (Canvas API doesn't resolve CSS custom properties)
  const chartColors = () => theme.getChartColors()

  // Format currency
  const formatCurrency = (value: number) => {
    const currency = getLocalCurrency()
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
    }).format(value)
  }

  // Get status class
  const getStatusClass = (status: AllocationStatus) => {
    switch (status) {
      case 'over':
        return 'status-over'
      case 'warning':
        return 'status-warning'
      default:
        return 'status-ok'
    }
  }

  // Show allocate modal for a category
  const openAllocateModal = (category: CategoryAllocation) => {
    setSelectedCategory(category)
    setAllocateAmount('')
    setBudgetMessage('')
    setShowAllocateModal(true)
  }

  // Load improvements once on mount (6-month data, not month-specific)
  onMount(() => {
    loadImprovements()
  })

  // Load data when month changes
  createEffect(() => {
    void month() // track month dependency
    loadData()
  })

  return (
    <div class={`page page-budgets page-enter ${styles.budgetsPage}`}>
      <div class={styles.pageHeader}>
        <div class={styles.headerTop}>
          <h1 data-test-id="budgets-header">Budgets</h1>
          <div data-test-id="month-selector" class={styles.monthSelector}>
            <button
              data-test-id="month-prev-btn"
              class={styles.btnGhost}
              onClick={goToPrevMonth}
              aria-label="Previous month"
            >
              <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M15 19l-7-7 7-7"
                />
              </svg>
            </button>
            <div class={styles.dropdownWrapper}>
              <button
                data-test-id="month-display"
                class={styles.monthBtn}
                onClick={() => {
                  setShowMonthPicker(!showMonthPicker())
                  setShowYearPicker(false)
                }}
              >
                {MONTHS[currentMonthNum() - 1]}
                <svg width="10" height="6" viewBox="0 0 10 6" fill="currentColor">
                  <path d="M5 6L0 0h10z" />
                </svg>
              </button>
              {showMonthPicker() && (
                <div class={styles.dropdown}>
                  {MONTHS.map((name, i) => (
                    <button
                      class={styles.dropdownItem}
                      classList={{ [styles.selected]: i + 1 === currentMonthNum() }}
                      onClick={() => {
                        setMonthNum(i + 1)
                        setShowMonthPicker(false)
                      }}
                    >
                      {name}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div class={styles.dropdownWrapper}>
              <button
                class={styles.yearBtn}
                onClick={() => {
                  setShowYearPicker(!showYearPicker())
                  setShowMonthPicker(false)
                }}
              >
                {currentYearNum()}
                <svg width="10" height="6" viewBox="0 0 10 6" fill="currentColor">
                  <path d="M5 6L0 0h10z" />
                </svg>
              </button>
              {showYearPicker() && (
                <div class={styles.dropdown}>
                  {years.map((y) => (
                    <button
                      class={styles.dropdownItem}
                      classList={{ [styles.selected]: y === currentYearNum() }}
                      onClick={() => {
                        setYearNum(y)
                        setShowYearPicker(false)
                      }}
                    >
                      {y}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button class={styles.btnGhost} onClick={goToNextMonth} aria-label="Next month">
              <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M9 5l7 7-7 7"
                />
              </svg>
            </button>
            {(showMonthPicker() || showYearPicker()) && (
              <div
                class={styles.overlay}
                onClick={() => {
                  setShowMonthPicker(false)
                  setShowYearPicker(false)
                }}
              />
            )}
          </div>
        </div>
        <p data-test-id="budgets-subtitle" class={styles.pageSubtitle}>
          Zero-based budgeting: allocate every dollar to a category
        </p>
      </div>

      {/* Budget Summary Cards */}
      <div data-test-id="budget-summary" class={styles.budgetSummary}>
        <div class={styles.summaryCard}>
          <div class={styles.summaryLabel}>Income</div>
          <div class={styles.summaryValue}>{formatCurrency(summary()?.income ?? 0)}</div>
        </div>
        <div class={styles.summaryCard}>
          <div class={styles.summaryLabel}>Allocated</div>
          <div class={styles.summaryValue}>{formatCurrency(summary()?.total_budget || 0)}</div>
        </div>
        <div class={styles.summaryCard}>
          <div class={styles.summaryLabel}>Spent</div>
          <div class={styles.summaryValue}>{formatCurrency(summary()?.total_spent || 0)}</div>
        </div>
        <div class={`${styles.summaryCard} ${styles.highlighted}`}>
          <div class={styles.summaryLabel}>Remaining</div>
          <div class={styles.summaryValue}>{formatCurrency(summary()?.remaining || 0)}</div>
        </div>
        <div class={styles.summaryCard}>
          <div class={styles.summaryLabel}>Unallocated</div>
          <div class={styles.summaryValue}>
            {formatCurrency(summary()?.zero_based_remaining || 0)}
          </div>
        </div>
      </div>

      {/* Category Allocation Chart */}
      <div class={styles.categoryChartSection}>
        <h3>Category Allocation</h3>
        <div class={styles.chartWrapper}>
          {allocations().length === 0 ? (
            <div class={styles.emptyState}>No allocations for this month</div>
          ) : (
            <Chart
              type="doughnut"
              data={{
                labels: allocations().map((a) => a.category_name),
                datasets: [
                  {
                    data: allocations().map((a) => a.allocated),
                    backgroundColor: allocations().map((a) => a.category_color || '#6b7280'),
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
                      color: chartColors().legend,
                    },
                  },
                },
              }}
              height={250}
              width="100%"
            />
          )}
        </div>
      </div>

      {/* Additional Charts Toggle */}
      <div class={styles.forecastToggleSection}>
        <button
          class={`${styles.btnOutline} ${styles.btnLarge}`}
          onClick={() => {
            setShowCharts(!showCharts())
          }}
        >
          {showCharts() ? 'Hide Charts' : 'Show Charts'}
        </button>
      </div>

      {/* Spending vs Budget Bar Chart */}
      {showCharts() && allocations().length > 0 && (
        <div class={styles.categoryChartSection}>
          <h3>Spending vs Budget</h3>
          <div class={styles.chartWrapper}>
            <Chart
              type="bar"
              data={{
                labels: allocations().map((a) => a.category_name),
                datasets: [
                  {
                    label: 'Budget',
                    data: allocations().map((a) => a.allocated),
                    backgroundColor: 'rgba(59, 130, 246, 0.6)',
                    borderColor: 'rgba(59, 130, 246, 1)',
                    borderWidth: 1,
                  },
                  {
                    label: 'Spent',
                    data: allocations().map((a) => a.spent),
                    backgroundColor: 'rgba(239, 68, 68, 0.6)',
                    borderColor: 'rgba(239, 68, 68, 1)',
                    borderWidth: 1,
                  },
                ],
              }}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                  legend: {
                    position: 'top',
                    labels: {
                      usePointStyle: true,
                      padding: 15,
                      font: { size: 12 },
                      color: chartColors().legend,
                    },
                  },
                },
                scales: {
                  x: { ticks: { color: chartColors().text }, grid: { color: chartColors().grid } },
                  y: {
                    beginAtZero: true,
                    ticks: {
                      callback: (value: any) => {
                        return new Intl.NumberFormat(undefined, {
                          style: 'currency',
                          currency: getLocalCurrency(),
                          minimumFractionDigits: 0,
                          maximumFractionDigits: 0,
                        }).format(value)
                      },
                      color: chartColors().text,
                    },
                    grid: { color: chartColors().grid },
                  },
                },
              }}
              height={300}
              width="100%"
            />
          </div>
        </div>
      )}

      {/* Historical Adherence Trend Chart */}
      {showCharts() && improvements().length > 0 && (
        <div class={styles.categoryChartSection}>
          <h3>Monthly Adherence Trend</h3>
          <div class={styles.chartWrapper}>
            <Chart
              type="line"
              data={{
                labels: [...improvements()].reverse().map((item: any) => item.month),
                datasets: [
                  {
                    label: 'Adherence %',
                    data: [...improvements()].reverse().map((item: any) => item.adherence_pct),
                    borderColor: 'rgba(59, 130, 246, 1)',
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                    fill: true,
                    tension: 0.3,
                    pointRadius: 4,
                    pointBackgroundColor: 'rgba(59, 130, 246, 1)',
                  },
                ],
              }}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                  legend: {
                    position: 'top',
                    labels: {
                      usePointStyle: true,
                      padding: 15,
                      font: { size: 12 },
                      color: chartColors().legend,
                    },
                  },
                  tooltip: {
                    callbacks: {
                      label: (ctx: any) => `${ctx.parsed.y.toFixed(1)}%`,
                    },
                  },
                },
                scales: {
                  x: { ticks: { color: chartColors().text }, grid: { color: chartColors().grid } },
                  y: {
                    beginAtZero: false,
                    min: 0,
                    max: 100,
                    ticks: {
                      callback: (value: any) => `${value}%`,
                      color: chartColors().text,
                    },
                    grid: { color: chartColors().grid },
                  },
                },
              }}
              height={250}
              width="100%"
            />
          </div>
        </div>
      )}

      {/* Forecast Toggle Button */}
      <div data-test-id="forecast-toggle-section" class={styles.forecastToggleSection}>
        <button class={`${styles.btnOutline} ${styles.btnLarge}`} onClick={toggleForecast}>
          {showForecast() ? 'Hide Budget Forecast' : 'Show Budget Forecast'}
        </button>
      </div>

      {/* Forecast Section */}
      {showForecast() && (
        <div class={styles.budgetForecast}>
          <div class={styles.forecastHeader}>
            <div class={styles.forecastTitle}>
              <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z"
                />
              </svg>
              <span>Budget Forecast</span>
            </div>
            <Button variant="ghost" size="sm" onClick={toggleForecast}>
              Hide
            </Button>
          </div>

          {forecastData() ? (
            <>
              {/* Adherence Stats */}
              <div class={styles.forecastStats}>
                <div class={styles.statItem}>
                  <div class={styles.statLabel}>Historical Adherence</div>
                  <div
                    class={styles.statValue}
                    classList={{
                      [styles.positive]: forecastData()!.avg_adherence >= 80,
                    }}
                  >
                    {forecastData()!.avg_adherence}%
                  </div>
                </div>
                <div class={styles.statItem}>
                  <div class={styles.statLabel}>Total Budget</div>
                  <div class={styles.statValue}>{formatCurrency(forecastData()!.total_budget)}</div>
                </div>
              </div>

              {/* Forecast Chart */}
              <div class={styles.forecastChart}>
                <div class={styles.chartRow}>
                  <span class={styles.chartLabel}>Month</span>
                  <span class={styles.chartLabel}>Budget</span>
                  <span class={styles.chartLabel}>Predicted</span>
                  <span class={styles.chartLabel}>Adherence</span>
                  <span class={styles.chartLabel}>Status</span>
                </div>
                <For each={forecastData()!.forecast}>
                  {(fm) => (
                    <div class={styles.chartRow} data-index={fm.month}>
                      <span class={styles.chartLabel}>{fm.label}</span>
                      <span class={`${styles.chartValue} ${styles.budgetVal}`}>
                        {formatCurrency(fm.budget_amount)}
                      </span>
                      <span class={`${styles.chartValue} ${styles.actualVal}`}>
                        {formatCurrency(fm.predicted_spent)}
                      </span>
                      <span class={styles.chartValue}>{Math.round(fm.adherence)}%</span>
                      <span
                        class={`${styles.chartStatus} ${styles[`chartStatus${fm.status.charAt(0).toUpperCase() + fm.status.slice(1)}`]}`}
                      >
                        {fm.status === 'over'
                          ? 'Over'
                          : fm.status === 'warning'
                            ? 'Warning'
                            : 'On Track'}
                      </span>
                    </div>
                  )}
                </For>
              </div>

              {/* Refresh Forecast Button */}
              <Button variant="outline" onClick={loadData}>
                Refresh Forecast
              </Button>
            </>
          ) : (
            <div class={styles.emptyState}>Loading forecast...</div>
          )}
        </div>
      )}

      {/* Error */}
      {error() && <div class={styles.toastError}>{error()}</div>}

      {/* Allocation Table */}
      <div data-test-id="budget-allocations" class={styles.budgetAllocations}>
        <div data-test-id="table-header" class={styles.tableHeader}>
          <h2>Category Allocations</h2>
          <div class={styles.actions}>
            <button class={styles.btnOutline} onClick={duplicateLastMonth}>
              <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2"
                />
              </svg>
              Duplicate Last Month
            </button>
            <button class={styles.btnOutline} onClick={setFromExpenses}>
              <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"
                />
              </svg>
              From Expenses
            </button>
            <button
              class={styles.btnPrimary}
              onClick={() => {
                const firstUnallocated = allocations().find((a) => !a.is_budgeted && a.can_allocate)
                if (firstUnallocated) {
                  openAllocateModal(firstUnallocated)
                }
              }}
              disabled={!summary()?.can_allocate}
            >
              <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M12 6v6m0 0v6m0-6h6m-6 0H6"
                />
              </svg>
              Add Allocation
            </button>
          </div>
        </div>

        {loading() ? (
          <div data-test-id="loading-state" class={styles.emptyState}>
            Loading budgets...
          </div>
        ) : allocations().length === 0 ? (
          <div class={styles.emptyState}>
            <p>No allocations for this month yet.</p>
            <p>Start by allocating income to expense categories.</p>
            <button
              class={styles.btnPrimary}
              onClick={() => {
                const firstUnallocated = allocations().find((a) => !a.is_budgeted && a.can_allocate)
                if (firstUnallocated) {
                  openAllocateModal(firstUnallocated)
                }
              }}
            >
              Create First Allocation
            </button>
          </div>
        ) : (
          <div class={styles.tableContainer}>
            <table data-test-id="data-table" class={styles.dataTable}>
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Amount</th>
                  <th>Spent</th>
                  <th>Remaining</th>
                  <th>% Used</th>
                  <th>Status</th>
                  <th>Rollover</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                <For each={allocations()}>
                  {(item) => (
                    <tr class={styles[getStatusClass(item.status)]}>
                      <td>
                        <div class={styles.categoryCell}>
                          <div
                            class={styles.categoryIcon}
                            style={`--bg-color: ${item.category_color}`}
                          >
                            {getCategorySvg(item.category_name)}
                          </div>
                          <span class={styles.categoryName}>{item.category_name}</span>
                        </div>
                      </td>
                      <td class={styles.amountCol}>{formatCurrency(item.allocated)}</td>
                      <td class={styles.amountCol}>{formatCurrency(item.spent)}</td>
                      <td class={`${styles.amountCol} ${styles.statusOk}`}>
                        {formatCurrency(item.remaining_budget)}
                      </td>
                      <td class={styles.percentCol}>
                        <div class={styles.progressBar}>
                          <div
                            class={styles.progressFill}
                            style={`width: ${item.percent_used}%; --color: ${item.category_color}`}
                          />
                        </div>
                        <span class={styles.percentValue}>{Math.round(item.percent_used)}%</span>
                      </td>
                      <td class={styles.statusCol}>
                        <div style={{ display: 'flex', gap: '6px', 'flex-wrap': 'wrap' }}>
                          {item.status === 'over' && <Badge status="over">Over Budget</Badge>}
                          {item.status === 'warning' && <Badge status="warning">Near Limit</Badge>}
                          {item.status === 'ok' && <Badge status="ok">On Track</Badge>}
                          {item.is_fully_allocated && <Badge status="ok">Fully Allocated</Badge>}
                        </div>
                      </td>
                      <td class={styles.actionsCol}>
                        {item.budget_id ? (
                          <button
                            class={item.rollover_enabled ? styles.rolloverOn : styles.rolloverOff}
                            onClick={() => {
                              toggleRollover(item.budget_id!, !item.rollover_enabled)
                            }}
                            title={item.rollover_enabled ? 'Disable rollover' : 'Enable rollover'}
                          >
                            {item.rollover_enabled ? 'ON' : 'OFF'}
                          </button>
                        ) : (
                          <span class={styles.budgetMessage}>--</span>
                        )}
                      </td>
                      <td class={styles.actionsCol}>
                        {item.can_allocate && !item.is_budgeted ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              openAllocateModal(item)
                            }}
                          >
                            Allocate
                          </Button>
                        ) : (
                          <span class={styles.budgetMessage}>{budgetMessage()}</span>
                        )}
                      </td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Allocate Modal */}
      {showAllocateModal() && selectedCategory() && (
        <div
          class={styles.modalOverlay}
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowAllocateModal(false)
          }}
        >
          <div
            class={`${styles.modal} ${styles.modalSmall}`}
            onClick={(e) => {
              e.stopPropagation()
            }}
          >
            <div class={styles.modalHeader}>
              <h3>Allocate Budget</h3>
              <button
                class={styles.modalClose}
                onClick={() => setShowAllocateModal(false)}
                aria-label="Close modal"
              >
                <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>
            <div class={styles.modalBody}>
              <p class={styles.modalText}>
                Allocate budget to <strong>{selectedCategory()!.category_name}</strong>
              </p>
              <label class={styles.formLabel}>Amount</label>
              <input
                type="number"
                class={styles.formInput}
                step="0.01"
                min="0.01"
                value={allocateAmount()}
                oninput={(e) => setAllocateAmount(e.target.value)}
                placeholder="0.00"
                autocapitalize="off"
              />
              <p class={styles.helpText}>
                Available unallocated: {formatCurrency(summary()?.unassigned_budget || 0)}
              </p>
            </div>
            <div class={styles.modalFooter}>
              <button class={styles.btnGhost} onClick={() => setShowAllocateModal(false)}>
                Cancel
              </button>
              <button
                class={styles.btnPrimary}
                onClick={allocateBudget}
                disabled={parseFloat(allocateAmount()) <= 0 || !allocateAmount()}
              >
                Allocate
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
