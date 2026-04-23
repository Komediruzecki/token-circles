/**
 * Global Stores - SolidJS stores for state management
 * These stores provide reactive state that can be shared across components
 */

import { batch, createEffect, createSignal } from 'solid-js'
import type * as ApiTypes from '../types/api.js'
import type * as Models from '../types/models.js'

// ============ API STORE ============
// Tracks API calls and provides error handling
export function createApiStore() {
  const [isBusy, setIsBusy] = createSignal(false)
  const [lastError, setLastError] = createSignal<string | null>(null)

  // Export apiCall for use in other stores
  const apiCall = async <T>(url: string, options: ApiTypes.ApiClientOptions = {}): Promise<T> => {
    setIsBusy(true)
    setLastError(null)

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...options.headers,
      }

      // Get profile IDs from localStorage
      const selectedIds = localStorage.getItem('selectedProfileIds')
      const profileIds = selectedIds ? JSON.parse(selectedIds) : [1]

      if (profileIds.length > 1) {
        headers['X-Profile-Ids'] = JSON.stringify(profileIds)
      } else {
        headers['X-Profile-Id'] = (profileIds[0] ?? 1).toString()
      }

      const response = await fetch(url, {
        method: options.method || 'GET',
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error ?? `HTTP ${response.status}`)
      }

      setLastError(null)
      return data
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      setLastError(message)
      throw error
    } finally {
      setIsBusy(false)
    }
  }

  const api = async <T>(url: string, options?: ApiTypes.ApiClientOptions): Promise<T> => {
    return apiCall<T>(url, options)
  }

  return {
    api,
    apiCall,
    isBusy,
    lastError,
    clearError: () => setLastError(null),
  }
}

// ============ PROFILE STORE ============
export function createProfileStore() {
  const [profiles, setProfiles] = createSignal<Models.Profile[]>([])
  const [currentProfileId, setCurrentProfileId] = createSignal<number>(1)
  const [selectedProfileIds, setSelectedProfileIds] = createSignal<number[]>([1])

  const loadProfiles = async () => {
    try {
      const data = await apiCall<Models.Profile[]>('/api/profiles')
      setProfiles(data)
    } catch (error) {
      console.error('Failed to load profiles:', error)
    }
  }

  const switchTo = async (id: number) => {
    setCurrentProfileId(id)
    setSelectedProfileIds([id])
    localStorage.setItem('currentProfileId', id.toString())
    await loadProfiles()
    window.location.reload()
  }

  const toggleProfile = async (id: number) => {
    const idx = selectedProfileIds().indexOf(id)
    let newIds: number[]
    if (idx !== -1) {
      newIds = selectedProfileIds().filter((pid) => pid !== id)
    } else {
      newIds = [...selectedProfileIds(), id]
    }

    if (newIds.length === 0) newIds = [currentProfileId()]

    setSelectedProfileIds(newIds)
    localStorage.setItem('selectedProfileIds', JSON.stringify(newIds))
    window.location.reload()
  }

  const selectAllProfiles = async () => {
    const all = profiles()
    setSelectedProfileIds(all.map((p) => p.id))
    await loadProfiles()
    window.location.reload()
  }

  const clearMultiSelect = () => {
    setSelectedProfileIds([currentProfileId()])
    localStorage.setItem('selectedProfileIds', JSON.stringify([currentProfileId()]))
    window.location.reload()
  }

  return {
    profiles,
    currentProfileId,
    selectedProfileIds,
    loadProfiles,
    switchTo,
    toggleProfile,
    selectAllProfiles,
    clearMultiSelect,
    getProfileIds: () => selectedProfileIds(),
  }
}

// ============ THEME STORE ============
export function createThemeStore() {
  const [theme, setTheme] = createSignal<'light' | 'dark'>('light')

  const toggle = () => {
    batch(() => {
      setTheme(theme() === 'light' ? 'dark' : 'light')
    })
  }

  const setThemeValue = (newTheme: 'light' | 'dark') => {
    batch(() => {
      setTheme(newTheme)
    })
  }

  createEffect(() => {
    if (theme() === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark')
    } else {
      document.documentElement.setAttribute('data-theme', 'light')
    }
  })

  return {
    theme,
    toggle,
    setTheme: setThemeValue,
  }
}

