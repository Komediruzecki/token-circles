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
  LogEntry,
  Settings,
  StorageAdapter,
  Transaction,
  TransactionFilters,
} from '../../types/storage'

const DB_NAME = 'finance-manager'
const DB_VERSION = 10

/** Thrown by deleteAccount when transactions still reference the account.
 *  The accounts handler maps this to a 409 JSON response. */
export class AccountInUseError extends Error {
  constructor(message = 'Account has transactions — reassign or delete them first.') {
    super(message)
    this.name = 'AccountInUseError'
  }
}

function upgradeSchema(
  db: IDBPDatabase,
  oldVersion: number,
  _newVersion: number | null,
  // The versionchange transaction from idb; typed loosely so the v10 data migration can
  // walk the accounts store without importing idb's deep generic cursor types.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx?: any
): void | Promise<void> {
  // v1: base stores
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

    const pf = db.createObjectStore('portfolioHoldings', { keyPath: 'id', autoIncrement: true })
    pf.createIndex('by_profile', 'profile_id')

    db.createObjectStore('settings', { keyPath: 'key' })
  }

  // v2: bills store
  if (oldVersion < 2) {
    const bills = db.createObjectStore('bills', { keyPath: 'id', autoIncrement: true })
    bills.createIndex('by_profile', 'profile_id')
  }

  // v3: housings store
  if (oldVersion < 3) {
    const housings = db.createObjectStore('housings', { keyPath: 'id', autoIncrement: true })
    housings.createIndex('by_profile', 'profile_id')
  }

  // v4: recurring store
  if (oldVersion < 4) {
    const recurring = db.createObjectStore('recurring', { keyPath: 'id', autoIncrement: true })
    recurring.createIndex('by_profile', 'profile_id')
  }

  // v5: tags store
  if (oldVersion < 5) {
    const tags = db.createObjectStore('tags', { keyPath: 'id', autoIncrement: true })
    tags.createIndex('by_profile', 'profile_id')
  }

  // v6: logs store
  if (oldVersion < 6) {
    const logs = db.createObjectStore('logs', { keyPath: 'id', autoIncrement: true })
    logs.createIndex('by_level', 'level')
    logs.createIndex('by_timestamp', 'timestamp')
  }

  // v7: categoryMappings store
  if (oldVersion < 7) {
    const cm = db.createObjectStore('categoryMappings', { keyPath: 'id', autoIncrement: true })
    cm.createIndex('by_profile', 'profile_id')
  }

  // v8: no schema change — bills get `type` field via seed data and handler defaults.
  // IndexedDB is schemaless so existing records default to type='bill' in application code.

  // v9: import session logs (mirrors worker migration 0014_import_logs)
  if (oldVersion < 9) {
    const il = db.createObjectStore('import_logs', { keyPath: 'id', autoIncrement: true })
    il.createIndex('by_profile', 'profile_id')
  }

  // v10: unify the account starting-date field name (audit D7). The same concept was
  // written under three names — canonical `starting_date` (read by the UI + worker), plus
  // legacy `starting_balance_date` (demo seed) and `balance_date` (CSV/bank import). Only
  // `starting_date` is ever read, so backfill it from either legacy field for any account
  // row that lacks it. Uses the upgrade transaction so the data migration commits with the
  // version bump. Guarded on `tx` so a fresh DB (no legacy rows) is a no-op.
  if (oldVersion < 10 && oldVersion >= 1 && tx) {
    const store = tx.objectStore('accounts')
    // Cursor walk is awaited request-by-request within the upgrade transaction (idb keeps
    // it alive as long as each awaited op belongs to that transaction).
    const migrate = async (): Promise<void> => {
      let cursor = await store.openCursor()
      while (cursor) {
        const a = cursor.value as Record<string, unknown>
        if (a && (a.starting_date === null || a.starting_date === undefined)) {
          const legacy = a.starting_balance_date ?? a.balance_date
          if (legacy !== null && legacy !== undefined) {
            a.starting_date = legacy
            await cursor.update(a)
          }
        }
        cursor = await cursor.continue()
      }
    }
    return migrate()
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

interface BalanceAdjustment {
  accountId: number
  delta: number
}

/** Compute how a transaction affects account balances.
 *  Returns an array of {accountId, delta} pairs.
 *  Positive delta = add to balance, negative = subtract.
 *  Uses the base-currency value (amount_local) so balances stay in one currency
 *  even when transactions are imported in a foreign currency. */
export function computeBalanceDeltas(tx: {
  account_id?: number | null
  transfer_account_id?: number | null
  type: string
  amount: number
  amount_local?: number | null
}): BalanceAdjustment[] {
  const value = typeof tx.amount_local === 'number' ? tx.amount_local : tx.amount
  const adj: BalanceAdjustment[] = []
  if (tx.account_id) {
    if (tx.type === 'transfer' && tx.transfer_account_id) {
      adj.push({ accountId: tx.account_id, delta: -value })
      adj.push({ accountId: tx.transfer_account_id, delta: value })
    } else if (tx.type === 'transfer') {
      // Transfer without a destination — money would vanish. Skip the adjustment
      // so balances aren't silently corrupted; the UI should validate this upstream.
    } else if (tx.type === 'income' || tx.type === 'expense') {
      adj.push({ accountId: tx.account_id, delta: tx.type === 'income' ? value : -value })
    }
  }
  if (
    !tx.account_id &&
    tx.transfer_account_id &&
    (tx.type === 'income' || tx.type === 'transfer')
  ) {
    adj.push({ accountId: tx.transfer_account_id, delta: value })
  }
  return adj
}

export class IndexedDBAdapter implements StorageAdapter {
  private getProfileId(): number {
    const stored = localStorage.getItem('currentProfileId')
    return stored ? parseInt(stored, 10) : 1
  }

  /**
   * Get all selected profile IDs (for household/multi-profile view).
   * Falls back to the single current profile ID if nothing stored.
   */
  getCurrentProfileIds(): number[] {
    const stored = localStorage.getItem('selectedProfileIds')
    if (stored) {
      try {
        const ids = JSON.parse(stored) as number[]
        if (Array.isArray(ids) && ids.length > 0) return ids
      } catch {
        /* ignore */
      }
    }
    return [this.getProfileId()]
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
    // No profiles exist — only seed demo on first init, never after user deletes all
    const hadProfiles = localStorage.getItem('finance_had_profiles')
    if (!hadProfiles) {
      localStorage.setItem('finance_had_profiles', '1')
      await seedDemoProfiles()
      const seeded = await db.getAll('profiles')
      if (seeded.length > 0) return seeded[0].id
    }
    // If user deleted all profiles, don't force-create one — return 0 so UI can handle it
    localStorage.removeItem('currentProfileId')
    return 0
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
    const pids = this.getCurrentProfileIds()
    const pidSet = new Set(pids)
    let txns: Transaction[] = []

    // Use the by_date index for date-range queries (O(log N + M) instead of O(N)).
    // Falls back to by_profile when no date filters are provided.
    const hasDateRange = !!(filters?.date_from || filters?.date_to)
    if (hasDateRange) {
      let range: IDBKeyRange | null = null
      if (filters!.date_from && filters!.date_to) {
        range = IDBKeyRange.bound(filters!.date_from, filters!.date_to)
      } else if (filters!.date_from) {
        range = IDBKeyRange.lowerBound(filters!.date_from)
      } else if (filters!.date_to) {
        range = IDBKeyRange.upperBound(filters!.date_to)
      }
      if (range) {
        const rows = await db.getAllFromIndex('transactions', 'by_date', range)
        // Filter to current profile(s) — by_date spans all profiles.
        txns = rows.filter((r: Transaction) => pidSet.has(r.profile_id))
      }
    } else {
      for (const pid of pids) {
        const rows = await db.getAllFromIndex('transactions', 'by_profile', pid)
        txns.push(...rows)
      }
    }

    if (filters) {
      if (filters.type) txns = txns.filter((t) => t.type === filters.type)
      if (filters.category_id) txns = txns.filter((t) => t.category_id === filters.category_id)
      if (!hasDateRange) {
        // Apply date filters in JS only when we didn't use the by_date index.
        if (filters.date_from) txns = txns.filter((t) => t.date >= filters.date_from!)
        if (filters.date_to) txns = txns.filter((t) => t.date <= filters.date_to!)
      }
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
    // Resolve the profile id BEFORE opening the transaction — awaiting an
    // unrelated read would let the readwrite transaction auto-commit early.
    if (!data.profile_id) data.profile_id = await this.getCurrentProfileId()
    // Row insert + balance adjustment share one transaction so the read-modify-write
    // on accounts is atomic and IndexedDB serializes concurrent balance mutations
    // (otherwise interleaved create/update calls lost-update the balance — see audit D4).
    const t = db.transaction(['transactions', 'accounts'], 'readwrite')
    const id = (await t.objectStore('transactions').add(data)) as number
    await this._applyDeltasInTx(t, computeBalanceDeltas(data))
    await t.done
    return id
  }

  async updateTransaction(id: number, tx: Partial<Transaction>): Promise<void> {
    const db = await getDB()
    const t = db.transaction(['transactions', 'accounts'], 'readwrite')
    const txStore = t.objectStore('transactions')
    const existing = await txStore.get(id)
    if (!existing) {
      await t.done
      return
    }
    // Reverse the old row's effect, apply the new one — all in one transaction.
    const deltas = computeBalanceDeltas(existing).map((adj) => ({
      accountId: adj.accountId,
      delta: -adj.delta,
    }))
    // Merge the patch, handling amount_local so a partial edit can't drift the balance:
    //  - if the caller sent amount_local, honour it (including an explicit null);
    //  - else if the caller changed amount, recompute amount_local from the new amount so the
    //    balance reflects the edit — previously the stale amount_local was kept, so editing a
    //    foreign-currency amount left the balance unchanged and the row inconsistent (audit D8);
    //  - else preserve the existing amount_local (an unrelated-field edit must not wipe it).
    const preserved: Record<string, unknown> = { ...tx }
    if (!('amount_local' in tx) && typeof (existing as any).amount_local === 'number') {
      const amountChanging = 'amount' in tx && typeof tx.amount === 'number'
      if (amountChanging) {
        const rate =
          typeof (tx as any).exchange_rate === 'number'
            ? (tx as any).exchange_rate
            : typeof (existing as any).exchange_rate === 'number'
              ? (existing as any).exchange_rate
              : null
        // Recompute from the new amount when a rate is known; otherwise clear it so the
        // balance math falls back to the new raw amount.
        preserved.amount_local =
          rate && rate > 0 ? Math.round((tx.amount as number) * rate * 100) / 100 : null
      } else {
        preserved.amount_local = (existing as any).amount_local
      }
    }
    Object.assign(existing, preserved)
    await txStore.put(existing)
    deltas.push(...computeBalanceDeltas(existing))
    await this._applyDeltasInTx(t, deltas)
    await t.done
  }

  async deleteTransaction(id: number): Promise<void> {
    const db = await getDB()
    const t = db.transaction(['transactions', 'accounts'], 'readwrite')
    const txStore = t.objectStore('transactions')
    const old = await txStore.get(id)
    if (old) {
      const deltas = computeBalanceDeltas(old).map((adj) => ({
        accountId: adj.accountId,
        delta: -adj.delta,
      }))
      await txStore.delete(id)
      await this._applyDeltasInTx(t, deltas)
    }
    await t.done
  }

  async bulkDeleteTransactions(ids: number[]): Promise<void> {
    const db = await getDB()
    const t = db.transaction(['transactions', 'accounts'], 'readwrite')
    const txStore = t.objectStore('transactions')
    const deltas: { accountId: number; delta: number }[] = []
    for (const id of ids) {
      const old = await txStore.get(id)
      if (old) {
        for (const adj of computeBalanceDeltas(old)) {
          deltas.push({ accountId: adj.accountId, delta: -adj.delta })
        }
        await txStore.delete(id)
      }
    }
    await this._applyDeltasInTx(t, deltas)
    await t.done
  }

  async deleteAllTransactions(): Promise<void> {
    const db = await getDB()
    const pids = this.getCurrentProfileIds()
    for (const pid of pids) {
      const accts = await db.getAllFromIndex('accounts', 'by_profile', pid)
      for (const a of accts) {
        a.balance = a.starting_balance ?? 0
        await db.put('accounts', a)
      }
      const txns = await db.getAllFromIndex('transactions', 'by_profile', pid)
      for (const t of txns) {
        await db.delete('transactions', t.id)
      }
    }
  }

  /**
   * Apply a set of balance deltas within an already-open readwrite transaction that
   * includes the 'accounts' store. Deltas are coalesced per account so a transfer
   * (two deltas) or a batch touches each account with a single read-modify-write,
   * and the whole thing commits atomically with the caller's row change.
   */
  private async _applyDeltasInTx(
    t: {
      objectStore(name: 'accounts'): {
        get(key: number): Promise<any>
        put(value: any): Promise<unknown>
      }
    },
    deltas: { accountId: number; delta: number }[]
  ): Promise<void> {
    if (deltas.length === 0) return
    const byAccount = new Map<number, number>()
    for (const { accountId, delta } of deltas) {
      byAccount.set(accountId, (byAccount.get(accountId) ?? 0) + delta)
    }
    const store = t.objectStore('accounts')
    for (const [accountId, delta] of byAccount) {
      const acct = await store.get(accountId)
      if (acct) {
        acct.balance = (acct.balance ?? 0) + delta
        await store.put(acct)
      }
    }
  }

  // ---- Categories ----

  async listCategories(type?: 'income' | 'expense'): Promise<Category[]> {
    const db = await getDB()
    const pids = this.getCurrentProfileIds()
    let cats: Category[] = []
    for (const pid of pids) {
      const rows = await db.getAllFromIndex('categories', 'by_profile', pid)
      cats.push(...rows)
    }
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
    const pids = this.getCurrentProfileIds()
    for (const pid of pids) {
      const cats = await db.getAllFromIndex('categories', 'by_profile', pid)
      for (const c of cats) {
        await db.delete('categories', c.id)
      }
    }
  }

  // ---- Accounts ----

  async listAccounts(): Promise<Account[]> {
    const db = await getDB()
    const pids = this.getCurrentProfileIds()
    const result: Account[] = []
    for (const pid of pids) {
      const rows = await db.getAllFromIndex('accounts', 'by_profile', pid)
      result.push(...rows)
    }
    return result
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
    // Block deletion while transactions still reference the account (audit A6) — removing it
    // would leave those transactions pointing at a missing account. Callers must reassign or
    // delete them first. The account's own balance-history snapshots are owned by it and are
    // removed with it (cascade).
    const txns = (await db.getAll('transactions')) as Transaction[]
    if (txns.some((t) => t.account_id === id || t.transfer_account_id === id)) {
      throw new AccountInUseError()
    }
    const history = await db.getAllFromIndex('balanceHistory', 'by_account', id)
    const t = db.transaction(['accounts', 'balanceHistory'], 'readwrite')
    for (const h of history) await t.objectStore('balanceHistory').delete(h.id as number)
    await t.objectStore('accounts').delete(id)
    await t.done
  }

  /**
   * Repair/recompute stored account balances for a profile (audit A1/D3). For each account,
   * balance := starting_balance + the sum of that account's balance deltas across the profile's
   * transactions, using the SAME convention as the create/update paths (computeBalanceDeltas,
   * base currency via amount_local). Fixes balances that drifted from a crash, an interrupted
   * write, or a legacy bug.
   */
  async recomputeBalances(profileId: number): Promise<void> {
    const db = await getDB()
    const accounts = await db.getAllFromIndex('accounts', 'by_profile', profileId)
    const txns = await db.getAllFromIndex('transactions', 'by_profile', profileId)
    const balances = new Map<number, number>()
    for (const a of accounts) balances.set(a.id, a.starting_balance ?? 0)
    for (const tx of txns as Transaction[]) {
      for (const { accountId, delta } of computeBalanceDeltas(tx)) {
        // Only touch this profile's accounts (a transfer's legs are same-profile).
        if (balances.has(accountId)) {
          balances.set(accountId, (balances.get(accountId) ?? 0) + delta)
        }
      }
    }
    for (const a of accounts) {
      // Round to cents to avoid float drift, matching the worker recompute.
      a.balance = Math.round((balances.get(a.id) ?? a.starting_balance ?? 0) * 100) / 100
      await db.put('accounts', a)
    }
  }

  // ---- Budgets ----

  async listBudgets(): Promise<Budget[]> {
    const db = await getDB()
    const pids = this.getCurrentProfileIds()
    const result: Budget[] = []
    for (const pid of pids) {
      const rows = await db.getAllFromIndex('budgets', 'by_profile', pid)
      result.push(...rows)
    }
    return result
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
    const pids = this.getCurrentProfileIds()
    const result: Goal[] = []
    for (const pid of pids) {
      const rows = await db.getAllFromIndex('goals', 'by_profile', pid)
      result.push(...rows)
    }
    return result
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
    const pids = this.getCurrentProfileIds()
    const result: Loan[] = []
    for (const pid of pids) {
      const rows = await db.getAllFromIndex('loans', 'by_profile', pid)
      result.push(...rows)
    }
    return result
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
      if (typeof s.key === 'string' && s.key.startsWith('__cache__')) continue
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
    const [
      transactions,
      categories,
      accounts,
      budgets,
      goals,
      loans,
      portfolioHoldings,
      bills,
      recurring,
      tags,
      housings,
      categoryMappings,
      receipts,
      balanceHistoryRows,
      profiles,
      settings,
    ] = await Promise.all([
      db.getAll('transactions'),
      db.getAll('categories'),
      db.getAll('accounts'),
      db.getAll('budgets'),
      db.getAll('goals'),
      db.getAll('loans'),
      db.getAll('portfolioHoldings'),
      db.getAll('bills'),
      db.getAll('recurring'),
      db.getAll('tags'),
      db.getAll('housings'),
      db.getAll('categoryMappings'),
      db.getAll('receipts'),
      db.getAll('balanceHistory'),
      db.getAll('profiles'),
      this.getSettings(),
    ])

    return {
      version: '2.0.0',
      export_date: new Date().toISOString(),
      storage_mode: 'serverless',
      profiles,
      categories,
      transactions,
      accounts,
      budgets,
      goals,
      loans,
      portfolioHoldings,
      bills,
      recurring,
      tags,
      housings,
      categoryMappings,
      receipts,
      balanceHistoryRows,
      settings,
    }
  }

  async importData(data: ExportData): Promise<void> {
    const db = await getDB()
    // Clear existing data. Includes every user-created store so a restore fully
    // replaces state and doesn't leave stale rows from the previous dataset.
    // Previously bills/recurring/tags/housings/categoryMappings were neither
    // cleared nor exported, so backups were incomplete and restores could orphan
    // or drop data (audit D11).
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
      'bills',
      'recurring',
      'tags',
      'housings',
      'categoryMappings',
    ]
    for (const store of stores) {
      if (db.objectStoreNames.contains(store)) await db.clear(store)
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

    // Import data with profile_id remapping. Records keep their original inline
    // `id` (add() honours it), so account_id / transaction_id references survive.
    if (data.categories) for (const c of data.categories) await db.add('categories', remap(c))
    if (data.accounts) for (const a of data.accounts) await db.add('accounts', remap(a))
    if (data.budgets) for (const b of data.budgets) await db.add('budgets', remap(b))
    if (data.goals) for (const g of data.goals) await db.add('goals', remap(g))
    if (data.loans) for (const l of data.loans) await db.add('loans', remap(l))
    if (data.transactions) for (const t of data.transactions) await db.add('transactions', remap(t))
    if (data.portfolioHoldings)
      for (const h of data.portfolioHoldings) await db.add('portfolioHoldings', remap(h))

    // User-created stores that were previously dropped from backups (audit D11).
    // Guarded by objectStore presence so an older DB without a store doesn't throw.
    const addAll = async (store: string, rows?: Record<string, unknown>[]) => {
      if (!rows || !db.objectStoreNames.contains(store)) return
      for (const row of rows) await db.add(store, remap(row as { profile_id?: number }))
    }
    await addAll('bills', data.bills)
    await addAll('recurring', data.recurring)
    await addAll('tags', data.tags)
    await addAll('housings', data.housings)
    await addAll('categoryMappings', data.categoryMappings)
    await addAll('receipts', data.receipts)
    // balanceHistory rows key off account_id (preserved above), not profile_id.
    if (data.balanceHistoryRows && db.objectStoreNames.contains('balanceHistory')) {
      for (const row of data.balanceHistoryRows) await db.add('balanceHistory', row)
    }

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
      'bills',
      'housings',
      'recurring',
      'tags',
      'logs',
    ]
    for (const store of stores) {
      try {
        if (db.objectStoreNames.contains(store)) {
          await db.clear(store)
        }
      } catch {
        // Skip stores that don't exist (schema mismatch)
      }
    }
    // Clear profile-related localStorage so the app doesn't reference stale IDs
    localStorage.removeItem('currentProfileId')
    localStorage.removeItem('selectedProfileIds')
    // Also clear init flag so demo profiles re-seed on next init
    localStorage.removeItem('finance_had_profiles')
  }

  // ---- Logs ----

  async addLog(entry: {
    timestamp: string
    level: string
    source: string
    error: string
    stack?: string | null
    request?: Record<string, unknown> | null
  }): Promise<number> {
    const db = await getDB()
    const id = (await db.add('logs', entry)) as number
    const all = await db.getAll('logs')
    if (all.length > 500) {
      const sorted = all.sort((a, b) => (a.id as number) - (b.id as number))
      for (const e of sorted.slice(0, all.length - 500)) {
        await db.delete('logs', e.id)
      }
    }
    return id
  }

  async getLogs(query: { level?: string; limit?: number; offset?: number }): Promise<LogEntry[]> {
    const db = await getDB()
    let logs = await db.getAll('logs')
    if (query.level) {
      logs = logs.filter((l) => l.level === query.level)
    }
    logs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    const offset = query.offset ?? 0
    const limit = query.limit ?? 50
    return logs.slice(offset, offset + limit)
  }

  async clearLogs(): Promise<void> {
    const db = await getDB()
    await db.clear('logs')
  }
}

/** Seed default categories for a first-time profile */
export async function seedDefaultCategories(profileId: number): Promise<void> {
  const db = await getDB()
  const existing = await db.getAllFromIndex('categories', 'by_profile', profileId)
  if (existing.length > 0) return // Already seeded

  const now = new Date().toISOString()
  for (const cat of DEFAULT_CATEGORIES) {
    // icon/parent_id/created_at are required by CategorySchema — write complete rows.
    await db.add('categories', {
      icon: '',
      parent_id: null,
      created_at: now,
      ...cat,
      profile_id: profileId,
    })
  }
}

// ── Demo Profile Seeding ──────────────────────────────────────────────────────

const DEMO_PROFILES = [
  { name: 'Example Low Income', income: 2500, spendFraction: 0.95 },
  { name: 'Example Mid Income', income: 5500, spendFraction: 0.82 },
  { name: 'Example High Income', income: 12000, spendFraction: 0.72 },
]

// Account types must match AccountSchema's enum (giro/savings/ib/cash — 'checking' was
// renamed to 'giro' in v4; stale 'checking' rows broke /accounts validation in demo mode).
const DEMO_ACCOUNTS = [
  { name: 'Checking Account', type: 'giro', currency: 'EUR' },
  { name: 'Savings Account', type: 'savings', currency: 'EUR' },
]

// Extra subscriptions per income tier, on top of each tier's base bills (low already has a
// phone plan; mid Netflix/Spotify/internet; high Netflix/Spotify/Google One/internet).
// Names deliberately match subscriptionBrands keywords so the Bills → Subscriptions view
// shows real brand icons. Low = lean, Mid = typical household, High = subscription-heavy.
export const DEMO_SUBSCRIPTIONS: Record<
  'low' | 'mid' | 'high',
  { name: string; amount: number; dueDay: number; notes: string; frequency?: string }[]
> = {
  low: [
    { name: 'Netflix', amount: 7.99, dueDay: 14, notes: 'Basic with ads' },
    { name: 'Spotify', amount: 5.99, dueDay: 21, notes: 'Student plan' },
  ],
  mid: [
    { name: 'YouTube Premium', amount: 12.99, dueDay: 8, notes: 'Ad-free and background play' },
    { name: 'Disney+', amount: 9.99, dueDay: 16, notes: 'Standard plan' },
    { name: 'iCloud+', amount: 2.99, dueDay: 22, notes: '200GB storage' },
    { name: 'Amazon Prime', amount: 8.99, dueDay: 27, notes: 'Monthly membership' },
  ],
  high: [
    { name: 'YouTube Premium', amount: 12.99, dueDay: 8, notes: 'Ad-free and background play' },
    { name: 'Disney+', amount: 13.99, dueDay: 16, notes: 'Premium, no ads' },
    { name: 'HBO Max', amount: 16.99, dueDay: 3, notes: '4K plan' },
    // Monthly (not the annual plan): the Subscriptions summary shows every amount as
    // "/mo" and does not normalize yearly plans — an annual price would read misleading.
    { name: 'Amazon Prime', amount: 8.99, dueDay: 11, notes: 'Prime membership' },
    { name: 'iCloud+', amount: 9.99, dueDay: 22, notes: '2TB family storage' },
    { name: 'Xbox Game Pass', amount: 14.99, dueDay: 6, notes: 'Ultimate tier' },
    { name: 'GitHub', amount: 10, dueDay: 9, notes: 'Copilot Pro' },
    { name: 'Dropbox', amount: 11.99, dueDay: 24, notes: 'Plus 2TB' },
    { name: 'Discord', amount: 9.99, dueDay: 19, notes: 'Nitro' },
  ],
}

// Monthly expense templates — fractions of total monthly spending
const MONTHLY_EXPENSES = [
  { name: 'Housing', description: 'Monthly rent', pct: 0.37 },
  { name: 'Food', description: 'Grocery shopping', pct: 0.21 },
  { name: 'Transportation', description: 'Transport pass', pct: 0.11 },
  { name: 'Utilities', description: 'Electric and water bill', pct: 0.08 },
  { name: 'Entertainment', description: 'Dining out', pct: 0.07 },
  { name: 'Shopping', description: 'Clothes and supplies', pct: 0.06 },
  { name: 'Insurance', description: 'Auto insurance', pct: 0.05 },
  { name: 'Subscriptions', description: 'Streaming services', pct: 0.05 },
]

export async function seedDemoProfiles(): Promise<void> {
  const db = await getDB()
  const existingProfiles = await db.getAll('profiles')
  // Check if any demo profile name already exists (not just count)
  const existingNames = new Set(existingProfiles.map((p: { name: string }) => p.name))
  if (DEMO_PROFILES.some((dp) => existingNames.has(dp.name))) return

  // Inline seed helper so we don't need to import
  async function seedCats(profileId: number) {
    const cats = await db.getAllFromIndex('categories', 'by_profile', profileId)
    if (cats.length > 0) return
    const now = new Date().toISOString()
    for (const cat of DEFAULT_CATEGORIES) {
      // icon/parent_id/created_at are required by CategorySchema — write complete rows.
      await db.add('categories', {
        icon: '',
        parent_id: null,
        created_at: now,
        ...cat,
        profile_id: profileId,
      })
    }
  }

  // Generate a pseudo-random but deterministic number from a seed
  const pseudoRand = (seed: number, min: number, max: number) => {
    const x = Math.sin(seed) * 10000
    const r = x - Math.floor(x)
    return Math.round(min + r * (max - min))
  }

  let firstProfileId: number | null = null

  for (const profile of DEMO_PROFILES) {
    const profileId = (await db.add('profiles', {
      name: profile.name,
      created_at: new Date().toISOString(),
    })) as number

    if (firstProfileId === null) firstProfileId = profileId

    // Seed categories
    await seedCats(profileId)
    const categories = await db.getAllFromIndex('categories', 'by_profile', profileId)
    const catByName = (name: string) => categories.find((c) => c.name === name)

    // Create accounts
    const savingsMult = profile.name.includes('Low')
      ? 0.2
      : profile.name.includes('Mid')
        ? 1.0
        : 2.5
    const accountIds: number[] = []
    for (const acct of DEMO_ACCOUNTS) {
      const multiplier = acct.type === 'giro' ? 0.3 : savingsMult
      const balance = Math.round(profile.income * multiplier)
      const id = (await db.add('accounts', {
        name: acct.name,
        type: acct.type,
        currency: acct.currency,
        balance,
        starting_balance: balance,
        starting_date: '2020-01-01',
        notes: '',
        profile_id: profileId,
      })) as number
      accountIds.push(id)
    }

    // Generate transactions from 2000-01 through current month
    const now = new Date()
    const startYear = 2000
    const endYear = now.getFullYear()
    const endMonth = now.getMonth() // 0-indexed

    for (let year = startYear; year <= endYear; year++) {
      const lastMonth = year === endYear ? endMonth : 11
      for (let month = 0; month <= lastMonth; month++) {
        const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`
        const daysInMonth = new Date(year, month + 1, 0).getDate()
        const yearIndex = year - startYear

        // Salary income on the 1st — grows 3% per year
        const salaryGrowth = Math.pow(1.03, yearIndex)
        const monthlyIncome = Math.round(profile.income * salaryGrowth)
        const salaryCat = catByName('Salary')
        if (salaryCat) {
          // beneficiary/payor/amount_local/exchange_rate/created_at/updated_at are required
          // by TransactionSchema — incomplete rows fail the ApiClient response validation.
          await db.add('transactions', {
            description: 'Monthly Salary',
            amount: monthlyIncome,
            type: 'income',
            category_id: salaryCat.id,
            date: `${monthStr}-01`,
            currency: 'EUR',
            profile_id: profileId,
            reconciled: 1,
            notes: '',
            account_id: accountIds[0],
            beneficiary: '',
            payor: 'Employer',
            amount_local: null,
            exchange_rate: 1,
            created_at: `${monthStr}-01T00:00:00.000Z`,
            updated_at: `${monthStr}-01T00:00:00.000Z`,
          })
        }

        // Monthly expense transactions
        const totalMonthlySpend = Math.round(monthlyIncome * profile.spendFraction)
        for (const ex of MONTHLY_EXPENSES) {
          const cat = catByName(ex.name)
          if (!cat) continue
          // Vary day and amount slightly per month using seed
          const seed = year * 100 + month + MONTHLY_EXPENSES.indexOf(ex) * 1000
          const day = Math.min(pseudoRand(seed, 2, 28), daysInMonth - 1)
          const amount = Math.round(
            totalMonthlySpend * ex.pct * (0.85 + pseudoRand(seed + 1, 0, 30) / 100)
          )
          if (amount <= 0) continue

          const txDate = `${monthStr}-${String(day).padStart(2, '0')}`
          await db.add('transactions', {
            description: ex.description,
            amount,
            type: 'expense',
            category_id: cat.id,
            date: txDate,
            currency: 'EUR',
            profile_id: profileId,
            reconciled: year < endYear || month < endMonth ? 1 : 0,
            notes: '',
            account_id: accountIds[0],
            beneficiary: ex.name,
            payor: '',
            amount_local: null,
            exchange_rate: 1,
            created_at: `${txDate}T00:00:00.000Z`,
            updated_at: `${txDate}T00:00:00.000Z`,
          })
        }
      }
    }

    // ── Portfolio holdings (Mid and High income only) ──
    if (!profile.name.includes('Low')) {
      const portfolioStocks = profile.name.includes('High')
        ? [
            { ticker: 'AAPL', shares: 50, price: 175, name: 'Apple Inc.' },
            { ticker: 'MSFT', shares: 30, price: 380, name: 'Microsoft Corp.' },
            { ticker: 'VWCE.DE', shares: 80, price: 95, name: 'Vanguard FTSE All-World' },
            { ticker: 'AMZN', shares: 20, price: 185, name: 'Amazon.com Inc.' },
          ]
        : [
            { ticker: 'VWCE.DE', shares: 25, price: 95, name: 'Vanguard FTSE All-World' },
            { ticker: 'AAPL', shares: 15, price: 175, name: 'Apple Inc.' },
          ]

      for (const holding of portfolioStocks) {
        await db.add('portfolioHoldings', {
          ticker: holding.ticker,
          name: holding.name,
          shares: holding.shares,
          purchase_price: holding.price,
          purchase_date: '2022-06-15',
          profile_id: profileId,
        })
      }
    }

    // ── Loans ──
    if (profile.name.includes('High')) {
      // Mortgage
      await db.add('loans', {
        name: 'Home Mortgage',
        principal: 250000,
        interest_rate: 3.5,
        start_date: '2021-03-01',
        term_months: 240,
        profile_id: profileId,
      })
    }
    if (profile.name.includes('Mid')) {
      // Car loan
      await db.add('loans', {
        name: 'Car Loan',
        principal: 18000,
        interest_rate: 4.9,
        start_date: '2022-08-01',
        term_months: 60,
        profile_id: profileId,
      })
    }

    // ── Savings goals ──
    const goals = profile.name.includes('High')
      ? [
          {
            name: 'Emergency Fund',
            target_amount: 30000,
            current_amount: 18000,
            notes: '6 months expenses',
          },
          { name: 'Vacation', target_amount: 5000, current_amount: 2500, notes: 'Summer trip' },
        ]
      : profile.name.includes('Mid')
        ? [
            {
              name: 'Emergency Fund',
              target_amount: 10000,
              current_amount: 4000,
              notes: 'Safety net',
            },
          ]
        : [
            {
              name: 'Emergency Fund',
              target_amount: 3000,
              current_amount: 500,
              notes: 'Get started',
            },
          ]

    for (const g of goals) {
      await db.add('goals', {
        name: g.name,
        target_amount: g.target_amount,
        current_amount: g.current_amount,
        notes: g.notes,
        profile_id: profileId,
      })
    }

    // ── Extra accounts for Mid and High tiers ──
    if (!profile.name.includes('Low')) {
      await db.add('accounts', {
        name: 'Investment Account',
        type: 'ib',
        currency: 'EUR',
        balance: profile.name.includes('High') ? 150000 : 25000,
        starting_balance: profile.name.includes('High') ? 120000 : 20000,
        starting_date: '2020-01-01',
        notes: '',
        profile_id: profileId,
      })
    }
    if (profile.name.includes('High')) {
      await db.add('accounts', {
        name: 'Retirement 401k',
        type: 'ib',
        currency: 'EUR',
        balance: 180000,
        starting_balance: 100000,
        starting_date: '2015-01-01',
        notes: 'Tax-advantaged retirement account',
        profile_id: profileId,
      })
    }

    // ── Additional loans ──
    if (profile.name.includes('High')) {
      await db.add('loans', {
        name: 'Investment Property Loan',
        principal: 200000,
        interest_rate: 4.2,
        start_date: '2023-06-01',
        term_months: 240,
        profile_id: profileId,
      })
    }
    if (!profile.name.includes('Low')) {
      await db.add('loans', {
        name: profile.name.includes('High') ? 'Luxury Car Lease' : 'Auto Loan',
        principal: profile.name.includes('High') ? 55000 : 18000,
        interest_rate: profile.name.includes('High') ? 3.9 : 5.2,
        start_date: profile.name.includes('High') ? '2024-01-15' : '2022-08-01',
        term_months: profile.name.includes('High') ? 48 : 60,
        profile_id: profileId,
      })
    }

    // ── Bills ──
    const bills = profile.name.includes('High')
      ? [
          {
            name: 'Mortgage Payment',
            amount: Math.round(profile.income * 0.28),
            dueDay: 1,
            recurring: 1,
            frequency: 'monthly',
            notes: 'Monthly mortgage',
            category: 'Housing',
          },
          {
            name: 'Electricity Bill',
            amount: 180,
            dueDay: 15,
            recurring: 1,
            frequency: 'monthly',
            notes: 'Monthly electricity',
            category: 'Utilities',
          },
          {
            name: 'Natural Gas',
            amount: 95,
            dueDay: 20,
            recurring: 1,
            frequency: 'monthly',
            notes: 'Monthly gas',
            category: 'Utilities',
          },
          {
            name: 'Internet Service',
            amount: 80,
            dueDay: 5,
            recurring: 1,
            frequency: 'monthly',
            notes: 'Fiber internet',
            category: 'Subscriptions',
            type: 'subscription',
          },
          {
            name: 'Health Insurance',
            amount: 420,
            dueDay: 1,
            recurring: 1,
            frequency: 'monthly',
            notes: 'Health coverage',
            category: 'Insurance',
          },
          {
            name: 'Car Insurance',
            amount: 180,
            dueDay: 10,
            recurring: 1,
            frequency: 'monthly',
            notes: 'Auto coverage',
            category: 'Insurance',
          },
          {
            name: 'Netflix',
            amount: 15.99,
            dueDay: 12,
            recurring: 1,
            frequency: 'monthly',
            notes: 'Premium plan',
            category: 'Subscriptions',
            type: 'subscription',
          },
          {
            name: 'Spotify',
            amount: 11.99,
            dueDay: 18,
            recurring: 1,
            frequency: 'monthly',
            notes: 'Family plan',
            category: 'Subscriptions',
            type: 'subscription',
          },
          {
            name: 'Google One',
            amount: 9.99,
            dueDay: 25,
            recurring: 1,
            frequency: 'monthly',
            notes: '2TB cloud storage',
            category: 'Subscriptions',
            type: 'subscription',
          },
        ]
      : profile.name.includes('Mid')
        ? [
            {
              name: 'Rent Payment',
              amount: Math.round(profile.income * 0.3),
              dueDay: 1,
              recurring: 1,
              frequency: 'monthly',
              notes: 'Monthly rent',
              category: 'Housing',
            },
            {
              name: 'Electricity Bill',
              amount: 130,
              dueDay: 15,
              recurring: 1,
              frequency: 'monthly',
              notes: 'Monthly electricity',
              category: 'Utilities',
            },
            {
              name: 'Internet Service',
              amount: 60,
              dueDay: 5,
              recurring: 1,
              frequency: 'monthly',
              notes: 'Home internet',
              category: 'Subscriptions',
              type: 'subscription',
            },
            {
              name: 'Car Insurance',
              amount: 120,
              dueDay: 10,
              recurring: 1,
              frequency: 'monthly',
              notes: 'Auto coverage',
              category: 'Insurance',
            },
            {
              name: 'Netflix',
              amount: 15.99,
              dueDay: 14,
              recurring: 1,
              frequency: 'monthly',
              notes: 'Standard plan',
              category: 'Subscriptions',
              type: 'subscription',
            },
            {
              name: 'Spotify',
              amount: 11.99,
              dueDay: 20,
              recurring: 1,
              frequency: 'monthly',
              notes: 'Individual plan',
              category: 'Subscriptions',
              type: 'subscription',
            },
          ]
        : [
            {
              name: 'Rent Payment',
              amount: Math.round(profile.income * 0.35),
              dueDay: 1,
              recurring: 1,
              frequency: 'monthly',
              notes: 'Monthly rent',
              category: 'Housing',
            },
            {
              name: 'Electricity Bill',
              amount: 90,
              dueDay: 15,
              recurring: 1,
              frequency: 'monthly',
              notes: 'Monthly electricity',
              category: 'Utilities',
            },
            {
              name: 'Phone Plan',
              amount: 35,
              dueDay: 5,
              recurring: 1,
              frequency: 'monthly',
              notes: 'Mobile phone',
              category: 'Subscriptions',
              type: 'subscription',
            },
          ]

    // Merge in the tier's extra subscriptions (brand names -> icons in the Subscriptions view)
    const tier = profile.name.includes('High')
      ? 'high'
      : profile.name.includes('Mid')
        ? 'mid'
        : 'low'
    const tierSubscriptions = DEMO_SUBSCRIPTIONS[tier].map((s) => ({
      name: s.name,
      amount: s.amount,
      dueDay: s.dueDay,
      recurring: 1,
      frequency: s.frequency ?? 'monthly',
      notes: s.notes,
      category: 'Subscriptions',
      type: 'subscription',
    }))

    for (const bill of [...bills, ...tierSubscriptions]) {
      const dueDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(bill.dueDay).padStart(2, '0')}`
      await db.add('bills', {
        name: bill.name,
        amount: bill.amount,
        due_date: dueDate,
        recurring: bill.recurring,
        frequency: bill.frequency,
        notes: bill.notes,
        is_active: 1,
        profile_id: profileId,
        type: (bill as any).type || 'bill',
      })
    }

    // ── Budgets ──
    const budgetCategories = [
      { name: 'Housing', pct: 0.37 },
      { name: 'Food', pct: 0.21 },
      { name: 'Transportation', pct: 0.11 },
      { name: 'Entertainment', pct: 0.07 },
      { name: 'Shopping', pct: 0.06 },
      { name: 'Subscriptions', pct: 0.05 },
    ]
    for (const bc of budgetCategories) {
      const cat = catByName(bc.name)
      if (!cat) continue
      const budgetAmount = Math.round(profile.income * profile.spendFraction * bc.pct)
      await db.add('budgets', {
        category_id: cat.id,
        amount: budgetAmount,
        period: 'monthly',
        start_date: `${now.getFullYear()}-01-01`,
        end_date: null,
        rollover_enabled: 1,
        rollover_amount: 0,
        profile_id: profileId,
      })
    }

    // ── Emergency fund config ──
    const monthlyExpenses = Math.round(profile.income * profile.spendFraction)
    await db.put('settings', {
      key: `emergency_fund_config_${profileId}`,
      value: JSON.stringify({ monthly_expenses: monthlyExpenses, profile_id: profileId }),
    })
  }

  // Set current profile to the mid-income (second) profile
  const profiles = await db.getAll('profiles')
  const midProfile = profiles.find((p) => p.name === 'Example Mid Income')
  if (midProfile) {
    localStorage.setItem('currentProfileId', String(midProfile.id))
  }
}
