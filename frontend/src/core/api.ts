/**
 * API Client - Type-safe HTTP client for backend API
 */

import { apiFetch } from './apiFetch'
import { logger } from './logger.js'
import type * as ApiTypes from '../types/api.js'
import type * as Models from '../types/models.js'

// API base URL
const API_BASE = '/api'

// Local storage keys
const CURRENT_PROFILE_ID_KEY = 'currentProfileId'
const SELECTED_PROFILE_IDS_KEY = 'selectedProfileIds'

/**
 * API Client class for making authenticated requests
 */
export class ApiClient {
  private headers: Record<string, string> = {}

  constructor() {
    this.updateHeaders()
    // Watch for changes to localStorage
    window.addEventListener('storage', () => {
      this.updateHeaders()
    })
  }

  private updateHeaders() {
    const currentProfileId = this.getCurrentProfileId()
    const selectedProfileIds = this.getSelectedProfileIds()

    this.headers = {
      'Content-Type': 'application/json',
      'X-Profile-Id': currentProfileId.toString(),
    }

    if (selectedProfileIds.length > 1) {
      this.headers['X-Profile-Ids'] = JSON.stringify(selectedProfileIds)
    }
  }

  private getCurrentProfileId(): number {
    const stored = localStorage.getItem(CURRENT_PROFILE_ID_KEY)
    if (stored !== null) {
      const parsed = parseInt(stored, 10)
      if (!isNaN(parsed)) {
        return parsed
      }
    }
    return 1
  }

  private getSelectedProfileIds(): number[] {
    const ids = localStorage.getItem(SELECTED_PROFILE_IDS_KEY)
    if (ids !== null) {
      try {
        const parsed = JSON.parse(ids)
        if (Array.isArray(parsed)) {
          return parsed
        }
      } catch {
        // ignore parse error
      }
    }
    return [this.getCurrentProfileId()]
  }

  /**
   * Make an HTTP request to the API
   */
  private async request<T>(endpoint: string, options: ApiTypes.ApiClientOptions = {}): Promise<T> {
    const url = API_BASE + endpoint
    const method = options.method || 'GET'

    // Update headers before request
    this.updateHeaders()

    // Handle body - serialize JsonObject to string
    let body: string | undefined
    if (options.body) {
      body = JSON.stringify(options.body)
    }

    // Prepare request options with explicit body type
    const requestOptions: RequestInit = {
      method,
      headers: this.headers,
      credentials: 'include',
    }

    // Attach body if exists
    if (body !== undefined) {
      requestOptions.body = body
    }

    // For DELETE without body, don't set Content-Type
    if (method === 'DELETE' && body === undefined) {
      delete (requestOptions.headers as Record<string, string>)['Content-Type']
    }

    try {
      const response = await apiFetch(url, requestOptions)

      if (!response.ok) {
        if (response.status === 401 && method !== 'GET') {
          window.dispatchEvent(new Event('auth:required'))
        }
        const errorData = await response.json().catch(() => ({
          error: `HTTP ${response.status}`,
        }))
        const errorMsg = (errorData.error || errorData.message) ?? `HTTP ${response.status}`

        // Auth check 401s are expected when not logged in — don't log as errors
        const isAuthEndpoint = endpoint === '/auth/check' || endpoint === '/auth/me'
        if (!isAuthEndpoint || response.status !== 401) {
          // Debug: trace POST /transactions failures
          if (endpoint === '/transactions' && method === 'POST') {
            console.error(
              '[apiClient] POST /transactions failed',
              { status: response.status, errorMsg, body: options.body },
              'Stack:',
              new Error().stack
            )
          }
          logger.error(
            'API Error',
            { status: response.status, endpoint, message: errorMsg },
            'ApiClient'
          )
        }
        throw new Error(errorMsg)
      }

      const contentType = response.headers.get('content-type')
      if (contentType === null || !contentType.includes('application/json')) {
        return {} as T
      }

      return await response.json()
    } catch (error) {
      // Don't re-log errors from auth endpoints — already handled above or expected
      const isAuthEndpoint = endpoint === '/auth/check' || endpoint === '/auth/me'
      if (!isAuthEndpoint) {
        const message = error instanceof Error ? error.message : 'Network error'
        logger.error('API Request Failed', { endpoint, method, message }, 'ApiClient')
      }
      throw error instanceof Error ? error : new Error('Network error')
    }
  }

  // ============ AUTH ============