// ============ MODAL STORE ============
export function createModalStore() {
  const [isOpen, setIsOpen] = createSignal(false)
  const [type, setType] = createSignal<string>('')
  const [data, setData] = createSignal<Record<string, unknown> | null>(null)

  const open = (newType: string, newData?: Record<string, unknown>) => {
    batch(() => {
      setType(newType)
      setData(newData || null)
      setIsOpen(true)
    })
  }

  const close = () => {
    batch(() => {
      setIsOpen(false)
      setTimeout(() => {
        setType('')
        setData(null)
      }, 300)
    })
  }

  return {
    isOpen,
    type,
    data,
    open,
    close,
  }
}

// ============ TOAST STORE ============
export function createToastStore() {
  type ToastVariant = 'info' | 'success' | 'error' | 'warning'

  interface Toast {
    id: number
    message: string
    variant: ToastVariant
    duration?: number
  }

  const [toasts, setToasts] = createSignal<Toast[]>([])

  const show = (message: string, variant: ToastVariant = 'info', duration: number = 3000) => {
    const id = Date.now()
    const newToast: Toast = {
      id,
      message,
      variant,
      duration,
    }

    batch(() => {
      setToasts((prev) => [...prev, newToast])
    })

    if (duration > 0) {
      setTimeout(() => {
        batch(() => {
          setToasts((prev) => prev.filter((t) => t.id !== id))
        })
      }, duration)
    }
  }

  const info = (message: string, duration?: number) => {
    show(message, 'info', duration)
  }
  const success = (message: string, duration?: number) => {
    show(message, 'success', duration)
  }
  const error = (message: string, duration?: number) => {
    show(message, 'error', duration)
  }
  const warning = (message: string, duration?: number) => {
    show(message, 'warning', duration)
  }

  const removeToast = (id: number) => {
    batch(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
    })
  }

  return {
    toasts,
    show,
    info,
    success,
    error,
    warning,
    removeToast,
  }
}

// ============ DASHBOARD DATA STORE ============
export function createDashboardStore() {
  const [metrics, setMetrics] = createSignal<Models.DashboardMetrics | null>(null)
  const [loading, setLoading] = createSignal(false)

  const load = async () => {
    setLoading(true)
    try {
      const data = await apiCall<Models.DashboardMetrics>('/api/dashboard')
      setMetrics(data)
    } catch (error) {
      console.error('Failed to load dashboard:', error)
    } finally {
      setLoading(false)
    }
  }

  return {
    metrics,
    loading,
    load,
  }
}

// ============ TRANSACTIONS STORE ============
export function createTransactionsStore() {
  const [transactions, setTransactions] = createSignal<Models.Transaction[]>([])
  const [loading, setLoading] = createSignal(false)
  const [filters, setFilters] = createSignal<ApiTypes.TransactionFilters>({
    search: '',
    dateFrom: '',
    dateTo: '',
    type: 'all' as 'income' | 'expense',
    category: 'all',
  })

  const load = async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (filters().search) params.append('search', filters().search)
      if (filters().dateFrom) params.append('date_from', filters().dateFrom)
      if (filters().dateTo) params.append('date_to', filters().dateTo)
      if (filters().type !== 'all') params.append('type', filters().type)
      if (filters().category !== 'all') params.append('category_id', filters().category.toString())

      const data = await apiCall<Models.Transaction[]>(`/api/transactions?${params}`)
      setTransactions(data)
    } catch (error) {
      console.error('Failed to load transactions:', error)
    } finally {
      setLoading(false)
    }
  }

  const applyFilters = (newFilters: Partial<ApiTypes.TransactionFilters>) => {
    batch(() => {
      setFilters((prev) => ({ ...prev, ...newFilters }))
    })
    void load()
  }

  const resetFilters = () => {
    batch(() => {
      setFilters({
        search: '',
        dateFrom: '',
        dateTo: '',
        type: 'all' as 'income' | 'expense',
        category: 'all',
      })
    })
    void load()
  }

  return {
    transactions,
    loading,
    filters,
    load,
    applyFilters,
    resetFilters,
  }
}

