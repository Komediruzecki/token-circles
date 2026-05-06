/**
 * Local API Handlers — IndexedDB-backed route handlers for serverless mode
 */
import { getDB, IndexedDBAdapter, seedDefaultCategories } from './idb'
import { getStorageMode, setStorageMode } from './storageFactory'
import type { StorageMode } from './storageFactory'

// ── Helpers ─────────────────────────────────────────────────────────────────

const adapter = new IndexedDBAdapter()

const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

const ok = (data: Record<string, unknown> = {}): Response => json({ ok: true, ...data })

const notFound = (what: string): Response => json({ error: `${what} not found` }, 404)

function idParam(params: Record<string, string>, key = 'p1'): number {
  return parseInt(params[key], 10)
}

// ── Auth ─────────────────────────────────────────────────────────────────────

export async function authLogin(body: unknown): Promise<Response> {
  if (body && typeof body === 'object' && 'username' in body) {
    return json({ id: 1, username: (body as Record<string, unknown>).username, role: 'admin' })
  }
  return json({ error: 'Missing credentials' }, 400)
}

export async function authCheck(): Promise<Response> {
  return json({ authenticated: true, user: { id: 1, username: 'local', role: 'admin' } })
}

export async function authLogout(): Promise<Response> {
  return ok()
}

export async function authMe(): Promise<Response> {
  return json({ id: 1, username: 'local', role: 'admin' })
}

// ── Profiles ─────────────────────────────────────────────────────────────────

export async function profilesList(): Promise<Response> {
  const db = await getDB()
  const profiles = await db.getAll('profiles')
  return json(profiles)
}

export async function profilesCreate(body: unknown): Promise<Response> {
  if (body && typeof body === 'object' && 'name' in body) {
    const name = (body as Record<string, unknown>).name as string
    const id = await adapter.createProfile(name)
    return json({ id, name, created_at: new Date().toISOString() }, 201)
  }
  return json({ error: 'Name required' }, 400)
}

export async function profilesGet(params: Record<string, string>): Promise<Response> {
  const db = await getDB()
  const profile = await db.get('profiles', idParam(params))
  if (!profile) return notFound('Profile')
  return json(profile)
}

export async function profilesUpdate(params: Record<string, string>, body: unknown): Promise<Response> {
  if (body && typeof body === 'object' && 'name' in body) {
    await adapter.updateProfile(idParam(params), (body as Record<string, unknown>).name as string)
    return ok()
  }
  return json({ error: 'Name required' }, 400)
}

export async function profilesDelete(params: Record<string, string>): Promise<Response> {
  await adapter.deleteProfile(idParam(params))
  return ok()
}

export async function profileResetData(): Promise<Response> {
  const db = await getDB()
  await Promise.all([
    db.clear('transactions'),
    db.clear('categories'),
    db.clear('accounts'),
    db.clear('budgets'),
    db.clear('goals'),
    db.clear('loans'),
    db.clear('balanceHistory'),
  ])
  return ok({ message: 'Profile data reset successfully' })
}

// ── Settings ─────────────────────────────────────────────────────────────────

export async function settingsGet(): Promise<Response> {
  const settings = await adapter.getSettings()
  return json(settings)
}

export async function settingsUpdate(body: unknown): Promise<Response> {
  if (body && typeof body === 'object') {
    await adapter.updateSettings(body as Record<string, unknown>)
    return ok()
  }
  return json({ error: 'Invalid settings body' }, 400)
}

export async function storageModeGet(): Promise<Response> {
  return json({ mode: getStorageMode() })
}

export async function storageModeSet(body: unknown): Promise<Response> {
  if (body && typeof body === 'object' && 'mode' in body) {
    const mode = (body as Record<string, unknown>).mode as StorageMode
    setStorageMode(mode)
    return ok({ mode })
  }
  return json({ error: 'Mode required' }, 400)
}

// ── Transactions ─────────────────────────────────────────────────────────────

export async function transactionsList(query: URLSearchParams): Promise<Response> {
  const filters: Record<string, unknown> = {}
  const df = query.get('date_from')
  const dt = query.get('date_to')
  const cat = query.get('category_id')
  const type = query.get('type')
  const search = query.get('search')
  if (df) filters.date_from = df
  if (dt) filters.date_to = dt
  if (cat) filters.category_id = parseInt(cat, 10)
  if (type) filters.type = type
  if (search) filters.search = search
  const txns = await adapter.listTransactions(filters as Parameters<typeof adapter.listTransactions>[0])
  return json(txns)
}

export async function transactionsCreate(body: unknown): Promise<Response> {
  if (!body || typeof body !== 'object') return json({ error: 'Invalid transaction data' }, 400)
  const tx = body as Record<string, unknown>
  tx.profile_id = adapter.getCurrentProfileId ? await adapter.getCurrentProfileId() : 1
  const id = await adapter.createTransaction(tx as Parameters<typeof adapter.createTransaction>[0])
  return json({ id, ...tx }, 201)
}

export async function transactionsGet(params: Record<string, string>): Promise<Response> {
  const db = await getDB()
  const txn = await db.get('transactions', idParam(params))
  if (!txn) return notFound('Transaction')
  return json(txn)
}

export async function transactionsUpdate(
  params: Record<string, string>,
  body: unknown,
): Promise<Response> {
  if (!body || typeof body !== 'object') return json({ error: 'Invalid data' }, 400)
  await adapter.updateTransaction(idParam(params), body as Record<string, unknown>)
  return ok()
}