  /**
   * Login with username and password
   */
  login(username: string, password: string): Promise<void> {
    return this.request<void>('/auth/login', {
      method: 'POST',
      body: { username, password },
    })
  }

  /**
   * Check if user is logged in
   */
  async checkLogin(): Promise<boolean> {
    try {
      await this.request('/auth/check')
      return true
    } catch {
      return false
    }
  }

  /**
   * Logout
   */
  async logout(): Promise<void> {
    await this.request('/auth/logout', { method: 'POST' })
  }

  // ============ PROFILES ============

  /**
   * Get all profiles
   */
  async getProfiles(): Promise<Models.Profile[]> {
    return this.request<Models.Profile[]>('/profiles')
  }

  /**
   * Get a single profile
   */
  async getProfile(id: number): Promise<Models.Profile> {
    return this.request<Models.Profile>(`/profiles/${id}`)
  }

  /**
   * Create a new profile
   */
  async createProfile(name: string): Promise<Models.Profile> {
    return this.request<Models.Profile>('/profiles', {
      method: 'POST',
      body: { name },
    })
  }

  /**
   * Update a profile
   */
  async updateProfile(id: number, name: string): Promise<void> {
    await this.request(`/profiles/${id}`, {
      method: 'PUT',
      body: { name },
    })
  }

  /**
   * Delete a profile
   */
  async deleteProfile(id: number): Promise<void> {
    await this.request(`/profiles/${id}`, { method: 'DELETE' })
  }

  /**
   * Reset all data for the current profile
   */
  async resetProfileData(): Promise<{ ok: boolean; message?: string }> {
    return this.request('/profile/data', { method: 'DELETE' })
  }

  // ============ TRANSACTIONS ============

  /**
   * Get all transactions with optional filters
   */
  async getTransactions(params?: ApiTypes.TransactionListParams): Promise<Models.Transaction[]> {
    const queryParams = new URLSearchParams()
    if (params?.date_from !== undefined) queryParams.append('date_from', params.date_from)
    if (params?.date_to !== undefined) queryParams.append('date_to', params.date_to)
    if (params?.category_id !== undefined)
      queryParams.append('category_id', params.category_id.toString())
    if (params?.search !== undefined) queryParams.append('search', params.search)
    if (params?.type !== undefined) {
      queryParams.append('type', params.type)
    }

    return this.request<Models.Transaction[]>(`/transactions?${queryParams.toString()}`)
  }

  /**
   * Get a single transaction
   */
  async getTransaction(id: number): Promise<Models.Transaction> {
    return this.request<Models.Transaction>(`/transactions/${id}`)
  }

  /**
   * Create a new transaction
   */
  async createTransaction(data: ApiTypes.TransactionCreateParams): Promise<Models.Transaction> {
    return this.request<Models.Transaction>('/transactions', {
      method: 'POST',
      body: data,
    })
  }

  /**
   * Update a transaction
   */
  async updateTransaction(
    id: number,
    data: Partial<ApiTypes.TransactionCreateParams>
  ): Promise<void> {
    await this.request(`/transactions/${id}`, {
      method: 'PUT',
      body: data,
    })
  }

  /**
   * Delete a transaction
   */
  async deleteTransaction(id: number): Promise<void> {
    await this.request(`/transactions/${id}`, { method: 'DELETE' })
  }

  // ============ CATEGORIES ============

  /**
   * Get all categories
   */
  async getCategories(): Promise<Models.Category[]> {
    return this.request<Models.Category[]>('/categories')
  }

  /**
   * Get a single category
   */
  async getCategory(id: number): Promise<Models.Category> {
    return this.request<Models.Category>(`/categories/${id}`)
  }

  /**
   * Create a category
   */
  async createCategory(data: Omit<Models.Category, 'id' | 'created_at'>): Promise<Models.Category> {
    return this.request<Models.Category>('/categories', {
      method: 'POST',
      body: data,
    })
  }

  /**
   * Update a category
   */
  async updateCategory(
    id: number,
    data: Omit<Models.Category, 'id' | 'created_at'>
  ): Promise<void> {
    await this.request(`/categories/${id}`, {
      method: 'PUT',
      body: data,
    })
  }

  /**
   * Delete a category
   */
  async deleteCategory(id: number): Promise<void> {
    await this.request(`/categories/${id}`, { method: 'DELETE' })
  }

