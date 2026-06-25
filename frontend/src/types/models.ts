/**
 * Finance Manager TypeScript Type Definitions
 * Based on database schema and API responses
 */

// ============ BASIC TYPES ============
export type ProfileId = number
export type TransactionId = number
export type CategoryId = number
export type AccountId = number
export type LoanId = number
export type GoalId = number
export type BillId = number

export type Currency = 'USD' | 'EUR' | 'GBP' | 'CAD' | 'AUD' | 'JPY'
export type TransactionType = 'income' | 'expense' | 'transfer'
export type BudgetPeriod = 'monthly' | 'weekly' | 'yearly'
export type AccountType = 'giro' | 'savings' | 'ib' | 'cash'

export type PageName =
  | 'dashboard'
  | 'transactions'
  | 'budgets'
  | 'loans'
  | 'goals'
  | 'bills'
  | 'import'
  | 'accounts'
  | 'categories'
  | 'settings'
  | 'retirement'
  | 'housing'
  | 'analytics'
  | 'compound'
  | 'emergency'
  | 'rentBuy'
  | 'counterparties'
  | 'portfolio'

// ============ PROFILE ============
export interface Profile {
  id: ProfileId
  name: string
  created_at: string
}

// ============ TRANSACTIONS ============
export interface Transaction {
  id: TransactionId
  description: string
  amount: number
  date: string
  beneficiary: string
  payor: string
  category_id: CategoryId | null
  currency: Currency
  amount_local: number | null
  exchange_rate: number
  type: TransactionType
  notes: string
  created_at: string
  updated_at: string
  profile_id: ProfileId
  account_id?: number | null
  transfer_account_id?: number | null
  category_name?: string | null
  category_color?: string | null
  reconciled?: boolean
  means_of_payment?: string | null
  tags?: Array<{ id: number; name: string; color: string }>
  receipt_id?: number | null
  receipt_name?: string | null
}

// ============ CATEGORIES ============
export interface Category {
  id: CategoryId
  name: string
  color: string
  icon: string
  type: TransactionType
  parent_id: CategoryId | null
  tax_deductible: boolean
  created_at: string
  profile_id: ProfileId
  parent_name?: string | null
}

export interface CategoryMapping {
  id: number
  pattern: string
  category_id: CategoryId
  confidence: number
  use_count: number
  profile_id: ProfileId
  category_name?: string
  category_color?: string
}

// ============ ACCOUNTS ============
export interface Account {
  id: AccountId
  name: string
  bank_name?: string | null
  type: AccountType
  currency: Currency
  balance: number
  notes?: string | null
  profile_id: ProfileId
  starting_balance?: number | null
  starting_date?: string | null
}

// ============ BUDGETS ============
export interface Budget {
  id: number
  category_id: CategoryId
  amount: number
  period: BudgetPeriod
  start_date: string
  end_date: string | null
  created_at: string
  profile_id: ProfileId
}

export interface CategoryAllocation {
  category_id: CategoryId
  category_name: string
  category_color: string
  category_icon: string | null
  budgeted: number
  spent: number
  remaining_budget: number
  percent_used: number
  status: 'ok' | 'warning' | 'over'
  can_allocate: boolean
  is_budgeted: boolean
  is_fully_allocated: boolean
}

export interface BudgetImprovement {
  month: string
  adherence_pct: number
  total_budget: number
  total_spent: number
}

export interface ZeroBasedAllocation {
  category_id: CategoryId
  category_name: string
  category_color: string
  amount: number
  allocated: number
  spent: number
  remaining: number
  percent_used: number
  status: 'ok' | 'warning' | 'over'
  is_fully_allocated: boolean
}

export interface BudgetSummaryResponse {
  total_budget: number
  total_spent: number
  total_remaining: number
  adherence_pct: number
  allocations: ZeroBasedAllocation[]
}

export interface ZeroBasedResponse {
  allocations: ZeroBasedAllocation[]
  categories: ZeroBasedAllocation[]
  summary: BudgetSummaryResponse
}

// ============ SAVINGS GOALS ============
export interface SavingsGoal {
  id: GoalId
  name: string
  target_amount: number
  current_amount: number
  deadline: string | null
  notes?: string | null
  created_at: string
  profile_id: ProfileId
}

// ============ LOANS ============
export interface Loan {
  id: LoanId
  name: string
  principal: number
  interest_rate: number
  start_date: string
  term_months: number
  created_at: string
  profile_id: ProfileId
}

export interface LoanRatePeriod {
  id: number
  loan_id: LoanId
  rate: number
  start_month: number
  end_month: number | null
}

export interface LoanPrepayment {
  id: number
  loan_id: LoanId
  month: number
  amount: number
  note: string
}

export interface LoanDetail extends Loan {
  prepayments: LoanPrepayment[]
  rate_periods: LoanRatePeriod[]
  monthly_payment: number
  remaining_balance: number
  total_paid: number
  total_interest: number
}

// ============ RECURRING TRANSACTIONS ============
export interface RecurringTransaction {
  id: number
  description: string
  amount: number
  type: TransactionType
  frequency: 'daily' | 'weekly' | 'monthly' | 'yearly'
  next_date: string | null
  category_id: CategoryId | null
  category_name: string | null
  category_color: string | null
  day_of_month: number | null
  notes: string | null
  profile_id: ProfileId
}

// ============ BILLS ============
export interface Bill {
  id: BillId
  name: string
  amount: number
  due_date: string
  category_id: CategoryId | null
  recurring: boolean
  last_paid_date: string | null
  next_due_date: string | null
  profile_id: ProfileId
}