export async function transactionsDelete(params: Record<string, string>): Promise<Response> {
  await adapter.deleteTransaction(idParam(params))
  return ok()
}

export async function transactionsExport(query: URLSearchParams): Promise<Response> {
  const filters: Record<string, unknown> = {}
  const df = query.get('date_from')
  const dt = query.get('date_to')
  if (df) filters.date_from = df
  if (dt) filters.date_to = dt
  const txns = await adapter.listTransactions(filters as Parameters<typeof adapter.listTransactions>[0] | undefined)
  const csv = ['date,type,description,amount,currency,category_id,notes']
  for (const t of txns) {
    csv.push(
      [t.date, t.type, `"${t.description}"`, t.amount, t.currency || 'EUR', t.category_id || '', `"${t.notes || ''}"`].join(','),
    )
  }
  return new Response(csv.join('\n'), {
    status: 200,
    headers: { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename=transactions.csv' },
  })
}

export async function transactionsSummary(): Promise<Response> {
  const txns = await adapter.listTransactions()
  const income = txns.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0)
  const expense = txns.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0)
  return json({ income, expense, count: txns.length })
}

// ── Reconciliation ───────────────────────────────────────────────────────────

export async function reconcileToggle(params: Record<string, string>): Promise<Response> {
  const db = await getDB()
  const txn = await db.get('transactions', idParam(params))
  if (!txn) return notFound('Transaction')
  const now = new Date().toISOString()
  txn.reconciled = txn.reconciled ? 0 : 1
  txn.reconciled_at = txn.reconciled ? now : null
  await db.put('transactions', txn)
  return json({ reconciled: txn.reconciled, reconciled_at: txn.reconciled_at })
}

export async function reconcileBulk(body: unknown): Promise<Response> {
  if (!body || typeof body !== 'object') return json({ error: 'Invalid data' }, 400)
  const { date_from, date_to } = body as Record<string, unknown>
  const txns = await adapter.listTransactions({
    date_from: date_from as string | undefined,
    date_to: date_to as string | undefined,
  })
  const db = await getDB()
  const now = new Date().toISOString()
  let count = 0
  for (const t of txns) {
    if (!t.reconciled) {
      t.reconciled = 1
      t.reconciled_at = now
      await db.put('transactions', t)
      count++
    }
  }
  return json({ message: `${count} transactions reconciled`, count })
}

export async function reconcileSummary(): Promise<Response> {
  const txns = await adapter.listTransactions()
  const reconciled = txns.filter((t) => t.reconciled)
  const unreconciled = txns.filter((t) => !t.reconciled)
  return json({
    reconciled_count: reconciled.length,
    unreconciled_count: unreconciled.length,
    reconciled_total: reconciled.reduce((s, t) => s + t.amount, 0),
    unreconciled_total: unreconciled.reduce((s, t) => s + t.amount, 0),
  })
}

export async function reconcileBatch(body: unknown): Promise<Response> {
  if (!body || typeof body !== 'object') return json({ error: 'Invalid data' }, 400)
  const ids = (body as Record<string, unknown>).transaction_ids as number[]
  if (!Array.isArray(ids)) return json({ error: 'transaction_ids array required' }, 400)
  const db = await getDB()
  const now = new Date().toISOString()
  let updated = 0
  for (const id of ids) {
    const txn = await db.get('transactions', id)
    if (txn && !txn.reconciled) {
      txn.reconciled = 1
      txn.reconciled_at = now
      await db.put('transactions', txn)
      updated++
    }
  }
  return json({ message: `${updated} transactions reconciled`, updated })
}

// ── Categories ───────────────────────────────────────────────────────────────

export async function categoriesList(query: URLSearchParams): Promise<Response> {
  const type = query.get('type') as 'income' | 'expense' | undefined
  const cats = await adapter.listCategories(type)
  return json(cats)
}

export async function categoriesCreate(body: unknown): Promise<Response> {
  if (!body || typeof body !== 'object') return json({ error: 'Invalid category data' }, 400)
  const cat = body as Record<string, unknown>
  cat.profile_id = await adapter.getCurrentProfileId()
  const id = await adapter.createCategory(cat as Parameters<typeof adapter.createCategory>[0])
  return json({ id, ...cat }, 201)
}

export async function categoriesGet(params: Record<string, string>): Promise<Response> {
  const db = await getDB()
  const cat = await db.get('categories', idParam(params))
  if (!cat) return notFound('Category')
  return json(cat)
}

export async function categoriesUpdate(
  params: Record<string, string>,
  body: unknown,
): Promise<Response> {
  if (!body || typeof body !== 'object') return json({ error: 'Invalid data' }, 400)
  await adapter.updateCategory(idParam(params), body as Record<string, unknown>)
  return ok()
}

export async function categoriesDelete(params: Record<string, string>): Promise<Response> {
  await adapter.deleteCategory(idParam(params))
  return ok()
}

// ── Accounts ─────────────────────────────────────────────────────────────────

export async function accountsList(): Promise<Response> {
  const accts = await adapter.listAccounts()
  return json(accts)
}

export async function accountsCreate(body: unknown): Promise<Response> {
  if (!body || typeof body !== 'object') return json({ error: 'Invalid account data' }, 400)
  const acct = body as Record<string, unknown>
  acct.profile_id = await adapter.getCurrentProfileId()
  const id = await adapter.createAccount(acct as Parameters<typeof adapter.createAccount>[0])
  return json({ id, ...acct }, 201)
}

export async function accountsGet(params: Record<string, string>): Promise<Response> {
  const db = await getDB()
  const acct = await db.get('accounts', idParam(params))
  if (!acct) return notFound('Account')
  return json(acct)
}