// ============ CATEGORIES STORE ============
export function createCategoriesStore() {
  const [categories, setCategories] = createSignal<Models.Category[]>([])
  const [loading, setLoading] = createSignal(false)

  const load = async () => {
    setLoading(true)
    try {
      const data = await apiCall<Models.Category[]>('/api/categories')
      setCategories(data)
    } catch (error) {
      console.error('Failed to load categories:', error)
    } finally {
      setLoading(false)
    }
  }

  return {
    categories,
    loading,
    load,
  }
}

// ============ BUDGETS STORE ============
export function createBudgetsStore() {
  const [budgets, setBudgets] = createSignal<Models.Budget[]>([])
  const [loading, setLoading] = createSignal(false)

  const load = async () => {
    setLoading(true)
    try {
      const data = await apiCall<Models.Budget[]>('/api/budgets')
      setBudgets(data)
    } catch (error) {
      console.error('Failed to load budgets:', error)
    } finally {
      setLoading(false)
    }
  }

  return {
    budgets,
    loading,
    load,
  }
}

// ============ GLOBAL STORES FACTORY ============
let globalStores: {
  api: ReturnType<typeof createApiStore>
  profile: ReturnType<typeof createProfileStore>
  theme: ReturnType<typeof createThemeStore>
  modal: ReturnType<typeof createModalStore>
  toast: ReturnType<typeof createToastStore>
  dashboard: ReturnType<typeof createDashboardStore>
  transactions: ReturnType<typeof createTransactionsStore>
  categories: ReturnType<typeof createCategoriesStore>
  budgets: ReturnType<typeof createBudgetsStore>
} | null = null

export function initializeStores() {
  if (!globalStores) {
    globalStores = {
      api: createApiStore(),
      profile: createProfileStore(),
      theme: createThemeStore(),
      modal: createModalStore(),
      toast: createToastStore(),
      dashboard: createDashboardStore(),
      transactions: createTransactionsStore(),
      categories: createCategoriesStore(),
      budgets: createBudgetsStore(),
    }
  }
  return globalStores
}

export function getStores() {
  if (!globalStores) {
    throw new Error('Stores not initialized. Call initializeStores() first.')
  }
  return globalStores
}

// ============ CONVENIENCE ACCESSORS ============
export const { api, isBusy, lastError } = (() => {
  const stores = getStores()
  return {
    api: stores.api.api,
    isBusy: stores.api.isBusy,
    lastError: stores.api.lastError,
  }
})()

export const { apiCall } = (() => {
  const stores = getStores()
  return {
    apiCall: stores.api.apiCall,
  }
})()

export const { profiles, currentProfileId, selectedProfileIds, loadProfiles } = (() => {
  const stores = getStores()
  return {
    profiles: stores.profile.profiles,
    currentProfileId: stores.profile.currentProfileId,
    selectedProfileIds: stores.profile.selectedProfileIds,
    loadProfiles: stores.profile.loadProfiles,
  }
})()

export const {
  theme,
  toggle: toggleTheme,
  setTheme: setThemeValue,
} = (() => {
  const stores = getStores()
  return {
    theme: stores.theme.theme,
    toggle: stores.theme.toggle,
    setTheme: stores.theme.setTheme,
  }
})()

export const {
  isOpen: isModalOpen,
  type: modalType,
  data: modalData,
  open: openModal,
  close: closeModal,
} = (() => {
  const stores = getStores()
  return {
    isOpen: stores.modal.isOpen,
    type: stores.modal.type,
    data: stores.modal.data,
    open: stores.modal.open,
    close: stores.modal.close,
  }
})()

export const {
  toasts,
  info: toastInfo,
  success: toastSuccess,
  error: toastError,
} = (() => {
  const stores = getStores()
  return {
    toasts: stores.toast.toasts,
    info: stores.toast.info,
    success: stores.toast.success,
    error: stores.toast.error,
  }
})()
