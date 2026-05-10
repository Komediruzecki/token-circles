/**
 * Storage Adapter Interface
 * Abstracts storage operations to support multiple backends (localStorage, SQLite, etc.)
 */

import type { BalanceEntryData } from './data.js'

export interface StorageAdapter {
  // Profile management
  getCurrentProfileId(): Promise<number>
  createProfile(name: string): Promise<number>
  updateProfile(id: number, name: string): Promise<void>
  deleteProfile(id: number): Promise<void>

  // Transaction management
  listTransactions(filters?: TransactionFilters): Promise<Transaction[]>
  createTransaction(tx: Transaction): Promise<number>
  updateTransaction(id: number, tx: Partial<Transaction>): Promise<void>
  deleteTransaction(id: number): Promise<void>
  deleteAllTransactions(): Promise<void>

  // Category management
  listCategories(type?: 'income' | 'expense'): Promise<Category[]>
  createCategory(category: Category): Promise<number>
  updateCategory(id: number, category: Partial<Category>): Promise<void>
  deleteCategory(id: number): Promise<void>
  deleteAllCategories(): Promise<void>

  // Account management
  listAccounts(): Promise<Account[]>
  createAccount(account: Account): Promise<number>
  updateAccount(id: number, account: Partial<Account>): Promise<void>
  deleteAccount(id: number): Promise<void>

  // Budget management
  listBudgets(): Promise<Budget[]>
  createBudget(budget: Budget): Promise<number>
  updateBudget(id: number, budget: Partial<Budget>): Promise<void>
  deleteBudget(id: number): Promise<void>

  // Savings goal management
  listGoals(): Promise<Goal[]>
  createGoal(goal: Goal): Promise<number>
  updateGoal(id: number, goal: Partial<Goal>): Promise<void>
  deleteGoal(id: number): Promise<void>

  // Loan management
  listLoans(): Promise<Loan[]>
  createLoan(loan: Loan): Promise<number>
  updateLoan(id: number, loan: Partial<Loan>): Promise<void>
  deleteLoan(id: number): Promise<void>

  // Transaction history (accounts)
  getBalanceHistory(accountId: number): Promise<BalanceEntry[]>
  recordBalance(accountId: number, balance: number): Promise<number>

  // Settings
  getSettings(): Promise<Settings>
  updateSettings(settings: Partial<Settings>): Promise<void>

  // Transaction (ACID)
  transaction<T>(callback: (tx: StorageAdapter) => Promise<T>): Promise<T>

  // Export/Import
  exportData(): Promise<ExportData>
  importData(data: ExportData): Promise<void>

  // Cleanup
  clearAllData(): Promise<void>
}

export interface TransactionFilters {
  date_from?: string
  date_to?: string
  category_id?: number
  type?: 'income' | 'expense' | 'transfer'
  search?: string
}

export interface Transaction {
  id: number
  profile_id: number
  type: 'income' | 'expense' | 'transfer'
  description: string
  amount: number
  currency: string
  local_currency?: string
  exchange_rate?: number
  category_id?: number
  account_id?: number
  transfer_account_id?: number
  beneficiary: string
  payor: string
  date: string
  means: string
  notes: string
  tags: string[]
  reconciled?: number
  reconciled_at?: string
}

export interface Category {
  id: number
  profile_id: number
  type: 'income' | 'expense'
  name: string
  color: string
  icon: string
  tax_deductible: boolean
}

export interface Account {
  id: number
  profile_id: number
  name: string
  type: 'giro' | 'ib' | 'savings'
  currency: string
  balance: number
  notes: string
  starting_balance?: number
  starting_date?: string
}

export interface Budget {
  id: number
  profile_id: number
  category_id: number
  amount: number
  period: 'monthly' | 'weekly' | 'yearly'
  start_date: string
  end_date?: string
  rollover_enabled: boolean
  rollover_amount: number
}

export interface Goal {
  id: number
  profile_id: number
  name: string
  target_amount: number
  current_amount: number
  deadline: string
  notes: string
}

export interface Loan {
  id: number
  profile_id: number
  name: string
  principal: number
  start_date: string
  term_months: number
  rate_periods: LoanRatePeriod[]
  prepayments: LoanPrepayment[]
}

export interface LoanRatePeriod {
  rate: number
  start_month: number
  end_month?: number
}

export interface LoanPrepayment {
  month: number
  amount: number
  note: string
}

export interface BalanceEntry {
  id: number
  account_id: number
  balance: number
  date: string
  notes: string
}

export interface Settings {
  theme: 'light' | 'dark'
  language: string
  currency: string
  primary_currency: string
  local_currency?: string
  [key: string]: unknown
}

export interface ExportData {
  version: string
  export_date: string
  storage_mode: 'serverless' | 'self-hosted'

  profiles: ExportProfile[]
  categories: ExportCategory[]
  transactions: ExportTransaction[]
  accounts: ExportAccount[]
  budgets: ExportBudget[]
  goals: ExportGoal[]
  loans: ExportLoan[]
  retirementGoals?: ExportGoal[]

  settings: ExportSettings

  balanceHistory?: Record<number, BalanceEntryData>
}

export interface ExportProfile {
  id: number
  name: string
  created_at: string
  updated_at: string
}

export interface ExportCategory {
  id: number
  profile_id: number
  type: 'income' | 'expense'
  name: string
  color: string
  tax_deductible: boolean
}

export type ExportTransaction = Transaction

export type ExportAccount = Account

export type ExportBudget = Budget

export type ExportGoal = Goal

export type ExportLoan = Loan

export type ExportSettings = Settings
