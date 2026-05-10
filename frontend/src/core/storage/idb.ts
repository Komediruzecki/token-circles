/**
 * IndexedDB Storage Adapter
 * Implements StorageAdapter for serverless/client-only operation using IndexedDB
 */
import { openDB } from 'idb'
import type { IDBPDatabase } from 'idb'
import type {
  Account,
  BalanceEntry,
  Budget,
  Category,
  ExportData,
  Goal,
  Loan,
  Settings,
  StorageAdapter,
  Transaction,
  TransactionFilters,
} from '../../types/storage'

const DB_NAME = 'finance-manager'
const DB_VERSION = 3

// ---- Schema Helpers ----

function upgradeSchema(db: IDBPDatabase, oldVersion: number) {
  // Profiles
  if (oldVersion < 1) {
    db.createObjectStore('profiles', { keyPath: 'id', autoIncrement: true })

    const txns = db.createObjectStore('transactions', { keyPath: 'id', autoIncrement: true })
    txns.createIndex('by_profile', 'profile_id')
    txns.createIndex('by_date', 'date')
    txns.createIndex('by_category', 'category_id')
    txns.createIndex('by_type', 'type')

    const cats = db.createObjectStore('categories', { keyPath: 'id', autoIncrement: true })
    cats.createIndex('by_profile', 'profile_id')
    cats.createIndex('by_type', 'type')

    const accts = db.createObjectStore('accounts', { keyPath: 'id', autoIncrement: true })
    accts.createIndex('by_profile', 'profile_id')

    const budgets = db.createObjectStore('budgets', { keyPath: 'id', autoIncrement: true })
    budgets.createIndex('by_profile', 'profile_id')

    const goals = db.createObjectStore('goals', { keyPath: 'id', autoIncrement: true })
    goals.createIndex('by_profile', 'profile_id')

    const loans = db.createObjectStore('loans', { keyPath: 'id', autoIncrement: true })
    loans.createIndex('by_profile', 'profile_id')

    const bh = db.createObjectStore('balanceHistory', { keyPath: 'id', autoIncrement: true })
    bh.createIndex('by_account', 'account_id')

    const receipts = db.createObjectStore('receipts', { keyPath: 'id', autoIncrement: true })
    receipts.createIndex('by_profile', 'profile_id')
    receipts.createIndex('by_transaction', 'transaction_id')

    db.createObjectStore('settings', { keyPath: 'key' })
  }

  // Version 3: Add portfolio holdings store
  if (oldVersion < 3) {
    const pf = db.createObjectStore('portfolioHoldings', { keyPath: 'id', autoIncrement: true })
    pf.createIndex('by_profile', 'profile_id')
  }
}

let dbPromise: ReturnType<typeof openDB> | null = null

export function getDB() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, { upgrade: upgradeSchema })
  }
  return dbPromise
}

// ---- Seed Data ----

const DEFAULT_CATEGORIES = [
  { type: 'income', name: 'Salary', color: '#22C55E', tax_deductible: false },
  { type: 'income', name: 'Freelance', color: '#16A34A', tax_deductible: false },
  { type: 'income', name: 'Investments', color: '#15803D', tax_deductible: false },
  { type: 'income', name: 'Gifts', color: '#86EFAC', tax_deductible: false },
  { type: 'expense', name: 'Housing', color: '#EF4444', tax_deductible: false },
  { type: 'expense', name: 'Food', color: '#F97316', tax_deductible: false },
  { type: 'expense', name: 'Transportation', color: '#EAB308', tax_deductible: false },
  { type: 'expense', name: 'Utilities', color: '#8B5CF6', tax_deductible: false },
  { type: 'expense', name: 'Healthcare', color: '#EC4899', tax_deductible: true },
  { type: 'expense', name: 'Entertainment', color: '#06B6D4', tax_deductible: false },
  { type: 'expense', name: 'Insurance', color: '#3B82F6', tax_deductible: false },
  { type: 'expense', name: 'Shopping', color: '#D946EF', tax_deductible: false },
  { type: 'expense', name: 'Education', color: '#14B8A6', tax_deductible: true },
  { type: 'expense', name: 'Subscriptions', color: '#F43F5E', tax_deductible: false },
]

