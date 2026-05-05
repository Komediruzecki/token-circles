/**
 * LocalStorage Adapter - Serverless Mode Storage
 * Stores all data in browser localStorage with automatic saving
 */

import type {
  AccountData,
  BalanceEntryData,
  BudgetData,
  CategoryData,
  DataStore,
  GoalData,
  LoanData,
  LoanPrepaymentData,
  LoanRatePeriodData,
  ProfileData,
  SettingsData,
  TransactionData,
} from '@/types/data'
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
} from '@/types/storage'

const STORAGE_KEY = 'finance_data'
const PROFILE_ID_KEY = 'finance_profile_id'
const VERSION_KEY = 'finance_version'

// Data store structure
let data: DataStore = {
  profiles: {},
  categories: {},
  transactions: {},
  accounts: {},
  budgets: {},
  goals: {},
  loans: {},
  balanceHistory: {},
  settings: {
    theme: 'light',
    language: 'en',
    currency: 'USD',
    primary_currency: 'USD',
  },
}

// Profile counter for generating IDs
let profileCounter = 1

// Counter for generating IDs
const counters: Record<string, number> = {
  categories: 1,
  transactions: 1,
  accounts: 1,
  budgets: 1,
  goals: 1,
  loans: 1,
  balanceHistory: 1,
}

/**
 * Internal helper to create a profile without checking current ID
 * Used by getCurrentProfileId to avoid circular dependencies
 */
function createProfileInternal(name: string): number {
  const id = profileCounter++
  const profile: ProfileData = {
    id,
    name,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }

  data.profiles[id] = profile
  saveData()

  // Create default categories
  createDefaultCategories(id)

  // Seed sample data for this profile
  seedSampleData(id)

  return id
}

/**
 * Load data from localStorage
 */
function loadData(): void {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored !== null) {
      const parsed = JSON.parse(stored) as Partial<DataStore>
      data = {
        ...data,
        profiles: parsed.profiles || {},
        categories: parsed.categories || {},
        transactions: parsed.transactions || {},
        accounts: parsed.accounts || {},
        budgets: parsed.budgets || {},
        goals: parsed.goals || {},
        loans: parsed.loans || {},
        balanceHistory: parsed.balanceHistory || {},
        settings: parsed.settings || data.settings,
      }

      // Initialize counters from data
      if (Object.keys(data.profiles).length > 0) {
        const ids = Object.values(data.profiles).map((p) => p.id)
        profileCounter = Math.max(...ids, 0) + 1
      }

      counters.categories = Math.max(...Object.values(data.categories).map((c) => c.id), 0) + 1
      counters.transactions = Math.max(...Object.values(data.transactions).map((t) => t.id), 0) + 1
      counters.accounts = Math.max(...Object.values(data.accounts).map((a) => a.id), 0) + 1
      counters.budgets = Math.max(...Object.values(data.budgets).map((b) => b.id), 0) + 1
      counters.goals = Math.max(...Object.values(data.goals).map((g) => g.id), 0) + 1
      counters.loans = Math.max(...Object.values(data.loans).map((l) => l.id), 0) + 1
      counters.balanceHistory =
        Math.max(...Object.values(data.balanceHistory).map((b) => b.id), 0) + 1
    }
  } catch (error) {
    console.error('Failed to load data from localStorage:', error)
    // Reset to default if corrupted
    resetToDefaults()
  }
}

/**
 * Save data to localStorage
 */
function saveData(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
    localStorage.setItem(VERSION_KEY, '2.0')
  } catch (error) {
    if (error instanceof DOMException && error.name === 'QuotaExceededError') {
      console.error('LocalStorage quota exceeded. Clear some data or increase storage size.')
    } else {
      console.error('Failed to save data to localStorage:', error)
    }
  }
}

/**
 * Get a profile by ID
 */
function getProfile(id: number): ProfileData | null {
  return data.profiles[id] ?? null
}

/**
 * Get all profiles for a profile ID filter
 */
function getProfiles(filterId?: number): ProfileData[] {
  return Object.values(data.profiles).filter((p) => !filterId || p.id === filterId)
}

/**
 * Create a new profile
 */
function createProfileData(name: string): ProfileData {
  const id = profileCounter++
  const profile: ProfileData = {
    id,
    name,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }

  data.profiles[id] = profile
  saveData()

  // Create default categories
  createDefaultCategories(id)

  return profile
}

/**
 * Update a profile
 */
function updateProfileData(id: number, name: string): void {
  const profile = getProfile(id)
  if (!profile) {
    throw new Error(`Profile ${id} not found`)
  }

  profile.name = name
  profile.updated_at = new Date().toISOString()
  data.profiles[id] = profile
  saveData()
}

/**
 * Delete a profile
 */
