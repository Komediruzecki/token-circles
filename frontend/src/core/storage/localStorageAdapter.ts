/**
 * LocalStorage Adapter - Serverless Mode Storage
 * Stores all data in browser localStorage with automatic saving
 */

import type {
  StorageAdapter,
  Transaction,
  TransactionFilters,
  Category,
  Account,
  Budget,
  Goal,
  Loan,
  LoanRatePeriod,
  LoanPrepayment,
  BalanceEntry,
  Settings,
  ExportData,
  ProfileData,
  CategoryData,
  TransactionData,
  AccountData,
  BudgetData,
  GoalData,
  LoanData,
  BalanceEntryData,
  SettingsData,
  DataStore,
} from '../types/storage';
import type { ProfileData as StoreProfile, CategoryData as StoreCategory, TransactionData as StoreTransaction, AccountData as StoreAccount, BudgetData as StoreBudget, GoalData as StoreGoal, LoanData as StoreLoan, BalanceEntryData as StoreBalance, SettingsData as StoreSettings } from '../types/data';

const STORAGE_KEY = 'finance_data';
const PROFILE_ID_KEY = 'finance_profile_id';
const SELECTED_PROFILE_IDS_KEY = 'finance_selected_profile_ids';
const VERSION_KEY = 'finance_version';
const STORAGE_MODE_KEY = 'finance_storage_mode';

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
};

// Profile counter for generating IDs
let profileCounter = 1;

// Counter for generating IDs
const counters: Record<string, number> = {
  categories: 1,
  transactions: 1,
  accounts: 1,
  budgets: 1,
  goals: 1,
  loans: 1,
  balanceHistory: 1,
};

/**
 * Internal helper to create a profile without checking current ID
 * Used by getCurrentProfileId to avoid circular dependencies
 */
function createProfileInternal(name: string): number {
  const id = profileCounter++;
  const profile: ProfileData = {
    id,
    name,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  data.profiles[id] = profile;
  saveData();

  // Create default categories
  createDefaultCategories(id);

  return id;
}

/**
 * Load data from localStorage
 */
function loadData(): void {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<DataStore>;
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
      };

      // Initialize counters from data
      if (Object.keys(data.profiles).length > 0) {
        const ids = Object.values(data.profiles).map(p => p.id);
        profileCounter = Math.max(...ids, 0) + 1;
      }

      counters.categories = Math.max(...Object.values(data.categories).map(c => c.id), 0) + 1;
      counters.transactions = Math.max(...Object.values(data.transactions).map(t => t.id), 0) + 1;
      counters.accounts = Math.max(...Object.values(data.accounts).map(a => a.id), 0) + 1;
      counters.budgets = Math.max(...Object.values(data.budgets).map(b => b.id), 0) + 1;
      counters.goals = Math.max(...Object.values(data.goals).map(g => g.id), 0) + 1;
      counters.loans = Math.max(...Object.values(data.loans).map(l => l.id), 0) + 1;
      counters.balanceHistory = Math.max(...Object.values(data.balanceHistory).map(b => b.id), 0) + 1;
    }
  } catch (error) {
    console.error('Failed to load data from localStorage:', error);
    // Reset to default if corrupted
    resetToDefaults();
  }
}

/**
 * Save data to localStorage
 */
function saveData(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    localStorage.setItem(VERSION_KEY, '2.0');
  } catch (error) {
    if (error instanceof DOMException && error.name === 'QuotaExceededError') {
      console.error('LocalStorage quota exceeded. Clear some data or increase storage size.');
    } else {
      console.error('Failed to save data to localStorage:', error);
    }
  }
}

/**
 * Get a profile by ID
 */
function getProfile(id: number): ProfileData | null {
  return data.profiles[id] || null;
}

/**
 * Get all profiles for a profile ID filter
 */
function getProfiles(filterId?: number): ProfileData[] {
  return Object.values(data.profiles)
    .filter(p => !filterId || p.id === filterId);
}

/**
 * Create a new profile
 */
