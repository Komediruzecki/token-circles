/**
 * API Client - Type-safe HTTP client for backend API
 */

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
  private headers: HeadersInit = {}

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
    const parsed = stored ? parseInt(stored, 10) : undefined
    return parsed ?? 1
  }

  private getSelectedProfileIds(): number[] {
    const ids = localStorage.getItem(SELECTED_PROFILE_IDS_KEY)
    const parsed = ids ? JSON.parse(ids) : undefined
    return parsed ? parsed : [this.getCurrentProfileId()]
  }

  // private setProfileIds(profileIds: number[]) {
  //   localStorage.setItem(SELECTED_PROFILE_IDS_KEY, JSON.stringify(profileIds));
  // }

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
    if (method === 'DELETE') {
      requestOptions.headers = {}
    }

    try {
      const response = await fetch(url, requestOptions)

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({
          error: `HTTP ${response.status}`,
        }))
        throw new Error((errorData.error || errorData.message) ?? `HTTP ${response.status}`)
      }

      const contentType = response.headers.get('content-type')
      if (contentType === null || !contentType.includes('application/json')) {
        return {} as T
      }

      return await response.json()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Network error'
      throw new Error(message)
    }
  }

  // ============ AUTH ============

  /**
   * Login with username and password
   */
  async login(username: string, password: string): Promise<void> {
    void this.request<void>('/auth/login', {
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
    if (params?.date_from) queryParams.append('date_from', params.date_from)
    if (params?.date_to) queryParams.append('date_to', params.date_to)
    if (params?.category_id) queryParams.append('category_id', params.category_id.toString())
    if (params?.search) queryParams.append('search', params.search)
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
   * Get dashboard metrics
   */
  async getDashboard(): Promise<Models.DashboardMetrics> {
    return this.request<Models.DashboardMetrics>('/dashboard')
  }

  /**
   * Get analytics summary
   */
  async getAnalytics(): Promise<Models.AnalyticsSummary> {
    return this.request<Models.AnalyticsSummary>('/analytics')
  }

  /**
   * Export transactions as CSV
   */
  async exportTransactions(params?: { date_from?: string; date_to?: string }): Promise<Blob> {
    const queryParams = new URLSearchParams()
    if (params?.date_from) queryParams.append('date_from', params.date_from)
    if (params?.date_to) queryParams.append('date_to', params.date_to as string)

    const response = await fetch(`${API_BASE}/transactions/export?${queryParams.toString()}`, {
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

    const response = await fetch(`${API_BASE}/import`, {
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

  // ============ HEALTH ============

  /**
   * Health check
   */
  async healthCheck(): Promise<{ status: string; timestamp: string }> {
    return this.request<{ status: string; timestamp: string }>('/health')
  }
}

// Export singleton instance
export const api = new ApiClient()

// Export utility functions
export const formatCurrency = (amount: number, currency: Models.Currency = 'EUR'): string => {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount)
}

export const formatDate = (dateStr: string): string => {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export const formatMonth = (date: Date | string): string => {
  const d = typeof date === 'string' ? new Date(date) : date
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

export const escapeHtml = (str: string): string => {
  const div = document.createElement('div')
  div.textContent = str
  return div.innerHTML
}

export const hexToRgba = (hex: string, alpha = 1): string => {
  if (!hex || !hex.startsWith('#')) return `rgba(255,255,255,${alpha})`
  const h = hex.replace('#', '')
  const r = parseInt(h.substring(0, 2), 16)
  const g = parseInt(h.substring(2, 4), 16)
  const b = parseInt(h.substring(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

export const toast = (
  message: string,
  type: 'info' | 'success' | 'error' | 'warning' = 'info'
): void => {
  const container = document.getElementById('toast-container')
  if (!container) return

  const el = document.createElement('div')
  el.className = `toast ${type}`
  el.textContent = message
  container.appendChild(el)

  setTimeout(() => {
    el.remove()
  }, 4000)
}