export async function accountsUpdate(
  params: Record<string, string>,
  body: unknown,
): Promise<Response> {
  if (!body || typeof body !== 'object') return json({ error: 'Invalid data' }, 400)
  await adapter.updateAccount(idParam(params), body as Record<string, unknown>)
  return ok()
}

export async function accountsDelete(params: Record<string, string>): Promise<Response> {
  await adapter.deleteAccount(idParam(params))
  return ok()
}

export async function accountsHistory(params: Record<string, string>): Promise<Response> {
  const history = await adapter.getBalanceHistory(idParam(params))
  return json(history)
}

export async function accountsHistoryRecord(
  params: Record<string, string>,
  body: unknown,
): Promise<Response> {
  if (!body || typeof body !== 'object') return json({ error: 'Invalid data' }, 400)
  const balance = (body as Record<string, unknown>).balance as number
  if (typeof balance !== 'number') return json({ error: 'Balance required' }, 400)
  const id = await adapter.recordBalance(idParam(params), balance)
  return json({ id, account_id: idParam(params), balance, date: new Date().toISOString() }, 201)
}

export async function accountsHistoryDelete(params: Record<string, string>): Promise<Response> {
  const db = await getDB()
  await db.delete('balanceHistory', idParam(params, 'p2'))
  return ok()
}

// ── Budgets ──────────────────────────────────────────────────────────────────

export async function budgetsList(): Promise<Response> {
  const budgets = await adapter.listBudgets()
  return json(budgets)
}

export async function budgetsCreate(body: unknown): Promise<Response> {
  if (!body || typeof body !== 'object') return json({ error: 'Invalid budget data' }, 400)
  const budget = body as Record<string, unknown>
  budget.profile_id = await adapter.getCurrentProfileId()
  const id = await adapter.createBudget(budget as Parameters<typeof adapter.createBudget>[0])
  return json({ id, ...budget }, 201)
}

export async function budgetsGet(params: Record<string, string>): Promise<Response> {
  const db = await getDB()
  const budget = await db.get('budgets', idParam(params))
  if (!budget) return notFound('Budget')
  return json(budget)
}

export async function budgetsUpdate(
  params: Record<string, string>,
  body: unknown,
): Promise<Response> {
  if (!body || typeof body !== 'object') return json({ error: 'Invalid data' }, 400)
  await adapter.updateBudget(idParam(params), body as Record<string, unknown>)
  return ok()
}

export async function budgetsDelete(params: Record<string, string>): Promise<Response> {
  await adapter.deleteBudget(idParam(params))
  return ok()
}

// ── Goals ────────────────────────────────────────────────────────────────────

export async function goalsList(): Promise<Response> {
  const goals = await adapter.listGoals()
  return json(goals)
}

export async function goalsCreate(body: unknown): Promise<Response> {
  if (!body || typeof body !== 'object') return json({ error: 'Invalid goal data' }, 400)
  const goal = body as Record<string, unknown>
  goal.profile_id = await adapter.getCurrentProfileId()
  const id = await adapter.createGoal(goal as Parameters<typeof adapter.createGoal>[0])
  return json({ id, ...goal }, 201)
}

export async function goalsGet(params: Record<string, string>): Promise<Response> {
  const db = await getDB()
  const goal = await db.get('goals', idParam(params))
  if (!goal) return notFound('Goal')
  return json(goal)
}

export async function goalsUpdate(
  params: Record<string, string>,
  body: unknown,
): Promise<Response> {
  if (!body || typeof body !== 'object') return json({ error: 'Invalid data' }, 400)
  await adapter.updateGoal(idParam(params), body as Record<string, unknown>)
  return ok()
}

export async function goalsDelete(params: Record<string, string>): Promise<Response> {
  await adapter.deleteGoal(idParam(params))
  return ok()
}

export async function goalsContribute(
  params: Record<string, string>,
  body: unknown,
): Promise<Response> {
  const db = await getDB()
  const goal = await db.get('goals', idParam(params))
  if (!goal) return notFound('Goal')
  if (!body || typeof body !== 'object') return json({ error: 'Invalid data' }, 400)
  const amount = (body as Record<string, unknown>).amount as number
  goal.current_amount = (goal.current_amount || 0) + amount
  await db.put('goals', goal)
  return json({ ok: true, current_amount: goal.current_amount })
}

// ── Loans ────────────────────────────────────────────────────────────────────

export async function loansList(): Promise<Response> {
  const loans = await adapter.listLoans()
  return json(loans)
}

export async function loansCreate(body: unknown): Promise<Response> {
  if (!body || typeof body !== 'object') return json({ error: 'Invalid loan data' }, 400)
  const loan = body as Record<string, unknown>
  loan.profile_id = await adapter.getCurrentProfileId()
  loan.rate_periods = loan.rate_periods || []
  loan.prepayments = loan.prepayments || []
  const id = await adapter.createLoan(loan as Parameters<typeof adapter.createLoan>[0])
  return json({ id, ...loan }, 201)
}

export async function loansGet(params: Record<string, string>): Promise<Response> {
  const db = await getDB()
  const loan = await db.get('loans', idParam(params))
  if (!loan) return notFound('Loan')
  return json(loan)
}

export async function loansUpdate(
  params: Record<string, string>,
  body: unknown,
): Promise<Response> {
  if (!body || typeof body !== 'object') return json({ error: 'Invalid data' }, 400)
  await adapter.updateLoan(idParam(params), body as Record<string, unknown>)
  return ok()
}