function createProfileData(name: string): ProfileData {
  const id = profileCounter++;
  const profile: ProfileData = {
    id,
    name,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  data.profiles[id] = profile;
  saveData();

  // Create default categories
  createDefaultCategories(id);

  return profile;
}

/**
 * Update a profile
 */
function updateProfileData(id: number, name: string): void {
  const profile = getProfile(id);
  if (!profile) {
    throw new Error(`Profile ${id} not found`);
  }

  profile.name = name;
  profile.updated_at = new Date().toISOString();
  data.profiles[id] = profile;
  saveData();
}

/**
 * Delete a profile
 */
function deleteProfileData(id: number): void {
  if (!data.profiles[id]) {
    throw new Error(`Profile ${id} not found`);
  }

  // Delete all related data
  Object.keys(data.categories).forEach(key => {
    const cat = data.categories[Number(key)];
    if (cat.profile_id === id) {
      delete data.categories[Number(key)];
    }
  });

  Object.keys(data.transactions).forEach(key => {
    const tx = data.transactions[Number(key)];
    if (tx.profile_id === id) {
      delete data.transactions[Number(key)];
    }
  });

  Object.keys(data.accounts).forEach(key => {
    const acc = data.accounts[Number(key)];
    if (acc.profile_id === id) {
      delete data.accounts[Number(key)];
    }
  });

  Object.keys(data.budgets).forEach(key => {
    const budget = data.budgets[Number(key)];
    if (budget.profile_id === id) {
      delete data.budgets[Number(key)];
    }
  });

  Object.keys(data.goals).forEach(key => {
    const goal = data.goals[Number(key)];
    if (goal.profile_id === id) {
      delete data.goals[Number(key)];
    }
  });

  Object.keys(data.loans).forEach(key => {
    const loan = data.loans[Number(key)];
    if (loan.profile_id === id) {
      delete data.loans[Number(key)];
    }
  });

  Object.keys(data.balanceHistory).forEach(key => {
    const entry = data.balanceHistory[Number(key)];
    if (entry.account_id) {
      // Balance history is per account, not per profile
      // Check if account belongs to this profile
      const account = Object.values(data.accounts).find(a => a.id === entry.account_id);
      if (account && account.profile_id === id) {
        delete data.balanceHistory[Number(key)];
      }
    }
  });

  delete data.profiles[id];
  saveData();
}

/**
 * Create default categories for a profile
 */
function createDefaultCategories(profileId: number): void {
  const expenseCategories = [
    { name: 'Food & Dining', color: '#ef4444' },
    { name: 'Transportation', color: '#f97316' },
    { name: 'Entertainment', color: '#eab308' },
    { name: 'Shopping', color: '#84cc16' },
    { name: 'Bills & Utilities', color: '#22c55e' },
    { name: 'Healthcare', color: '#14b8a6' },
    { name: 'Education', color: '#06b6d4' },
    { name: 'Personal Care', color: '#0ea5e9' },
    { name: 'Travel', color: '#3b82f6' },
    { name: 'Gifts & Donations', color: '#6366f1' },
    { name: 'Other Expenses', color: '#8b5cf6' },
  ];

  const incomeCategories = [
    { name: 'Salary', color: '#22c55e' },
    { name: 'Freelance', color: '#10b981' },
    { name: 'Investments', color: '#06b6d4' },
    { name: 'Other Income', color: '#6366f1' },
  ];

  expenseCategories.forEach(cat => {
    createCategoryData(profileId, 'expense', cat.name, cat.color);
  });

  incomeCategories.forEach(cat => {
    createCategoryData(profileId, 'income', cat.name, cat.color);
  });
}

/**
 * Get categories for a profile
 */
function getCategories(filterProfileId?: number, type?: 'income' | 'expense'): CategoryData[] {
  let categories = Object.values(data.categories);

  if (filterProfileId !== undefined) {
    categories = categories.filter(c => c.profile_id === filterProfileId);
  }

  if (type) {
    categories = categories.filter(c => c.type === type);
  }

  return categories;
}

/**
 * Create a category
 */
function createCategoryData(profileId: number, type: 'income' | 'expense', name: string, color: string): CategoryData {
  const id = counters.categories++;
  const category: CategoryData = {
    id,
    profile_id: profileId,
    type,
    name,
    color,
    tax_deductible: type === 'expense',
  };

  data.categories[id] = category;
  saveData();

  return category;
}

/**
 * Update a category
 */
function updateCategoryData(id: number, category: Partial<CategoryData>): void {
  const existing = data.categories[id];
  if (!existing) {
    throw new Error(`Category ${id} not found`);
  }

  Object.assign(existing, category);
  data.categories[id] = existing;
  saveData();
}

/**
 * Delete a category
 */
function deleteCategoryData(id: number): void {
  if (!data.categories[id]) {
    throw new Error(`Category ${id} not found`);
  }

  delete data.categories[id];
  saveData();
}

/**
 * Get all categories for a profile and type filter
 */
function getCategoriesForProfile(profileId: number, type?: 'income' | 'expense'): CategoryData[] {
  return getCategories(profileId, type);
}

/**
 * Get all transactions for a profile with optional filters
 */
function getTransactions(filterProfileId?: number, filters?: TransactionFilters): TransactionData[] {
  let transactions = Object.values(data.transactions);

  if (filterProfileId !== undefined) {
    transactions = transactions.filter(t => t.profile_id === filterProfileId);
  }

  if (filters) {
    if (filters.date_from) {
      transactions = transactions.filter(t => t.date >= filters.date_from);
    }

    if (filters.date_to) {
      transactions = transactions.filter(t => t.date <= filters.date_to);
    }

    if (filters.category_id) {
      transactions = transactions.filter(t => t.category_id === filters.category_id);
    }

    if (filters.type) {
      transactions = transactions.filter(t => t.type === filters.type);
    }

    if (filters.search) {
      const searchLower = filters.search.toLowerCase();
      transactions = transactions.filter(t =>
        t.description.toLowerCase().includes(searchLower) ||
        t.notes.toLowerCase().includes(searchLower) ||
        (t.tags && t.tags.some(tag => tag.toLowerCase().includes(searchLower)))
      );
    }
  }

  return transactions;
}

/**
 * Create a transaction
 */
function createTransactionData(tx: TransactionData): TransactionData {
  const id = counters.transactions++;
  const transaction: TransactionData = {
    id,
    ...tx,
    tags: tx.tags || [],
  };

  data.transactions[id] = transaction;
  saveData();

  return transaction;
}

/**
 * Update a transaction
 */
function updateTransactionData(id: number, tx: Partial<TransactionData>): void {
  const existing = data.transactions[id];
  if (!existing) {
    throw new Error(`Transaction ${id} not found`);
  }

  Object.assign(existing, tx);
  data.transactions[id] = existing;
  saveData();
}

/**
 * Delete a transaction
 */
function deleteTransactionData(id: number): void {
  if (!data.transactions[id]) {
    throw new Error(`Transaction ${id} not found`);
  }

  delete data.transactions[id];
  saveData();
}

/**
 * Get all accounts for a profile
 */
function getAccounts(filterProfileId?: number): AccountData[] {
  let accounts = Object.values(data.accounts);

  if (filterProfileId !== undefined) {
    accounts = accounts.filter(a => a.profile_id === filterProfileId);
  }

  return accounts;
}

/**
 * Create an account
 */
function createAccountData(account: AccountData): AccountData {
  const id = counters.accounts++;
  data.accounts[id] = account;
  saveData();
  return account;
}

/**
 * Update an account
 */
function updateAccountData(id: number, account: Partial<AccountData>): void {
  const existing = data.accounts[id];
  if (!existing) {
    throw new Error(`Account ${id} not found`);
  }

  Object.assign(existing, account);
  data.accounts[id] = existing;
  saveData();
}

/**
 * Delete an account
 */
function deleteAccountData(id: number): void {
  if (!data.accounts[id]) {
    throw new Error(`Account ${id} not found`);
  }

  // Also delete balance history
  Object.keys(data.balanceHistory).forEach(key => {
    const entry = data.balanceHistory[Number(key)];
    if (entry.account_id === id) {
      delete data.balanceHistory[Number(key)];
    }
  });

  delete data.accounts[id];
  saveData();
}

/**
 * Get budgets for a profile
 */
function getBudgets(filterProfileId?: number): BudgetData[] {
  let budgets = Object.values(data.budgets);

  if (filterProfileId !== undefined) {
    budgets = budgets.filter(b => b.profile_id === filterProfileId);
  }

  return budgets;
}

/**
 * Create a budget
 */
function createBudgetData(budget: BudgetData): BudgetData {
  const id = counters.budgets++;
  data.budgets[id] = budget;
  saveData();
  return budget;
}

/**
 * Update a budget
 */
function updateBudgetData(id: number, budget: Partial<BudgetData>): void {
  const existing = data.budgets[id];
  if (!existing) {
    throw new Error(`Budget ${id} not found`);
  }

  Object.assign(existing, budget);
  data.budgets[id] = existing;
  saveData();
}

/**
 * Delete a budget
 */
function deleteBudgetData(id: number): void {
  if (!data.budgets[id]) {
    throw new Error(`Budget ${id} not found`);
  }

  delete data.budgets[id];
  saveData();
}

/**
 * Get goals for a profile
 */
function getGoals(filterProfileId?: number): GoalData[] {
  let goals = Object.values(data.goals);

  if (filterProfileId !== undefined) {
    goals = goals.filter(g => g.profile_id === filterProfileId);
  }

  return goals;
}

/**
 * Create a goal
 */
function createGoalData(goal: GoalData): GoalData {
  const id = counters.goals++;
  data.goals[id] = goal;
  saveData();
  return goal;
}

/**
 * Update a goal
 */
function updateGoalData(id: number, goal: Partial<GoalData>): void {
  const existing = data.goals[id];
  if (!existing) {
    throw new Error(`Goal ${id} not found`);
  }

  Object.assign(existing, goal);
  data.goals[id] = existing;
  saveData();
}

/**
 * Delete a goal
 */
function deleteGoalData(id: number): void {
  if (!data.goals[id]) {
    throw new Error(`Goal ${id} not found`);
  }

  delete data.goals[id];
  saveData();
}

/**
 * Get loans for a profile
 */
function getLoans(filterProfileId?: number): LoanData[] {
  let loans = Object.values(data.loans);

  if (filterProfileId !== undefined) {
    loans = loans.filter(l => l.profile_id === filterProfileId);
  }

  return loans;
}

/**
 * Create a loan
 */
function createLoanData(loan: LoanData): LoanData {
  const id = counters.loans++;
  data.loans[id] = loan;
  saveData();
  return loan;
}

/**
 * Update a loan
 */
function updateLoanData(id: number, loan: Partial<LoanData>): void {
  const existing = data.loans[id];
  if (!existing) {
    throw new Error(`Loan ${id} not found`);
  }

  Object.assign(existing, loan);
  data.loans[id] = existing;
  saveData();
}

/**
 * Delete a loan
 */
function deleteLoanData(id: number): void {
  if (!data.loans[id]) {
    throw new Error(`Loan ${id} not found`);
  }

  delete data.loans[id];
  saveData();
}

/**
 * Get balance history for an account
 */
function getBalanceHistoryData(accountId: number): BalanceEntryData[] {
  return Object.values(data.balanceHistory)
    .filter(b => b.account_id === accountId)
    .sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * Record a balance entry
 */
function recordBalanceData(accountId: number, balance: number, notes?: string): BalanceEntryData {
  const id = counters.balanceHistory++;
  const entry: BalanceEntryData = {
    id,
    account_id: accountId,
    balance,
    date: new Date().toISOString().split('T')[0],
    notes: notes || '',
  };

  data.balanceHistory[id] = entry;
  saveData();
  return entry;
}

/**
 * Get settings
 */
function getSettingsData(): SettingsData {
  return { ...data.settings };
}

/**
 * Update settings
 */
function updateSettingsData(settings: Partial<SettingsData>): void {
  Object.assign(data.settings, settings);
  saveData();
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
  };
  counters.categories = 1;
  counters.transactions = 1;
  counters.accounts = 1;
  counters.budgets = 1;
  counters.goals = 1;
  counters.loans = 1;
  counters.balanceHistory = 1;
  saveData();
  createDefaultProfile();
}

/**
 * Create default profile
 */
function createDefaultProfile(): void {
  const existingId = getCurrentProfileId();
  if (getProfile(existingId)) {
    return; // Already has a profile
  }

  profileCounter = 1;
  createProfileData('Main Profile');
}

/**
 * LocalStorage Adapter Implementation
 */
export class LocalStorageAdapter implements StorageAdapter {
  // Profile management
  async getCurrentProfileId(): Promise<number> {
    let idStr = localStorage.getItem(PROFILE_ID_KEY);
    let id = idStr ? parseInt(idStr, 10) : 1;

    if (!getProfile(id)) {
      // Use first available profile
      const profiles = getProfiles();
      if (profiles.length > 0) {
        id = profiles[0].id;
      } else {
        id = createProfileInternal('Main Profile');
      }
      localStorage.setItem(PROFILE_ID_KEY, id.toString());
    }

    return id;
  }

  async createProfile(name: string): Promise<number> {
    return createProfileData(name).id;
  }

  async updateProfile(id: number, name: string): Promise<void> {
    updateProfileData(id, name);
  }

  async deleteProfile(id: number): Promise<void> {
    deleteProfileData(id);
  }

  // Transaction management
  async listTransactions(filters?: TransactionFilters): Promise<Transaction[]> {
    const profileId = await this.getCurrentProfileId();
    const transactions = getTransactions(profileId, filters);
    return transactions as Transaction[];
  }

  async createTransaction(tx: Transaction): Promise<number> {
    const profileId = await this.getCurrentProfileId();
    const transactionData: TransactionData = {
      ...tx,
      profile_id: profileId,
    };
    const result = createTransactionData(transactionData);
    return result.id;
  }

  async updateTransaction(id: number, tx: Partial<Transaction>): Promise<void> {
    updateTransactionData(id, tx);
  }

  async deleteTransaction(id: number): Promise<void> {
    deleteTransactionData(id);
  }

  async deleteAllTransactions(): Promise<void> {
    const profileId = await this.getCurrentProfileId();
    Object.keys(data.transactions).forEach(key => {
      const tx = data.transactions[Number(key)];
      if (tx.profile_id === profileId) {
        delete data.transactions[Number(key)];
      }
    });
    saveData();
  }

  // Category management
  async listCategories(type?: 'income' | 'expense'): Promise<Category[]> {
    const profileId = await this.getCurrentProfileId();
    const categories = getCategoriesForProfile(profileId, type);
    return categories as Category[];
  }

  async createCategory(category: Category): Promise<number> {
    const profileId = await this.getCurrentProfileId();
    return createCategoryData(profileId, category.type, category.name, category.color).id;
  }

  async updateCategory(id: number, category: Partial<Category>): Promise<void> {
    updateCategoryData(id, category);
  }

  async deleteCategory(id: number): Promise<void> {
    deleteCategoryData(id);
  }

  async deleteAllCategories(): Promise<void> {
    const profileId = await this.getCurrentProfileId();
    Object.keys(data.categories).forEach(key => {
      const cat = data.categories[Number(key)];
      if (cat.profile_id === profileId) {
        delete data.categories[Number(key)];
      }
    });
    saveData();
  }

  // Account management
  async listAccounts(): Promise<Account[]> {
    const profileId = await this.getCurrentProfileId();
    const accounts = getAccounts(profileId);
    return accounts as Account[];
  }

  async createAccount(account: Account): Promise<number> {
    return createAccountData(account as AccountData).id;
  }

  async updateAccount(id: number, account: Partial<Account>): Promise<void> {
    updateAccountData(id, account);
  }

  async deleteAccount(id: number): Promise<void> {
    deleteAccountData(id);
  }

  // Budget management
  async listBudgets(): Promise<Budget[]> {
    const profileId = await this.getCurrentProfileId();
    const budgets = getBudgets(profileId);
    return budgets as Budget[];
  }

  async createBudget(budget: Budget): Promise<number> {
    const profileId = await this.getCurrentProfileId();
    const budgetData: BudgetData = {
      ...budget,
      profile_id: profileId,
    };
    return createBudgetData(budgetData).id;
  }

  async updateBudget(id: number, budget: Partial<Budget>): Promise<void> {
    updateBudgetData(id, budget);
  }

  async deleteBudget(id: number): Promise<void> {
    deleteBudgetData(id);
  }

  // Goal management
  async listGoals(): Promise<Goal[]> {
    const profileId = await this.getCurrentProfileId();
    const goals = getGoals(profileId);
    return goals as Goal[];
  }

  async createGoal(goal: Goal): Promise<number> {
    const profileId = await this.getCurrentProfileId();
    const goalData: GoalData = {
      ...goal,
      profile_id: profileId,
    };
    return createGoalData(goalData).id;
  }

  async updateGoal(id: number, goal: Partial<Goal>): Promise<void> {
    updateGoalData(id, goal);
  }

  async deleteGoal(id: number): Promise<void> {
    deleteGoalData(id);
  }

  // Loan management
  async listLoans(): Promise<Loan[]> {
    const profileId = await this.getCurrentProfileId();
    const loans = getLoans(profileId);
    return loans as Loan[];
  }

  async createLoan(loan: Loan): Promise<number> {
    const profileId = await this.getCurrentProfileId();
    const loanData: LoanData = {
      ...loan,
      profile_id: profileId,
    };
    return createLoanData(loanData).id;
  }

  async updateLoan(id: number, loan: Partial<Loan>): Promise<void> {
    updateLoanData(id, loan);
  }

  async deleteLoan(id: number): Promise<void> {
    deleteLoanData(id);
  }

  // Transaction history
  async getBalanceHistory(accountId: number): Promise<BalanceEntry[]> {
    return getBalanceHistoryData(accountId) as BalanceEntry[];
  }

  async recordBalance(accountId: number, balance: number): Promise<number> {
    return recordBalanceData(accountId, balance).id;
  }

  // Settings
  async getSettings(): Promise<Settings> {
    const settings = getSettingsData();
    return {
      theme: settings.theme,
      language: settings.language,
      currency: settings.currency,
      primary_currency: settings.primary_currency,
    };
  }

  async updateSettings(settings: Partial<Settings>): Promise<void> {
    updateSettingsData(settings);
  }

  // Transaction (ACID-like with LocalStorage)
  async transaction<T>(callback: (tx: StorageAdapter) => Promise<T>): Promise<T> {
    try {
      return await callback(this);
    } catch (error) {
      console.error('Transaction failed:', error);
      // LocalStorage doesn't have atomic transactions, but we try to restore state
      loadData(); // Reload original state
      throw error;
    }
  }

  // Export/Import
  async exportData(): Promise<ExportData> {
    const profileId = await this.getCurrentProfileId();

    const profiles = getProfiles().map(p => ({
      id: p.id,
      name: p.name,
      created_at: p.created_at,
      updated_at: p.updated_at,
    }));

    const categories = getCategories(profileId).map(c => ({
      id: c.id,
      profile_id: c.profile_id,
      type: c.type,
      name: c.name,
      color: c.color,
      tax_deductible: c.tax_deductible,
    }));

    const transactions = getTransactions(profileId).map(t => ({
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
    }));

    const accounts = getAccounts(profileId).map(a => ({
      id: a.id,
      profile_id: a.profile_id,
      name: a.name,
      type: a.type,
      currency: a.currency,
      balance: a.balance,
      notes: a.notes,
    }));

    const budgets = getBudgets(profileId).map(b => ({
      id: b.id,
      profile_id: b.profile_id,
      category_id: b.category_id,
      amount: b.amount,
      period: b.period,
      start_date: b.start_date,
      end_date: b.end_date,
      rollover_enabled: b.rollover_enabled,
      rollover_amount: b.rollover_amount,
    }));

    const goals = getGoals(profileId).map(g => ({
      id: g.id,
      profile_id: g.profile_id,
      name: g.name,
      target_amount: g.target_amount,
      current_amount: g.current_amount,
      deadline: g.deadline,
      notes: g.notes,
    }));

    const loans = getLoans(profileId).map(l => ({
      id: l.id,
      profile_id: l.profile_id,
      name: l.name,
      principal: l.principal,
      start_date: l.start_date,
      term_months: l.term_months,
      rate_periods: l.rate_periods,
      prepayments: l.prepayments,
    }));

    const settings = getSettingsData();

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
    };
  }

  async importData(data: ExportData): Promise<void> {
    // Clear current data for the profile
    const currentProfileId = await this.getCurrentProfileId();

    // Delete all data for current profile
    Object.keys(data.profiles).forEach(key => {
      const id = Number(key);
      if (id === currentProfileId) {
        delete data.profiles[id];
        Object.keys(data.categories).forEach(cKey => {
          const cat = data.categories[Number(cKey)];
          if (cat.profile_id === currentProfileId) {
            delete data.categories[Number(cKey)];
          }
        });

        Object.keys(data.transactions).forEach(tKey => {
          const tx = data.transactions[Number(tKey)];
          if (tx.profile_id === currentProfileId) {
            delete data.transactions[Number(tKey)];
          }
        });

        Object.keys(data.accounts).forEach(aKey => {
          const acc = data.accounts[Number(aKey)];
          if (acc.profile_id === currentProfileId) {
            delete data.accounts[Number(aKey)];
          }
        });

        Object.keys(data.budgets).forEach(bKey => {
          const budget = data.budgets[Number(bKey)];
          if (budget.profile_id === currentProfileId) {
            delete data.budgets[Number(bKey)];
          }
        });

        Object.keys(data.goals).forEach(gKey => {
          const goal = data.goals[Number(gKey)];
          if (goal.profile_id === currentProfileId) {
            delete data.goals[Number(gKey)];
          }
        });

        Object.keys(data.loans).forEach(lKey => {
          const loan = data.loans[Number(lKey)];
          if (loan.profile_id === currentProfileId) {
            delete data.loans[Number(lKey)];
          }
        });

        Object.keys(data.balanceHistory).forEach(bhKey => {
          const entry = data.balanceHistory[Number(bhKey)];
          if (entry.account_id) {
            const account = Object.values(data.accounts).find(a => a.id === entry.account_id);
            if (account && account.profile_id === currentProfileId) {
              delete data.balanceHistory[Number(bhKey)];
            }
          }
        });
      }
    });

    // Save exported data
    data.profiles.forEach(profile => {
      data.profiles[profile.id] = profile;
    });

    data.categories.forEach(cat => {
      data.categories[cat.id] = cat;
    });

    data.transactions.forEach(tx => {
      data.transactions[tx.id] = tx;
    });

    data.accounts.forEach(acc => {
      data.accounts[acc.id] = acc;
    });

    data.budgets.forEach(budget => {
      data.budgets[budget.id] = budget;
    });

    data.goals.forEach(goal => {
      data.goals[goal.id] = goal;
    });

    data.loans.forEach(loan => {
      data.loans[loan.id] = loan;
    });

    data.settings = data.settings;
    data.balanceHistory = {};

    saveData();

    // Update profile IDs to be sequential
    const sortedProfiles = Object.values(data.profiles).sort((a, b) => a.id - b.id);
    const idMap = new Map<number, number>();

    sortedProfiles.forEach((original, index) => {
      const newId = index + 1;
      idMap.set(original.id, newId);

      data.profiles[newId] = { ...original, id: newId };
      delete data.profiles[original.id];
    });

    // Fix references
    Object.keys(data.categories).forEach(key => {
      const cat = data.categories[Number(key)];
      cat.profile_id = idMap.get(cat.profile_id)!;
      data.categories[cat.id] = cat;
      delete data.categories[Number(key)];
    });

    Object.keys(data.transactions).forEach(key => {
      const tx = data.transactions[Number(key)];
      tx.profile_id = idMap.get(tx.profile_id)!;
      if (tx.category_id) {
        const newCatId = Object.values(data.categories).find(c => c.name === tx.description && c.type === tx.type)?.id;
        if (newCatId) tx.category_id = newCatId;
      }
      data.transactions[tx.id] = tx;
      delete data.transactions[Number(key)];
    });

    Object.keys(data.accounts).forEach(key => {
      const acc = data.accounts[Number(key)];
      acc.profile_id = idMap.get(acc.profile_id)!;
      data.accounts[acc.id] = acc;
      delete data.accounts[Number(key)];
    });

    Object.keys(data.budgets).forEach(key => {
      const budget = data.budgets[Number(key)];
      budget.profile_id = idMap.get(budget.profile_id)!;
      budget.category_id = Object.values(data.categories).find(c => c.id === budget.category_id)?.id || 1;
      data.budgets[budget.id] = budget;
      delete data.budgets[Number(key)];
    });

    Object.keys(data.goals).forEach(key => {
      const goal = data.goals[Number(key)];
      goal.profile_id = idMap.get(goal.profile_id)!;
      data.goals[goal.id] = goal;
      delete data.goals[Number(key)];
    });

    Object.keys(data.loans).forEach(key => {
      const loan = data.loans[Number(key)];
      loan.profile_id = idMap.get(loan.profile_id)!;
      data.loans[loan.id] = loan;
      delete data.loans[Number(key)];
    });

    // Rebuild counter
    profileCounter = Math.max(...Object.values(data.profiles).map(p => p.id), 0) + 1;
    counters.categories = Math.max(...Object.values(data.categories).map(c => c.id), 0) + 1;
    counters.transactions = Math.max(...Object.values(data.transactions).map(t => t.id), 0) + 1;
    counters.accounts = Math.max(...Object.values(data.accounts).map(a => a.id), 0) + 1;
    counters.budgets = Math.max(...Object.values(data.budgets).map(b => b.id), 0) + 1;
    counters.goals = Math.max(...Object.values(data.goals).map(g => g.id), 0) + 1;
    counters.loans = Math.max(...Object.values(data.loans).map(l => l.id), 0) + 1;
    counters.balanceHistory = Math.max(...Object.values(data.balanceHistory).map(b => b.id), 0) + 1;

    saveData();
  }

  // Cleanup
  async clearAllData(): Promise<void> {
    resetToDefaults();
  }
}

// Initialize on module load
loadData();