export class IndexedDBAdapter implements StorageAdapter {
  private getProfileId(): number {
    const stored = localStorage.getItem('currentProfileId')
    return stored ? parseInt(stored, 10) : 1
  }

  // ---- Profiles ----

  async getCurrentProfileId(): Promise<number> {
    const db = await getDB()
    const profiles = await db.getAll('profiles')
    const profileId = this.getProfileId()
    if (profiles.find((p) => p.id === profileId)) return profileId
    if (profiles.length > 0) {
      localStorage.setItem('currentProfileId', String(profiles[0].id))
      return profiles[0].id
    }
    return this.createProfile('Main Profile')
  }

  async createProfile(name: string): Promise<number> {
    const db = await getDB()
    const id = (await db.add('profiles', { name, created_at: new Date().toISOString() })) as number
    localStorage.setItem('currentProfileId', String(id))
    return id
  }

  async updateProfile(id: number, name: string): Promise<void> {
    const db = await getDB()
    const profile = await db.get('profiles', id)
    if (profile) {
      profile.name = name
      await db.put('profiles', profile)
    }
  }

  async deleteProfile(id: number): Promise<void> {
    const db = await getDB()
    await db.delete('profiles', id)
  }

  // ---- Transactions ----

  async listTransactions(filters?: TransactionFilters): Promise<Transaction[]> {
    const db = await getDB()
    const profileId = await this.getCurrentProfileId()
    let txns = await db.getAllFromIndex('transactions', 'by_profile', profileId)

    if (filters) {
      if (filters.type) txns = txns.filter((t) => t.type === filters.type)
      if (filters.category_id) txns = txns.filter((t) => t.category_id === filters.category_id)
      if (filters.date_from) txns = txns.filter((t) => t.date >= filters.date_from!)
      if (filters.date_to) txns = txns.filter((t) => t.date <= filters.date_to!)
      if (filters.search) {
        const q = filters.search.toLowerCase()
        txns = txns.filter(
          (t) =>
            t.description.toLowerCase().includes(q) ||
            t.notes?.toLowerCase().includes(q) ||
            t.beneficiary?.toLowerCase().includes(q) ||
            t.payor?.toLowerCase().includes(q)
        )
      }
    }

    return txns.sort((a, b) => b.date.localeCompare(a.date))
  }

  async createTransaction(tx: Transaction): Promise<number> {
    const db = await getDB()
    const data = { ...tx }
    if (!data.profile_id) data.profile_id = await this.getCurrentProfileId()
    return (await db.add('transactions', data)) as number
  }

  async updateTransaction(id: number, tx: Partial<Transaction>): Promise<void> {
    const db = await getDB()
    const existing = await db.get('transactions', id)
    if (existing) {
      Object.assign(existing, tx)
      await db.put('transactions', existing)
    }
  }

  async deleteTransaction(id: number): Promise<void> {
    const db = await getDB()
    await db.delete('transactions', id)
  }

  async deleteAllTransactions(): Promise<void> {
    const db = await getDB()
    await db.clear('transactions')
  }

  // ---- Categories ----

  async listCategories(type?: 'income' | 'expense'): Promise<Category[]> {
    const db = await getDB()
    const profileId = await this.getCurrentProfileId()
    let cats = await db.getAllFromIndex('categories', 'by_profile', profileId)
    if (type) cats = cats.filter((c) => c.type === type)
    return cats
  }

  async createCategory(category: Category): Promise<number> {
    const db = await getDB()
    const data = { ...category }
    if (!data.profile_id) data.profile_id = await this.getCurrentProfileId()
    return (await db.add('categories', data)) as number
  }

  async updateCategory(id: number, category: Partial<Category>): Promise<void> {
    const db = await getDB()
    const existing = await db.get('categories', id)
    if (existing) {
      Object.assign(existing, category)
      await db.put('categories', existing)
    }
  }

  async deleteCategory(id: number): Promise<void> {
    const db = await getDB()
    await db.delete('categories', id)
  }

  async deleteAllCategories(): Promise<void> {
    const db = await getDB()
    await db.clear('categories')
  }

  // ---- Accounts ----

  async listAccounts(): Promise<Account[]> {
    const db = await getDB()
    const profileId = await this.getCurrentProfileId()
    return db.getAllFromIndex('accounts', 'by_profile', profileId)
  }