function deleteProfileData(id: number): void {
  if (!data.profiles[id]) {
    throw new Error(`Profile ${id} not found`)
  }

  // Delete all related data
  Object.keys(data.categories).forEach((key) => {
    const cat = data.categories[Number(key)]
    if (cat.profile_id === id) {
      data.categories[Number(key)] = undefined as any
    }
  })

  Object.keys(data.transactions).forEach((key) => {
    const tx = data.transactions[Number(key)]
    if (tx.profile_id === id) {
      data.transactions[Number(key)] = undefined as any
    }
  })

  Object.keys(data.accounts).forEach((key) => {
    const acc = data.accounts[Number(key)]
    if (acc.profile_id === id) {
      data.accounts[Number(key)] = undefined as any
    }
  })

  Object.keys(data.budgets).forEach((key) => {
    const budget = data.budgets[Number(key)]
    if (budget.profile_id === id) {
      // @ts-expect-error - Allow undefined assignment for clean up
      data.budgets[Number(key)] = undefined
    }
  })

  Object.keys(data.goals).forEach((key) => {
    const goal = data.goals[Number(key)]
    if (goal.profile_id === id) {
      // @ts-expect-error - Allow undefined assignment for clean up
      data.goals[Number(key)] = undefined
    }
  })

  Object.keys(data.loans).forEach((key) => {
    const loan = data.loans[Number(key)]
    if (loan.profile_id === id) {
      // @ts-expect-error - Allow undefined assignment for clean up
      data.loans[Number(key)] = undefined
    }
  })

  Object.keys(data.balanceHistory).forEach((key) => {
    const entry = data.balanceHistory[Number(key)]
    if (entry.account_id) {
      // Balance history is per account, not per profile
      // Check if account belongs to this profile
      const account = Object.values(data.accounts).find((a) => a.id === entry.account_id)
      if (account && account.profile_id === id) {
        // @ts-expect-error - Allow undefined assignment for clean up
        data.balanceHistory[Number(key)] = undefined
      }
    }
  })

  // @ts-expect-error - Allow undefined assignment for clean up
  data.profiles[id] = undefined
  saveData()
}

/**
 * Create default categories for a profile
 * Uses the same 26 categories as the SQL database (22 expense + 4 income)
 */
function createDefaultCategories(profileId: number): void {
  const categories = [
    // Income categories
    ['Salary Income', '#059669'],
    ['Passive Income', '#2563eb'],
    ['Investment Income', '#4f46e5'],
    ['Other Income', '#9333ea'],
    // Expense categories
    ['Rent / Mortgage', '#dc2626'],
    ['Utilities', '#475569'],
    ['Groceries', '#ea580c'],
    ['Clothing', '#7c3aed'],
    ['Household Items', '#0891b2'],
    ['Emergency Fund', '#dc2626'],
    ['Investments / Stocks / ETF', '#16a34a'],
    ['Car', '#d97706'],
    ['Car Maintenance', '#b45309'],
    ['Food / Eating Out / Restaurants', '#f97316'],
    ['Health', '#16a34a'],
    ['Subscriptions', '#0891b2'],
    ['Transportation', '#6366f1'],
    ['Travel / Vacation', '#0d9488'],
    ['Education', '#db2777'],
    ['Entertainment', '#8b5cf6'],
    ['Personal Care', '#e11d48'],
    ['Insurance', '#64748b'],
    ['Gifts / Donations', '#ec4899'],
  ]

  categories.forEach(([name, color]) => {
    createCategoryData(profileId, 'expense', name, color)
  })

  // Add income categories
  const incomeCategories = ['Salary', 'Freelance', 'Investments', 'Other Income']
  incomeCategories.forEach((name, index) => {
    const colors = ['#22c55e', '#10b981', '#06b6d4', '#6366f1']
    createCategoryData(profileId, 'income', name, colors[index])
  })
}

/**
 * Seed sample data for a profile
 * Generates similar data to the SQL database's seedProfileData function
 */