export async function loansDelete(params: Record<string, string>): Promise<Response> {
  await adapter.deleteLoan(idParam(params))
  return ok()
}

// Loan rate periods
export async function loanRates(params: Record<string, string>): Promise<Response> {
  const db = await getDB()
  const loan = await db.get('loans', idParam(params))
  if (!loan) return notFound('Loan')
  return json(loan.rate_periods || [])
}

export async function loanRatesAdd(
  params: Record<string, string>,
  body: unknown,
): Promise<Response> {
  const db = await getDB()
  const loan = await db.get('loans', idParam(params))
  if (!loan) return notFound('Loan')
  if (!body || typeof body !== 'object') return json({ error: 'Invalid data' }, 400)
  const rates = loan.rate_periods || []
  rates.push(body as Record<string, unknown>)
  loan.rate_periods = rates
  await db.put('loans', loan)
  return json({ ok: true }, 201)
}

export async function loanRateUpdate(
  params: Record<string, string>,
  body: unknown,
): Promise<Response> {
  const db = await getDB()
  const loan = await db.get('loans', idParam(params))
  if (!loan) return notFound('Loan')
  if (!body || typeof body !== 'object') return json({ error: 'Invalid data' }, 400)
  const rateId = idParam(params, 'p2') // p2 is the rateId
  const rates = loan.rate_periods || []
  if (rateId >= 0 && rateId < rates.length) {
    rates[rateId] = { ...rates[rateId], ...(body as Record<string, unknown>) }
    loan.rate_periods = rates
    await db.put('loans', loan)
    return ok()
  }
  return notFound('Rate period')
}

export async function loanRateDelete(params: Record<string, string>): Promise<Response> {
  const db = await getDB()
  const loan = await db.get('loans', idParam(params))
  if (!loan) return notFound('Loan')
  const rateId = idParam(params, 'p2')
  const rates = loan.rate_periods || []
  if (rateId >= 0 && rateId < rates.length) {
    rates.splice(rateId, 1)
    loan.rate_periods = rates
    await db.put('loans', loan)
    return ok()
  }
  return notFound('Rate period')
}

// Loan prepayments
export async function loanPrepayments(params: Record<string, string>): Promise<Response> {
  const db = await getDB()
  const loan = await db.get('loans', idParam(params))
  if (!loan) return notFound('Loan')
  return json(loan.prepayments || [])
}

export async function loanPrepaymentAdd(
  params: Record<string, string>,
  body: unknown,
): Promise<Response> {
  const db = await getDB()
  const loan = await db.get('loans', idParam(params))
  if (!loan) return notFound('Loan')
  if (!body || typeof body !== 'object') return json({ error: 'Invalid data' }, 400)
  const prepayments = loan.prepayments || []
  prepayments.push(body as Record<string, unknown>)
  loan.prepayments = prepayments
  await db.put('loans', loan)
  return json({ ok: true }, 201)
}

export async function loanPrepaymentsDelete(params: Record<string, string>): Promise<Response> {
  const db = await getDB()
  const loan = await db.get('loans', idParam(params))
  if (!loan) return notFound('Loan')
  const prepayId = idParam(params, 'p2')
  const prepayments = loan.prepayments || []
  if (prepayId >= 0 && prepayId < prepayments.length) {
    prepayments.splice(prepayId, 1)
    loan.prepayments = prepayments
    await db.put('loans', loan)
    return ok()
  }
  return notFound('Prepayment')
}

// ── Export / Import / Clear ──────────────────────────────────────────────────

export async function exportAll(): Promise<Response> {
  const data = await adapter.exportData()
  return json(data)
}

export async function exportByType(params: Record<string, string>, query: URLSearchParams): Promise<Response> {
  const type = params.p1
  const fmt = query.get('format') || 'json'
  const data = await adapter.exportData()

  if (fmt === 'csv' && type === 'transactions') {
    const csv = ['date,type,description,amount,currency,category_id,notes']
    for (const t of data.transactions) {
      csv.push(
        [t.date, t.type, `"${t.description}"`, t.amount, t.currency, `"${t.notes || ''}"`].join(','),
      )
    }
    return new Response(csv.join('\n'), {
      headers: { 'Content-Type': 'text/csv', 'Content-Disposition': `attachment; filename=${type}.csv` },
    })
  }

  return json(data)
}

export async function importData(body: unknown): Promise<Response> {
  if (!body || typeof body !== 'object') return json({ error: 'Invalid import data' }, 400)
  await adapter.importData(body as Parameters<typeof adapter.importData>[0])
  return ok({ message: 'Data imported successfully' })
}

export async function clearAll(): Promise<Response> {
  await adapter.clearAllData()
  return ok({ message: 'All data cleared' })
}

// ── Dashboard aggregation ────────────────────────────────────────────────────

function getAmount(t: Record<string, unknown>): number {
  return (t.amount_local as number) ?? (t.amount as number) ?? 0
}

function monthStart(y: number, m: number): string {
  return `${y}-${String(m).padStart(2, '0')}-01`
}

function nextMonth(y: number, m: number): { year: number; month: number } {
  if (m === 12) return { year: y + 1, month: 1 }
  return { year: y, month: m + 1 }
}

function prevMonth(y: number, m: number): { year: number; month: number } {
  if (m === 1) return { year: y - 1, month: 12 }
  return { year: y, month: m - 1 }
}