  async createAccount(account: Account): Promise<number> {
    const db = await getDB()
    const data = { ...account }
    if (!data.profile_id) data.profile_id = await this.getCurrentProfileId()
    return (await db.add('accounts', data)) as number
  }

  async updateAccount(id: number, account: Partial<Account>): Promise<void> {
    const db = await getDB()
    const existing = await db.get('accounts', id)
    if (existing) {
      Object.assign(existing, account)
      await db.put('accounts', existing)
    }
  }

  async deleteAccount(id: number): Promise<void> {
    const db = await getDB()
    await db.delete('accounts', id)
  }

  // ---- Budgets ----

  async listBudgets(): Promise<Budget[]> {
    const db = await getDB()
    const profileId = await this.getCurrentProfileId()
    return db.getAllFromIndex('budgets', 'by_profile', profileId)
  }

  async createBudget(budget: Budget): Promise<number> {
    const db = await getDB()
    const data = { ...budget }
    if (!data.profile_id) data.profile_id = await this.getCurrentProfileId()
    return (await db.add('budgets', data)) as number
  }

  async updateBudget(id: number, budget: Partial<Budget>): Promise<void> {
    const db = await getDB()
    const existing = await db.get('budgets', id)
    if (existing) {
      Object.assign(existing, budget)
      await db.put('budgets', existing)
    }
  }

  async deleteBudget(id: number): Promise<void> {
    const db = await getDB()
    await db.delete('budgets', id)
  }

  // ---- Goals ----

  async listGoals(): Promise<Goal[]> {
    const db = await getDB()
    const profileId = await this.getCurrentProfileId()
    return db.getAllFromIndex('goals', 'by_profile', profileId)
  }

  async createGoal(goal: Goal): Promise<number> {
    const db = await getDB()
    const data = { ...goal }
    if (!data.profile_id) data.profile_id = await this.getCurrentProfileId()
    return (await db.add('goals', data)) as number
  }

  async updateGoal(id: number, goal: Partial<Goal>): Promise<void> {
    const db = await getDB()
    const existing = await db.get('goals', id)
    if (existing) {
      Object.assign(existing, goal)
      await db.put('goals', existing)
    }
  }

  async deleteGoal(id: number): Promise<void> {
    const db = await getDB()
    await db.delete('goals', id)
  }

  // ---- Loans ----

  async listLoans(): Promise<Loan[]> {
    const db = await getDB()
    const profileId = await this.getCurrentProfileId()
    return db.getAllFromIndex('loans', 'by_profile', profileId)
  }

  async createLoan(loan: Loan): Promise<number> {
    const db = await getDB()
    const data = { ...loan }
    if (!data.profile_id) data.profile_id = await this.getCurrentProfileId()
    return (await db.add('loans', data)) as number
  }

  async updateLoan(id: number, loan: Partial<Loan>): Promise<void> {
    const db = await getDB()
    const existing = await db.get('loans', id)
    if (existing) {
      Object.assign(existing, loan)
      await db.put('loans', existing)
    }
  }

  async deleteLoan(id: number): Promise<void> {
    const db = await getDB()
    await db.delete('loans', id)
  }

  // ---- Balance History ----

  async getBalanceHistory(accountId: number): Promise<BalanceEntry[]> {
    const db = await getDB()
    return db.getAllFromIndex('balanceHistory', 'by_account', accountId)
  }

  async recordBalance(accountId: number, balance: number): Promise<number> {
    const db = await getDB()
    return (await db.add('balanceHistory', {
      account_id: accountId,
      balance,
      date: new Date().toISOString(),
      notes: '',
    })) as number
  }

  // ---- Settings ----

  async getSettings(): Promise<Settings> {
    const db = await getDB()
    const all = await db.getAll('settings')
    const result: Record<string, unknown> = {
      theme: 'dark',
      language: 'en',
      currency: 'EUR',
      primary_currency: 'EUR',
    }
    for (const s of all) {
      result[s.key] = s.value
    }
    return result as unknown as Settings
  }

  async updateSettings(settings: Partial<Settings>): Promise<void> {
    const db = await getDB()
    for (const [key, value] of Object.entries(settings)) {
      await db.put('settings', { key, value })
    }
  }