  /**
   * Get category mappings for auto-mapping
   */
  async getCategoryMappings(): Promise<Models.CategoryMapping[]> {
    return this.request<Models.CategoryMapping[]>('/categories/mappings')
  }

  /**
   * Add/update a category mapping
   */
  async upsertCategoryMapping(
    pattern: string,
    category_id: number,
    confidence?: number
  ): Promise<{ ok: boolean; id?: number; use_count?: number }> {
    return this.request('/categories/mappings', {
      method: 'POST',
      body: { pattern, category_id, confidence },
    })
  }

  /**
   * Delete a category mapping
   */
  async deleteCategoryMapping(id: number): Promise<void> {
    await this.request(`/categories/mappings/${id}`, { method: 'DELETE' })
  }

  /**
   * Auto-map uncategorized transactions
   */
  async autoMapTransactions(transactionIds: number[]): Promise<{ ok: boolean; mapped: number }> {
    return this.request<{ ok: boolean; mapped: number }>('/categories/auto-map', {
      method: 'POST',
      body: { transaction_ids: transactionIds },
    })
  }

  // ============ ACCOUNTS ============

  /**
   * Get all accounts
   */
  async getAccounts(): Promise<Models.Account[]> {
    return this.request<Models.Account[]>('/accounts')
  }

  /**
   * Get a single account
   */
  async getAccount(id: number): Promise<Models.Account> {
    return this.request<Models.Account>(`/accounts/${id}`)
  }

  /**
   * Create an account
   */
  async createAccount(data: ApiTypes.AccountCreateParams): Promise<Models.Account> {
    return this.request<Models.Account>('/accounts', {
      method: 'POST',
      body: data,
    })
  }

  /**
   * Update an account
   */
  async updateAccount(id: number, data: Partial<ApiTypes.AccountCreateParams>): Promise<void> {
    await this.request(`/accounts/${id}`, {
      method: 'PUT',
      body: data,
    })
  }

  /**
   * Delete an account
   */
  async deleteAccount(id: number): Promise<void> {
    await this.request(`/accounts/${id}`, { method: 'DELETE' })
  }

  /**
   * Get balance history for an account
   */
  async getBalanceHistory(id: number): Promise<Models.BalanceHistory[]> {
    return this.request<Models.BalanceHistory[]>(`/accounts/${id}/history`)
  }

  /**
   * Record a balance entry
   */
  async recordBalance(id: number, balance: number): Promise<void> {
    await this.request(`/accounts/${id}/history`, {
      method: 'POST',
      body: { balance },
    })
  }

  /**
   * Delete a balance history entry
   */
  async deleteBalanceEntry(accountId: number, entryId: number): Promise<void> {
    await this.request(`/accounts/${accountId}/history/${entryId}`, {
      method: 'DELETE',
    })
  }

  // ============ BUDGETS ============

  /**
   * Get all budgets
   */
  async getBudgets(): Promise<Models.Budget[]> {
    return this.request<Models.Budget[]>('/budgets')
  }

  /**
   * Get a single budget
   */
  async getBudget(id: number): Promise<Models.Budget> {
    return this.request<Models.Budget>(`/budgets/${id}`)
  }

  /**
   * Create a budget
   */
  async createBudget(data: ApiTypes.BudgetCreateParams): Promise<Models.Budget> {
    return this.request<Models.Budget>('/budgets', {
      method: 'POST',
      body: data,
    })
  }

  /**
   * Update a budget
   */
  async updateBudget(id: number, data: Partial<ApiTypes.BudgetCreateParams>): Promise<void> {
    await this.request(`/budgets/${id}`, {
      method: 'PUT',
      body: data,
    })
  }

  /**
   * Delete a budget
   */
  async deleteBudget(id: number): Promise<void> {
    await this.request(`/budgets/${id}`, { method: 'DELETE' })
  }

  // ============ SAVINGS GOALS ============

  /**
   * Get all savings goals
   */
  async getGoals(): Promise<Models.SavingsGoal[]> {
    return this.request<Models.SavingsGoal[]>('/savings-goals')
  }

  /**
   * Get a single savings goal
   */
  async getGoal(id: number): Promise<Models.SavingsGoal> {
    return this.request<Models.SavingsGoal>(`/savings-goals/${id}`)
  }

  /**
   * Create a savings goal
   */
  async createGoal(data: ApiTypes.GoalCreateParams): Promise<Models.SavingsGoal> {
    return this.request<Models.SavingsGoal>('/savings-goals', {
      method: 'POST',
      body: data,
    })
  }