function seedSampleData(profileId: number): void {
  // Get category IDs
  const categories = getCategoriesForProfile(profileId, 'expense')
  const categoryMap: Record<string, number> = {}
  categories.forEach((c) => {
    categoryMap[c.name] = c.id
  })

  // Get income category IDs
  const incomeCategories = getCategoriesForProfile(profileId, 'income')
  incomeCategories.forEach((c) => {
    categoryMap[c.name] = c.id
  })

  // Generate sample transactions (last 6 months)
  const now = new Date()
  const startMonth = new Date(now.getFullYear(), now.getMonth() - 6, 1)

  for (let i = 0; i < 60; i++) {
    const daysAgo = Math.floor(Math.random() * 180)
    const date = new Date(startMonth)
    date.setDate(date.getDate() + daysAgo)
    const dateStr = date.toISOString().split('T')[0]

    const random = Math.random()

    // Income
    if (random < 0.1) {
      const descriptions = [
        'Salary Deposit',
        'Passive Income - Rental Property',
        'Investment Dividend',
        'Year-End Bonus',
      ]
      const amounts = [
        Math.random() * 100 + 500,
        Math.random() * 200 + 100,
        Math.random() * 100 + 50,
        Math.random() * 2000 + 500,
      ]
      const idx = Math.floor(Math.random() * 4)
      createTransactionData({
        id: counters.transactions++,
        description: descriptions[idx],
        amount: amounts[idx],
        date: dateStr,
        type: 'income',
        profile_id: profileId,
        currency: 'USD',
        local_currency: 'USD',
        exchange_rate: 1,
        category_id: undefined,
        account_id: undefined,
        beneficiary: 'Employer',
        payor: 'Employer',
        means: 'giro',
        notes: descriptions[idx],
        tags: [],
      })
    }
    // Rent/Mortgage
    else if (random < 0.25) {
      createTransactionData({
        id: counters.transactions++,
        description: 'Rent Payment',
        amount: Math.random() * 500 + 800,
        date: dateStr,
        type: 'expense',
        profile_id: profileId,
        currency: 'USD',
        local_currency: 'USD',
        exchange_rate: 1,
        category_id: undefined,
        account_id: undefined,
        beneficiary: 'Property Management Co',
        payor: 'Landlord',
        means: 'giro',
        notes: 'Monthly rent payment',
        tags: [],
      })
    }
    // Food
    else if (random < 0.45) {
      const foodTypes = ['Grocery Shopping', 'Restaurant / Takeout', 'Coffee / Lunch']
      const idx = Math.floor(Math.random() * foodTypes.length)
      createTransactionData({
        id: counters.transactions++,
        description: foodTypes[idx],
        amount: Math.random() * 50 + 20,
        date: dateStr,
        type: 'expense',
        profile_id: profileId,
        currency: 'USD',
        local_currency: 'USD',
        exchange_rate: 1,
        category_id: undefined,
        account_id: undefined,
        beneficiary: 'Store',
        payor: 'Store',
        means: 'giro',
        notes: foodTypes[idx],
        tags: [],
      })
    }
    // Utilities
    else if (random < 0.6) {
      const utilities = [
        'Electricity Bill',
        'Natural Gas Bill',
        'Water & Sewer',
        'Internet Service',
      ]
      const idx = Math.floor(Math.random() * utilities.length)
      createTransactionData({
        id: counters.transactions++,
        description: utilities[idx],
        amount: Math.random() * 100 + 30,
        date: dateStr,
        type: 'expense',
        profile_id: profileId,
        currency: 'USD',
        local_currency: 'USD',
        exchange_rate: 1,
        category_id: undefined,
        account_id: undefined,
        beneficiary: 'Utility Company',
        payor: 'Utility Company',
        means: 'giro',
        notes: utilities[idx],
        tags: [],
      })
    }
    // Transportation
    else if (random < 0.7) {
      const description = Math.random() < 0.5 ? 'Gas Station' : 'Car Maintenance / Service'
      createTransactionData({
        id: counters.transactions++,
        description,
        amount: Math.random() * 60 + 30,
        date: dateStr,
        type: 'expense',
        profile_id: profileId,
        currency: 'USD',
        local_currency: 'USD',
        exchange_rate: 1,
        category_id: undefined,
        account_id: undefined,
        beneficiary: 'Gas Station',
        payor: 'Gas Station',
        means: 'giro',
        notes: description,
        tags: [],
      })
    }
    // Subscriptions
    else if (random < 0.8) {
      const subs = ['Netflix Subscription', 'Spotify Premium', 'Gym Membership', 'Online News Sub']
      const idx = Math.floor(Math.random() * subs.length)
      createTransactionData({
        id: counters.transactions++,
        description: subs[idx],
        amount: Math.random() * 20 + 10,
        date: dateStr,
        type: 'expense',
        profile_id: profileId,
        currency: 'USD',
        local_currency: 'USD',
        exchange_rate: 1,
        category_id: undefined,
        account_id: undefined,
        beneficiary: 'Subscription Service',
        payor: 'Subscription Service',
        means: 'giro',
        notes: subs[idx],
        tags: [],
      })
    }
    // Entertainment
    else if (random < 0.9) {
      const ent = ['Movie Theater', 'Concert / Event', 'Sports Game']
      const idx = Math.floor(Math.random() * ent.length)
      createTransactionData({
        id: counters.transactions++,
        description: ent[idx],
        amount: Math.random() * 80 + 20,
        date: dateStr,
        type: 'expense',
        profile_id: profileId,
        currency: 'USD',
        local_currency: 'USD',
        exchange_rate: 1,
        category_id: undefined,
        account_id: undefined,
        beneficiary: 'Entertainment Venue',
        payor: 'Entertainment Venue',
        means: 'giro',
        notes: ent[idx],
        tags: [],
      })
    }
    // Miscellaneous
    else {
      createTransactionData({
        id: counters.transactions++,
        description: 'Miscellaneous Purchase',
        amount: Math.random() * 40 + 10,
        date: dateStr,
        type: 'expense',
        profile_id: profileId,
        currency: 'USD',
        local_currency: 'USD',
        exchange_rate: 1,
        category_id: undefined,
        account_id: undefined,
        beneficiary: 'Merchant',
        payor: 'Merchant',
        means: 'giro',
        notes: 'Miscellaneous',
        tags: [],
      })
    }
  }

  // Generate sample accounts
  const accountNames = ['Checking Account', 'Savings Account']
  const accountTypes: ['giro', 'savings', 'ib'] = ['giro', 'savings', 'ib']
  accountNames.forEach((name) => {
    createAccountData(
      name,
      accountTypes[Math.floor(Math.random() * accountTypes.length)],
      'USD',
      Math.random() * 10000 + 1000,
      profileId,
      'Sample account'
    )
  })

  // Generate sample savings goals
  const goals = [
    { name: 'Emergency Fund', target: 10000, current: 5000 },
    { name: 'Vacation Fund', target: 3000, current: 1500 },
    { name: 'New Car', target: 25000, current: 8000 },
  ]
  goals.forEach((goal) => {
    createGoalData({
      id: counters.goals++,
      name: goal.name,
      target_amount: goal.target,
      current_amount: goal.current,
      deadline: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000 * (Math.random() * 2 + 1))
        .toISOString()
        .split('T')[0],
      notes: `Savings goal for ${goal.name}`,
      profile_id: profileId,
    })
  })

  // Generate sample loans
  const loans = [
    { name: 'Car Loan', principal: 15000, rate: 5.5, start_date: '2024-01-01', term_months: 48 },
  ]
  loans.forEach((loan) => {
    createLoanData({
      id: counters.loans++,
      name: loan.name,
      principal: loan.principal,
      start_date: loan.start_date,
      term_months: loan.term_months,
      rate_periods: [{ id: 1, rate: loan.rate, start_month: 0, end_month: loan.term_months }],
      prepayments: [],
      profile_id: profileId,
    })
  })
}