export async function dashboardMain(query: URLSearchParams): Promise<Response> {
  try {
    const pid = await adapter.getCurrentProfileId()
    const now = new Date()
    const year = parseInt(query.get('year')!) || now.getFullYear()
    const month = parseInt(query.get('month')!) || (now.getMonth() + 1)

    const startDate = monthStart(year, month)
    const pm = prevMonth(year, month)
    const lastDay = new Date(year, month, 0).getDate()
    const endDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
    const prevStart = monthStart(pm.year, pm.month)
    const prevLastDay = new Date(pm.year, pm.month, 0).getDate()
    const prevEnd = `${pm.year}-${String(pm.month).padStart(2, '0')}-${String(prevLastDay).padStart(2, '0')}`

    const allTxns = await adapter.listTransactions()
    const profileTxns = allTxns.filter((t) => t.profile_id === pid)

    // Current month
    const currentTxns = profileTxns.filter((t) => t.date >= startDate && t.date <= endDate)
    const currentIncome = currentTxns.filter((t) => t.type === 'income').reduce((s, t) => s + getAmount(t as unknown as Record<string, unknown>), 0)
    const currentExpense = currentTxns.filter((t) => t.type === 'expense').reduce((s, t) => s + getAmount(t as unknown as Record<string, unknown>), 0)

    // Previous month
    const prevTxns = profileTxns.filter((t) => t.date >= prevStart && t.date <= prevEnd)
    const prevIncome = prevTxns.filter((t) => t.type === 'income').reduce((s, t) => s + getAmount(t as unknown as Record<string, unknown>), 0)
    const prevExpense = prevTxns.filter((t) => t.type === 'expense').reduce((s, t) => s + getAmount(t as unknown as Record<string, unknown>), 0)

    // Recent transactions (top 10)
    const recent = [...currentTxns]
      .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id)
      .slice(0, 10)

    // Category breakdown (expenses)
    const cats = await adapter.listCategories()
    const catMap = new Map(cats.map((c) => [c.id, c]))
    const expenseByCat: Record<string, { category_name: string; category_color: string; total: number }> = {}
    for (const t of currentTxns.filter((t) => t.type === 'expense')) {
      const cat = catMap.get(t.category_id)
      const key = String(t.category_id || 0)
      if (!expenseByCat[key]) {
        expenseByCat[key] = {
          category_name: cat?.name || 'Uncategorized',
          category_color: cat?.color || '#999',
          total: 0,
        }
      }
      expenseByCat[key].total += getAmount(t as unknown as Record<string, unknown>)
    }
    const expenseByCategory = Object.values(expenseByCat).sort((a, b) => b.total - a.total)

    // Account balances
    const accts = await adapter.listAccounts()
    const balance = accts.reduce((s, a) => s + (a.balance || 0), 0)

    return json({
      totalIncome: currentIncome,
      totalExpenses: currentExpense,
      balance,
      incomeByCategory: [],
      expenseByCategory,
      recentTransactions: recent,
      upcomingBills: [],
      momIncomeDelta: currentIncome - prevIncome,
      momExpenseDelta: currentExpense - prevExpense,
      momBalanceDelta: (currentIncome - currentExpense) - (prevIncome - prevExpense),
    })
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
}

export async function dashboardSummary(query: URLSearchParams): Promise<Response> {
  try {
    const pid = await adapter.getCurrentProfileId()
    const now = new Date()
    const y = parseInt(query.get('year')!) || now.getFullYear()
    const mRaw = query.get('month')
    let m: number | null = null
    if (mRaw) {
      m = parseInt(mRaw.includes('-') ? mRaw.split('-')[1] : mRaw, 10)
    }

    let startDate: string, endDate: string
    if (m) {
      startDate = monthStart(y, m)
      const nm = nextMonth(y, m)
      endDate = monthStart(nm.year, nm.month)
    } else {
      startDate = `${y}-01-01`
      endDate = `${y + 1}-01-01`
    }

    const allTxns = await adapter.listTransactions()
    const profileTxns = allTxns.filter((t) => t.profile_id === pid)
    const periodTxns = profileTxns.filter((t) => t.date >= startDate && t.date < endDate)

    const income = periodTxns.filter((t) => t.type === 'income').reduce((s, t) => s + getAmount(t as unknown as Record<string, unknown>), 0)
    const expense = periodTxns.filter((t) => t.type === 'expense').reduce((s, t) => s + getAmount(t as unknown as Record<string, unknown>), 0)
    const transfer = periodTxns.filter((t) => t.type === 'transfer').reduce((s, t) => s + getAmount(t as unknown as Record<string, unknown>), 0)

    // Previous period
    let prevStart: string, prevEnd: string
    if (m) {
      const pm = prevMonth(y, m)
      prevStart = monthStart(pm.year, pm.month)
      const nm = nextMonth(pm.year, pm.month)
      prevEnd = monthStart(nm.year, nm.month)
    } else {
      prevStart = `${y - 1}-01-01`
      prevEnd = `${y}-01-01`
    }

    const prevTxns = profileTxns.filter((t) => t.date >= prevStart && t.date < prevEnd)
    const prevIncome = prevTxns.filter((t) => t.type === 'income').reduce((s, t) => s + getAmount(t as unknown as Record<string, unknown>), 0)
    const prevExpense = prevTxns.filter((t) => t.type === 'expense').reduce((s, t) => s + getAmount(t as unknown as Record<string, unknown>), 0)

    // YTD
    const ytdStart = `${y}-01-01`
    const ytdTxns = profileTxns.filter((t) => t.date >= ytdStart)
    const ytdIncome = ytdTxns.filter((t) => t.type === 'income').reduce((s, t) => s + getAmount(t as unknown as Record<string, unknown>), 0)
    const ytdExpense = ytdTxns.filter((t) => t.type === 'expense').reduce((s, t) => s + getAmount(t as unknown as Record<string, unknown>), 0)

    // Recent
    const recent = [...periodTxns]
      .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id)
      .slice(0, 10)

    return json({
      summary: { income, expense, transfer, balance: income - expense },
      prevSummary: { income: prevIncome, expense: prevExpense },
      recent,
      ytd: { income: ytdIncome, expense: ytdExpense, net: ytdIncome - ytdExpense },
      month: m ? `${y}-${String(m).padStart(2, '0')}` : String(y),
      currency: 'EUR',
    })
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
}