  /**
   * Update a savings goal
   */
  async updateGoal(id: number, data: Partial<Models.SavingsGoal>): Promise<void> {
    await this.request(`/savings-goals/${id}`, {
      method: 'PUT',
      body: data,
    })
  }

  /**
   * Delete a savings goal
   */
  async deleteGoal(id: number): Promise<void> {
    await this.request(`/savings-goals/${id}`, { method: 'DELETE' })
  }

  /**
   * Add contribution to a savings goal
   */
  async addGoalContribution(id: number, amount: number): Promise<void> {
    await this.request(`/savings-goals/${id}/contribute`, {
      method: 'POST',
      body: { amount },
    })
  }

  // ============ LOANS ============

  /**
   * Get all loans
   */
  async getLoans(): Promise<Models.Loan[]> {
    return this.request<Models.Loan[]>('/loans')
  }

  /**
   * Get a single loan
   */
  async getLoan(id: number): Promise<Models.Loan> {
    return this.request<Models.Loan>(`/loans/${id}`)
  }

  /**
   * Create a loan
   */
  async createLoan(data: ApiTypes.LoanCreateParams): Promise<Models.Loan> {
    return this.request<Models.Loan>('/loans', {
      method: 'POST',
      body: data,
    })
  }

  /**
   * Update a loan
   */
  async updateLoan(id: number, data: Partial<Models.Loan>): Promise<void> {
    await this.request(`/loans/${id}`, {
      method: 'PUT',
      body: data,
    })
  }

  /**
   * Delete a loan
   */
  async deleteLoan(id: number): Promise<void> {
    await this.request(`/loans/${id}`, { method: 'DELETE' })
  }

  /**
   * Get rate periods for a loan
   */
  async getLoanRatePeriods(id: number): Promise<Models.LoanRatePeriod[]> {
    return this.request<Models.LoanRatePeriod[]>(`/loans/${id}/rate-periods`)
  }

  /**
   * Update loan rate
   */
  async updateLoanRate(
    id: number,
    rate: number,
    startMonth: number,
    endMonth: number | null
  ): Promise<void> {
    await this.request(`/loans/${id}/rate`, {
      method: 'PUT',
      body: { rate, start_month: startMonth, end_month: endMonth },
    })
  }

  /**
   * Add prepayment
   */
  async addLoanPrepayment(id: number, month: number, amount: number, note?: string): Promise<void> {
    await this.request(`/loans/${id}/prepayment`, {
      method: 'POST',
      body: { month, amount, note },
    })
  }

  // ============ BILLS ============

  /**
   * Get all bills
   */
  async getBills(): Promise<Models.Bill[]> {
    return this.request<Models.Bill[]>('/bills')
  }

  /**
   * Get a single bill
   */
  async getBill(id: number): Promise<Models.Bill> {
    return this.request<Models.Bill>(`/bills/${id}`)
  }

  /**
   * Create a bill
   */
  async createBill(data: Omit<Models.Bill, 'id' | 'created_at'>): Promise<Models.Bill> {
    return this.request<Models.Bill>('/bills', {
      method: 'POST',
      body: data,
    })
  }

  /**
   * Update a bill
   */
  async updateBill(id: number, data: Partial<Models.Bill>): Promise<void> {
    await this.request(`/bills/${id}`, {
      method: 'PUT',
      body: data,
    })
  }

  /**
   * Delete a bill
   */
  async deleteBill(id: number): Promise<void> {
    await this.request(`/bills/${id}`, { method: 'DELETE' })
  }

  /**
   * Mark a bill as paid
   */
  async markBillPaid(id: number): Promise<void> {
    await this.request(`/bills/${id}/pay`, { method: 'POST' })
  }

  // ============ SETTINGS ============

  /**
   * Get all settings for current profile
   */
  async getSettings(): Promise<Models.Settings> {
    return this.request<Models.Settings>('/settings')
  }

  /**
   * Update settings
   */
  async updateSettings(data: ApiTypes.SettingsUpdateParams): Promise<void> {
    await this.request('/settings', {
      method: 'PUT',
      body: data,
    })
  }

  /**
   * Update single setting
   */
  async updateSetting(key: string, value: string): Promise<void> {
    await this.request('/settings', {
      method: 'PUT',
      body: { [key]: value },
    })
  }

  // ============ ANALYTICS & DASHBOARD ============