/**
 * Get categories for a profile
 */
function getCategories(filterProfileId?: number, type?: 'income' | 'expense'): CategoryData[] {
  let categories = Object.values(data.categories)

  if (filterProfileId !== undefined) {
    categories = categories.filter((c) => c.profile_id === filterProfileId)
  }

  if (type !== undefined) {
    categories = categories.filter((c) => c.type === type)
  }

  return categories
}

/**
 * Create a category
 */
function createCategoryData(
  profileId: number,
  type: 'income' | 'expense',
  name: string,
  color: string
): CategoryData {
  const id = counters.categories++
  const category: CategoryData = {
    id,
    profile_id: profileId,
    type,
    name,
    color,
    tax_deductible: type === 'expense',
  }

  data.categories[id] = category
  saveData()

  return category
}

/**
 * Update a category
 */
function updateCategoryData(id: number, category: Partial<CategoryData>): void {
  const existing = data.categories[id]
  if (!existing) {
    throw new Error(`Category ${id} not found`)
  }

  Object.assign(existing, category)
  data.categories[id] = existing
  saveData()
}

/**
 * Delete a category
 */
function deleteCategoryData(id: number): void {
  if (!data.categories[id]) {
    throw new Error(`Category ${id} not found`)
  }

  // @ts-expect-error - Allow undefined assignment for clean up
  data.categories[id] = undefined
  saveData()
}

/**
 * Get all categories for a profile and type filter
 */
function getCategoriesForProfile(profileId: number, type?: 'income' | 'expense'): CategoryData[] {
  return getCategories(profileId, type)
}

/**
 * Get all transactions for a profile with optional filters
 */
function getTransactions(
  filterProfileId?: number,
  filters?: TransactionFilters
): TransactionData[] {
  let transactions = Object.values(data.transactions)

  if (filterProfileId !== undefined) {
    transactions = transactions.filter((t) => t.profile_id === filterProfileId)
  }

  if (filters !== undefined) {
    if ((filters as TransactionFilters).date_from !== undefined) {
      const dateFrom = (filters as TransactionFilters).date_from
      if (dateFrom !== undefined) {
        transactions = transactions.filter((t) => t.date >= dateFrom)
      }
    }

    if ((filters as TransactionFilters).date_to !== undefined) {
      const dateTo = (filters as TransactionFilters).date_to
      if (dateTo !== undefined) {
        transactions = transactions.filter((t) => t.date <= dateTo)
      }
    }

    if (filters.category_id !== undefined) {
      transactions = transactions.filter((t) => t.category_id === filters.category_id)
    }

    if (filters.type !== undefined) {
      transactions = transactions.filter((t) => t.type === filters.type)
    }

    if (filters.search !== undefined) {
      const searchLower = filters.search.toLowerCase()
      transactions = transactions.filter(
        (t) =>
          t.description.toLowerCase().includes(searchLower) ||
          t.notes.toLowerCase().includes(searchLower) ||
          (t.tags !== undefined && t.tags.some((tag) => tag.toLowerCase().includes(searchLower)))
      )
    }
  }

  return transactions
}

/**
 * Create a transaction
 */
function createTransactionData(tx: TransactionData): TransactionData {
  const id = counters.transactions++
  const transaction: TransactionData = {
    ...tx,
    tags: tx.tags || [],
  }

  data.transactions[id] = transaction
  saveData()

  return transaction
}

/**
 * Update a transaction
 */
function updateTransactionData(id: number, tx: Partial<TransactionData>): void {
  const existing = data.transactions[id]
  if (!existing) {
    throw new Error(`Transaction ${id} not found`)
  }

  Object.assign(existing, tx)
  data.transactions[id] = existing
  saveData()
}

/**
 * Delete a transaction
 */
function deleteTransactionData(id: number): void {
  if (!data.transactions[id]) {
    throw new Error(`Transaction ${id} not found`)
  }

  data.transactions[id] = undefined as any
  saveData()
}

/**
 * Get all accounts for a profile
 */
function getAccounts(filterProfileId?: number): AccountData[] {
  let accounts = Object.values(data.accounts)

  if (filterProfileId !== undefined) {
    accounts = accounts.filter((a) => a.profile_id === filterProfileId)
  }

  return accounts
}

/**
 * Create an account
 */
function createAccountData(
  name: string,
  type: AccountData['type'],
  currency: string,
  balance: number,
  profileId: number,
  notes?: string
): AccountData {
  const id = counters.accounts++
  const account: AccountData = {
    id,
    profile_id: profileId,
    name,
    type,
    currency,
    balance,
    notes: notes || '',
  }
  data.accounts[id] = account
  saveData()
  return account
}

/**
 * Update an account
 */
