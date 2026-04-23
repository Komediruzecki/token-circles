/**
 * API Client TypeScript Types
 * Type-safe wrapper for API calls
 */

import type * as Models from './models.js'

// ============ API CLIENT TYPES ============

export type JsonObject = Record<string, unknown>

export interface ApiClientOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'
  headers?: Record<string, string>
  body?: JsonObject | null
}

export interface ApiClientError {
  error: string
  message?: string
  status?: number
}

// ============ API RESPONSE WRAPPERS ============

export interface ApiSuccessResponse<T> {
  data: T
  error?: undefined
}

export type ApiResponse<T> = ApiSuccessResponse<T> | { error: string }

// ============ STORE TYPES ============

export interface Store<T> {
  value: T
  set: (value: T) => void
  update: (fn: (prev: T) => T) => void
}

export type StoreState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: unknown }
  | { status: 'error'; error: string }

// ============ GLOBAL STORE TYPES ============

export interface AuthStore {
  isAuthenticated: () => boolean
  getProfileId: () => number | null
  getSelectedProfileIds: () => number[]
  login: (username: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

export interface ThemeStore {
  theme: 'light' | 'dark'
  toggle: () => void
  setTheme: (theme: 'light' | 'dark') => void
}

export interface ProfileStore {
  profiles: Models.Profile[]
  currentProfileId: number
  selectedProfileIds: number[]
  loadProfiles: () => Promise<void>
  switchTo: (id: number) => Promise<void>
  toggleProfile: (id: number) => Promise<void>
  selectAllProfiles: () => Promise<void>
  clearMultiSelect: () => void
  getProfileIds: () => number[]
  refreshUI: () => Promise<void>
}

// ============ API ENDPOINTS TYPE DEFINITIONS ============

export type TransactionListParams = {
  profile_id?: number
  profile_ids?: number[]
  date_from?: string
  date_to?: string
  category_id?: number
  search?: string
  type?: 'income' | 'expense'
  limit?: number
  page?: number
  perPage?: number
  reconciled?: boolean
  category_name?: string
}

export type TransactionCreateParams = Omit<Models.Transaction, 'id' | 'created_at' | 'updated_at'>

export type BudgetCreateParams = Omit<Models.Budget, 'id' | 'created_at'>

export type GoalCreateParams = Omit<Models.SavingsGoal, 'id' | 'created_at' | 'current_amount'> & {
  current_amount?: number
}

export type AccountCreateParams = Omit<Models.Account, 'id'>

export type LoanCreateParams = Omit<Models.Loan, 'id' | 'created_at'>

export type SettingsUpdateParams = Partial<Models.Settings>

// ============ FILTER STATE TYPES ============

export interface TransactionFilters {
  search: string
  dateFrom: string
  dateTo: string
  type: 'all' | 'income' | 'expense'
  category: number | 'all'
}

export interface BudgetFilters {
  period: 'all' | 'monthly' | 'weekly' | 'yearly'
  activeOnly: boolean
}

// ============ MODAL STATE TYPES ============

export interface ModalState {
  isOpen: boolean
  type: string
  data?: JsonObject
  close: () => void
  open: (type: string, data?: JsonObject) => void
}