  /**
   * Get min/max transaction years for the selected profiles.
   * Uses the analytics distinct-years endpoint.
   */
  async getTransactionYears(): Promise<{ minYear: number; maxYear: number; years: number[] }> {
    const res = await this.request<{ years: number[] }>('/analytics/distinct-years')
    const years = res.years || []
    return {
      minYear: years.length > 0 ? Math.min(...years) : new Date().getFullYear(),
      maxYear: years.length > 0 ? Math.max(...years) : new Date().getFullYear(),
      years,
    }
  }

  /**
   * Get dashboard metrics
   */
  async getDashboard(
    month?: number,
    year?: number,
    dateFrom?: string,
    dateTo?: string,
    allTime?: boolean
  ): Promise<Models.DashboardMetrics> {
    const qs = new URLSearchParams()
    if (allTime) {
      qs.set('all', 'true')
    } else if (dateFrom && dateTo) {
      qs.set('date_from', dateFrom)
      qs.set('date_to', dateTo)
    } else if (month && year) {
      qs.set('month', String(month))
      qs.set('year', String(year))
    }
    const params = qs.toString() ? `?${qs.toString()}` : ''
    return this.request<Models.DashboardMetrics>(`/dashboard${params}`)
  }

  /**
   * Get analytics summary
   */
  async getAnalytics(): Promise<Models.AnalyticsSummary> {
    return this.request<Models.AnalyticsSummary>('/analytics')
  }

  /**
   * Get dashboard chart data (monthly income/expense, category breakdown, cash flow)
   */
  async getDashboardCharts(months?: number): Promise<Models.DashboardChartsResponse> {
    const params = months ? `?months=${months}` : ''
    return this.request<Models.DashboardChartsResponse>(`/dashboard/charts${params}`)
  }

  /**
   * Get net worth timeline data
   */
  async getNetWorth(): Promise<Models.NetWorthResponse> {
    return this.request<Models.NetWorthResponse>('/dashboard/net-worth')
  }

  /**
   * Export transactions as CSV
   */
  async exportTransactions(params?: { date_from?: string; date_to?: string }): Promise<Blob> {
    const queryParams = new URLSearchParams()
    if (params?.date_from !== undefined) queryParams.append('date_from', params.date_from)
    if (params?.date_to !== undefined) queryParams.append('date_to', params.date_to)

    const response = await apiFetch(`${API_BASE}/transactions/export?${queryParams.toString()}`, {
      headers: this.headers,
      credentials: 'include',
    })

    if (!response.ok) {
      throw new Error(`Failed to export: ${response.statusText}`)
    }

    return response.blob()
  }

  /**
   * Import transactions from CSV
   */
  async importTransactions(file: File): Promise<Models.ImportResult> {
    const formData = new FormData()
    formData.append('file', file)

    const response = await apiFetch(`${API_BASE}/import`, {
      method: 'POST',
      body: formData,
      credentials: 'include',
    })

    return await response.json()
  }

  // ============ RETIREMENT ============

  /**
   * Get retirement projection
   */
  async getRetirementProjection(params?: {
    current_age?: number
    retirement_age?: number
    life_expectancy?: number
    current_savings?: number
    monthly_contribution?: number
    current_annual_income?: number
    annual_return?: number
    inflation_rate?: number
    monthly_expenses?: number
  }): Promise<Models.RetirementProjection> {
    return this.request<Models.RetirementProjection>('/retirement', {
      method: 'POST',
      body: params,
    })
  }

  // ============ HOUSING CALCULATOR ============

  /**
   * Calculate housing costs
   */
  async calculateHousing(params: {
    gross_income: number
    living_expenses: number
    transport_cost: number
    utilities_cost: number
    savings_target: number
  }): Promise<Models.HousingCalculation> {
    return this.request<Models.HousingCalculation>('/housing/calculate', {
      method: 'POST',
      body: params,
    })
  }

  // ============ EXCHANGE RATES ============

  /**
   * Get exchange rates for a base currency
   */
  async getExchangeRates(
    base?: string,
    symbols?: string
  ): Promise<{
    base: string
    rates: Record<string, number>
    timestamp: number
    last_updated: string
  }> {
    const queryParams = new URLSearchParams()
    if (base !== undefined) queryParams.append('base', base)
    if (symbols !== undefined) queryParams.append('symbols', symbols)

    return this.request<{
      base: string
      rates: Record<string, number>
      timestamp: number
      last_updated: string
    }>(`/exchange-rates?${queryParams.toString()}`)
  }