function updateAccountData(id: number, account: Partial<AccountData>): void {
  const existing = data.accounts[id]
  if (!existing) {
    throw new Error(`Account ${id} not found`)
  }

  Object.assign(existing, account)
  data.accounts[id] = existing
  saveData()
}

/**
 * Delete an account
 */
function deleteAccountData(id: number): void {
  if (!data.accounts[id]) {
    throw new Error(`Account ${id} not found`)
  }

  // Also delete balance history
  Object.keys(data.balanceHistory).forEach((key) => {
    const entry = data.balanceHistory[Number(key)]
    if (entry.account_id === id) {
      data.balanceHistory[Number(key)] = undefined as any
    }
  })

  data.accounts[id] = undefined as any
  saveData()
}

/**
 * Get budgets for a profile
 */
function getBudgets(filterProfileId?: number): BudgetData[] {
  let budgets = Object.values(data.budgets)

  if (filterProfileId !== undefined) {
    budgets = budgets.filter((b) => b.profile_id === filterProfileId)
  }

  return budgets
}

/**
 * Create a budget
 */
function createBudgetData(budget: BudgetData): BudgetData {
  const id = counters.budgets++
  data.budgets[id] = budget
  saveData()
  return budget
}

/**
 * Update a budget
 */
function updateBudgetData(id: number, budget: Partial<BudgetData>): void {
  const existing = data.budgets[id]
  if (!existing) {
    throw new Error(`Budget ${id} not found`)
  }

  Object.assign(existing, budget)
  data.budgets[id] = existing
  saveData()
}

/**
 * Delete a budget
 */
function deleteBudgetData(id: number): void {
  if (!data.budgets[id]) {
    throw new Error(`Budget ${id} not found`)
  }

  data.budgets[id] = undefined as any
  saveData()
}

/**
 * Get goals for a profile
 */
function getGoals(filterProfileId?: number): GoalData[] {
  let goals = Object.values(data.goals)

  if (filterProfileId !== undefined) {
    goals = goals.filter((g) => g.profile_id === filterProfileId)
  }

  return goals
}

/**
 * Create a goal
 */
function createGoalData(goal: GoalData): GoalData {
  const id = counters.goals++
  data.goals[id] = goal
  saveData()
  return goal
}

/**
 * Update a goal
 */
function updateGoalData(id: number, goal: Partial<GoalData>): void {
  const existing = data.goals[id]
  if (!existing) {
    throw new Error(`Goal ${id} not found`)
  }

  Object.assign(existing, goal)
  data.goals[id] = existing
  saveData()
}

/**
 * Delete a goal
 */
function deleteGoalData(id: number): void {
  if (!data.goals[id]) {
    throw new Error(`Goal ${id} not found`)
  }

  data.goals[id] = undefined as any
  saveData()
}

/**
 * Get loans for a profile
 */
function getLoans(filterProfileId?: number): LoanData[] {
  let loans = Object.values(data.loans)

  if (filterProfileId !== undefined) {
    loans = loans.filter((l) => l.profile_id === filterProfileId)
  }

  return loans
}

/**
 * Create a loan
 */
function createLoanData(loan: LoanData): LoanData {
  const id = counters.loans++
  data.loans[id] = loan
  saveData()
  return loan
}

/**
 * Update a loan
 */
function updateLoanData(id: number, loan: Partial<LoanData>): void {
  const existing = data.loans[id]
  if (!existing) {
    throw new Error(`Loan ${id} not found`)
  }

  Object.assign(existing, loan)
  data.loans[id] = existing
  saveData()
}

/**
 * Delete a loan
 */
function deleteLoanData(id: number): void {
  if (!data.loans[id]) {
    throw new Error(`Loan ${id} not found`)
  }

  data.loans[id] = undefined as any
  saveData()
}

/**
 * Get balance history for an account
 */
function getBalanceHistoryData(accountId: number): BalanceEntryData[] {
  return Object.values(data.balanceHistory)
    .filter((b) => b.account_id === accountId)
    .sort((a, b) => b.date.localeCompare(a.date))
}

/**
 * Record a balance entry
 */
function recordBalanceData(accountId: number, balance: number, notes?: string): BalanceEntryData {
  const id = counters.balanceHistory++
  const entry: BalanceEntryData = {
    id,
    account_id: accountId,
    balance,
    date: new Date().toISOString().split('T')[0],
    notes: notes || '',
  }

  data.balanceHistory[id] = entry
  saveData()
  return entry
}

/**
 * Get settings
 */
function getSettingsData(): SettingsData {
  return { ...data.settings }
}

/**
 * Update settings
 */
function updateSettingsData(settings: Partial<SettingsData>): void {
  Object.assign(data.settings, settings)
  saveData()
}

/**
 * Reset to default values
 */
function resetToDefaults(): void {
  data = {
    profiles: {},
    categories: {},
    transactions: {},
    accounts: {},
    budgets: {},
    goals: {},
    loans: {},
    balanceHistory: {},
    settings: {
      theme: 'light',
      language: 'en',
      currency: 'USD',
      primary_currency: 'USD',
    },
  }
  counters.categories = 1
  counters.transactions = 1
  counters.accounts = 1
  counters.budgets = 1
  counters.goals = 1
  counters.balanceHistory = 1
  saveData()
  // Default profile is created by the storage factory on first init
}

/**
 * LocalStorage Adapter Implementation
 */
