/**
 * Storage Factory - Creates the appropriate storage adapter based on mode
 */

import type { StorageAdapter } from '../types/storage.js'
import { LocalStorageAdapter } from './localStorageAdapter.js'

// Storage modes
export type StorageMode = 'serverless' | 'self-hosted'

// Singleton instance storage
let currentAdapter: StorageAdapter | null = null
let currentMode: StorageMode = 'self-hosted'

// Check if we're running in a serverless environment
function detectStorageMode(): StorageMode {
  // Check if we can use localStorage (not in a browser context for SSR)
  if (typeof window === 'undefined') {
    return 'self-hosted'
  }

  // In serverless mode, check for localStorage support
  try {
    const testKey = '__storage_test__'
    localStorage.setItem(testKey, 'test')
    localStorage.removeItem(testKey)

    // Check if API base URL is root (self-hosted) or domain (serverless)
    const apiBase = window.location.pathname.replace(/\/$/, '')
    return apiBase === '/' ? 'serverless' : 'self-hosted'
  } catch {
    return 'self-hosted'
  }
}

/**
 * Get the current storage mode
 */
export function getStorageMode(): StorageMode {
  if (currentMode === 'self-hosted') {
    return 'self-hosted'
  }

  // Check localStorage for stored preference
  const stored = localStorage.getItem('finance_storage_mode')
  if (stored) {
    const mode = stored as StorageMode
    if (mode === 'serverless' || mode === 'self-hosted') {
      return mode
    }
  }

  return detectStorageMode()
}

/**
 * Set the storage mode
 */
export function setStorageMode(mode: StorageMode): void {
  currentMode = mode
  localStorage.setItem('finance_storage_mode', mode)
  currentAdapter = null // Reset adapter on mode change
}

/**
 * Get the current storage adapter (singleton)
 */
export async function getStorageAdapter(): Promise<StorageAdapter> {
  if (currentAdapter) {
    return currentAdapter
  }

  const mode = getStorageMode()

  if (mode === 'serverless') {
    currentAdapter = new LocalStorageAdapter()
  } else {
    currentAdapter = new SelfHostedAdapter()
  }

  return currentAdapter
}

/**
 * Reset the current adapter (for testing or mode switching)
 */
export function resetAdapter(): void {
  currentAdapter = null
}

/**
 * Self-Hosted Adapter Implementation
 * Communicates with the backend API
 */
class SelfHostedAdapter implements StorageAdapter {
  // Profile management
  async getCurrentProfileId(): Promise<number> {
    const response = await fetch('/api/profiles', {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
    })

    if (!response.ok) {
      throw new Error('Failed to get profiles')
    }

    const profiles = await response.json()

    // Check localStorage for stored profile ID
    const storedId = localStorage.getItem('currentProfileId')
    if (storedId) {
      const id = parseInt(storedId, 10)
      if (profiles.some((p) => p.id === id)) {
        return id
      }
    }

    // Use first profile
    if (profiles.length > 0) {
      localStorage.setItem('currentProfileId', profiles[0].id.toString())
      return profiles[0].id
    }

    // Create default profile
    const created = await fetch('/api/profiles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ name: 'Main Profile' }),
    })

    if (!created.ok) {
      throw new Error('Failed to create profile')
    }