// ============ SETTINGS ============
export interface Setting {
  key: string
  value: string
  profile_id: ProfileId | null
}

export interface Settings {
  local_currency?: Currency
  theme?: 'light' | 'dark'
  [key: string]: unknown
}

export interface NotificationSettings {
  email: string
  emailNotifications: boolean
  budgetAlerts: boolean
  billsReminders: boolean
  spendingReport: boolean
}

// ============ EMERGENCY FUND ============
export interface EmergencyFundConfig {
  monthly_expenses: number
  profile_id: ProfileId
}

// ============ IMPORT / EXPORT ============
export interface ImportResult {
  success: boolean
  transactions: number
  errors: ImportError[]
}

export interface ImportError {
  row: number
  description: string
  fields?: Record<string, string>
}

// ============ RESPONSE TYPES ============
export interface PaginatedResponse<T> {
  items: T[]
  total: number
  page: number
  perPage: number
}

// ============ DASHBOARD METRICS ============
export interface DashboardMetrics {
  totalIncome: number
  totalExpenses: number
  balance: number
  incomeByCategory: CategoryBalance[]
  expenseByCategory: CategoryBalance[]
  recentTransactions: Transaction[]
  upcomingBills: Bill[]
  // MoM delta fields
  momIncomeDelta?: number
  momExpenseDelta?: number
  momBalanceDelta?: number
}

export interface DashboardMonthMetrics {
  month: string
  income: number
  expenses: number
  balance: number
  incomeByCategory: CategoryBalance[]
  expenseByCategory: CategoryBalance[]
}

export interface DashboardChartData {
  labels: string[]
  income: number[]
  expenses: number[]
  netWorth: number[]
}

export interface DashboardChartsResponse {
  byCategory: { name: string; color: string; icon: string; total: number; count: number }[]
  monthly: { month: string; income: number; expense: number }[]
  cashFlow: { month: string; income: number; expense: number; cumulative: number }[]
  currency: string
}

export interface NetWorthResponse {
  totalNetWorth: number
  timeline: { month: string; balance: number; netChange: number }[]
}

export interface CategoryBalance {
  category_id: CategoryId
  category_name: string
  category_color: string
  amount: number
}

// ============ ANALYTICS ============
export interface AnalyticsSummary {
  monthlySpending: MonthData[]
  categoryBreakdown: { category_name: string; amount: number; color: string }[]
  transactionCount: number
  totalIncome: number
  totalExpense: number
}

export interface MonthData {
  month: string
  income: number
  expense: number
}

// ============ RETIREMENT ============
export interface RetirementProjection {
  currentAge: number
  retirementAge: number
  lifeExpectancy: number
  currentSavings: number
  monthlyContribution: number
  currentAnnualIncome: number
  annualReturn: number
  inflationRate: number
  monthlyExpenses: number
  expectedRetirementYears: number
  retirementSavings: number
  monthlyWithdrawal: number
  current_amount: number
  projected_total: number
}

// ============ HOUSING CALCULATOR ============
export interface HousingCalculation {
  grossIncome: number
  livingExpenses: number
  transportCost: number
  utilitiesCost: number
  savingsTarget: number
  housingRatio: number
  affordableRent: number
  recommendedRent: number
  monthlySpendingBreakdown: HousingCategory[]
}

export interface HousingCategory {
  name: string
  amount: number
  percentage: number
}

// ============ BALANCE HISTORY ============
export interface BalanceHistory {
  id: number
  account_id: AccountId
  balance: number
  recorded_at: string
  notes?: string
}

// ============ RECEIPTS ============
export interface Receipt {
  id: number
  transaction_id: TransactionId | null
  filename: string
  original_name: string
  file_type: string
  file_size: number
  storage_path: string
  uploaded_at: string
  profile_id: ProfileId
  transaction?: Transaction
}

// ============ PORTFOLIO ============
export interface PortfolioHolding {
  id: number
  ticker: string
  shares: number
  // Stored columns are snake_case (the API returns raw DB rows since the backend
  // no longer camelCases responses).
  purchase_price: number
  purchase_date: string
  notes: string
  created_at: string
  profile_id: ProfileId
  // Computed by the backend at read time — these stay camelCase.
  currentPrice?: number
  marketValue?: number
  costBasis?: number
  gain?: number
  gainPercent?: number
}

export interface PortfolioSummary {
  totalValue: number
  totalCostBasis: number
  totalGain: number
  totalGainPercent: number
  holdings: PortfolioHolding[]
  allocation: { ticker: string; value: number; shares: number; percentage: number }[]
}

export interface StockPrice {
  price: number
  change: number
  changePercent: number
  dayHigh?: number
  dayLow?: number
  name?: string
}

// ============ ANALYTICS RESPONSES ============
export interface CategoryTrendItem {
  category_name: string
  category_color: string
  total: number
  count: number
  month?: string
}

export interface WeeklyTrendItem {
  week_start: string
  income: number
  expense: number
  count: number
}

export interface TransactionSummaryItem {
  type: string
  total: number
  count: number
}

export interface SankeyData {
  nodes: Array<{ name: string; category: string; color?: string }>
  links: Array<{ source: string | number; target: string | number; value: number }>
}

export interface AnalyticsApiResponse {
  weeks?: WeeklyTrendItem[]
  trends?: CategoryTrendItem[]
  categories?: CategoryTrendItem[]
  summary?: TransactionSummaryItem[]
  monthly?: Array<Record<string, unknown>>
  items?: Transaction[]
  transactions?: Transaction[]
  sankey?: SankeyData
  [key: string]: unknown
}

// ============ COMPONENT TYPES ============
import type { Component } from 'solid-js'

export type PageComponent = Component