export class LocalStorageAdapter implements StorageAdapter {
  // Profile management
  async getCurrentProfileId(): Promise<number> {
    const idStr = localStorage.getItem(PROFILE_ID_KEY)
    let id = idStr !== null && idStr !== '' ? parseInt(idStr, 10) : 1

    if (getProfile(id) === null) {
      // Use first available profile
      const profiles = getProfiles()
      if (profiles.length > 0) {
        id = profiles[0].id
      } else {
        id = createProfileInternal('Main Profile')
      }
      localStorage.setItem(PROFILE_ID_KEY, id.toString())
    }

    return id
  }

  createProfile(name: string): Promise<number> {
    return Promise.resolve(createProfileData(name).id)
  }

  updateProfile(id: number, name: string): Promise<void> {
    updateProfileData(id, name)
    return Promise.resolve()
  }

  deleteProfile(id: number): Promise<void> {
    deleteProfileData(id)
    return Promise.resolve()
  }

  // Transaction management
  async listTransactions(filters?: TransactionFilters): Promise<Transaction[]> {
    const profileId = await this.getCurrentProfileId()
    const transactions = getTransactions(profileId, filters)
    return transactions as Transaction[]
  }

  async createTransaction(tx: Transaction): Promise<number> {
    const profileId = await this.getCurrentProfileId()
    const transactionData: TransactionData = {
      ...tx,
      profile_id: profileId,
    }
    const result = createTransactionData(transactionData)
    return result.id
  }

  async updateTransaction(id: number, tx: Partial<Transaction>): Promise<void> {
    updateTransactionData(id, tx)
  }

  async deleteTransaction(id: number): Promise<void> {
    deleteTransactionData(id)
  }

  async deleteAllTransactions(): Promise<void> {
    const profileId = await this.getCurrentProfileId()
    Object.keys(data.transactions).forEach((key) => {
      const tx = data.transactions[Number(key)]
      if (tx.profile_id === profileId) {
        data.transactions[Number(key)] = undefined as any
      }
    })
    saveData()
  }

  // Category management
  async listCategories(type?: 'income' | 'expense'): Promise<Category[]> {
    const profileId = await this.getCurrentProfileId()
    const categories = getCategoriesForProfile(profileId, type)
    return categories as Category[]
  }

  async createCategory(category: Category): Promise<number> {
    const profileId = await this.getCurrentProfileId()
    return createCategoryData(profileId, category.type, category.name, category.color).id
  }

  async updateCategory(id: number, category: Partial<Category>): Promise<void> {
    updateCategoryData(id, category)
  }

  async deleteCategory(id: number): Promise<void> {
    deleteCategoryData(id)
  }

  async deleteAllCategories(): Promise<void> {
    const profileId = await this.getCurrentProfileId()
    Object.keys(data.categories).forEach((key) => {
      const cat = data.categories[Number(key)]
      if (cat.profile_id === profileId) {
        data.categories[Number(key)] = undefined as any
      }
    })
    saveData()
  }

  // Account management
  async listAccounts(): Promise<Account[]> {
    const profileId = await this.getCurrentProfileId()
    const accounts = getAccounts(profileId)
    return accounts as Account[]
  }

  async createAccount(account: Account): Promise<number> {
    const profileId = await this.getCurrentProfileId()
    return createAccountData(
      account.name,
      account.type,
      account.currency,
      account.balance,
      profileId,
      account.notes
    ).id
  }

  async updateAccount(id: number, account: Partial<Account>): Promise<void> {
    updateAccountData(id, account)
  }

  async deleteAccount(id: number): Promise<void> {
    deleteAccountData(id)
  }

  // Budget management
  async listBudgets(): Promise<Budget[]> {
    const profileId = await this.getCurrentProfileId()
    const budgets = getBudgets(profileId)
    return budgets as Budget[]
  }

  async createBudget(budget: Budget): Promise<number> {
    const profileId = await this.getCurrentProfileId()
    const budgetData: BudgetData = {
      ...budget,
      profile_id: profileId,
    }
    return createBudgetData(budgetData).id
  }

  async updateBudget(id: number, budget: Partial<Budget>): Promise<void> {
    updateBudgetData(id, budget)
  }

  async deleteBudget(id: number): Promise<void> {
    deleteBudgetData(id)
  }

  // Goal management
  async listGoals(): Promise<Goal[]> {
    const profileId = await this.getCurrentProfileId()
    const goals = getGoals(profileId)
    return goals as Goal[]
  }

  async createGoal(goal: Goal): Promise<number> {
    const profileId = await this.getCurrentProfileId()
    const goalData: GoalData = {
      ...goal,
      profile_id: profileId,
    }
    return createGoalData(goalData).id
  }

  async updateGoal(id: number, goal: Partial<Goal>): Promise<void> {
    updateGoalData(id, goal)
  }

  async deleteGoal(id: number): Promise<void> {
    deleteGoalData(id)
  }

  // Loan management
  async listLoans(): Promise<Loan[]> {
    const profileId = await this.getCurrentProfileId()
    const loans = getLoans(profileId)
    return loans as Loan[]
  }

  async createLoan(loan: Loan): Promise<number> {
    const profileId = await this.getCurrentProfileId()
    const loanData: LoanData = {
      id: 0, // Will be generated by createLoanData
      profile_id: profileId,
      name: loan.name,
      principal: loan.principal,
      start_date: loan.start_date,
      term_months: loan.term_months,
      rate_periods: (loan.rate_periods || []) as LoanRatePeriodData[],
      prepayments: (loan.prepayments || []) as LoanPrepaymentData[],
    }
    return createLoanData(loanData).id
  }

