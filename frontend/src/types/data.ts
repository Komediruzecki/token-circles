/**
 * Data store structure for LocalStorage adapter
 */

export interface DataStore {
  profiles: Record<number, ProfileData>
  categories: Record<number, CategoryData>
  transactions: Record<number, TransactionData>
  accounts: Record<number, AccountData>
  budgets: Record<number, BudgetData>
  goals: Record<number, GoalData>
  loans: Record<number, LoanData>
  balanceHistory: Record<number, BalanceEntryData>
  settings: SettingsData
}

export interface ProfileData {
  id: number
  name: string
  created_at: string
  updated_at: string
}

export interface CategoryData {
  id: number
  profile_id: number
  type: 'income' | 'expense'
  name: string
  color: string
  tax_deductible: boolean
}

export interface TransactionData {
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
  beneficiary: string
  payor: string
  date: string
  means: string
  notes: string
  tags: string[]
}

export interface AccountData {
  id: number
  profile_id: number
  name: string
  type: 'giro' | 'ib' | 'savings'
  currency: string
  balance: number
  notes: string
}

export interface BudgetData {
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

export interface GoalData {
  id: number
  profile_id: number
  name: string
  target_amount: number
  current_amount: number
  deadline: string
  notes: string
}

export interface LoanData {
  id: number
  profile_id: number
  name: string
  principal: number
  interest_rate: number
  start_date: string
  term_months: number
  rate_periods: LoanRatePeriodData[]
  prepayments: LoanPrepaymentData[]
}

export interface LoanRatePeriodData {
  id: number
  rate: number
  start_month: number
  end_month?: number
}

export interface LoanPrepaymentData {
  id: number
  month: number
  amount: number
  note: string
}

export interface BalanceEntryData {
  id: number
  account_id: number
  balance: number
  date: string
  notes: string
}

export interface SettingsData {
  theme: 'light' | 'dark'
  language: string
  currency: string
  primary_currency: string
}