    const newProfile = await created.json()
    localStorage.setItem('currentProfileId', newProfile.id.toString())
    return newProfile.id
  }

  async createProfile(name: string): Promise<number> {
    const response = await fetch('/api/profiles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ name }),
    })

    if (!response.ok) {
      throw new Error('Failed to create profile')
    }

    const profile = await response.json()
    localStorage.setItem('currentProfileId', profile.id.toString())
    return profile.id
  }

  async updateProfile(id: number, name: string): Promise<void> {
    await fetch(`/api/profiles/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ name }),
    })
  }

  async deleteProfile(id: number): Promise<void> {
    await fetch(`/api/profiles/${id}`, {
      method: 'DELETE',
      credentials: 'include',
    })
  }

  // Transaction management
  async listTransactions(
    filters?: Parameters<StorageAdapter['listTransactions']>[0]
  ): Promise<Parameters<StorageAdapter['listTransactions']>[1]> {
    const params = new URLSearchParams()
    if (filters?.date_from) params.append('date_from', filters.date_from)
    if (filters?.date_to) params.append('date_to', filters.date_to)
    if (filters?.category_id) params.append('category_id', filters.category_id.toString())
    if (filters?.search) params.append('search', filters.search)
    if (filters?.type) params.append('type', filters.type)

    const response = await fetch(`/api/transactions?${params.toString()}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
    })

    if (!response.ok) {
      throw new Error('Failed to get transactions')
    }

    return response.json()
  }

  async createTransaction(tx: Parameters<StorageAdapter['createTransaction']>[0]): Promise<number> {
    const response = await fetch('/api/transactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(tx),
    })

    if (!response.ok) {
      throw new Error('Failed to create transaction')
    }

    return (await response.json()).id
  }

  async updateTransaction(
    id: number,
    tx: Parameters<StorageAdapter['updateTransaction']>[1]
  ): Promise<void> {
    await fetch(`/api/transactions/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(tx),
    })
  }

  async deleteTransaction(id: number): Promise<void> {
    await fetch(`/api/transactions/${id}`, {
      method: 'DELETE',
      credentials: 'include',
    })
  }

  async deleteAllTransactions(): Promise<void> {
    await fetch('/api/transactions/all', {
      method: 'DELETE',
      credentials: 'include',
    })
  }

  // Category management
  async listCategories(
    type?: 'income' | 'expense'
  ): Promise<Parameters<StorageAdapter['listCategories']>[1]> {
    const params = type ? `?type=${type}` : ''
    const response = await fetch(`/api/categories${params}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
    })

    if (!response.ok) {
      throw new Error('Failed to get categories')
    }

    return response.json()
  }

  async createCategory(category: Parameters<StorageAdapter['createCategory']>[1]): Promise<number> {
    const response = await fetch('/api/categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(category),
    })

    if (!response.ok) {
      throw new Error('Failed to create category')
    }

    return (await response.json()).id
  }

  async updateCategory(
    id: number,
    category: Parameters<StorageAdapter['updateCategory']>[1]
  ): Promise<void> {
    await fetch(`/api/categories/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(category),
    })
  }

  async deleteCategory(id: number): Promise<void> {
    await fetch(`/api/categories/${id}`, {
      method: 'DELETE',
      credentials: 'include',
    })
  }

  async deleteAllCategories(): Promise<void> {
    await fetch('/api/categories/all', {
      method: 'DELETE',
      credentials: 'include',
    })
  }

  // Account management
  async listAccounts(): Promise<Parameters<StorageAdapter['listAccounts']>[1]> {
    const response = await fetch('/api/accounts', {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
    })

    if (!response.ok) {
      throw new Error('Failed to get accounts')
    }

    return response.json()
  }

  async createAccount(account: Parameters<StorageAdapter['createAccount']>[1]): Promise<number> {
    const response = await fetch('/api/accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(account),
    })

    if (!response.ok) {
      throw new Error('Failed to create account')
    }

    return (await response.json()).id
  }

  async updateAccount(
    id: number,
    account: Parameters<StorageAdapter['updateAccount']>[1]
  ): Promise<void> {
    await fetch(`/api/accounts/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(account),
    })
  }

  async deleteAccount(id: number): Promise<void> {
    await fetch(`/api/accounts/${id}`, {
      method: 'DELETE',
      credentials: 'include',
    })
  }

  // Budget management
  async listBudgets(): Promise<Parameters<StorageAdapter['listBudgets']>[1]> {
    const response = await fetch('/api/budgets', {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
    })

    if (!response.ok) {
      throw new Error('Failed to get budgets')
    }

    return response.json()
  }

  async createBudget(budget: Parameters<StorageAdapter['createBudget']>[1]): Promise<number> {
    const response = await fetch('/api/budgets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(budget),
    })

    if (!response.ok) {
      throw new Error('Failed to create budget')
    }

    return (await response.json()).id
  }

  async updateBudget(
    id: number,
    budget: Parameters<StorageAdapter['updateBudget']>[1]
  ): Promise<void> {
    await fetch(`/api/budgets/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(budget),
    })
  }

  async deleteBudget(id: number): Promise<void> {
    await fetch(`/api/budgets/${id}`, {
      method: 'DELETE',
      credentials: 'include',
    })
  }

  // Goal management
  async listGoals(): Promise<Parameters<StorageAdapter['listGoals']>[1]> {
    const response = await fetch('/api/savings-goals', {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
    })

    if (!response.ok) {
      throw new Error('Failed to get goals')
    }

    return response.json()
  }

  async createGoal(goal: Parameters<StorageAdapter['createGoal']>[1]): Promise<number> {
    const response = await fetch('/api/savings-goals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(goal),
    })

    if (!response.ok) {
      throw new Error('Failed to create goal')
    }

    return (await response.json()).id
  }

  async updateGoal(id: number, goal: Parameters<StorageAdapter['updateGoal']>[1]): Promise<void> {
    await fetch(`/api/savings-goals/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(goal),
    })
  }

  async deleteGoal(id: number): Promise<void> {
    await fetch(`/api/savings-goals/${id}`, {
      method: 'DELETE',
      credentials: 'include',
    })
  }

  // Loan management
  async listLoans(): Promise<Parameters<StorageAdapter['listLoans']>[1]> {
    const response = await fetch('/api/loans', {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
    })

    if (!response.ok) {
      throw new Error('Failed to get loans')
    }

    return response.json()
  }

  async createLoan(loan: Parameters<StorageAdapter['createLoan']>[1]): Promise<number> {
    const response = await fetch('/api/loans', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(loan),
    })

    if (!response.ok) {
      throw new Error('Failed to create loan')
    }

    return (await response.json()).id
  }

  async updateLoan(id: number, loan: Parameters<StorageAdapter['updateLoan']>[1]): Promise<void> {
    await fetch(`/api/loans/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(loan),
    })
  }

  async deleteLoan(id: number): Promise<void> {
    await fetch(`/api/loans/${id}`, {
      method: 'DELETE',
      credentials: 'include',
    })
  }

  // Transaction history
  async getBalanceHistory(
    accountId: number
  ): Promise<Parameters<StorageAdapter['getBalanceHistory']>[1]> {
    const response = await fetch(`/api/accounts/${accountId}/history`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
    })

    if (!response.ok) {
      throw new Error('Failed to get balance history')
    }

    return response.json()
  }

  async recordBalance(accountId: number, balance: number): Promise<number> {
    const response = await fetch(`/api/accounts/${accountId}/history`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ balance }),
    })

    if (!response.ok) {
      throw new Error('Failed to record balance')
    }

    return (await response.json()).id
  }

  // Settings
  async getSettings(): Promise<Parameters<StorageAdapter['getSettings']>[1]> {
    const response = await fetch('/api/settings', {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
    })

    if (!response.ok) {
      throw new Error('Failed to get settings')
    }

    return response.json()
  }

  async updateSettings(settings: Parameters<StorageAdapter['updateSettings']>[1]): Promise<void> {
    await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(settings),
    })
  }

  // Transaction (ACID)
  async transaction<T>(callback: (tx: StorageAdapter) => Promise<T>): Promise<T> {
    // For self-hosted, we rely on the backend for transactions
    return callback(this)
  }

  // Export/Import
  async exportData(): Promise<Parameters<StorageAdapter['exportData']>[1]> {
    const response = await fetch('/api/export', {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
    })

    if (!response.ok) {
      throw new Error('Failed to export data')
    }

    return response.json()
  }

  async importData(data: Parameters<StorageAdapter['importData']>[1]): Promise<void> {
    const response = await fetch('/api/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(data),
    })

    if (!response.ok) {
      throw new Error('Failed to import data')
    }
  }

  // Cleanup
  async clearAllData(): Promise<void> {
    await fetch('/api/clear-all', {
      method: 'DELETE',
      credentials: 'include',
    })
  }
}