  async updateLoan(id: number, loan: Partial<LoanData>): Promise<void> {
    updateLoanData(id, loan)
  }

  async deleteLoan(id: number): Promise<void> {
    deleteLoanData(id)
  }

  // Transaction history
  async getBalanceHistory(accountId: number): Promise<BalanceEntry[]> {
    return getBalanceHistoryData(accountId) as BalanceEntry[]
  }

  async recordBalance(accountId: number, balance: number): Promise<number> {
    return recordBalanceData(accountId, balance).id
  }

  // Settings
  async getSettings(): Promise<Settings> {
    const settings = getSettingsData()
    return {
      theme: settings.theme,
      language: settings.language,
      currency: settings.currency,
      primary_currency: settings.primary_currency,
    }
  }

  async updateSettings(settings: Partial<Settings>): Promise<void> {
    updateSettingsData(settings)
  }

  // Transaction (ACID-like with LocalStorage)
  async transaction<T>(callback: (tx: StorageAdapter) => Promise<T>): Promise<T> {
    try {
      return await callback(this)
    } catch (error) {
      console.error('Transaction failed:', error)
      // LocalStorage doesn't have atomic transactions, but we try to restore state
      loadData() // Reload original state
      throw error
    }
  }

  // Export/Import
  async exportData(): Promise<ExportData> {
    const profileId = await this.getCurrentProfileId()

    const profiles = getProfiles().map((p) => ({
      id: p.id,
      name: p.name,
      created_at: p.created_at,
      updated_at: p.updated_at,
    }))

    const categories = getCategories(profileId).map((c) => ({
      id: c.id,
      profile_id: c.profile_id,
      type: c.type,
      name: c.name,
      color: c.color,
      tax_deductible: c.tax_deductible,
    }))

    const transactions = getTransactions(profileId).map((t) => ({
      id: t.id,
      profile_id: t.profile_id,
      type: t.type,
      description: t.description,
      amount: t.amount,
      currency: t.currency,
      local_currency: t.local_currency,
      exchange_rate: t.exchange_rate,
      category_id: t.category_id,
      account_id: t.account_id,
      beneficiary: t.beneficiary,
      payor: t.payor,
      date: t.date,
      means: t.means,
      notes: t.notes,
      tags: t.tags,
    }))

    const accounts = getAccounts(profileId).map((a) => ({
      id: a.id,
      profile_id: a.profile_id,
      name: a.name,
      type: a.type,
      currency: a.currency,
      balance: a.balance,
      notes: a.notes,
    }))

    const budgets = getBudgets(profileId).map((b) => ({
      id: b.id,
      profile_id: b.profile_id,
      category_id: b.category_id,
      amount: b.amount,
      period: b.period,
      start_date: b.start_date,
      end_date: b.end_date,
      rollover_enabled: b.rollover_enabled,
      rollover_amount: b.rollover_amount,
    }))

    const goals = getGoals(profileId).map((g) => ({
      id: g.id,
      profile_id: g.profile_id,
      name: g.name,
      target_amount: g.target_amount,
      current_amount: g.current_amount,
      deadline: g.deadline,
      notes: g.notes,
    }))

    const loans = getLoans(profileId).map((l) => ({
      id: l.id,
      profile_id: l.profile_id,
      name: l.name,
      principal: l.principal,
      start_date: l.start_date,
      term_months: l.term_months,
      rate_periods: l.rate_periods,
      prepayments: l.prepayments,
    }))

    const settings = getSettingsData()

    return {
      version: '2.0',
      export_date: new Date().toISOString(),
      storage_mode: 'serverless',
      profiles,
      categories,
      transactions,
      accounts,
      budgets,
      goals,
      loans,
      settings,
    }
  }

