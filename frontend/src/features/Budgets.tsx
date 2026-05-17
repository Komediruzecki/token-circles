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
import Button from '../components/Button'
import CategoryIcon, { getCategorySvg } from '../components/CategoryIcon'
import Chart from '../components/Chart'
import ConfirmButton from '../components/ConfirmButton'
import { api, getLocalCurrency } from '../core/api'
import { apiDelete, apiGet, apiPost, apiPut, showToast } from '../core/api'
import { useAppState } from '../core/appStore'
import { theme } from '../core/theme'
import styles from './BudgetsPage.module.css'
import type { BudgetImprovement, BudgetSummaryResponse, ZeroBasedAllocation, ZeroBasedResponse } from '../types/models'

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

interface Category {
  id: number
  name: string
  type: 'expense' | 'income'
  color: string
  icon: string | null
  profile_id: number
  budget?: number
}

export default function Budgets() {
  const state = useAppState()
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

  const [improvements, setImprovements] = createSignal<BudgetImprovement[]>([])
  const [showMonthPicker, setShowMonthPicker] = createSignal(false)
  const [showYearPicker, setShowYearPicker] = createSignal(false)

  // Categories state
  const [categories, setCategories] = createSignal<Category[]>([])
  const [showCatModal, setShowCatModal] = createSignal(false)
  const [showCatBudgetModal, setShowCatBudgetModal] = createSignal(false)
  const [editingCategory, setEditingCategory] = createSignal<Category | null>(null)
  const [selectedCat, setSelectedCat] = createSignal<Category | null>(null)
  const [catBudgetAmount, setCatBudgetAmount] = createSignal('')
  const [filterType, setFilterType] = createSignal<'all' | 'expense' | 'income'>('all')
  const [categoryBudgetSummary, setCategoryBudgetSummary] = createSignal<
    Record<number, { spent: number; budget: number; remaining: number; percent_used: number }>
  >({})
  const [catFormData, setCatFormData] = createSignal({
    name: '',
    type: 'expense' as 'expense' | 'income',
    color: '#3b82f6',
    icon: '',
  })

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
  const [availableYears, setAvailableYears] = createSignal<number[]>([
    currentYear - 1,
    currentYear,
    currentYear + 1,
  ])

  const loadYearRange = async () => {
    try {
      const { years } = await api.getTransactionYears()
      if (years.length > 0) setAvailableYears([...years].sort((a, b) => b - a))
    } catch { /* keep defaults */ }
  }

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
        apiGet<ZeroBasedResponse>(`/api/budgets/zero-based?month=${month()}`),
        apiGet<ZeroBasedResponse>(`/api/budgets/zero-based/summary?month=${month()}`),
        apiGet<ForecastData>(`/api/budgets/forecast?month=${month()}`).catch(() => null),
      ])

      const allocationsList = (allocationsRes?.allocations || allocationsRes?.categories || []).map(
        (item: ZeroBasedAllocation) => ({
          ...item,
          amount: item.amount || item.allocated || 0,
          allocated: item.amount || item.allocated || 0,
          status:
            item.status ||
            (item.percent_used > 100 ? 'over' : item.percent_used >= 90 ? 'warning' : 'ok'),
          is_fully_allocated: item.is_fully_allocated ?? ((item.is_budgeted as boolean) && item.amount > 0),
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

  // Load historical improvements data for trend chart
  const loadImprovements = async () => {
    try {
      const data = await apiGet<BudgetImprovement[]>(`/api/budgets/improvements?months=6`)
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

  // Load categories
  const loadCategories = async () => {
    try {
      const [allRes, budgetRes] = await Promise.all([
        apiGet<Category[]>('/api/categories'),
        apiGet<BudgetSummaryResponse[]>(
          `/api/budgets/summary?year=${currentYearNum()}&month=${currentMonthNum()}`
        ).catch((): BudgetSummaryResponse[] => []),
      ])
      setCategories(allRes)
      const summary: Record<
        number,
        { spent: number; budget: number; remaining: number; percent_used: number }
      > = {}
      if (Array.isArray(budgetRes)) {
        for (const b of budgetRes) {
          summary[b.category_id] = {
            spent: b.spent || 0,
            budget: b.amount || 0,
            remaining: b.remaining || 0,
            percent_used: b.percentage || 0,
          }
        }
      }
      setCategoryBudgetSummary(summary)
    } catch (err) {
      console.error('Failed to load categories:', err)
    }
  }

  // Handle category form submit
  const handleCatSubmit = async (e: Event) => {
    e.preventDefault()
    const data = {
      name: catFormData().name,
      type: catFormData().type,
      color: catFormData().color,
      icon: catFormData().icon || null,
    }

    try {
      if (editingCategory()) {
        await apiPut(`/api/categories/${editingCategory()!.id}`, data)
        showToast('Category updated successfully', 'success')
      } else {
        await apiPost('/api/categories', data)
        showToast('Category created successfully', 'success')
      }
      setShowCatModal(false)
      setEditingCategory(null)
      setCatFormData({ name: '', type: 'expense', color: '#3b82f6', icon: '' })
      loadCategories()
    } catch (err) {
      console.error('Failed to save category:', err)
      showToast('Failed to save category', 'error')
    }
  }

  // Delete category
  const deleteCategory = async (id: number) => {
    try {
      await apiDelete(`/api/categories/${id}`)
      showToast('Category deleted successfully', 'success')
      loadCategories()
    } catch (err) {
      console.error('Failed to delete category:', err)
      showToast('Failed to delete category', 'error')
    }
  }

  // Update category color
  const updateCategoryColor = async (id: number, color: string) => {
    try {
      await apiPut(`/api/categories/${id}`, { color })
      loadCategories()
    } catch (err) {
      console.error('Failed to update color:', err)
      showToast('Failed to update color', 'error')
    }
  }

  // Edit category
  const editCategory = (category: Category) => {
    setEditingCategory(category)
    setCatFormData({
      name: category.name,
      type: category.type,
      color: category.color,
      icon: category.icon || '',
    })
    setShowCatModal(true)
  }

  // Open budget modal for a category
  const openCatBudgetModal = (category: Category) => {
    setSelectedCat(category)
    setCatBudgetAmount('')
    setShowCatBudgetModal(true)
  }

  // Update budget for a category
  const updateCatBudget = async (amount: number) => {
    if (!selectedCat()) return
    try {
      const now = new Date()
      const startDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
      await apiPost('/api/budgets', {
        category_id: selectedCat()!.id,
        amount,
        period: 'monthly',
        start_date: startDate,
      })
      showToast('Budget set successfully', 'success')
      setShowCatBudgetModal(false)
      setSelectedCat(null)
      loadCategories()
    } catch (err) {
      console.error('Failed to set budget', err)
      showToast('Failed to set budget', 'error')
    }
  }

  // Load improvements and categories once on mount
  onMount(() => {
    loadImprovements()
    loadCategories()
    loadYearRange()
  })

  // Reload when profile selection changes
  createEffect(() => {
    void state.profileVersion
    loadImprovements()
    loadCategories()
    loadData()
    loadYearRange()
  })

  // Load data when month changes
  createEffect(() => {
    void month() // track month dependency
    loadData()
    loadCategories()
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
                  {availableYears().map((y) => (
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

      {/* Spending vs Budget Bar Chart */}
      {allocations().length > 0 && (
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
      {improvements().length > 0 && (
        <div class={styles.categoryChartSection}>
          <h3>Monthly Adherence Trend</h3>
          <div class={styles.chartWrapper}>
            <Chart
              type="line"
              data={{
                labels: [...improvements()].reverse().map((item) => item.month),
                datasets: [
                  {
                    label: 'Adherence %',
                    data: [...improvements()].reverse().map((item) => item.adherence_pct),
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

      {/* Forecast Section */}
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

      {/* Categories Section */}
      <div class={styles.categoriesSection}>
        <div class={styles.categoriesHeader}>
          <h2>Categories</h2>
          <button
            class={styles.btnPrimary}
            onClick={() => {
              setEditingCategory(null)
              setCatFormData({ name: '', type: 'expense', color: '#3b82f6', icon: '' })
              setShowCatModal(true)
            }}
          >
            <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
            Add Category
          </button>
        </div>

        <div class={styles.categoriesFilter}>
          <button
            class={`${styles.filterTab} ${filterType() === 'all' ? styles.filterTabActive : ''}`}
            onClick={() => setFilterType('all')}
          >
            All Categories
          </button>
          <button
            class={`${styles.filterTab} ${filterType() === 'expense' ? styles.filterTabActive : ''}`}
            onClick={() => setFilterType('expense')}
          >
            Expenses
          </button>
          <button
            class={`${styles.filterTab} ${filterType() === 'income' ? styles.filterTabActive : ''}`}
            onClick={() => setFilterType('income')}
          >
            Income
          </button>
        </div>

        {categories().length === 0 ? (
          <div class={styles.emptyState}>
            <p>No categories yet</p>
            <p>Create your first category to start organizing your transactions.</p>
          </div>
        ) : (
          <div class={styles.categoriesGridScroll}>
            <div class={styles.categoriesGrid}>
              <For
                each={categories().filter((c) =>
                  filterType() === 'all' ? true : c.type === filterType()
                )}
              >
                {(category) => {
                  const summary = categoryBudgetSummary()[category.id]
                  const spent = summary?.spent || 0
                  const budget = summary?.budget || 0
                  const remaining = summary?.remaining ?? budget - spent
                  const percentUsed = summary?.percent_used || 0
                  const isOverBudget = percentUsed > 100

                  return (
                    <div class={styles.categoryCard} style={`--cat-color: ${category.color}`}>
                      <div class={styles.catCardHeader}>
                        <div
                          class={styles.catCardIcon}
                          style={`background: ${category.color}20; color: ${category.color}`}
                        >
                          <CategoryIcon name={category.name} icon={category.icon} size={18} />
                        </div>
                        <div class={styles.catCardInfo}>
                          <h3 class={styles.catCardName}>{category.name}</h3>
                          <span class={styles.catCardType}>{category.type}</span>
                        </div>
                        <div class={styles.catCardActions}>
                          <button
                            class={styles.catActionBtn}
                            onClick={() => {
                              openCatBudgetModal(category)
                            }}
                            title="Set Budget"
                          >
                            <svg
                              width="16"
                              height="16"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                          </button>
                          <button
                            class={styles.catActionBtn}
                            onClick={() => {
                              editCategory(category)
                            }}
                            title="Edit"
                          >
                            <svg
                              width="16"
                              height="16"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                          </button>
                          <ConfirmButton
                            class={styles.catActionBtn}
                            onConfirm={() => deleteCategory(category.id)}
                            label={
                              <svg
                                width="16"
                                height="16"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            }
                          />
                        </div>
                      </div>
                      <div class={styles.catCardSpending}>
                        <div class={styles.catSpendingHeader}>
                          <span class={styles.catSpendingLabel}>Spent</span>
                          <span
                            class={`${styles.catSpendingAmount} ${isOverBudget ? styles.catOver : ''}`}
                          >
                            {formatCurrency(spent)}
                          </span>
                        </div>
                        {category.type === 'expense' && budget > 0 && (
                          <>
                            <div class={styles.catProgressBar}>
                              <div
                                class={`${styles.catProgressFill} ${isOverBudget ? styles.catOver : ''}`}
                                style={{ width: `${Math.min(100, percentUsed)}%` }}
                              />
                            </div>
                            <div class={styles.catSpendingFooter}>
                              <span class={styles.catBudgetLimit}>
                                {formatCurrency(budget)} limit
                              </span>
                              <span
                                class={`${styles.catRemaining} ${isOverBudget ? styles.catOver : ''}`}
                              >
                                {formatCurrency(remaining)} remaining
                              </span>
                            </div>
                          </>
                        )}
                      </div>
                      <div class={styles.catColorPicker}>
                        <span class={styles.catColorLabel}>Color:</span>
                        <div class={styles.catColorDots}>
                          {[
                            '#ef4444',
                            '#f97316',
                            '#eab308',
                            '#22c55e',
                            '#3b82f6',
                            '#8b5cf6',
                            '#ec4899',
                            '#6b7280',
                          ].map((color) => (
                            <button
                              class={`${styles.catColorDot} ${category.color === color ? styles.catColorDotActive : ''}`}
                              style={{ background: color }}
                              onClick={() => updateCategoryColor(category.id, color)}
                              title={color}
                            >
                              {category.color === color && (
                                <svg
                                  width="12"
                                  height="12"
                                  fill="none"
                                  stroke="white"
                                  stroke-width="3"
                                  viewBox="0 0 24 24"
                                >
                                  <path d="M20 6L9 17l-5-5" />
                                </svg>
                              )}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  )
                }}
              </For>
            </div>
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

      {/* Add/Edit Category Modal */}
      {showCatModal() && (
        <div
          class={styles.modalOverlay}
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowCatModal(false)
              setEditingCategory(null)
              setCatFormData({ name: '', type: 'expense', color: '#3b82f6', icon: '' })
            }
          }}
        >
          <div
            class={styles.modal}
            onClick={(e) => {
              e.stopPropagation()
            }}
          >
            <div class={styles.modalHeader}>
              <h3>{editingCategory() ? 'Edit Category' : 'Add Category'}</h3>
              <button
                class={styles.modalClose}
                onClick={() => {
                  setShowCatModal(false)
                  setEditingCategory(null)
                  setCatFormData({ name: '', type: 'expense', color: '#3b82f6', icon: '' })
                }}
              >
                <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <form class={styles.modalBody} onSubmit={handleCatSubmit}>
              <div class={styles.catFormGroup}>
                <label class={styles.formLabel}>Category Name</label>
                <input
                  type="text"
                  class={styles.formInput}
                  placeholder="e.g., Food, Rent"
                  value={catFormData().name}
                  oninput={(e) => setCatFormData({ ...catFormData(), name: e.target.value })}
                  required
                />
              </div>
              <div class={styles.catFormGroup}>
                <label class={styles.formLabel}>Category Type</label>
                <select
                  class={styles.formInput}
                  value={catFormData().type}
                  oninput={(e) => setCatFormData({ ...catFormData(), type: e.target.value as any })}
                >
                  <option value="expense">Expense</option>
                  <option value="income">Income</option>
                </select>
              </div>
              <div class={styles.catFormGroup}>
                <label class={styles.formLabel}>Icon (emoji)</label>
                <input
                  type="text"
                  class={styles.formInput}
                  placeholder="e.g., food, home, car"
                  value={catFormData().icon}
                  oninput={(e) => setCatFormData({ ...catFormData(), icon: e.target.value })}
                  maxlength="2"
                />
              </div>
              <div class={styles.catFormGroup}>
                <label class={styles.formLabel}>Color</label>
                <div class={styles.catColorDots}>
                  {[
                    '#ef4444',
                    '#f97316',
                    '#eab308',
                    '#22c55e',
                    '#3b82f6',
                    '#8b5cf6',
                    '#ec4899',
                    '#6b7280',
                  ].map((color) => (
                    <button
                      class={`${styles.catColorDot} ${styles.catColorDotLarge} ${catFormData().color === color ? styles.catColorDotActive : ''}`}
                      style={{ background: color }}
                      onClick={() => setCatFormData({ ...catFormData(), color })}
                      title={color}
                    >
                      {catFormData().color === color && (
                        <svg
                          width="14"
                          height="14"
                          fill="none"
                          stroke="white"
                          stroke-width="3"
                          viewBox="0 0 24 24"
                        >
                          <path d="M20 6L9 17l-5-5" />
                        </svg>
                      )}
                    </button>
                  ))}
                </div>
              </div>
              <div class={styles.modalFooter}>
                <button
                  type="button"
                  class={styles.btnGhost}
                  onClick={() => {
                    setShowCatModal(false)
                    setEditingCategory(null)
                    setCatFormData({ name: '', type: 'expense', color: '#3b82f6', icon: '' })
                  }}
                >
                  Cancel
                </button>
                <button type="submit" class={styles.btnPrimary}>
                  {editingCategory() ? 'Update' : 'Add'} Category
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Category Budget Modal */}
      {showCatBudgetModal() && selectedCat() && (
        <div
          class={styles.modalOverlay}
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowCatBudgetModal(false)
          }}
        >
          <div
            class={styles.modal}
            onClick={(e) => {
              e.stopPropagation()
            }}
          >
            <div class={styles.modalHeader}>
              <h3>Set Budget</h3>
              <button class={styles.modalClose} onClick={() => setShowCatBudgetModal(false)}>
                <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div class={styles.modalBody}>
              <p class={styles.modalText}>
                Set a monthly budget for <strong>{selectedCat()!.name}</strong>
              </p>
              <div class={styles.catFormGroup}>
                <label class={styles.formLabel}>Monthly Budget Amount</label>
                <input
                  type="number"
                  step="0.01"
                  class={styles.formInput}
                  placeholder="500.00"
                  value={catBudgetAmount()}
                  oninput={(e) => setCatBudgetAmount((e.target as HTMLInputElement).value)}
                />
              </div>
            </div>
            <div class={styles.modalFooter}>
              <button class={styles.btnGhost} onClick={() => setShowCatBudgetModal(false)}>
                Cancel
              </button>
              <button
                class={styles.btnPrimary}
                onClick={() => {
                  updateCatBudget(parseFloat(catBudgetAmount()) || 0)
                }}
              >
                Save Budget
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