  // ---- Transaction wrapper ----

  async transaction<T>(callback: (tx: StorageAdapter) => Promise<T>): Promise<T> {
    return callback(this)
  }

  // ---- Export/Import ----

  async exportData(): Promise<ExportData> {
    const db = await getDB()
    const [transactions, categories, accounts, budgets, goals, loans, settings] = await Promise.all(
      [
        db.getAll('transactions'),
        db.getAll('categories'),
        db.getAll('accounts'),
        db.getAll('budgets'),
        db.getAll('goals'),
        db.getAll('loans'),
        this.getSettings(),
      ]
    )

    return {
      version: '2.0.0',
      export_date: new Date().toISOString(),
      storage_mode: 'serverless',
      profiles: await db.getAll('profiles'),
      categories,
      transactions,
      accounts,
      budgets,
      goals,
      loans,
      settings,
    }
  }

  async importData(data: ExportData): Promise<void> {
    const db = await getDB()
    // Clear existing data
    const stores = [
      'transactions',
      'categories',
      'accounts',
      'budgets',
      'goals',
      'loans',
      'balanceHistory',
      'receipts',
      'profiles',
      'portfolioHoldings',
    ]
    for (const store of stores) {
      await db.clear(store)
    }

    // Import profiles and build ID mapping (old SQLite ID → new IndexedDB ID)
    const profileIdMap = new Map<number, number>()
    if (data.profiles && data.profiles.length > 0) {
      for (const p of data.profiles) {
        const oldId = p.id
        const newId = (await db.add('profiles', {
          name: p.name,
          created_at: p.created_at || new Date().toISOString(),
        })) as number
        profileIdMap.set(oldId, newId)
      }
    }

    // If no profiles in export, create a default one
    if (profileIdMap.size === 0) {
      const defaultId = (await db.add('profiles', {
        name: 'Main Profile',
        created_at: new Date().toISOString(),
      })) as number
      // Map old profile_id=1 (common default) to the new default profile
      profileIdMap.set(1, defaultId)
    }

    // Set current profile to the first imported/new profile
    const firstProfileId = profileIdMap.values().next().value
    if (firstProfileId) {
      localStorage.setItem('currentProfileId', String(firstProfileId))
    }

    // Helper: remap profile_id on imported records
    const remap = <T extends { profile_id?: number }>(record: T): T => {
      if (record.profile_id && typeof record.profile_id === 'number') {
        const mapped = profileIdMap.get(record.profile_id)
        if (mapped !== undefined) {
          record = { ...record, profile_id: mapped }
        } else {
          record = { ...record, profile_id: firstProfileId ?? 1 }
        }
      }
      return record
    }

    // Import data with profile_id remapping
    if (data.categories) for (const c of data.categories) await db.add('categories', remap(c))
    if (data.accounts) for (const a of data.accounts) await db.add('accounts', remap(a))
    if (data.budgets) for (const b of data.budgets) await db.add('budgets', remap(b))
    if (data.goals) for (const g of data.goals) await db.add('goals', remap(g))
    if (data.loans) for (const l of data.loans) await db.add('loans', remap(l))
    if (data.transactions) for (const t of data.transactions) await db.add('transactions', remap(t))
    if (data.portfolioHoldings)
      for (const h of data.portfolioHoldings) await db.add('portfolioHoldings', remap(h))

    // Import settings
    for (const [key, value] of Object.entries(data.settings)) {
      await db.put('settings', { key, value })
    }
  }

  // ---- Cleanup ----

  async clearAllData(): Promise<void> {
    const db = await getDB()
    const stores = [
      'transactions',
      'categories',
      'accounts',
      'budgets',
      'goals',
      'loans',
      'balanceHistory',
      'receipts',
      'profiles',
      'portfolioHoldings',
      'settings',
    ]
    for (const store of stores) {
      await db.clear(store)
    }
  }
}

/** Seed default categories for a first-time profile */
export async function seedDefaultCategories(profileId: number): Promise<void> {
  const db = await getDB()
  const existing = await db.getAllFromIndex('categories', 'by_profile', profileId)
  if (existing.length > 0) return // Already seeded

  for (const cat of DEFAULT_CATEGORIES) {
    await db.add('categories', { ...cat, profile_id: profileId })
  }
}