  async importData(importData: ExportData): Promise<void> {
    // Clear current data for the profile
    const currentProfileId = await this.getCurrentProfileId()

    // Delete all data for current profile
    Object.keys(importData.profiles).forEach((key) => {
      const id = Number(key)
      if (id === currentProfileId) {
        importData.profiles[id] = undefined as any
        Object.keys(importData.categories).forEach((cKey) => {
          const cat = importData.categories[Number(cKey)]
          if (cat.profile_id === currentProfileId) {
            importData.categories[Number(cKey)] = undefined as any
          }
        })

        Object.keys(importData.transactions).forEach((tKey) => {
          const tx = importData.transactions[Number(tKey)]
          if (tx.profile_id === currentProfileId) {
            importData.transactions[Number(tKey)] = undefined as any
          }
        })

        Object.keys(importData.accounts).forEach((aKey) => {
          const acc = importData.accounts[Number(aKey)]
          if (acc.profile_id === currentProfileId) {
            importData.accounts[Number(aKey)] = undefined as any
          }
        })

        Object.keys(importData.budgets).forEach((bKey) => {
          const budget = importData.budgets[Number(bKey)]
          if (budget.profile_id === currentProfileId) {
            importData.budgets[Number(bKey)] = undefined as any
          }
        })

        Object.keys(importData.goals).forEach((gKey) => {
          const goal = importData.goals[Number(gKey)]
          if (goal.profile_id === currentProfileId) {
            importData.goals[Number(gKey)] = undefined as any
          }
        })

        Object.keys(importData.loans).forEach((lKey) => {
          const loan = importData.loans[Number(lKey)]
          if (loan.profile_id === currentProfileId) {
            importData.loans[Number(lKey)] = undefined as any
          }
        })

        const balanceHistory = importData.balanceHistory
        if (balanceHistory !== undefined) {
          Object.keys(balanceHistory).forEach((bhKey) => {
            const entry = balanceHistory[Number(bhKey)]
            if (entry !== undefined && entry.account_id !== undefined) {
              const account = Object.values(importData.accounts).find(
                (a) => a.id === entry.account_id
              )
              if (account !== undefined && account.profile_id === currentProfileId) {
                const key = Number(bhKey)
                balanceHistory[key] = undefined as any
              }
            }
          })
        }
      }
    })

    // Save exported data
    importData.profiles.forEach((profile) => {
      data.profiles[profile.id] = profile
    })

    importData.categories.forEach((cat) => {
      data.categories[cat.id] = cat
    })

    importData.transactions.forEach((tx) => {
      data.transactions[tx.id] = tx
    })

    importData.accounts.forEach((acc) => {
      data.accounts[acc.id] = acc
    })

    importData.budgets.forEach((budget) => {
      data.budgets[budget.id] = budget
    })

    importData.goals.forEach((goal) => {
      data.goals[goal.id] = goal
    })

    importData.loans.forEach((loan) => {
      data.loans[loan.id] = loan as unknown as LoanData
    })

    data.balanceHistory = {}

    saveData()

    // Update profile IDs to be sequential
    const sortedProfiles = Object.values(data.profiles).sort((a, b) => a.id - b.id)
    const idMap = new Map<number, number>()

    sortedProfiles.forEach((original, index) => {
      const newId = index + 1
      idMap.set(original.id, newId)

      data.profiles[newId] = { ...original, id: newId }
      data.profiles[original.id] = undefined as any
    })

    // Fix references
    Object.keys(data.categories).forEach((key) => {
      const cat = data.categories[Number(key)]
      const mappedId = idMap.get(cat.profile_id)
      if (mappedId !== undefined) {
        cat.profile_id = mappedId
      }
      data.categories[cat.id] = cat
      data.categories[Number(key)] = undefined as any
    })

    Object.keys(data.transactions).forEach((key) => {
      const tx = data.transactions[Number(key)]
      const mappedId = idMap.get(tx.profile_id)
      if (mappedId !== undefined) {
        tx.profile_id = mappedId
      }
      if (tx.category_id !== undefined) {
        const newCatId = Object.values(data.categories).find(
          (c) => c.name === tx.description && c.type === tx.type
        )?.id
        if (newCatId !== undefined) tx.category_id = newCatId
      }
      data.transactions[tx.id] = tx
      data.transactions[Number(key)] = undefined as any
    })

    Object.keys(data.accounts).forEach((key) => {
      const acc = data.accounts[Number(key)]
      const mappedId = idMap.get(acc.profile_id)
      if (mappedId !== undefined) {
        acc.profile_id = mappedId
      }
      data.accounts[acc.id] = acc
      data.accounts[Number(key)] = undefined as any
    })

    Object.keys(data.budgets).forEach((key) => {
      const budget = data.budgets[Number(key)]
      const mappedId = idMap.get(budget.profile_id)
      if (mappedId !== undefined) {
        budget.profile_id = mappedId
      }
      budget.category_id =
        Object.values(data.categories).find((c) => c.id === budget.category_id)?.id || 1
      data.budgets[budget.id] = budget
      data.budgets[Number(key)] = undefined as any
    })

    Object.keys(data.goals).forEach((key) => {
      const goal = data.goals[Number(key)]
      const mappedId = idMap.get(goal.profile_id)
      if (mappedId !== undefined) {
        goal.profile_id = mappedId
      }
      data.goals[goal.id] = goal
      data.goals[Number(key)] = undefined as any
    })

    Object.keys(data.loans).forEach((key) => {
      const loan = data.loans[Number(key)]
      const mappedId = idMap.get(loan.profile_id)
      if (mappedId !== undefined) {
        loan.profile_id = mappedId
      }
      data.loans[loan.id] = loan
      data.loans[Number(key)] = undefined as any
    })

    // Rebuild counter
    profileCounter = Math.max(...Object.values(data.profiles).map((p) => p.id), 0) + 1
    counters.categories = Math.max(...Object.values(data.categories).map((c) => c.id), 0) + 1
    counters.transactions = Math.max(...Object.values(data.transactions).map((t) => t.id), 0) + 1
    counters.accounts = Math.max(...Object.values(data.accounts).map((a) => a.id), 0) + 1
    counters.budgets = Math.max(...Object.values(data.budgets).map((b) => b.id), 0) + 1
    counters.goals = Math.max(...Object.values(data.goals).map((g) => g.id), 0) + 1
    counters.loans = Math.max(...Object.values(data.loans).map((l) => l.id), 0) + 1
    counters.balanceHistory =
      Math.max(...Object.values(data.balanceHistory).map((b: BalanceEntryData) => b.id), 0) + 1

    saveData()
  }

  // Cleanup
  async clearAllData(): Promise<void> {
    resetToDefaults()
  }
}

// Initialize on module load
loadData()
