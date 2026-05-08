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

function getCategoryIcon(categoryName: string): JSX.Element {
  const name = categoryName.toLowerCase()
  const iconProps = {
    width: '16',
    height: '16',
    fill: 'none',
    stroke: '#fff',
    'stroke-width': '2',
    'stroke-linecap': 'round' as const,
    'stroke-linejoin': 'round' as const,
  }

  // Transport / Car
  if (/car|auto|vehicle|transport|gas|fuel|parking|uber|lyft|toll/i.test(name))
    return (
      <svg {...iconProps} viewBox="0 0 24 24">
        <path d="M5 17h14v-5H5v5zm11.5-5L18 8H6l1.5 4M7 17a1 1 0 100 2 1 1 0 000-2zm10 0a1 1 0 100 2 1 1 0 000-2zM9 4h6" />
      </svg>
    )

  // Food / Dining / Groceries
  if (/food|dining|grocer|restaurant|eat|meal|lunch|dinner|breakfast|cafe|coffee/i.test(name))
    return (
      <svg {...iconProps} viewBox="0 0 24 24">
        <path d="M18 8h1a4 4 0 010 8h-1M2 8h16v9a4 4 0 01-4 4H6a4 4 0 01-4-4V8zm4-4v4m4-4v4m4-4v4" />
      </svg>
    )

  // Housing / Rent / Mortgage
  if (/hous|rent|mortgage|home|lease|property|real\s*estate/i.test(name))
    return (
      <svg {...iconProps} viewBox="0 0 24 24">
        <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
        <path d="M9 22V12h6v10" />
      </svg>
    )

  // Utilities
  if (/utilit|electric|water|gas\s*bill|sewer|trash|garbage|recycling|power|energy/i.test(name))
    return (
      <svg {...iconProps} viewBox="0 0 24 24">
        <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
      </svg>
    )

  // Entertainment / Fun
  if (/entertain|fun|game|movie|cinema|theatre|theater|concert|music|stream|netflix|spotify|hulu|disney|hbo/i.test(name))
    return (
      <svg {...iconProps} viewBox="0 0 24 24">
        <rect x="2" y="3" width="20" height="14" rx="2" />
        <path d="M8 21h8m-4-4v4" />
      </svg>
    )

  // Shopping / Retail
  if (/shop|retail|cloth|apparel|mall|amazon|walmart|target|costco/i.test(name))
    return (
      <svg {...iconProps} viewBox="0 0 24 24">
        <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4zM3 6h18" />
        <path d="M16 10a4 4 0 01-8 0" />
      </svg>
    )

  // Health / Medical
  if (/health|medical|doctor|dentist|pharma|hospital|clinic|therapy|vet|vision|eye|glasses/i.test(name))
    return (
      <svg {...iconProps} viewBox="0 0 24 24">
        <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" />
      </svg>
    )

  // Education
  if (/edu|school|college|university|tuition|book|course|class|learn|study|student/i.test(name))
    return (
      <svg {...iconProps} viewBox="0 0 24 24">
        <path d="M4 19.5A2.5 2.5 0 016.5 17H20" />
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" />
      </svg>
    )

  // Travel
  if (/travel|flight|airfare|airline|hotel|airbnb|vacation|trip|holiday/i.test(name))
    return (
      <svg {...iconProps} viewBox="0 0 24 24">
        <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.362 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.338 1.85.573 2.81.7A2 2 0 0122 16.92z" />
      </svg>
    )

  // Insurance
  if (/insur/i.test(name))
    return (
      <svg {...iconProps} viewBox="0 0 24 24">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      </svg>
    )

  // Savings / Investment
  if (/sav|invest|retire|ira|401|stock|broker|dividend|interest/i.test(name))
    return (
      <svg {...iconProps} viewBox="0 0 24 24">
        <path d="M13 11l4-4m-4 4l2 4-5 1-2-4 1-5z" />
        <circle cx="12" cy="12" r="3" />
        <circle cx="19" cy="5" r="2" />
        <circle cx="5" cy="19" r="2" />
      </svg>
    )

  // Phone / Internet / Communication
  if (/phone|mobile|cell|internet|wifi|broadband|telecom|data\s*plan/i.test(name))
    return (
      <svg {...iconProps} viewBox="0 0 24 24">
        <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.362 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.338 1.85.573 2.81.7A2 2 0 0122 16.92z" />
      </svg>
    )

  // Gifts / Donations
  if (/gift|donat|charit|present/i.test(name))
    return (
      <svg {...iconProps} viewBox="0 0 24 24">
        <path d="M20 12v8H4v-8M22 8H2v4h20V8zM12 8v12M12 8c0-3-2-5-4-5S4 5 4 8m8 0c0-3 2-5 4-5s4 2 4 5" />
      </svg>
    )

  // Pets
  if (/pet|dog|cat|animal|vet/i.test(name))
    return (
      <svg {...iconProps} viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.07 4.93a10 10 0 010 14.14M4.93 4.93a10 10 0 000 14.14" />
        <circle cx="7" cy="8" r="1.5" />
        <circle cx="17" cy="8" r="1.5" />
        <circle cx="7" cy="16" r="1.5" />
        <circle cx="17" cy="16" r="1.5" />
      </svg>
    )

  // Fitness / Sports
  if (/fit|gym|sport|exercise|workout|yoga|bike|cycling|run/i.test(name))
    return (
      <svg {...iconProps} viewBox="0 0 24 24">
        <path d="M18 20V10M12 20V4M6 20v-6" />
      </svg>
    )

  // Subscriptions
  if (/subscri|member|recur/i.test(name))
    return (
      <svg {...iconProps} viewBox="0 0 24 24">
        <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
      </svg>
    )

  // Kids / Children
  if (/child|kid|baby|daycare|nanny|babysit|school\s*supp/i.test(name))
    return (
      <svg {...iconProps} viewBox="0 0 24 24">
        <circle cx="12" cy="8" r="4" />
        <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
      </svg>
    )

  // Beauty / Personal Care
  if (/beaut|spa|salon|hair|nail|cosmet|skin|makeup|barber/i.test(name))
    return (
      <svg {...iconProps} viewBox="0 0 24 24">
        <circle cx="12" cy="8" r="4" />
        <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7M12 12v4" />
      </svg>
    )

  // Business / Work
  if (/business|work|office|supplies|desk/i.test(name))
    return (
      <svg {...iconProps} viewBox="0 0 24 24">
        <rect x="2" y="7" width="20" height="14" rx="2" />
        <path d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2M12 12v.01" />
      </svg>
    )

  // Taxes
  if (/tax|irs|government/i.test(name))
    return (
      <svg {...iconProps} viewBox="0 0 24 24">
        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
        <path d="M14 2v6h6M16 13H8m8 4H8m0-8h4" />
      </svg>
    )

  // Credit Card / Loans / Debt
  if (/credit|debt|loan|card|payment|interest/i.test(name))
    return (
      <svg {...iconProps} viewBox="0 0 24 24">
        <rect x="1" y="4" width="22" height="16" rx="2" />
        <path d="M1 10h22" />
      </svg>
    )

  // Income / Salary / Wages
  if (/income|salary|wage|paycheck|payroll|earn|revenue/i.test(name))
    return (
      <svg {...iconProps} viewBox="0 0 24 24">
        <path d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />
      </svg>
    )

  // Miscellaneous / Other / General / Uncategorized
  if (/misc|other|general|uncategor|unknown|various|catch.?all/i.test(name))
    return (
      <svg {...iconProps} viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
      </svg>
    )

  // Fallback: generic tag/price-tag icon
  return (
    <svg {...iconProps} viewBox="0 0 24 24">
      <path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z" />
      <path d="M7 7h.01" />
    </svg>
  )
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
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
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
            (item.percent_used >= 100 ? 'over' : item.percent_used >= 90 ? 'warning' : 'ok'),
          is_fully_allocated:
            item.is_fully_allocated ?? (item.is_budgeted && item.amount > 0),
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
              onclick={goToPrevMonth}
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
                onclick={() => { setShowMonthPicker(!showMonthPicker()); setShowYearPicker(false) }}
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
                      onclick={() => {
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
                onclick={() => { setShowYearPicker(!showYearPicker()); setShowMonthPicker(false) }}
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
                      onclick={() => {
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
            <button
              class={styles.btnGhost}
              onclick={goToNextMonth}
              aria-label="Next month"
            >
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
                onclick={() => { setShowMonthPicker(false); setShowYearPicker(false) }}
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
                    data: allocations().map((a) => a.amount),
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
          onclick={() => {
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
                    data: allocations().map((a) => a.amount),
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
        <button class={`${styles.btnOutline} ${styles.btnLarge}`} onclick={toggleForecast}>
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
            <Button variant="ghost" size="sm" onclick={toggleForecast}>
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
              <Button variant="outline" onclick={loadData}>
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
            <button class={styles.btnOutline} onclick={duplicateLastMonth}>
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
            <button class={styles.btnOutline} onclick={setFromExpenses}>
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
              onclick={() => {
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
              onclick={() => {
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
                            {getCategoryIcon(item.category_name)}
                          </div>
                          <span class={styles.categoryName}>{item.category_name}</span>
                        </div>
                      </td>
                      <td class={styles.amountCol}>{formatCurrency(item.amount)}</td>
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
                        {item.status === 'over' && <Badge status="over">Over Budget</Badge>}
                        {item.status === 'warning' && <Badge status="warning">Near Limit</Badge>}
                        {item.status === 'ok' && <Badge status="ok">On Track</Badge>}
                        {item.is_fully_allocated && <Badge status="ok">Fully Allocated</Badge>}
                      </td>
                      <td class={styles.actionsCol}>
                        {item.budget_id ? (
                          <button
                            class={item.rollover_enabled ? styles.rolloverOn : styles.rolloverOff}
                            onclick={() => {
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
                            onclick={() => {
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
          onclick={(e) => {
            if (e.target === e.currentTarget) setShowAllocateModal(false)
          }}
        >
          <div
            class={`${styles.modal} ${styles.modalSmall}`}
            onclick={(e) => {
              e.stopPropagation()
            }}
          >
            <div class={styles.modalHeader}>
              <h3>Allocate Budget</h3>
              <button
                class={styles.modalClose}
                onclick={() => setShowAllocateModal(false)}
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
              <button class={styles.btnGhost} onclick={() => setShowAllocateModal(false)}>
                Cancel
              </button>
              <button
                class={styles.btnPrimary}
                onclick={allocateBudget}
                disabled={parseFloat(allocateAmount()) <= 0 || !allocateAmount()}
              >
                Allocate
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Traditional View (placeholder) */}
      <div class={styles.budgetTraditional}>
        <div class={styles.emptyState}>
          <p>Traditional view coming soon</p>
          <p>View budget vs actual reports and past budgets.</p>
        </div>
      </div>
    </div>
  )
}