  /**
   * Get exchange rate for a specific currency pair
   */
  async getExchangeRate(base: string, target: string): Promise<{ rate: number }> {
    return this.request<{ rate: number }>(`/exchange-rates/${base}/${target}`)
  }

  // ============ HEALTH ============

  /**
   * Health check
   */
  async healthCheck(): Promise<{ status: string; timestamp: string }> {
    return this.request<{ status: string; timestamp: string }>('/health')
  }

  // ============ RECEIPTS ============

  /**
   * Upload a receipt for a transaction
   */
  async uploadReceipt(transactionId: number, file: File): Promise<Models.Receipt> {
    const formData = new FormData()
    formData.append('receipt', file)
    formData.append('transaction_id', transactionId.toString())

    const response = await apiFetch(`${API_BASE}/receipts/upload`, {
      method: 'POST',
      headers: { 'X-Profile-Id': this.getCurrentProfileId().toString() },
      body: formData,
      credentials: 'include',
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: `HTTP ${response.status}` }))
      const errorMsg = errorData.error ?? errorData.message
      throw new Error(errorMsg !== undefined ? errorMsg : 'Failed to upload receipt')
    }

    return await response.json()
  }

  /**
   * Get a single receipt by ID
   */
  async getReceipt(id: number): Promise<Models.Receipt> {
    return this.request<Models.Receipt>(`/receipts/${id}`)
  }

  /**
   * Get all receipts for a transaction
   */
  async getReceiptsForTransaction(transactionId: number): Promise<Models.Receipt[]> {
    return this.request<Models.Receipt[]>(`/receipts/transaction/${transactionId}`)
  }

  /**
   * Get receipt file as blob
   */
  async getReceiptFile(id: number): Promise<Blob> {
    const url = `${API_BASE}/receipts/${id}/file`
    const response = await apiFetch(url, {
      headers: this.headers,
      credentials: 'include',
    })

    if (!response.ok) {
      throw new Error(`Failed to download receipt: ${response.statusText}`)
    }

    return await response.blob()
  }

  /**
   * Delete a receipt
   */
  async deleteReceipt(id: number): Promise<void> {
    await this.request(`/receipts/${id}`, { method: 'DELETE' })
  }

  // ============ RECONCILIATION ============

  /**
   * Toggle reconciled status for a transaction
   */
  async toggleReconcile(id: number): Promise<{ reconciled: number; reconciled_at: string | null }> {
    return this.request(`/transactions/${id}/reconcile`, { method: 'PATCH' })
  }

  /**
   * Bulk reconcile transactions by date range
   */
  async reconcileByDateRange(
    dateFrom: string,
    dateTo: string
  ): Promise<{ message: string; count: number }> {
    return this.request(`/transactions/reconcile/bulk`, {
      method: 'POST',
      body: { date_from: dateFrom, date_to: dateTo },
    })
  }

  /**
   * Get reconciliation summary for all transactions
   */
  async getReconciliationSummary(): Promise<{
    reconciled_count: number
    unreconciled_count: number
    reconciled_total: number
    unreconciled_total: number
  }> {
    return this.request(`/transactions/reconcile/summary`)
  }

  /**
   * Batch mark transactions as reconciled by ID list
   */
  async reconcileByIds(transactionIds: number[]): Promise<{ message: string; updated: number }> {
    return this.request(`/transactions/reconcile-batch`, {
      method: 'PUT',
      body: { transaction_ids: transactionIds },
    })
  }

  async getTags(): Promise<{ id: number; name: string; color: string }[]> {
    return this.request('/tags')
  }

  /**
   * Create a new tag
   */
  async createTag(
    name: string,
    color?: string
  ): Promise<{ id: number; name: string; color: string }> {
    return this.request('/tags', {
      method: 'POST',
      body: { name, color },
    })
  }

  // ============ RECURRING TRANSACTIONS ============

  getRecurring(): Promise<Models.RecurringTransaction[]> {
    return this.request<Models.RecurringTransaction[]>('/recurring')
  }

  getRecurringById(id: number): Promise<Models.RecurringTransaction> {
    return this.request<Models.RecurringTransaction>(`/recurring/${id}`)
  }

  createRecurring(
    data: Partial<Models.RecurringTransaction> &
      Pick<Models.RecurringTransaction, 'description' | 'amount' | 'type' | 'frequency'>
  ): Promise<Models.RecurringTransaction> {
    return this.request<Models.RecurringTransaction>('/recurring', { method: 'POST', body: data })
  }

  updateRecurring(
    id: number,
    data: Partial<Models.RecurringTransaction>
  ): Promise<Models.RecurringTransaction> {
    return this.request<Models.RecurringTransaction>(`/recurring/${id}`, {
      method: 'PUT',
      body: data,
    })
  }

  deleteRecurring(id: number): Promise<void> {
    return this.request(`/recurring/${id}`, { method: 'DELETE' })
  }

  populateRecurring(id: number): Promise<{ ok: boolean }> {
    return this.request(`/recurring/${id}/populate`, { method: 'POST' })
  }
}