export async function dashboardCharts(query: URLSearchParams): Promise<Response> {
  try {
    const pid = await adapter.getCurrentProfileId()
    const monthsCount = parseInt(query.get('months')!) || 12
    const endDate = new Date()
    const startDate = new Date()
    startDate.setMonth(startDate.getMonth() - monthsCount + 1)
    startDate.setDate(1)
    const startStr = startDate.toISOString().split('T')[0]
    const endStr = endDate.toISOString().split('T')[0]

    const allTxns = await adapter.listTransactions()
    const profileTxns = allTxns.filter((t) => t.profile_id === pid)
    const rangeTxns = profileTxns.filter((t) => t.date >= startStr && t.date <= endStr)

    // By category
    const cats = await adapter.listCategories()
    const catMap = new Map(cats.map((c) => [c.id, c]))
    const byCat: Record<string, { name: string; color: string; icon: string | null; total: number; count: number }> = {}
    for (const t of rangeTxns.filter((t) => t.type === 'expense')) {
      const cat = catMap.get(t.category_id)
      const key = String(t.category_id || 0)
      if (!byCat[key]) {
        byCat[key] = {
          name: cat?.name || 'Uncategorized',
          color: cat?.color || '#999',
          icon: cat?.icon || null,
          total: 0,
          count: 0,
        }
      }
      byCat[key].total += getAmount(t as unknown as Record<string, unknown>)
      byCat[key].count++
    }
    const byCategory = Object.values(byCat).sort((a, b) => b.total - a.total)

    // Monthly cash flow
    const monthlyMap: Record<string, { month: string; income: number; expense: number }> = {}
    for (const t of rangeTxns.filter((t) => t.type === 'income' || t.type === 'expense')) {
      const mo = t.date.substring(0, 7)
      if (!monthlyMap[mo]) monthlyMap[mo] = { month: mo, income: 0, expense: 0 }
      if (t.type === 'income') monthlyMap[mo].income += getAmount(t as unknown as Record<string, unknown>)
      if (t.type === 'expense') monthlyMap[mo].expense += getAmount(t as unknown as Record<string, unknown>)
    }
    const monthly = Object.values(monthlyMap).sort((a, b) => a.month.localeCompare(b.month))

    let running = 0
    const cashFlow = monthly.map((m) => {
      running += m.income - m.expense
      return { ...m, cumulative: running }
    })

    // Get currency
    const settings = await adapter.getSettings()
    const currency = (settings as Record<string, unknown>).local_currency || (settings as Record<string, unknown>).currency || 'EUR'

    return json({ byCategory, monthly, cashFlow, currency })
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
}

export async function dashboardNetWorth(): Promise<Response> {
  try {
    const pid = await adapter.getCurrentProfileId()
    const accts = await adapter.listAccounts()
    const totalNetWorth = accts.reduce((s, a) => s + (a.balance || 0), 0)

    // Monthly net flow from all transactions
    const allTxns = await adapter.listTransactions()
    const profileTxns = allTxns.filter((t) => t.profile_id === pid && (t.type === 'income' || t.type === 'expense'))
    const monthlyMap: Record<string, { month: string; net: number }> = {}
    for (const t of profileTxns) {
      const mo = t.date.substring(0, 7)
      if (!monthlyMap[mo]) monthlyMap[mo] = { month: mo, net: 0 }
      const amt = getAmount(t as unknown as Record<string, unknown>)
      monthlyMap[mo].net += t.type === 'income' ? amt : -amt
    }

    const sortedMonths = Object.keys(monthlyMap).sort()
    const totalNet = Object.values(monthlyMap).reduce((s, m) => s + m.net, 0)
    const opening = totalNetWorth - totalNet

    let balance = opening
    const timeline = sortedMonths.map((mo) => {
      balance += monthlyMap[mo].net
      return {
        month: mo,
        balance: Math.round(balance * 100) / 100,
        netChange: Math.round(monthlyMap[mo].net * 100) / 100,
      }
    })

    return json({
      totalNetWorth: Math.round(totalNetWorth * 100) / 100,
      accounts: accts,
      timeline,
    })
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
}

// ── Analytics ─────────────────────────────────────────────────────────────────

export async function analyticsDistinctYears(): Promise<Response> {
  try {
    const allTxns = await adapter.listTransactions()
    const years = [...new Set(allTxns.map((t) => parseInt(t.date.substring(0, 4))))].sort((a, b) => b - a)
    const currentYear = new Date().getFullYear()
    if (years.length === 0) years.push(currentYear)
    if (!years.includes(currentYear)) years.unshift(currentYear)
    return json({ years })
  } catch (_err) {
    return json({ years: [new Date().getFullYear()] })
  }
}

export async function analyticsWeeks(query: URLSearchParams): Promise<Response> {
  try {
    const year = parseInt(query.get('year')!)
    const month = query.get('month') ? parseInt(query.get('month')!) : null
    if (!year) return json({ weeks: [] })

    const weeks: Array<{ week: number; label: string }> = []
    const firstDay = month ? new Date(year, month - 1, 1) : new Date(year, 0, 1)
    const lastDay = month
      ? new Date(year, month, 0)
      : new Date(year, 11, 31)

    let w = 1
    const current = new Date(firstDay)
    while (current <= lastDay) {
      const ws = new Date(current)
      ws.setDate(current.getDate() - current.getDay())
      const we = new Date(ws)
      we.setDate(ws.getDate() + 6)
      weeks.push({
        week: w,
        label: `Week ${w} (${ws.toISOString().slice(0, 10)} - ${we.toISOString().slice(0, 10)})`,
      })
      current.setDate(current.getDate() + 7)
      w++
    }
    return json({ weeks })
  } catch (_err) {
    return json({ weeks: [] })
  }
}

export async function analyticsDailyHeatmap(query: URLSearchParams): Promise<Response> {
  try {
    const year = parseInt(query.get('year')!)
    if (!year) return json({ error: 'year required' }, 400)
    const type = query.get('type') === 'income' ? 'income' : 'expense'

    const allTxns = await adapter.listTransactions()
    const pid = await adapter.getCurrentProfileId()
    const rows = allTxns.filter(
      (t) => t.profile_id === pid && t.date.startsWith(String(year)) && t.type === type
    )

    const dates: Record<string, number> = {}
    for (const t of rows) {
      if (!dates[t.date]) dates[t.date] = 0
      dates[t.date] += getAmount(t as unknown as Record<string, unknown>)
    }

    return json({ dates, year, type })
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
}

export async function analyticsCategoryTrends(query: URLSearchParams): Promise<Response> {
  try {
    const pid = await adapter.getCurrentProfileId()
    const year = parseInt(query.get('year')!) || new Date().getFullYear()
    const month = query.get('month') ? parseInt(query.get('month')!) : null
    const week = query.get('week') ? parseInt(query.get('week')!) : null
    const type = query.get('type') || 'expense'

    // Date range
    let startStr: string, endStr: string
    if (month && week) {
      const lastDay = new Date(year, month, 0).getDate()
      const ws = (week - 1) * 7 + 1
      const we = Math.min(week * 7, lastDay)
      startStr = `${year}-${String(month).padStart(2, '0')}-${String(ws).padStart(2, '0')}`
      endStr = `${year}-${String(month).padStart(2, '0')}-${String(we).padStart(2, '0')}`
    } else if (month) {
      const lastDay = new Date(year, month, 0).getDate()
      startStr = `${year}-${String(month).padStart(2, '0')}-01`
      endStr = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
    } else {
      startStr = `${year}-01-01`
      endStr = `${year}-12-31`
    }

    // Calculate numDays
    const [sy, sm, sd] = startStr.split('-').map(Number)
    const [ey, em, ed] = endStr.split('-').map(Number)
    const sdDate = new Date(sy, sm - 1, sd)
    const edDate = new Date(ey, em - 1, ed)
    const numDays = Math.round((edDate.getTime() - sdDate.getTime()) / 86400000) + 1

    const allTxns = await adapter.listTransactions()
    const cats = await adapter.listCategories(type as 'income' | 'expense')
    const txns = allTxns.filter(
      (t) => t.profile_id === pid && t.type === type && t.date >= startStr && t.date <= endStr
    )

    // Generate labels based on view level
    const labels: string[] = []
    const periodMap = new Map<string, number>()
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    const monthNamesFull = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

    if (week && month) {
      const lastDay = new Date(year, month, 0).getDate()
      const ws = (week - 1) * 7 + 1
      const we = Math.min(week * 7, lastDay)
      for (let d = ws; d <= we; d++) {
        const date = new Date(year, month - 1, d)
        labels.push(dayNames[date.getDay()])
        periodMap.set(`${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`, labels.length - 1)
      }
    } else if (month) {
      const lastDay = new Date(year, month, 0).getDate()
      for (let d = 1; d <= lastDay; d++) {
        labels.push(`${monthNamesFull[month - 1]} ${d}`)
        periodMap.set(`${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`, labels.length - 1)
      }
    } else {
      for (let m = 0; m < 12; m++) {
        labels.push(`${monthNames[m]} ${year}`)
        periodMap.set(`${year}-${String(m + 1).padStart(2, '0')}`, m)
      }
    }

    // Aggregate by category
    const catDataMap: Record<string, { category: string; color: string; data: number[] }> = {}
    for (const c of cats) {
      catDataMap[c.id] = { category: c.name, color: c.color, data: new Array(labels.length).fill(0) }
    }

    for (const t of txns) {
      const dateKey = month ? t.date : t.date.substring(0, 7)
      const idx = periodMap.get(dateKey)
      if (idx !== undefined && catDataMap[t.category_id]) {
        catDataMap[t.category_id].data[idx] += getAmount(t as unknown as Record<string, unknown>)
      }
    }

    const datasets = Object.values(catDataMap)
      .filter((d) => d.data.some((v) => v > 0))
      .sort((a, b) => {
        const totalA = a.data.reduce((x, y) => x + y, 0)
        const totalB = b.data.reduce((x, y) => x + y, 0)
        return totalB - totalA
      })

    // Handle compare mode
    const compare = query.get('compare')
    if (compare === '1') {
      const cmpYear = parseInt(query.get('compare_year')!)
      const cmpMonth = query.get('compare_month') ? parseInt(query.get('compare_month')!) : null
      let cmpStart: string, cmpEnd: string
      if (cmpMonth) {
        const lastCmpDay = new Date(cmpYear, cmpMonth, 0).getDate()
        cmpStart = `${cmpYear}-${String(cmpMonth).padStart(2, '0')}-01`
        cmpEnd = `${cmpYear}-${String(cmpMonth).padStart(2, '0')}-${String(lastCmpDay).padStart(2, '0')}`
      } else {
        cmpStart = `${cmpYear}-01-01`
        cmpEnd = `${cmpYear}-12-31`
      }
      const cmpTxns = allTxns.filter(
        (t) => t.profile_id === pid && t.type === type && t.date >= cmpStart && t.date <= cmpEnd
      )

      const cmpCatData: Record<string, { category: string; color: string; data: number[] }> = {}
      for (const c of cats) {
        cmpCatData[c.id] = { category: c.name, color: c.color, data: new Array(labels.length).fill(0) }
      }
      for (const t of cmpTxns) {
        const dateKey = month ? t.date : t.date.substring(0, 7)
        const idx = periodMap.get(dateKey)
        if (idx !== undefined && cmpCatData[t.category_id]) {
          cmpCatData[t.category_id].data[idx] += getAmount(t as unknown as Record<string, unknown>)
        }
      }
      const cmpDatasets = Object.values(cmpCatData).filter((d) => d.data.some((v) => v > 0))

      return json({
        labels,
        datasets,
        numDays,
        compare: { labels, datasets: cmpDatasets },
      })
    }

    return json({ labels, datasets, numDays })
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
}

export async function analyticsSankey(query: URLSearchParams): Promise<Response> {
  try {
    const pid = await adapter.getCurrentProfileId()
    const year = parseInt(query.get('year')!) || new Date().getFullYear()
    const month = query.get('month') ? parseInt(query.get('month')!) : null

    if (!month) return json({ nodes: [], links: [] })

    const lastDay = new Date(year, month, 0).getDate()
    const startStr = `${year}-${String(month).padStart(2, '0')}-01`
    const endStr = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`

    const allTxns = await adapter.listTransactions()
    const budgets = await adapter.listBudgets()
    const cats = await adapter.listCategories()

    // Get budgets for this month
    const activeBudgets = budgets.filter(
      (b) =>
        b.period === 'month' || b.period === 'monthly'
    )

    // Get actual spending for this month
    const profileTxns = allTxns.filter(
      (t) => t.profile_id === pid && t.type === 'expense' && t.date >= startStr && t.date <= endStr
    )

    const actualMap = new Map<number, number>()
    for (const t of profileTxns) {
      const prev = actualMap.get(t.category_id) || 0
      actualMap.set(t.category_id, prev + getAmount(t as unknown as Record<string, unknown>))
    }

    const catMap = new Map(cats.map((c) => [c.id, c]))

    interface SankeyNode { name: string; category: string; color?: string }
    interface SankeyLink { source: string; target: string; value: number; sourceCategory: string; targetCategory: string }

    const nodes: SankeyNode[] = []
    const links: SankeyLink[] = []
    const nodeNames = new Set<string>()

    nodes.push({ name: 'Total Budget', category: 'budget' })
    nodeNames.add('Total Budget')

    for (const b of activeBudgets) {
      const cat = catMap.get(b.category_id)
      const catName = cat?.name || `Category ${b.category_id}`
      if (!nodeNames.has(catName)) {
        nodes.push({ name: catName, category: 'category', color: cat?.color })
        nodeNames.add(catName)
      }
    }

    nodes.push({ name: 'Total Actual', category: 'actual' })
    nodeNames.add('Total Actual')

    let totalBudget = 0
    for (const b of activeBudgets) {
      totalBudget += b.amount
      const cat = catMap.get(b.category_id)
      const catName = cat?.name || `Category ${b.category_id}`
      links.push({
        source: 'Total Budget',
        target: catName,
        value: b.amount,
        sourceCategory: 'budget',
        targetCategory: 'category',
      })
    }

    let totalActual = 0
    for (const b of activeBudgets) {
      const actual = actualMap.get(b.category_id) || 0
      totalActual += actual
      const cat = catMap.get(b.category_id)
      const catName = cat?.name || `Category ${b.category_id}`
      links.push({
        source: catName,
        target: 'Total Actual',
        value: actual,
        sourceCategory: 'category',
        targetCategory: 'actual',
      })
    }

    // If no budgets, use actual spending directly
    if (activeBudgets.length === 0) {
      for (const [catId, amount] of actualMap) {
        const cat = catMap.get(catId)
        if (cat) {
          nodes.push({ name: cat.name, category: 'category', color: cat.color })
          links.push({
            source: cat.name,
            target: 'Total Actual',
            value: amount,
            sourceCategory: 'category',
            targetCategory: 'actual',
          })
        }
      }
    }

    // Budget unused → "Unused Budget" node
    const budgetUnused = totalBudget - totalActual
    if (budgetUnused > 0 && activeBudgets.length > 0) {
      nodes.push({ name: 'Unused Budget', category: 'savings' })
      links.push({
        source: 'Total Budget',
        target: 'Unused Budget',
        value: budgetUnused,
        sourceCategory: 'budget',
        targetCategory: 'savings',
      })
    }

    return json({ nodes, links })
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
}

// ── Seed default categories ──────────────────────────────────────────────────

export async function seedCategories(): Promise<Response> {
  const pid = await adapter.getCurrentProfileId()
  await seedDefaultCategories(pid)
  const cats = await adapter.listCategories()
  return json({ ok: true, categories: cats.length })
}