// Export singleton instance
export const api = new ApiClient()

// Export utility functions
export const getLocalCurrency = (): string => {
  try {
    return localStorage.getItem('localCurrency') || 'EUR'
  } catch {
    return 'EUR'
  }
}

export const formatCurrency = (amount: number, currency: Models.Currency = 'EUR'): string => {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount)
}

export const formatDate = (dateStr: string): string => {
  let date = new Date(dateStr)
  // Handle Google Viz Date(Y,M,D) format where month is 0-indexed
  if (isNaN(date.getTime())) {
    const m = dateStr.match(/^Date\((\d{4}),\s*(\d{1,2}),\s*(\d{1,2})\)$/)
    if (m) {
      date = new Date(parseInt(m[1]), parseInt(m[2]), parseInt(m[3]))
    }
  }
  // Handle dd/mm/yyyy
  if (isNaN(date.getTime())) {
    const m = dateStr.match(/^(\d{1,2})[/\-. ](\d{1,2})[/\-. ](\d{4})$/)
    if (m) {
      date = new Date(parseInt(m[3]), parseInt(m[2]) - 1, parseInt(m[1]))
    }
  }
  if (isNaN(date.getTime())) return dateStr
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

import { addToast } from './toastStore'

export const toast = (
  message: string,
  type: 'info' | 'success' | 'error' | 'warning' = 'info'
): void => {
  addToast(message, type)
}

// Re-export for backward compatibility — prefer toast() for new code
export const showToast = toast

// ── HTTP verb helpers ─────────────────────────────────────────────────────────

function getProfileIdForHeaders(): string {
  const id = localStorage.getItem('currentProfileId')
  return (id !== null ? parseInt(id, 10) : 1).toString()
}

function getHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'X-Profile-Id': getProfileIdForHeaders(),
  }
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const contentType = response.headers.get('content-type')
  if (contentType !== null && contentType.includes('application/json')) {
    const data = (await response.json()) as T
    if (!response.ok) {
      const errorData = data as { error?: string } | undefined
      throw new Error(errorData?.error || `Request failed with status ${response.status}`)
    }
    return data
  }
  throw new Error('Invalid response format')
}

export async function apiGet<T = unknown>(url: string): Promise<T> {
  const response = await apiFetch(url, {
    credentials: 'include',
    method: 'GET',
    headers: getHeaders(),
  })
  if (!response.ok) throw new Error(`Request failed with status ${response.status}`)
  return parseJsonResponse<T>(response)
}

export async function apiPost<T = unknown>(
  url: string,
  body: unknown,
  options?: RequestInit
): Promise<T> {
  const response = await apiFetch(url, {
    credentials: 'include',
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(body),
    ...options,
  })
  if (!response.ok) throw new Error(`Request failed with status ${response.status}`)
  return parseJsonResponse<T>(response)
}

export async function apiPut<T = unknown>(
  url: string,
  body: unknown,
  options?: RequestInit
): Promise<T> {
  const response = await apiFetch(url, {
    credentials: 'include',
    method: 'PUT',
    headers: getHeaders(),
    body: JSON.stringify(body),
    ...options,
  })
  if (!response.ok) throw new Error(`Request failed with status ${response.status}`)
  return parseJsonResponse<T>(response)
}

export async function apiDelete<T = unknown>(url: string): Promise<T> {
  const response = await apiFetch(url, {
    credentials: 'include',
    method: 'DELETE',
    headers: { 'X-Profile-Id': getProfileIdForHeaders() },
  })
  if (!response.ok) throw new Error(`Request failed with status ${response.status}`)
  return parseJsonResponse<T>(response)
}
