/**
 * Local API Handlers — IndexedDB-backed route handlers for serverless mode
 */
import {
  calculateSchedule,
  getSummary,
} from '../loanCalculator'
import {
  generateAnnualPdf,
  generateMonthlyPdf,
  generatePlSummaryPdf,
  generateTaxSummaryPdf,
} from './clientPdfReports'
import {
  adapter,
  getAmount,
  idParam,
  json,
  monthStart,
  nextMonth,
  notFound,
  ok,
  prevMonth,
} from './handlers/helpers'
import { getDB, seedDefaultCategories, seedDemoProfiles } from './idb'
import { getStorageMode, setStorageMode } from './storageFactory'
import type { WorkBook } from 'xlsx'
import type { StorageMode } from './storageFactory'

// Re-export budgets from the split module
export {
  budgetsAlerts,
  budgetsAllocate,
  budgetsCreate,
  budgetsDelete,
  budgetsDuplicateLast,
  budgetsForecast,
  budgetsFromExpenses,
  budgetsGet,
  budgetsHistory,
  budgetsImprovements,
  budgetsList,
  budgetsRollover,
  budgetsSummary,
  budgetsUpdate,
  budgetsZeroBased,
  budgetsZeroBasedSummary,
} from './handlers/budgets'

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

  // Compute per-profile counts for the Settings Household Overview table
  const result = await Promise.all(
    profiles.map(async (p: { id: number; name: string }) => {
      const pid = p.id
      let txCount = 0
      let acctCount = 0
      let budgetCount = 0
      try {
        txCount = await db.countFromIndex('transactions', 'by_profile', pid)
      } catch { /* store may not exist */ }
      try {
        acctCount = await db.countFromIndex('accounts', 'by_profile', pid)
      } catch { /* store may not exist */ }
      try {
        budgetCount = await db.countFromIndex('budgets', 'by_profile', pid)
      } catch { /* store may not exist */ }
      return {
        ...p,
        transaction_count: txCount,
        account_count: acctCount,
        budget_count: budgetCount,
      }
    })
  )

  return json(result)
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

export async function profilesUpdate(
  params: Record<string, string>,
  body: unknown
): Promise<Response> {
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
  const txns = await adapter.listTransactions(
    filters as Parameters<typeof adapter.listTransactions>[0]
  )

  // Enrich transactions with category name/color (like the backend SQL JOIN)
  const db = await getDB()
  const pid = await adapter.getCurrentProfileId()
  const cats = await db.getAllFromIndex('categories', 'by_profile', pid)
  const catMap = new Map(cats.map((c) => [c.id, c]))
  const enriched = txns.map((t) => {
    const cat = catMap.get(t.category_id)
    return {
      ...t,
      category_name: cat?.name || null,
      category_color: cat?.color || null,
    }
  })

  return json(enriched)
}

export async function transactionsCreate(body: unknown): Promise<Response> {
  if (!body || typeof body !== 'object') return json({ error: 'Invalid transaction data' }, 400)
  const tx = body as Record<string, unknown>
  tx.profile_id = adapter.getCurrentProfileId ? await adapter.getCurrentProfileId() : 1
  const id = await adapter.createTransaction(
    tx as unknown as Parameters<typeof adapter.createTransaction>[0]
  )
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
  body: unknown
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
  const txns = await adapter.listTransactions(
    filters as Parameters<typeof adapter.listTransactions>[0] | undefined
  )
  const csv = ['date,type,description,amount,currency,category_id,notes']
  for (const t of txns) {
    csv.push(
      [
        t.date,
        t.type,
        `"${t.description}"`,
        t.amount,
        t.currency || 'EUR',
        t.category_id || '',
        `"${t.notes || ''}"`,
      ].join(',')
    )
  }
  return new Response(csv.join('\n'), {
    status: 200,
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': 'attachment; filename=transactions.csv',
    },
  })
}

export async function transactionsSummary(): Promise<Response> {
  const txns = await adapter.listTransactions()
  const totalIncome = txns.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0)
  const totalExpenses = txns.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0)
  return json({ totalIncome, totalExpenses, count: txns.length })
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
  const id = await adapter.createCategory(
    cat as unknown as Parameters<typeof adapter.createCategory>[0]
  )
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
  body: unknown
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
  const id = await adapter.createAccount(
    acct as unknown as Parameters<typeof adapter.createAccount>[0]
  )
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
  body: unknown
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
  body: unknown
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


// ── Goals ────────────────────────────────────────────────────────────────────

export async function goalsList(): Promise<Response> {
  const goals = await adapter.listGoals()
  return json(goals)
}

export async function goalsCreate(body: unknown): Promise<Response> {
  if (!body || typeof body !== 'object') return json({ error: 'Invalid goal data' }, 400)
  const goal = body as Record<string, unknown>
  goal.profile_id = await adapter.getCurrentProfileId()
  const id = await adapter.createGoal(goal as unknown as Parameters<typeof adapter.createGoal>[0])
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
  body: unknown
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
  body: unknown
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
  const enriched = loans.map((l) => {
    const prepayments = (l as Record<string, unknown>).prepayments as Array<{ amount: number }> | undefined
    const total_prepaid = prepayments?.reduce((s, p) => s + (p.amount || 0), 0) || 0
    const prepayment_count = prepayments?.length || 0
    return { ...l, total_prepaid, prepayment_count }
  })
  return json(enriched)
}

export async function loansCreate(body: unknown): Promise<Response> {
  if (!body || typeof body !== 'object') return json({ error: 'Invalid loan data' }, 400)
  const loan = body as Record<string, unknown>
  loan.profile_id = await adapter.getCurrentProfileId()
  loan.rate_periods = loan.rate_periods || []
  loan.prepayments = loan.prepayments || []
  const id = await adapter.createLoan(loan as unknown as Parameters<typeof adapter.createLoan>[0])
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
  body: unknown
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
  body: unknown
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
  body: unknown
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
  body: unknown
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

// Loan amortization calculate (ported from backend/models/loanCalculator.js)
export async function loansCalculate(params: Record<string, string>): Promise<Response> {
  try {
    const db = await getDB()
    const loan = await db.get('loans', idParam(params))
    if (!loan) return notFound('Loan')

    const ratePeriods = (loan.rate_periods || []) as Array<{
      rate: number
      start_month: number
      end_month?: number | null
    }>
    const prepayments = (loan.prepayments || []) as Array<{
      month: number
      amount: number
      note?: string
    }>

    // Prepend the loan's initial rate as the first rate period
    const initialRatePeriod = {
      rate: (loan.interest_rate as number) || 0,
      start_month: 1,
      end_month: null as number | null,
    }
    const allRatePeriods = [initialRatePeriod, ...ratePeriods]

    const scheduleWithPrepayments = calculateSchedule(
      loan.principal as number,
      loan.start_date as string,
      loan.term_months as number,
      allRatePeriods,
      prepayments
    )

    const scheduleNoPrepayments = calculateSchedule(
      loan.principal as number,
      loan.start_date as string,
      loan.term_months as number,
      allRatePeriods,
      []
    )

    const summary = getSummary(scheduleWithPrepayments, scheduleNoPrepayments)

    return json({
      schedule: scheduleWithPrepayments,
      summary,
      comparison: {
        withPrepayments: summary,
        withoutPrepayments: getSummary(scheduleNoPrepayments, scheduleNoPrepayments),
      },
    })
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
}

// ── Housing ──────────────────────────────────────────────────────────────────

export async function housingList(): Promise<Response> {
  const db = await getDB()
  const pids = adapter.getCurrentProfileIds()
  try {
    const all: Record<string, unknown>[] = []
    for (const pid of pids) {
      const rows = await db.getAllFromIndex('housings', 'by_profile', pid)
      all.push(...rows)
    }
    const total = all.reduce((s, h) => s + Math.abs(parseFloat(String((h.monthly_amount as number) || 0))), 0)
    return json({ housings: all, total_monthly: Math.round(total) })
  } catch {
    return json({ housings: [], total_monthly: 0 })
  }
}

export async function housingCreate(body: unknown): Promise<Response> {
  if (!body || typeof body !== 'object') return json({ error: 'Invalid data' }, 400)
  const b = body as Record<string, unknown>
  const property_name = (b.property_name as string) || (b.name as string) || ''
  const amount = parseFloat(String((b.monthly_amount as string | number) || 0))
  if (!property_name || isNaN(amount) || amount <= 0) {
    return json({ error: 'Property name and a valid monthly amount are required' }, 400)
  }
  const due_day = (b.due_day as number) || 1
  const due_month = (b.due_month as number) || new Date().getMonth() + 1
  const db = await getDB()
  const pid = await adapter.getCurrentProfileId()
  const id = await db.add('housings', {
    profile_id: pid,
    name: property_name,
    type: (b.type as string) || 'other',
    monthly_amount: amount,
    due_date: `${String(due_month).padStart(2, '0')}-${String(due_day).padStart(2, '0')}`,
    due_day,
    due_month,
    autopay: b.autopay ? 1 : 0,
    notes: (b.notes as string) || '',
    created_at: new Date().toISOString(),
    property_name,
  })
  return json({ id }, 201)
}

export async function housingGet(params: Record<string, string>): Promise<Response> {
  const db = await getDB()
  const h = await db.get('housings', idParam(params))
  return h ? json(h) : notFound('Housing expense')
}

export async function housingUpdate(params: Record<string, string>, body: unknown): Promise<Response> {
  const db = await getDB()
  const h = await db.get('housings', idParam(params))
  if (!h) return notFound('Housing expense')
  if (body && typeof body === 'object') {
    const b = body as Record<string, unknown>
    if (b.property_name !== undefined) h.name = b.property_name
    if (b.type !== undefined) h.type = b.type
    if (b.monthly_amount !== undefined) h.monthly_amount = parseFloat(String((b.monthly_amount as string | number) || 0))
    if (b.due_day !== undefined) h.due_day = Number(b.due_day)
    if (b.due_month !== undefined) h.due_month = Number(b.due_month)
    if (b.autopay !== undefined) h.autopay = b.autopay ? 1 : 0
    if (b.notes !== undefined) h.notes = b.notes
    if (b.due_day !== undefined || b.due_month !== undefined) {
      h.due_date = `${String(h.due_month || 1).padStart(2, '0')}-${String(h.due_day || 1).padStart(2, '0')}`
    }
    h.property_name = h.name
  }
  await db.put('housings', h)
  return ok()
}

export async function housingDelete(params: Record<string, string>): Promise<Response> {
  const db = await getDB()
  await db.delete('housings', idParam(params))
  return ok()
}

// ── Bills ────────────────────────────────────────────────────────────────────

// Helper: determine if a bill is paid for the current billing period (mirrors backend logic)
function isBillPaidForCurrentPeriod(bill: Record<string, unknown>, now: Date): boolean {
  if (!bill.last_paid_date && !bill.last_paid) return false
  const lastPaid = new Date((bill.last_paid_date || bill.last_paid) as string)
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)

  const frequency = (bill.frequency as string) || 'monthly'
  if (frequency === 'monthly') {
    return lastPaid.getMonth() === today.getMonth() && lastPaid.getFullYear() === today.getFullYear()
  } else if (frequency === 'weekly') {
    const weekAgo = new Date(today)
    weekAgo.setDate(weekAgo.getDate() - 7)
    return lastPaid >= weekAgo
  } else if (frequency === 'biweekly') {
    const twoWeeksAgo = new Date(today)
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14)
    return lastPaid >= twoWeeksAgo
  } else if (frequency === 'yearly') {
    return lastPaid.getFullYear() === today.getFullYear()
  }
  return false
}

export async function billsList(query?: URLSearchParams): Promise<Response> {
  const db = await getDB()
  const pids = adapter.getCurrentProfileIds()
  try {
    const all: Record<string, unknown>[] = []
    for (const pid of pids) {
      const rows = await db.getAllFromIndex('bills', 'by_profile', pid)
      all.push(...rows)
    }

    const now = new Date()
    const billsWithStatus = all.map((b) => ({
      ...b,
      paid: isBillPaidForCurrentPeriod(b, now),
    }))

    // Filter by paid status if requested
    const paidParam = query?.get('paid')
    if (paidParam === 'true') return json(billsWithStatus.filter((b) => b.paid))
    if (paidParam === 'false') return json(billsWithStatus.filter((b) => !b.paid))

    return json(billsWithStatus)
  } catch {
    return json([])
  }
}

export async function billsCreate(body: unknown): Promise<Response> {
  if (!body || typeof body !== 'object') return json({ error: 'Invalid data' }, 400)
  const b = body as Record<string, unknown>
  const name = ((b.name as string) || '').trim()
  const amount = parseFloat(String((b.amount as string | number) || 0))
  if (!name || isNaN(amount) || amount <= 0) {
    return json({ error: 'Name and a valid amount are required' }, 400)
  }
  const db = await getDB()
  const pid = await adapter.getCurrentProfileId()
  const id = await db.add('bills', {
    profile_id: pid,
    name,
    amount,
    frequency: (b.frequency as string) || 'monthly',
    due_date: (b.due_date as string) || '',
    day_of_month: (b.day_of_month as number) || 1,
    category_id: b.category_id !== null && b.category_id !== undefined ? Number(b.category_id) : null,
    recurring: b.recurring !== false ? 1 : 0,
    is_active: 1,
    notes: (b.notes as string) || '',
    created_at: new Date().toISOString(),
  })
  return json({ id }, 201)
}

export async function billsGet(params: Record<string, string>): Promise<Response> {
  const db = await getDB()
  const b = await db.get('bills', idParam(params))
  return b ? json(b) : notFound('Bill')
}

export async function billsUpdate(params: Record<string, string>, body: unknown): Promise<Response> {
  const db = await getDB()
  const bill = await db.get('bills', idParam(params))
  if (!bill) return notFound('Bill')
  if (body && typeof body === 'object') {
    const b = body as Record<string, unknown>
    if (b.name !== undefined) bill.name = b.name
    if (b.amount !== undefined) bill.amount = parseFloat(String((b.amount as string | number) || 0))
    if (b.frequency !== undefined) bill.frequency = b.frequency
    if (b.due_date !== undefined) bill.due_date = b.due_date
    if (b.day_of_month !== undefined) bill.day_of_month = Number(b.day_of_month)
    if (b.category_id !== undefined) bill.category_id = b.category_id !== null ? Number(b.category_id) : null
    if (b.recurring !== undefined) bill.recurring = b.recurring ? 1 : 0
    if (b.is_active !== undefined) bill.is_active = b.is_active ? 1 : 0
    if (b.notes !== undefined) bill.notes = b.notes
  }
  await db.put('bills', bill)
  return ok()
}

export async function billsDelete(params: Record<string, string>): Promise<Response> {
  const db = await getDB()
  await db.delete('bills', idParam(params))
  return ok()
}

export async function billsUpcoming(): Promise<Response> {
  const db = await getDB()
  const pids = adapter.getCurrentProfileIds()
  try {
    const all: Record<string, unknown>[] = []
    for (const pid of pids) {
      const rows = await db.getAllFromIndex('bills', 'by_profile', pid)
      all.push(...rows)
    }
    const active = all.filter((b: Record<string, unknown>) => b.is_active !== 0)
    const today = new Date()
    const dayOfMonth = today.getDate()
    const upcoming = active
      .filter((b: Record<string, unknown>) => {
        // Derive day of month from due_date (format: YYYY-MM-DD) or fall back to day_of_month field
        const dueDate = (b.due_date as string) || ''
        const dom = dueDate ? parseInt(dueDate.split('-')[2], 10) : (Number(b.day_of_month) || 1)
        return dom >= dayOfMonth
      })
      .sort((a: Record<string, unknown>, b: Record<string, unknown>) => {
        const aDate = (a.due_date as string) || ''
        const bDate = (b.due_date as string) || ''
        const aDom = aDate ? parseInt(aDate.split('-')[2], 10) : (Number(a.day_of_month) || 1)
        const bDom = bDate ? parseInt(bDate.split('-')[2], 10) : (Number(b.day_of_month) || 1)
        return aDom - bDom
      })
    return json(upcoming)
  } catch {
    return json([])
  }
}

export async function billsPayOrMarkPaid(params: Record<string, string>): Promise<Response> {
  const db = await getDB()
  const bill = await db.get('bills', idParam(params))
  if (!bill) return notFound('Bill')
  const now = new Date().toISOString().substring(0, 10)
  bill.last_paid_date = now
  bill.last_paid = now
  await db.put('bills', bill)
  return ok()
}

// ── Category mappings ───────────────────────────────────────────────────────

export async function categoryMappingsList(): Promise<Response> {
  const db = await getDB()
  const pids = adapter.getCurrentProfileIds()
  try {
    if (db.objectStoreNames.contains('categoryMappings')) {
      const all: Record<string, unknown>[] = []
      for (const pid of pids) {
        const rows = await db.getAllFromIndex('categoryMappings', 'by_profile', pid)
        all.push(...rows)
      }
      return json(all)
    }
  } catch { /* store may not exist yet */ }
  return json([])
}

export async function categoryMappingsCreate(body: unknown): Promise<Response> {
  if (!body || typeof body !== 'object') return json({ error: 'Invalid data' }, 400)
  const db = await getDB()
  const pid = await adapter.getCurrentProfileId()
  if (db.objectStoreNames.contains('categoryMappings')) {
    const id = await db.add('categoryMappings', {
      profile_id: pid,
      pattern: (body as Record<string, unknown>).pattern || '',
      category_id: (body as Record<string, unknown>).category_id || null,
      created_at: new Date().toISOString(),
    })
    return json({ id }, 201)
  }
  return json({ id: 1 }, 201)
}

export async function categoryMappingsDelete(params: Record<string, string>): Promise<Response> {
  const db = await getDB()
  if (db.objectStoreNames.contains('categoryMappings')) {
    await db.delete('categoryMappings', idParam(params))
  }
  return ok()
}

// ── Tags ────────────────────────────────────────────────────────────────────

export async function tagsList(): Promise<Response> {
  const db = await getDB()
  const pids = adapter.getCurrentProfileIds()
  try {
    const all: Record<string, unknown>[] = []
    for (const pid of pids) {
      const rows = await db.getAllFromIndex('tags', 'by_profile', pid)
      all.push(...rows)
    }
    return json(all)
  } catch {
    return json([])
  }
}

export async function tagsCreate(body: unknown): Promise<Response> {
  if (!body || typeof body !== 'object') return json({ error: 'Invalid data' }, 400)
  const b = body as Record<string, unknown>
  const name = (b.name as string) || ''
  if (!name.trim()) return json({ error: 'Tag name is required' }, 400)
  const db = await getDB()
  const pid = await adapter.getCurrentProfileId()
  const id = await db.add('tags', {
    profile_id: pid,
    name: name.trim(),
    color: (b.color as string) || '#6366f1',
    created_at: new Date().toISOString(),
  })
  return json({ id, name: name.trim(), color: (b.color as string) || '#6366f1' }, 201)
}

export async function tagsGetTransactions(params: Record<string, string>): Promise<Response> {
  // Return transactions associated with a tag
  const db = await getDB()
  const pid = await adapter.getCurrentProfileId()
  const tagId = idParam(params)
  const allTxns = await db.getAllFromIndex('transactions', 'by_profile', pid)
  const filtered = allTxns.filter((t: Record<string, unknown>) => {
    const tagIds = (t.tag_ids as number[]) || []
    return tagIds.includes(tagId)
  })
  return json(filtered)
}

// ── Recurring ───────────────────────────────────────────────────────────────

export async function recurringList(): Promise<Response> {
  const db = await getDB()
  const pids = adapter.getCurrentProfileIds()
  try {
    const all: Record<string, unknown>[] = []
    for (const pid of pids) {
      const rows = await db.getAllFromIndex('recurring', 'by_profile', pid)
      all.push(...rows)
    }
    return json(all)
  } catch {
    return json([])
  }
}

export async function recurringCreate(body: unknown): Promise<Response> {
  if (!body || typeof body !== 'object') return json({ error: 'Invalid data' }, 400)
  const b = body as Record<string, unknown>
  const db = await getDB()
  const pid = await adapter.getCurrentProfileId()
  const id = await db.add('recurring', {
    profile_id: pid,
    description: (b.description as string) || '',
    amount: parseFloat(String((b.amount as string | number) || 0)),
    type: (b.type as string) || 'expense',
    frequency: (b.frequency as string) || 'monthly',
    day_of_month: (b.day_of_month as number) || (b.day as number) || 1,
    next_date: (b.next_date as string) || '',
    category_id: (b.category_id as number) || null,
    notes: (b.notes as string) || '',
    is_active: 1,
    created_at: new Date().toISOString(),
  })
  return json({ id, profile_id: pid }, 201)
}

export async function recurringUpdate(params: Record<string, string>, body: unknown): Promise<Response> {
  const db = await getDB()
  const item = await db.get('recurring', idParam(params))
  if (!item) return notFound('Recurring transaction')
  if (body && typeof body === 'object') {
    const b = body as Record<string, unknown>
    if (b.description !== undefined) item.description = b.description
    if (b.amount !== undefined) item.amount = parseFloat(String((b.amount as string | number) || 0))
    if (b.type !== undefined) item.type = b.type
    if (b.frequency !== undefined) item.frequency = b.frequency
    if (b.day_of_month !== undefined) item.day_of_month = b.day_of_month
    if (b.day !== undefined) item.day_of_month = b.day
    if (b.next_date !== undefined) item.next_date = b.next_date
    if (b.category_id !== undefined) item.category_id = b.category_id
    if (b.notes !== undefined) item.notes = b.notes
    if (b.is_active !== undefined) item.is_active = b.is_active ? 1 : 0
  }
  await db.put('recurring', item)
  return ok()
}

export async function recurringDelete(params: Record<string, string>): Promise<Response> {
  const db = await getDB()
  await db.delete('recurring', idParam(params))
  return ok()
}

export async function recurringUpcoming(): Promise<Response> {
  const db = await getDB()
  const pid = await adapter.getCurrentProfileId()
  try {
    const all = await db.getAllFromIndex('recurring', 'by_profile', pid)
    const active = all.filter((r: Record<string, unknown>) => r.is_active !== 0)
    return json(active)
  } catch {
    return json([])
  }
}

export async function recurringPopulate(params: Record<string, string>): Promise<Response> {
  const db = await getDB()
  const item = await db.get('recurring', idParam(params))
  if (!item) return notFound('Recurring transaction')

  // Create a transaction from the recurring template
  const pid = await adapter.getCurrentProfileId()
  const accountId = item.account_id || null
  await db.add('transactions', {
    profile_id: pid,
    description: item.description,
    amount: item.amount,
    type: item.type,
    category_id: item.category_id,
    date: new Date().toISOString().substring(0, 10),
    currency: 'EUR',
    reconciled: 0,
    notes: item.notes || '',
    account_id: accountId,
  })

  // Update next_date
  const nextDate = new Date()
  if (item.frequency === 'monthly') nextDate.setMonth(nextDate.getMonth() + 1)
  else if (item.frequency === 'weekly') nextDate.setDate(nextDate.getDate() + 7)
  else if (item.frequency === 'biweekly') nextDate.setDate(nextDate.getDate() + 14)
  else nextDate.setMonth(nextDate.getMonth() + 1)
  item.next_date = nextDate.toISOString().substring(0, 10)
  await db.put('recurring', item)

  return json({ ok: true })
}

// ── Export / Import / Clear ──────────────────────────────────────────────────

export async function exportAll(): Promise<Response> {
  const data = await adapter.exportData()
  return json(data)
}

export async function exportByType(
  params: Record<string, string>,
  query: URLSearchParams
): Promise<Response> {
  const type = params.p1
  const fmt = query.get('format') || 'json'
  const data = await adapter.exportData()

  if (fmt === 'csv' && type === 'transactions') {
    const csv = ['date,type,description,amount,currency,category_id,notes']
    for (const t of data.transactions) {
      csv.push(
        [t.date, t.type, `"${t.description}"`, t.amount, t.currency, `"${t.notes || ''}"`].join(',')
      )
    }
    return new Response(csv.join('\n'), {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename=${type}.csv`,
      },
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

export async function deleteAllTransactions(): Promise<Response> {
  const db = await getDB()
  const pid = await adapter.getCurrentProfileId()
  const txns = await db.getAllFromIndex('transactions', 'by_profile', pid)
  for (const t of txns) {
    await db.delete('transactions', t.id)
  }
  return ok({ message: 'All transactions deleted' })
}

export async function deleteAllCategories(): Promise<Response> {
  const db = await getDB()
  const pid = await adapter.getCurrentProfileId()
  const cats = await db.getAllFromIndex('categories', 'by_profile', pid)
  for (const c of cats) {
    await db.delete('categories', c.id)
  }
  await seedDefaultCategories(pid)
  return ok({ message: 'Categories reset to defaults' })
}

export async function reseedDemoData(): Promise<Response> {
  await adapter.clearAllData()
  localStorage.removeItem('finance_had_profiles')
  await seedDemoProfiles()
  return ok({ message: 'Demo data reseeded' })
}


export async function dashboardMain(query: URLSearchParams): Promise<Response> {
  try {
    const now = new Date()
    const allTime = query.get('all') === 'true'
    const dateFrom = query.get('date_from')
    const dateTo = query.get('date_to')
    const year = parseInt(query.get('year')!) || now.getFullYear()
    const month = parseInt(query.get('month')!) || now.getMonth() + 1

    let startDate: string
    let endDate: string
    if (allTime) {
      startDate = '0000-01-01'
      endDate = '9999-12-31'
    } else if (dateFrom && dateTo) {
      startDate = dateFrom
      endDate = dateTo
    } else {
      startDate = monthStart(year, month)
      const lastDay = new Date(year, month, 0).getDate()
      endDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
    }

    // Previous period (for MoM delta)
    const pm = prevMonth(year, month)
    const prevStart = monthStart(pm.year, pm.month)
    const prevLastDay = new Date(pm.year, pm.month, 0).getDate()
    const prevEnd = `${pm.year}-${String(pm.month).padStart(2, '0')}-${String(prevLastDay).padStart(2, '0')}`

    const profileTxns = await adapter.listTransactions()

    // Current period
    const currentTxns = profileTxns.filter((t) => t.date >= startDate && t.date <= endDate)
    const currentIncome = currentTxns
      .filter((t) => t.type === 'income')
      .reduce((s, t) => s + getAmount(t as unknown as Record<string, unknown>), 0)
    const currentExpense = currentTxns
      .filter((t) => t.type === 'expense')
      .reduce((s, t) => s + getAmount(t as unknown as Record<string, unknown>), 0)

    // Previous month
    const prevTxns = profileTxns.filter((t) => t.date >= prevStart && t.date <= prevEnd)
    const prevIncome = prevTxns
      .filter((t) => t.type === 'income')
      .reduce((s, t) => s + getAmount(t as unknown as Record<string, unknown>), 0)
    const prevExpense = prevTxns
      .filter((t) => t.type === 'expense')
      .reduce((s, t) => s + getAmount(t as unknown as Record<string, unknown>), 0)

    // Recent transactions (top 10) with category join
    const cats = await adapter.listCategories()
    const catMap = new Map(cats.map((c) => [c.id, c]))
    const recent = [...currentTxns]
      .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id)
      .slice(0, 10)
      .map((t) => {
        const cat = catMap.get(t.category_id!)
        return {
          ...t,
          category_name: cat?.name || 'Uncategorized',
          category_color: cat?.color || '#999',
          category_icon: cat?.icon || 'question_mark',
        }
      })

    // Category breakdown (expenses)
    const expenseByCat: Record<
      string,
      { category_name: string; category_color: string; total: number }
    > = {}
    for (const t of currentTxns.filter((t) => t.type === 'expense')) {
      const cat = catMap.get(t.category_id!)
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
      momBalanceDelta: currentIncome - currentExpense - (prevIncome - prevExpense),
    })
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
}

export async function dashboardSummary(query: URLSearchParams): Promise<Response> {
  try {
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

    const profileTxns = await adapter.listTransactions()
    const periodTxns = profileTxns.filter((t) => t.date >= startDate && t.date < endDate)

    const income = periodTxns
      .filter((t) => t.type === 'income')
      .reduce((s, t) => s + getAmount(t as unknown as Record<string, unknown>), 0)
    const expense = periodTxns
      .filter((t) => t.type === 'expense')
      .reduce((s, t) => s + getAmount(t as unknown as Record<string, unknown>), 0)
    const transfer = periodTxns
      .filter((t) => t.type === 'transfer')
      .reduce((s, t) => s + getAmount(t as unknown as Record<string, unknown>), 0)

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
    const prevIncome = prevTxns
      .filter((t) => t.type === 'income')
      .reduce((s, t) => s + getAmount(t as unknown as Record<string, unknown>), 0)
    const prevExpense = prevTxns
      .filter((t) => t.type === 'expense')
      .reduce((s, t) => s + getAmount(t as unknown as Record<string, unknown>), 0)

    // YTD
    const ytdStart = `${y}-01-01`
    const ytdTxns = profileTxns.filter((t) => t.date >= ytdStart)
    const ytdIncome = ytdTxns
      .filter((t) => t.type === 'income')
      .reduce((s, t) => s + getAmount(t as unknown as Record<string, unknown>), 0)
    const ytdExpense = ytdTxns
      .filter((t) => t.type === 'expense')
      .reduce((s, t) => s + getAmount(t as unknown as Record<string, unknown>), 0)

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
    const monthsCount = parseInt(query.get('months')!) || 12
    const endDate = new Date()
    const startDate = new Date()
    startDate.setMonth(startDate.getMonth() - monthsCount + 1)
    startDate.setDate(1)
    const startStr = startDate.toISOString().split('T')[0]
    const endStr = endDate.toISOString().split('T')[0]

    const allTxns = await adapter.listTransactions()
    const rangeTxns = allTxns.filter((t) => t.date >= startStr && t.date <= endStr)

    // By category
    const cats = await adapter.listCategories()
    const catMap = new Map(cats.map((c) => [c.id, c]))
    const byCat: Record<
      string,
      { name: string; color: string; icon: string | null; total: number; count: number }
    > = {}
    for (const t of rangeTxns.filter((t) => t.type === 'expense')) {
      const cat = catMap.get(t.category_id!)
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
      if (t.type === 'income')
        monthlyMap[mo].income += getAmount(t as unknown as Record<string, unknown>)
      if (t.type === 'expense')
        monthlyMap[mo].expense += getAmount(t as unknown as Record<string, unknown>)
    }
    const monthly = Object.values(monthlyMap).sort((a, b) => a.month.localeCompare(b.month))

    let running = 0
    const cashFlow = monthly.map((m) => {
      running += m.income - m.expense
      return { ...m, cumulative: running }
    })

    // Get currency
    const settings = await adapter.getSettings()
    const currency =
      (settings as Record<string, unknown>).local_currency ||
      (settings as Record<string, unknown>).currency ||
      'EUR'

    return json({ byCategory, monthly, cashFlow, currency })
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
}

export async function dashboardNetWorth(): Promise<Response> {
  try {
    const accts = await adapter.listAccounts()
    const totalNetWorth = accts.reduce((s, a) => s + (a.balance || 0), 0)

    // Monthly net flow from all transactions
    const allTxns = await adapter.listTransactions()
    const profileTxns = allTxns.filter(
      (t) => t.type === 'income' || t.type === 'expense'
    )
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
    const years = [...new Set(allTxns.map((t) => parseInt(t.date.substring(0, 4))))].sort(
      (a, b) => b - a
    )
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
    const lastDay = month ? new Date(year, month, 0) : new Date(year, 11, 31)

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
    const rows = allTxns.filter(
      (t) => t.date.startsWith(String(year)) && t.type === type
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
      (t) => t.type === type && t.date >= startStr && t.date <= endStr
    )

    // Generate labels based on view level
    const labels: string[] = []
    const periodMap = new Map<string, number>()
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    const monthNames = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ]
    const monthNamesFull = [
      'January',
      'February',
      'March',
      'April',
      'May',
      'June',
      'July',
      'August',
      'September',
      'October',
      'November',
      'December',
    ]

    if (week && month) {
      const lastDay = new Date(year, month, 0).getDate()
      const ws = (week - 1) * 7 + 1
      const we = Math.min(week * 7, lastDay)
      for (let d = ws; d <= we; d++) {
        const date = new Date(year, month - 1, d)
        labels.push(dayNames[date.getDay()])
        periodMap.set(
          `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
          labels.length - 1
        )
      }
    } else if (month) {
      const lastDay = new Date(year, month, 0).getDate()
      for (let d = 1; d <= lastDay; d++) {
        labels.push(`${monthNamesFull[month - 1]} ${d}`)
        periodMap.set(
          `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
          labels.length - 1
        )
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
      catDataMap[c.id] = {
        category: c.name,
        color: c.color,
        data: new Array(labels.length).fill(0),
      }
    }

    for (const t of txns) {
      const dateKey = month ? t.date : t.date.substring(0, 7)
      const idx = periodMap.get(dateKey)
      const catId = t.category_id
      if (idx !== undefined && catId !== undefined && catDataMap[catId]) {
        catDataMap[catId].data[idx] += getAmount(t as unknown as Record<string, unknown>)
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
        (t) => t.type === type && t.date >= cmpStart && t.date <= cmpEnd
      )

      const cmpCatData: Record<string, { category: string; color: string; data: number[] }> = {}
      for (const c of cats) {
        cmpCatData[c.id] = {
          category: c.name,
          color: c.color,
          data: new Array(labels.length).fill(0),
        }
      }
      for (const t of cmpTxns) {
        const dateKey = month ? t.date : t.date.substring(0, 7)
        const idx = periodMap.get(dateKey)
        const cmpCatId = t.category_id
        if (idx !== undefined && cmpCatId !== undefined && cmpCatData[cmpCatId]) {
          cmpCatData[cmpCatId].data[idx] += getAmount(t as unknown as Record<string, unknown>)
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
    const year = parseInt(query.get('year')!) || new Date().getFullYear()
    const month = query.get('month') ? parseInt(query.get('month')!) : null

    if (!month) return json({ nodes: [], links: [] })

    const lastDay = new Date(year, month, 0).getDate()
    const startStr = `${year}-${String(month).padStart(2, '0')}-01`
    const endStr = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`

    const allTxns = await adapter.listTransactions()
    const budgets = await adapter.listBudgets()
    const cats = await adapter.listCategories()

    // Get budgets for this month (deduplicate by category_id — listBudgets returns all historical records)
    const budgetMap = new Map<number, (typeof budgets)[number]>()
    for (const b of budgets) {
      if (b.period === 'monthly' && !budgetMap.has(b.category_id)) {
        budgetMap.set(b.category_id, b)
      }
    }
    const activeBudgets = Array.from(budgetMap.values())

    // Get actual spending for this month
    const profileTxns = allTxns.filter(
      (t) => t.type === 'expense' && t.date >= startStr && t.date <= endStr
    )

    const actualMap = new Map<number, number>()
    for (const t of profileTxns) {
      const prev = actualMap.get(t.category_id!) || 0
      actualMap.set(t.category_id!, prev + getAmount(t as unknown as Record<string, unknown>))
    }

    const catMap = new Map(cats.map((c) => [c.id, c]))

    interface SankeyNode {
      name: string
      category: string
      color?: string
    }
    interface SankeyLink {
      source: string
      target: string
      value: number
      sourceCategory: string
      targetCategory: string
    }

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

// ── Stats monthly ────────────────────────────────────────────────────────────

export async function statsMonthly(query: URLSearchParams): Promise<Response> {
  try {
    const months = parseInt(query.get('months') || '24')
    const profileTxns = await adapter.listTransactions()

    const now = new Date()
    const result: Array<{ month: string; income: number; expense: number }> = []
    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const monthStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      const monthTxns = profileTxns.filter((t) => t.date.startsWith(monthStr))
      const income = monthTxns.filter((t) => t.type === 'income').reduce((s, t) => s + getAmount(t as unknown as Record<string, unknown>), 0)
      const expense = monthTxns.filter((t) => t.type === 'expense').reduce((s, t) => s + getAmount(t as unknown as Record<string, unknown>), 0)
      result.push({ month: monthStr, income, expense })
    }
    return json(result)
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

// ── Calculators ────────────────────────────────────────────────────────────────

export async function compoundInterest(body: unknown): Promise<Response> {
  try {
    if (!body || typeof body !== 'object') return json({ error: 'Invalid data' }, 400)
    const {
      principal = 0,
      monthlyContribution = 0,
      annualReturn = 7,
      years = 10,
      compoundsPerYear = 12,
    } = body as Record<string, number>

    const rate = annualReturn / 100
    const n = compoundsPerYear

    const projection = []
    let balance = principal
    let totalContributions = principal

    for (let y = 0; y <= years; y++) {
      projection.push({
        year: y,
        balance: Math.round(balance),
        contributions: Math.round(totalContributions),
        interest: Math.round(balance - totalContributions),
      })

      const yearlyContribution = monthlyContribution * 12
      for (let p = 0; p < n; p++) {
        balance = balance * (1 + rate / n) + monthlyContribution
      }
      totalContributions += yearlyContribution
    }

    const scenarios = [
      { name: 'Conservative', return: 4, color: '#3b82f6' },
      { name: 'Moderate', return: 6, color: '#10b981' },
      { name: 'Optimistic', return: 8, color: '#8b5cf6' },
    ].map((s) => {
      const r = s.return / 100
      let bal = principal
      let contrib = principal
      for (let y = 0; y <= years; y++) {
        if (y > 0) {
          for (let p = 0; p < n; p++) {
            bal = bal * (1 + r / n) + monthlyContribution
          }
          contrib += monthlyContribution * 12
        }
      }
      return {
        name: s.name,
        return: s.return,
        color: s.color,
        finalBalance: Math.round(bal),
        totalContributions: Math.round(contrib),
        interest: Math.round(bal - contrib),
      }
    })

    return json({
      projection,
      principal,
      monthlyContribution,
      annualReturn,
      years,
      finalBalance: projection[projection.length - 1].balance,
      totalContributions: projection[projection.length - 1].contributions,
      totalInterest: projection[projection.length - 1].interest,
      scenarios,
    })
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
}

export async function retirementCalculate(body: unknown): Promise<Response> {
  try {
    if (!body || typeof body !== 'object') return json({ error: 'Invalid data' }, 400)
    const {
      currentAge = 30,
      retirementAge = 65,
      currentSavings = 0,
      monthlyContribution = 0,
      annualReturn = 7,
      annualExpenses = 30000,
      withdrawalRate = 4,
      inflationRate: _inflationRate = 2,
      expensesAtRetirement = null,
      country = '',
    } = body as Record<string, unknown>

    const colMultipliers: Record<string, number> = {
      usa: 1.0,
      europe: 0.9,
      switzerland: 1.3,
      croatia: 0.6,
      japan: 0.85,
    }
    const colFactor = colMultipliers[country as string] || 1.0
    const adjustedExpenses =
      expensesAtRetirement !== null
        ? (expensesAtRetirement as number)
        : (annualExpenses as number) * colFactor

    const fireNumber = adjustedExpenses / ((withdrawalRate as number) / 100)

    const monthsToRetirement = ((retirementAge as number) - (currentAge as number)) * 12
    if (monthsToRetirement <= 0) {
      return json({ error: 'Retirement age must be greater than current age' }, 400)
    }
    const monthlyReturn = (annualReturn as number) / 100 / 12

    let savings = currentSavings as number
    const timeline = []
    for (let m = 0; m <= monthsToRetirement; m++) {
      if (m % 12 === 0) {
        timeline.push({
          year: (currentAge as number) + m / 12,
          age: Math.round((currentAge as number) + m / 12),
          savings: Math.round(savings),
        })
      }
      savings = savings * (1 + monthlyReturn) + (monthlyContribution as number)
    }

    let fireMonth: number | null = null
    let fireAge: number | null = null
    savings = currentSavings as number
    for (let m = 1; m <= monthsToRetirement * 2; m++) {
      savings = savings * (1 + monthlyReturn) + (monthlyContribution as number)
      if (savings >= fireNumber && fireMonth === null) {
        fireMonth = m
        fireAge = (currentAge as number) + m / 12
      }
    }

    let retirementSavings = savings
    const withdrawalTimeline = []
    if (fireMonth !== null) {
      for (let y = 0; y < 20; y++) {
        retirementSavings =
          retirementSavings * (1 + (annualReturn as number) / 100) - adjustedExpenses
        withdrawalTimeline.push({
          year: y + 1,
          savings: Math.max(0, Math.round(retirementSavings)),
          balance: Math.max(0, Math.round(retirementSavings)),
        })
      }
    }

    const scenarios = [
      {
        name: 'Conservative',
        ret: 4,
        fireNumber: Math.round(adjustedExpenses / 0.04),
        fireAge: null as number | null,
      },
      {
        name: 'Moderate',
        ret: 6,
        fireNumber: Math.round(adjustedExpenses / 0.06),
        fireAge: null as number | null,
      },
      {
        name: 'Optimistic',
        ret: 8,
        fireNumber: Math.round(adjustedExpenses / 0.08),
        fireAge: null as number | null,
      },
    ].map((s) => {
      let m = currentSavings as number
      let fa: number | null = null
      for (let mo = 1; mo <= monthsToRetirement * 2; mo++) {
        m = m * (1 + s.ret / 100 / 12) + (monthlyContribution as number)
        if (m >= s.fireNumber && fa === null) {
          fa = (currentAge as number) + mo / 12
        }
      }
      return {
        name: s.name,
        return: s.ret,
        fireNumber: s.fireNumber,
        fireAge: fa ? Math.round(fa * 10) / 10 : null,
        reached: fa !== null,
        savingsAtFire: Math.round(m),
        shortfall: fa === null ? s.fireNumber - Math.round(m) : 0,
      }
    })

    return json({
      fireNumber: Math.round(fireNumber),
      fireAge: fireAge ? Math.round(fireAge * 10) / 10 : null,
      fireMonth,
      fireYear: fireAge ? Math.floor(fireAge) : null,
      savingsAtRetirement: Math.round(savings),
      monthsToFire: fireMonth,
      currentNWAtFire: Math.round(savings),
      traditionalRetirementAge: 65,
      timeline: timeline.filter(
        (t: Record<string, number>) => t.year % 5 === 0 || t.year === currentAge
      ),
      withdrawalTimeline,
      scenarios,
      inputs: {
        currentAge,
        retirementAge,
        currentSavings,
        monthlyContribution,
        annualReturn,
        adjustedExpenses,
        withdrawalRate,
        country,
        expensesAtRetirement,
      },
    })
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
}

export async function emergencyFund(): Promise<Response> {
  try {
    const db = await getDB()
    const pid = await adapter.getCurrentProfileId()

    const twelveMonthsAgo = new Date()
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12)
    const dateStr = twelveMonthsAgo.toISOString().split('T')[0]

    const txns = (await db.getAllFromIndex('transactions', 'by_profile', pid)).filter(
      (t: Record<string, unknown>) => t.type === 'expense' && (t.date as string) >= dateStr
    )

    const monthlyTotals: Record<string, number> = {}
    for (const r of txns) {
      const m = (r.date as string).substring(0, 7)
      monthlyTotals[m] = (monthlyTotals[m] || 0) + Math.abs(getAmount(r))
    }
    const monthsWithData = Object.keys(monthlyTotals).length
    const avgMonthlyExpenses =
      monthsWithData > 0
        ? Object.values(monthlyTotals).reduce((a, b) => a + b, 0) / monthsWithData
        : 0

    const accounts = await db.getAllFromIndex('accounts', 'by_profile', pid)
    const totalEmergencyFund = accounts
      .filter((a: Record<string, unknown>) => a.type === 'savings')
      .reduce((s: number, a: Record<string, unknown>) => s + ((a.balance as number) || 0), 0)

    const totalBalance = accounts.reduce(
      (s: number, a: Record<string, unknown>) => s + ((a.balance as number) || 0),
      0
    )

    const coverage = [
      { months: 3, label: 'Starter', ratio: 3 },
      { months: 6, label: 'Standard', ratio: 6 },
      { months: 12, label: 'Conservative', ratio: 12 },
    ].map((c) => {
      const required = avgMonthlyExpenses * c.months
      const current = totalEmergencyFund
      return {
        months: c.months,
        label: c.label,
        required: Math.round(required),
        current: Math.round(current),
        coveragePct: required > 0 ? Math.min(100, Math.round((current / required) * 100)) : 0,
        status: current >= required ? 'complete' : current >= required * 0.5 ? 'partial' : 'low',
      }
    })

    return json({
      avgMonthlyExpenses: Math.round(avgMonthlyExpenses),
      totalEmergencyFund: Math.round(totalEmergencyFund),
      totalBalance: Math.round(totalBalance),
      monthsWithData,
      coverage,
      accounts: accounts.filter((a: Record<string, unknown>) => a.type === 'savings'),
    })
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
}

export async function retirementProjection(query: URLSearchParams): Promise<Response> {
  try {
    const db = await getDB()

    const settingsRows = await db.getAll('settings')
    const settingsRow = settingsRows.find(
      (s: Record<string, unknown>) => s.key === 'retirement_goals'
    )
    const settings = settingsRow ? settingsRow.value : null

    const currentAge = parseFloat(query.get('currentAge') || query.get('age') || '30') || 30
    const retirementAge =
      parseFloat(query.get('retirementAge') || query.get('retire') || '65') || 65
    const currentSavings =
      parseFloat(query.get('currentSavings') || query.get('savings') || '0') || 0
    const monthlyContribution =
      parseFloat(query.get('monthlyContribution') || query.get('contribution') || '500') || 0
    const annualReturn = parseFloat(query.get('annualReturn') || query.get('return') || '7') || 7
    const withdrawalRate = parseFloat(query.get('withdrawalRate') || query.get('rate') || '4') || 4
    const country = query.get('country') || 'US'

    const result = calculateRetirementProjection(
      currentAge,
      retirementAge,
      currentSavings,
      monthlyContribution,
      annualReturn,
      withdrawalRate,
      country,
      settings
    )

    return json(result)
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
}

export async function retirementGoals(): Promise<Response> {
  try {
    const pid = await adapter.getCurrentProfileId()
    const db = await getDB()

    const settingsRows = await db.getAll('settings')
    const settingsRow = settingsRows.find(
      (s: Record<string, unknown>) => s.key === 'retirement_goals'
    )
    const settings = settingsRow ? settingsRow.value : null

    const goals = await db.getAllFromIndex('goals', 'by_profile', pid)

    return json({
      settings,
      goals,
    })
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
}

export async function retirementGoalCreate(body: unknown): Promise<Response> {
  if (!body || typeof body !== 'object') return json({ error: 'Invalid goal data' }, 400)
  const goal = body as Record<string, unknown>
  goal.profile_id = await adapter.getCurrentProfileId()
  const id = await adapter.createGoal(goal as unknown as Parameters<typeof adapter.createGoal>[0])
  return json({ id, ...goal }, 201)
}

export async function retirementGoalUpdate(
  params: Record<string, string>,
  body: unknown
): Promise<Response> {
  if (!body || typeof body !== 'object') return json({ error: 'Invalid data' }, 400)
  await adapter.updateGoal(idParam(params), body as Record<string, unknown>)
  return ok()
}

export async function retirementGoalDelete(params: Record<string, string>): Promise<Response> {
  await adapter.deleteGoal(idParam(params))
  return ok()
}

function calculateRetirementProjection(
  currentAge: number,
  retirementAge: number,
  currentSavings: number,
  monthlyContribution: number,
  annualReturn: number,
  withdrawalRate: number,
  country: string,
  _settings: unknown
): Record<string, unknown> {
  const monthsToRetirement = (retirementAge - currentAge) * 12

  const countryAdjustment = country === 'US' ? 1.0 : 0.9
  const monthlyExpenses = (currentAge >= retirementAge ? 0 : 2500) * countryAdjustment
  const adjustedExpenses = country === 'US' && currentAge >= retirementAge ? 2500 : monthlyExpenses
  const annualWithdrawal = adjustedExpenses * 12

  let savings = currentSavings
  let investmentGains = 0
  let balance = savings

  for (let i = 1; i <= monthsToRetirement; i++) {
    const monthlyReturn = annualReturn / 100 / 12
    investmentGains += savings * monthlyReturn
    savings += monthlyContribution
    balance = savings + investmentGains
  }

  let retirementSavings = balance
  let yearsInRetirement = 0

  while (retirementSavings > 0 && yearsInRetirement < 50) {
    retirementSavings -= annualWithdrawal
    const annualReturnReal = (annualReturn - 3) / 100
    retirementSavings *= 1 + annualReturnReal
    yearsInRetirement++
  }

  const shortfall = retirementSavings < 0 ? Math.abs(retirementSavings) : 0
  const yearsOfRunway = Math.round(retirementSavings / (annualWithdrawal / 12))

  const projectedTotal = Math.round(balance)
  return {
    currentAge,
    retirementAge,
    currentSavings: Math.round(currentSavings),
    monthlyContribution: Math.round(monthlyContribution),
    annualReturn: Math.round(annualReturn),
    withdrawalRate: Math.round(withdrawalRate),
    country,
    expensesAtRetirement: Math.round(annualWithdrawal),
    retirementSavings: Math.round(retirementSavings),
    retirementAgeActual: retirementAge + yearsInRetirement,
    yearsInRetirement,
    balanceAtRetirement: Math.round(balance),
    finalBalance: Math.max(0, Math.round(retirementSavings)),
    shortfall,
    yearsOfRunway,
    // Frontend-compatible field names
    current_age: currentAge,
    retirement_age: retirementAge,
    current_amount: Math.round(currentSavings),
    annual_contribution: Math.round(monthlyContribution * 12),
    expected_return: Math.round(annualReturn),
    withdrawal_rate: Math.round(withdrawalRate),
    years_to_retire: retirementAge - currentAge,
    projected_total: projectedTotal,
    projected_income: Math.round(projectedTotal > 0 ? projectedTotal * 0.04 : 0),
    monthly_income_in_retirement: Math.round(projectedTotal > 0 ? projectedTotal * 0.04 / 12 : 0),
  }
}

// ── Receipts ────────────────────────────────────────────────────────────────

function getProfileIdsFromStorage(): number[] {
  const selected = localStorage.getItem('selectedProfileIds')
  if (selected) {
    try {
      const ids = JSON.parse(selected) as number[]
      if (Array.isArray(ids) && ids.length > 0) return ids
    } catch { /* ignore */ }
  }
  const stored = localStorage.getItem('currentProfileId')
  return stored ? [parseInt(stored, 10)] : [1]
}

function getProfileIdFromStorage(): number {
  const ids = getProfileIdsFromStorage()
  return ids[0]
}

// ── Reports ─────────────────────────────────────────────────────────────────

export async function reportHandler(ctx: {
  path: string
  query: URLSearchParams
}): Promise<Response> {
  const path = ctx.path
  const query = ctx.query

  // Client-side PDF generation with jsPDF + Chart.js
  if (path.includes('-pdf')) {
    try {
      const yearParam = query.get('year')
      const year = yearParam ? parseInt(yearParam, 10) : new Date().getFullYear()
      const month = query.get('month')
      const theme = query.get('theme') || 'light'
      const dark = theme === 'dark'

      let blob: Blob

      if (path.includes('monthly-pdf') && month) {
        blob = await generateMonthlyPdf(`${year}-${String(parseInt(month)).padStart(2, '0')}`, dark)
      } else if (path.includes('annual-pdf') || (path.includes('monthly-pdf') && !month)) {
        blob = await generateAnnualPdf(year, dark)
      } else if (path.includes('tax-summary-pdf')) {
        blob = await generateTaxSummaryPdf(year, dark)
      } else if (path.includes('pl-summary-pdf')) {
        blob = await generatePlSummaryPdf(year, dark)
      } else {
        return json({ error: 'Unknown PDF report type' }, 400)
      }

      return new Response(blob, {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="${path.replace('/api/reports/', '')}.pdf"`,
        },
      })
    } catch (err) {
      return json({ error: `PDF generation failed: ${(err as Error).message}` }, 500)
    }
  }

  const yearParam = query.get('year')
  if (!yearParam) return json({ error: 'year is required' }, 400)
  const year = parseInt(yearParam, 10)

  try {
    if (path === '/api/reports/tax-summary') {
      const db = await getDB()
      const profileId = getProfileIdFromStorage()
      const cats = await db.getAllFromIndex('categories', 'by_profile', profileId)
      const txns = await db.getAllFromIndex('transactions', 'by_profile', profileId)

      const startStr = `${year}-01-01`
      const endStr = `${year}-12-31`
      const rows = txns.filter(
        (t) => t.type === 'expense' && t.date >= startStr && t.date <= endStr
      )
      const catMap = new Map(cats.map((c) => [c.id, c]))

      const taxDeductible: { category_name: string; amount: number }[] = []
      const nonDeductible: { category_name: string; amount: number }[] = []
      for (const t of rows) {
        const cat = catMap.get(t.category_id)
        if (cat?.tax_deductible) {
          taxDeductible.push({ category_name: cat.name, amount: t.amount })
        } else {
          nonDeductible.push({ category_name: cat?.name || 'Unknown', amount: t.amount })
        }
      }

      const byCategory = (items: { category_name: string; amount: number }[]) => {
        const map: Record<string, { total: number; transactions: unknown[] }> = {}
        for (const r of items) {
          if (!map[r.category_name]) map[r.category_name] = { total: 0, transactions: [] }
          map[r.category_name].total += r.amount
        }
        return map
      }

      return json({
        year,
        taxDeductibleTotal: taxDeductible.reduce((s, r) => s + r.amount, 0),
        nonDeductibleTotal: nonDeductible.reduce((s, r) => s + r.amount, 0),
        totalExpenses: rows.reduce((s, r) => s + r.amount, 0),
        taxDeductibleCategories: byCategory(taxDeductible),
        nonDeductibleCategories: byCategory(nonDeductible),
        transactionCount: rows.length,
      })
    }

    if (path === '/api/reports/pl-summary') {
      const db = await getDB()
      const profileId = getProfileIdFromStorage()
      const cats = await db.getAllFromIndex('categories', 'by_profile', profileId)
      const txns = await db.getAllFromIndex('transactions', 'by_profile', profileId)

      const startStr = `${year}-01-01`
      const endStr = `${year}-12-31`
      const rows = txns.filter((t) => t.date >= startStr && t.date <= endStr)
      const catMap = new Map(cats.map((c) => [c.id, c]))

      const income = rows.filter((r) => r.type === 'income')
      const expenses = rows.filter((r) => r.type === 'expense')

      const byCategory = (txs: typeof rows) => {
        const map: Record<string, { total: number; count: number }> = {}
        for (const r of txs) {
          if (!map[r.category_name]) map[r.category_name] = { total: 0, count: 0 }
          map[r.category_name].total += r.amount
          map[r.category_name].count++
        }
        return map
      }

      const incomeByCat = byCategory(
        income.map((r) => ({ ...r, category_name: catMap.get(r.category_id)?.name || 'Unknown' }))
      )
      const expenseByCat = byCategory(
        expenses.map((r) => ({ ...r, category_name: catMap.get(r.category_id)?.name || 'Unknown' }))
      )

      const incomeTotal = income.reduce((s, r) => s + r.amount, 0)
      const expenseTotal = expenses.reduce((s, r) => s + r.amount, 0)

      return json({
        year,
        income: { total: incomeTotal, byCategory: incomeByCat },
        expenses: { total: expenseTotal, byCategory: expenseByCat },
        netSavings: incomeTotal - expenseTotal,
        savingsRate:
          incomeTotal > 0
            ? parseFloat((((incomeTotal - expenseTotal) / incomeTotal) * 100).toFixed(1))
            : 0,
        transactionCount: rows.length,
      })
    }

    return json({ error: 'Unknown report type' }, 400)
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
}

export async function receiptsUpload(body: unknown): Promise<Response> {
  try {
    const formData = body as FormData
    const file = formData.get('file') as File | null
    const transactionIdRaw = formData.get('transaction_id')

    if (!file) return json({ error: 'No file uploaded' }, 400)

    let transactionId: number | null = null
    if (transactionIdRaw && typeof transactionIdRaw === 'string') {
      transactionId = parseInt(transactionIdRaw, 10)
    }

    const fileData = await file.arrayBuffer()
    const profileId = getProfileIdFromStorage()
    const filename = `${Date.now()}-${file.name}`
    const db = await getDB()

    const id = (await db.add('receipts', {
      transaction_id: transactionId,
      filename,
      original_name: file.name,
      file_type: file.type || 'application/octet-stream',
      file_size: file.size,
      file_data: fileData,
      storage_path: '',
      profile_id: profileId,
      uploaded_at: new Date().toISOString(),
    })) as number

    return json({
      id,
      transaction_id: transactionId,
      filename,
      original_name: file.name,
      file_type: file.type || 'application/octet-stream',
      file_size: file.size,
      url: `/receipts/${filename}`,
      uploaded_at: new Date().toISOString(),
    })
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
}

export async function receiptsGet(params: Record<string, string>): Promise<Response> {
  const db = await getDB()
  const receipt = await db.get('receipts', idParam(params))
  if (!receipt) return notFound('Receipt')
  return json(receipt)
}

export async function receiptsDelete(params: Record<string, string>): Promise<Response> {
  const db = await getDB()
  const id = idParam(params)
  const receipt = await db.get('receipts', id)
  if (!receipt) return notFound('Receipt')
  await db.delete('receipts', id)
  return ok()
}

export async function receiptsGetFile(params: Record<string, string>): Promise<Response> {
  const db = await getDB()
  const receipt = await db.get('receipts', idParam(params))
  if (!receipt || !receipt.file_data) return notFound('Receipt file')

  const ext = receipt.original_name?.split('.').pop()?.toLowerCase()
  let contentType = receipt.file_type || 'application/octet-stream'
  if (!receipt.file_type || receipt.file_type === 'application/octet-stream') {
    const mimeMap: Record<string, string> = {
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      gif: 'image/gif',
      pdf: 'application/pdf',
      webp: 'image/webp',
    }
    if (ext && mimeMap[ext]) contentType = mimeMap[ext]
  }

  return new Response(receipt.file_data, {
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `inline; filename="${receipt.original_name || receipt.filename}"`,
    },
  })
}

export async function receiptsGetByTransaction(params: Record<string, string>): Promise<Response> {
  const db = await getDB()
  const transactionId = idParam(params)
  const receipts = await db.getAllFromIndex('receipts', 'by_transaction', transactionId)
  return json(receipts)
}

export async function receiptsGetFileByName(params: Record<string, string>): Promise<Response> {
  const db = await getDB()
  const filename = params.p1
  const all = await db.getAll('receipts')
  const receipt = all.find((r) => r.filename === filename)
  if (!receipt || !receipt.file_data) return notFound('Receipt file')

  const ext = receipt.original_name?.split('.').pop()?.toLowerCase()
  let contentType = receipt.file_type || 'application/octet-stream'
  if (!receipt.file_type || receipt.file_type === 'application/octet-stream') {
    const mimeMap: Record<string, string> = {
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      gif: 'image/gif',
      pdf: 'application/pdf',
      webp: 'image/webp',
    }
    if (ext && mimeMap[ext]) contentType = mimeMap[ext]
  }

  return new Response(receipt.file_data, {
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `inline; filename="${receipt.original_name || receipt.filename}"`,
    },
  })
}

// ── Import (LS13) ───────────────────────────────────────────────────────────

function toStr(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean') return ''
  return String(v)
}

interface ImportSession {
  workbook: WorkBook
  uploadedAt: number
}

const importSessions = new Map<string, ImportSession>()

async function parseSheetData(workbook: WorkBook) {
  const sheetName = workbook.SheetNames[0] || 'Sheet1'
  const sheet = workbook.Sheets[sheetName]
  const XLSX = await import('xlsx')
  const raw: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet, { defval: '' })

  const results: Record<string, unknown>[] = []
  for (const row of raw) {
    const cleaned: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(row)) {
      const lk = key.toLowerCase().trim()
      if (lk === 'date' || lk === 'datum') {
        cleaned.date = value
      } else if (lk === 'description' || lk === 'desc') {
        cleaned.description = value
      } else if (lk === 'amount' || lk === 'bedrag') {
        cleaned.amount = value
      } else if (lk === 'type') {
        cleaned.type = value
      } else if (lk === 'category' || lk === 'categorie') {
        cleaned.category = value
      } else if (lk === 'notes' || lk === 'note' || lk === 'notities') {
        cleaned.notes = value
      } else if (lk === 'beneficiary' || lk === 'begunstigde') {
        cleaned.beneficiary = value
      } else if (lk === 'payor' || lk === 'betaler') {
        cleaned.payor = value
      } else {
        cleaned[key] = value
      }
    }
    if (cleaned.date || cleaned.description || cleaned.amount) {
      results.push(cleaned)
    }
  }
  return results
}

async function detectDuplicates(
  rows: Record<string, unknown>[]
): Promise<{ duplicates: number[]; clean: Record<string, unknown>[] }> {
  const db = await getDB()
  const profileId = getProfileIdFromStorage()
  const existing = await db.getAllFromIndex('transactions', 'by_profile', profileId)
  const duplicates: number[] = []

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const date = toStr(row.date)
    const desc = toStr(row.description).toLowerCase().trim()
    const amount = parseFloat(toStr(row.amount) || '0')

    const match = existing.find(
      (t) =>
        t.date === date &&
        t.description.toLowerCase().trim() === desc &&
        Math.abs(Number(t.amount) - amount) < 0.01
    )
    if (match) duplicates.push(i)
  }

  const clean = rows.filter((_, i) => !duplicates.includes(i))
  return { duplicates, clean }
}

export async function importUpload(body: unknown): Promise<Response> {
  try {
    const formData = body as FormData
    const file = formData.get('file') as File | null
    if (!file) return json({ error: 'No file uploaded' }, 400)

    const ext = file.name.split('.').pop()?.toLowerCase()
    const buffer = await file.arrayBuffer()
    let workbook: WorkBook

    const XLSX = await import('xlsx')
    if (ext === 'csv') {
      const text = new TextDecoder().decode(buffer)
      workbook = XLSX.read(text, { type: 'string', raw: true })
    } else {
      workbook = XLSX.read(buffer, { type: 'array' })
    }

    const sessionId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    importSessions.set(sessionId, { workbook, uploadedAt: Date.now() })

    const rows = await parseSheetData(workbook)
    return json({ session_id: sessionId, filename: file.name, rows, row_count: rows.length })
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
}

export async function importFileSheet(body: unknown): Promise<Response> {
  try {
    const data = body as Record<string, unknown>
    const sessionId = toStr(data.session_id)
    const session = importSessions.get(sessionId)
    if (!session) return json({ error: 'Session expired or not found' }, 404)

    const rows = await parseSheetData(session.workbook)
    const { duplicates, clean } = await detectDuplicates(rows)
    return json({
      rows,
      total: rows.length,
      new_items: clean.length,
      duplicate_indices: duplicates,
    })
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
}

export async function importGoogleSheet(body: unknown): Promise<Response> {
  if (!body || typeof body !== 'object') return json({ error: 'URL is required' }, 400)
  const { url, sheetName } = body as Record<string, string>
  if (!url) return json({ error: 'URL is required' }, 400)

  // Extract sheet ID and gid from URL
  const idMatch = url.match(/\/d\/([a-zA-Z0-9-_]+)/)
  if (!idMatch) return json({ error: 'Invalid Google Sheets URL or ID' }, 400)
  const sheetId = idMatch[1]
  const gidMatch = url.match(/[?&#]gid=([0-9]+)/)
  const gid = gidMatch ? gidMatch[1] : null

  // CSV parse helper (handles quoted fields, commas in values)
  const parseCSV = (text: string): { headers: string[]; rows: string[][] } => {
    const rows: string[][] = []
    const lines = text.trim().split('\n')
    for (const line of lines) {
      const cols: string[] = []
      let cur = ''
      let inQuotes = false
      for (const ch of line) {
        if (ch === '"') { inQuotes = !inQuotes }
        else if (ch === ',' && !inQuotes) { cols.push(cur.trim().replace(/^"|"$/g, '')); cur = '' }
        else cur += ch
      }
      cols.push(cur.trim().replace(/^"|"$/g, ''))
      rows.push(cols)
    }
    return { headers: rows[0] || [], rows: rows.slice(1).filter((r) => r.some((c) => c)) }
  }

  // Timeout wrapper for fetch — avoids hanging on slow/unreachable URLs
  const fetchWithTimeout = async (url: string, ms: number) => {
    const controller = new AbortController()
    const timer = setTimeout(() => { controller.abort() }, ms)
    try {
      const res = await fetch(url, { signal: controller.signal })
      return res
    } finally {
      clearTimeout(timer)
    }
  }

  // Strategy 1: Published CSV (requires sheet to be published to web)
  try {
    const pubUrl = gid
      ? `https://docs.google.com/spreadsheets/d/${sheetId}/pub?output=csv&gid=${gid}`
      : `https://docs.google.com/spreadsheets/d/${sheetId}/pub?output=csv`
    const pubRes = await fetchWithTimeout(pubUrl, 10000)
    if (pubRes.ok) {
      const text = await pubRes.text()
      if (!text.trim().startsWith('<!DOCTYPE') && !text.trim().startsWith('<html')) {
        const { headers, rows } = parseCSV(text)
        return json({
          headers,
          rows,
          sheetNames: [sheetName || 'Sheet1'],
          selectedSheet: sheetName || 'Sheet1',
        })
      }
    }
  } catch { /* fall through */ }

  // Strategy 2: Google Visualization API (CORS-friendly, works for link-shared sheets)
  try {
    const gvizUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:json${gid ? `&gid=${gid}` : ''}${sheetName ? `&sheet=${encodeURIComponent(sheetName)}` : ''}`
    const gvizRes = await fetchWithTimeout(gvizUrl, 10000)
    if (gvizRes.ok) {
      const gvizText = await gvizRes.text()
      // Strip Google's response wrapper: "/*O_o*/ google.visualization.Query.setResponse({...});"
      const jsonStr = gvizText
        .replace(/^\)\]\}'/, '')
        .replace(/^\/\*O_o\*\/\s*google\.visualization\.Query\.setResponse\(/, '')
        .replace(/\);?\s*$/, '')
      const parsed = JSON.parse(jsonStr)
      if (parsed.table) {
        const cols = parsed.table.cols.map((c: Record<string, unknown>) =>
          (c.label as string) || (c.id as string) || ''
        )
        const dataRows = (parsed.table.rows || []).map((r: Record<string, unknown>) =>
          (r.c as Array<{ v: unknown }>).map((cell) => {
            const v = cell?.v
            if (v === null || v === undefined) return ''
            return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : typeof v === 'boolean' ? String(v) : JSON.stringify(v)
          })
        )
        return json({
          headers: cols,
          rows: dataRows,
          sheetNames: [sheetName || 'Sheet1'],
          selectedSheet: sheetName || 'Sheet1',
        })
      }
    }
  } catch { /* fall through */ }

  // Strategy 3: Regular CSV export (rarely works from browser due to CORS, but try anyway)
  try {
    const csvUrl = gid
      ? `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`
      : `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv`
    const csvRes = await fetchWithTimeout(csvUrl, 10000)
    if (csvRes.ok) {
      const text = await csvRes.text()
      if (!text.trim().startsWith('<!DOCTYPE') && !text.trim().startsWith('<html')) {
        const { headers, rows } = parseCSV(text)
        return json({
          headers,
          rows,
          sheetNames: [sheetName || 'Sheet1'],
          selectedSheet: sheetName || 'Sheet1',
        })
      }
    }
  } catch { /* fall through */ }

  return json({
    error: 'Could not access the Google Sheet from the browser.',
    message:
      'To import this sheet, either: (1) Publish it to the web (File → Share → Publish to web), ' +
      'or (2) Set sharing to "Anyone with the link can view", ' +
      'or (3) Download as CSV and use the File Upload tab.',
    serverlessMode: true,
  }, 422)
}

export async function importExecute(body: unknown): Promise<Response> {
  try {
    const data = body as Record<string, unknown>
    const mapping = (data.mapping as Record<string, string>) || {}
    const dryRun = Boolean(data.dry_run)
    const categoryTypes = (data.categoryTypes as Record<string, string>) || {}
    const accountTypes = (data.accountTypes as Record<string, string>) || {}
    const accountBalances = (data.accountBalances as Record<string, string>) || {}
    const accountBalanceDates = (data.accountBalanceDates as Record<string, string>) || {}

    // Accept rows directly (from paste/Google Sheets) or via session_id (from file upload)
    let rows: Record<string, unknown>[]
    if (Array.isArray(data.rows)) {
      // Convert string[][] from frontend into named-object rows using the mapping
      const rawRows = data.rows as string[][]
      const idxToField: Record<number, string> = {}
      for (const [field, idx] of Object.entries(mapping)) {
        const n = Number(idx)
        if (!isNaN(n)) idxToField[n] = field
      }
      rows = rawRows.map((r) => {
        const obj: Record<string, unknown> = {}
        for (let c = 0; c < r.length; c++) {
          const field = idxToField[c] || `col_${c}`
          obj[field] = r[c]
        }
        return obj
      })
    } else {
      const sessionId = toStr(data.session_id)
      const session = importSessions.get(sessionId)
      if (!session) return json({ error: 'Session expired or not found' }, 404)
      rows = await parseSheetData(session.workbook)
    }
    const { clean } = await detectDuplicates(rows)

    const profileId = getProfileIdFromStorage()
    const db = await getDB()
    const categories = await db.getAllFromIndex('categories', 'by_profile', profileId)

    // Create accounts for categories marked as 'account' type
    const accountIdMap = new Map<string, number>()
    if (!dryRun) {
      for (const [catName, catType] of Object.entries(categoryTypes)) {
        if (catType !== 'account') continue
        const accType = (accountTypes[catName] || 'giro') as 'giro' | 'savings' | 'ib'
        const balance = parseFloat(accountBalances[catName]) || 0
        const balanceDate = accountBalanceDates[catName] || new Date().toISOString().split('T')[0]
        const account = {
          name: catName,
          type: accType,
          balance,
          balance_date: balanceDate,
          profile_id: profileId,
          created_at: new Date().toISOString(),
        }
        const id = await db.add('accounts', account)
        accountIdMap.set(catName, id as number)
      }
    }

    const imported: number[] = []
    const skipped: { index: number; reason: string }[] = []

    for (let i = 0; i < clean.length; i++) {
      const row = clean[i]
      const description = toStr(row.description)
      const date = toStr(row.date)
      const amount = parseFloat(toStr(row.amount) || '0')
      // Determine transaction type: use type column > categoryTypes > amount sign
      let type = 'expense'
      const rawType = toStr(row.type).trim().toLowerCase()
      if (['income', 'expense', 'transfer'].includes(rawType)) {
        type = rawType
      } else {
        const catName = toStr(row.category).toLowerCase().trim()
        const catType = categoryTypes[catName]
        if (catType && (catType === 'income' || catType === 'expense')) {
          type = catType
        } else {
          type = amount < 0 ? 'expense' : amount > 0 ? 'income' : 'expense'
        }
      }

      if (!description || !date || isNaN(amount)) {
        skipped.push({
          index: i,
          reason: `Missing required fields (description, date, amount) for row ${i + 1}`,
        })
        continue
      }

      let categoryId: number | null = null
      let accountId: number | null = null
      const rawCat = toStr(row.category)
      if (rawCat) {
        const catName = rawCat.toLowerCase().trim()
        let cat = categories.find((c) => c.name.toLowerCase().trim() === catName)
        // Auto-create category if not found
        if (!cat) {
          const defaultColor = '#6366f1'
          const id = await db.add('categories', {
            name: catName.charAt(0).toUpperCase() + catName.slice(1),
            type,
            color: defaultColor,
            icon: 'tag',
            profile_id: profileId,
          })
          cat = { id: id as number, name: catName, type, color: defaultColor, icon: 'tag' } as any
          categories.push(cat)
        }
        if (cat) categoryId = cat.id
        // Check if this category maps to a created account
        if (accountIdMap.has(catName)) {
          accountId = accountIdMap.get(catName)!
        }
      }

      const transaction = {
        profile_id: profileId,
        type,
        description,
        date,
        amount: type === 'income' ? Math.abs(amount) : -Math.abs(amount),
        category_id: categoryId,
        notes: toStr(row.notes),
        beneficiary: toStr(row.beneficiary),
        payor: toStr(row.payor),
        account_id: accountId || data.account_id ? Number(accountId || data.account_id) : null,
        created_at: new Date().toISOString(),
      }

      if (!dryRun) {
        const id = await db.add('transactions', transaction)
        imported.push(id as number)
      } else {
        imported.push(-1)
      }
    }

    return json({
      imported: imported.length,
      skipped: skipped.length,
      dry_run: dryRun,
      imported_ids: dryRun ? [] : imported,
      skipped_items: skipped,
      accounts_created: dryRun ? 0 : accountIdMap.size,
    })
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
}

export async function importBulk(body: unknown): Promise<Response> {
  try {
    const data = body as Record<string, unknown>
    const items = data.items as Record<string, unknown>[] | undefined
    if (!items || !Array.isArray(items)) {
      return json({ error: 'No items array provided' }, 400)
    }

    const profileId = getProfileIdFromStorage()
    const db = await getDB()
    const imported: number[] = []

    for (const item of items) {
      const transaction = {
        profile_id: profileId,
        type: toStr(item.type) || 'expense',
        description: toStr(item.description),
        date: toStr(item.date) || new Date().toISOString().slice(0, 10),
        amount: Number(item.amount) || 0,
        category_id: item.category_id ? Number(item.category_id) : null,
        notes: toStr(item.notes),
        beneficiary: toStr(item.beneficiary),
        payor: toStr(item.payor),
        account_id: item.account_id ? Number(item.account_id) : null,
        created_at: new Date().toISOString(),
      }
      const id = await db.add('transactions', transaction)
      imported.push(id as number)
    }

    return json({ imported: imported.length, imported_ids: imported })
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
}

// ── Counterparties ─────────────────────────────────────────────────────────

export async function getCounterparties(): Promise<Response> {
  try {
    const db = await getDB()
    const pids = getProfileIdsFromStorage()
    const txs: Record<string, unknown>[] = []
    for (const pid of pids) {
      txs.push(...(await db.getAllFromIndex('transactions', 'by_profile', pid)))
    }

    const map = new Map<string, { incoming: number; outgoing: number; count: number }>()

    for (const tx of txs) {
      const txAmount = typeof tx.amount === 'number' ? tx.amount : parseFloat(toStr(tx.amount)) || 0
      if (tx.type === 'expense') {
        const beneficiary = toStr(tx.beneficiary).trim() || toStr(tx.description).trim()
        if (beneficiary) {
          const existing = map.get(beneficiary)
          if (existing) {
            existing.outgoing += txAmount
            existing.count++
          } else {
            map.set(beneficiary, { incoming: 0, outgoing: txAmount, count: 1 })
          }
        }
      }
      if (tx.type === 'income') {
        const payor = toStr(tx.payor).trim() || toStr(tx.description).trim()
        if (payor) {
          const existing = map.get(payor)
          if (existing) {
            existing.incoming += txAmount
            existing.count++
          } else {
            map.set(payor, { incoming: txAmount, outgoing: 0, count: 1 })
          }
        }
      }
    }

    const result = Array.from(map.entries()).map(([name, data]) => ({
      name,
      incoming: Math.round(data.incoming * 100) / 100,
      outgoing: Math.round(data.outgoing * 100) / 100,
      net: Math.round((data.incoming - data.outgoing) * 100) / 100,
      transaction_count: data.count,
    }))

    result.sort((a, b) => Math.abs(b.net) - Math.abs(a.net))

    return json(result)
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
}

// ── Portfolio ─────────────────────────────────────────────────────────────────

export async function portfolioHoldingsList(): Promise<Response> {
  try {
    const db = await getDB()
    const pids = getProfileIdsFromStorage()
    const holdings: Record<string, unknown>[] = []
    for (const pid of pids) {
      holdings.push(...(await db.getAllFromIndex('portfolioHoldings', 'by_profile', pid)))
    }
    const result = holdings.map((h: any) => ({
      ...h,
      currentPrice: h.purchase_price,
      marketValue: h.purchase_price * h.shares,
      costBasis: h.purchase_price * h.shares,
      gain: 0,
      gainPercent: 0,
    }))
    return json(result)
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
}

export async function portfolioHoldingsCreate(body: unknown): Promise<Response> {
  try {
    if (typeof body !== 'object' || body === null) {
      return json({ error: 'Invalid request body' }, 400)
    }
    const data = body as Record<string, unknown>
    const tickerVal = data.ticker
    const sharesVal = data.shares
    const priceVal = data.purchase_price
    const dateVal = data.purchase_date
    const notesVal = data.notes
    if (typeof tickerVal !== 'string' && typeof tickerVal !== 'number') {
      return json({ error: 'ticker is required' }, 400)
    }
    if (typeof sharesVal !== 'number' && typeof sharesVal !== 'string') {
      return json({ error: 'shares is required' }, 400)
    }
    if (typeof priceVal !== 'number' && typeof priceVal !== 'string') {
      return json({ error: 'purchase_price is required' }, 400)
    }
    if (typeof dateVal !== 'string') {
      return json({ error: 'purchase_date is required' }, 400)
    }
    const db = await getDB()
    const holding = {
      ticker: String(tickerVal).toUpperCase(),
      shares: parseFloat(String(sharesVal)),
      purchase_price: parseFloat(String(priceVal)),
      purchase_date: dateVal,
      notes: typeof notesVal === 'string' ? notesVal : '',
      created_at: new Date().toISOString(),
      profile_id: parseInt(localStorage.getItem('currentProfileId') || '1', 10),
    }
    const id = await db.add('portfolioHoldings', holding)
    return json({ ...holding, id }, 201)
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
}

export async function portfolioHoldingsUpdate(
  params: Record<string, string>,
  body: unknown
): Promise<Response> {
  try {
    const id = idParam(params)
    const data = body as Record<string, unknown>
    const db = await getDB()
    const existing = await db.get('portfolioHoldings', id)
    if (!existing) return notFound('Holding')
    const updTicker = typeof data.ticker === 'string' ? data.ticker.toUpperCase() : existing.ticker
    const updShares =
      typeof data.shares === 'number' || typeof data.shares === 'string'
        ? parseFloat(String(data.shares))
        : existing.shares
    const updPrice =
      typeof data.purchase_price === 'number' || typeof data.purchase_price === 'string'
        ? parseFloat(String(data.purchase_price))
        : existing.purchase_price
    const updDate =
      typeof data.purchase_date === 'string' ? data.purchase_date : existing.purchase_date
    const updNotes = typeof data.notes === 'string' ? data.notes : existing.notes
    const updated = {
      ...existing,
      ticker: updTicker,
      shares: updShares,
      purchase_price: updPrice,
      purchase_date: updDate,
      notes: updNotes,
      updated_at: new Date().toISOString(),
    }
    await db.put('portfolioHoldings', updated)
    return json(updated)
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
}

export async function portfolioHoldingsDelete(params: Record<string, string>): Promise<Response> {
  try {
    const id = idParam(params)
    const db = await getDB()
    const existing = await db.get('portfolioHoldings', id)
    if (!existing) return notFound('Holding')
    await db.delete('portfolioHoldings', id)
    return json({ ok: true })
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
}

export async function portfolioSummary(): Promise<Response> {
  try {
    const db = await getDB()
    const holdings = await db.getAll('portfolioHoldings')
    let totalValue = 0
    let totalCostBasis = 0
    const enriched = holdings.map((h: any) => {
      const currentPrice = h.purchase_price
      const marketValue = currentPrice * h.shares
      const costBasis = h.purchase_price * h.shares
      const gain = marketValue - costBasis
      const gainPercent = costBasis > 0 ? (gain / costBasis) * 100 : 0
      totalValue += marketValue
      totalCostBasis += costBasis
      return { ...h, currentPrice, marketValue, costBasis, gain, gainPercent }
    })
    const allocationMap: Record<string, { ticker: string; value: number; shares: number }> = {}
    for (const h of enriched) {
      if (!allocationMap[h.ticker]) {
        allocationMap[h.ticker] = { ticker: h.ticker, value: 0, shares: 0 }
      }
      allocationMap[h.ticker].value += h.marketValue
      allocationMap[h.ticker].shares += h.shares
    }
    const allocation = Object.values(allocationMap)
      .map((a) => ({ ...a, percentage: totalValue > 0 ? (a.value / totalValue) * 100 : 0 }))
      .sort((a, b) => b.value - a.value)

    const totalGain = totalValue - totalCostBasis
    const totalGainPercent = totalCostBasis > 0 ? (totalGain / totalCostBasis) * 100 : 0

    return json({
      totalValue,
      totalCostBasis,
      totalGain,
      totalGainPercent,
      holdings: enriched,
      allocation,
    })
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
}

export async function portfolioPrices(body: unknown): Promise<Response> {
  try {
    const data = body as Record<string, unknown>
    const tickers = data.tickers as string[]
    if (!tickers || !Array.isArray(tickers) || tickers.length === 0) {
      return json({ error: 'tickers array is required' }, 400)
    }
    const prices: Record<string, unknown> = {}
    for (const t of tickers) {
      prices[t] = { price: 0, change: 0, changePercent: 0, name: t }
    }
    return json(prices)
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
}

// ── Transaction Tags ─────────────────────────────────────────────────────────

export async function transactionTagsGet(params: Record<string, string>): Promise<Response> {
  try {
    const db = await getDB()
    const pid = await adapter.getCurrentProfileId()
    const txId = idParam(params)
    const tx = await db.get('transactions', txId)
    if (!tx || tx.profile_id !== pid) return notFound('Transaction')
    const tagIds: number[] = tx.tag_ids || []
    if (tagIds.length === 0) return json([])
    const allTags = await db.getAllFromIndex('tags', 'by_profile', pid)
    const result = (allTags as Record<string, unknown>[]).filter((t) =>
      tagIds.includes(t.id as number)
    )
    return json(result)
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
}

export async function transactionTagsSet(
  params: Record<string, string>,
  body: unknown
): Promise<Response> {
  try {
    const db = await getDB()
    const pid = await adapter.getCurrentProfileId()
    const txId = idParam(params)
    const tx = await db.get('transactions', txId)
    if (!tx || tx.profile_id !== pid) return notFound('Transaction')
    const data = body as Record<string, unknown>
    const tagIds = data.tagIds as number[] | undefined
    if (!Array.isArray(tagIds)) return json({ error: 'tagIds must be an array' }, 400)
    const updated = { ...tx, tag_ids: tagIds, tags: [] as { id: number; name: string; color: string }[] }
    if (tagIds.length > 0) {
      const allTags = await db.getAllFromIndex('tags', 'by_profile', pid)
      updated.tags = (allTags as Record<string, unknown>[])
        .filter((t) => tagIds.includes(t.id as number))
        .map((t) => ({ id: t.id as number, name: t.name as string, color: t.color as string }))
    }
    await db.put('transactions', updated)
    return ok()
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
}

export async function transactionsByTag(params: Record<string, string>): Promise<Response> {
  try {
    const db = await getDB()
    const pid = await adapter.getCurrentProfileId()
    const tagId = idParam(params)
    const allTxns = await db.getAllFromIndex('transactions', 'by_profile', pid)
    const filtered = (allTxns as Record<string, unknown>[]).filter((t) => {
      const tagIds = (t.tag_ids as number[]) || []
      return tagIds.includes(tagId)
    })
    return json({ rows: filtered, total: filtered.length })
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
}

// ── Transaction Bulk Operations ────────────────────────────────────────────────

export async function transactionsBulk(body: unknown): Promise<Response> {
  try {
    const db = await getDB()
    const pids = adapter.getCurrentProfileIds()
    const data = body as Record<string, unknown>
    const ids = (data.ids || data.transactionIds) as number[] | undefined
    const action = ((data.action || data._method || 'update') as string).toLowerCase()
    const updateData = (data.data || data) as Record<string, unknown>

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return json({ error: 'No transaction IDs provided' }, 400)
    }
    if (ids.length > 1000) {
      return json({ error: 'Cannot update more than 1000 transactions at once' }, 400)
    }

    if (action === 'delete') {
      let deleted = 0
      for (const id of ids) {
        const tx = await db.get('transactions', id)
        if (tx && pids.includes(tx.profile_id)) {
          await db.delete('transactions', id)
          deleted++
        }
      }
      return json({ ok: true, deleted })
    }

    if (action === 'update') {
      if (!updateData || typeof updateData !== 'object') {
        return json({ error: 'No update data provided' }, 400)
      }
      const allowedFields = ['category_id', 'type', 'description', 'beneficiary', 'payor', 'notes', 'reconciled']
      let updated = 0
      for (const id of ids) {
        const tx = await db.get('transactions', id)
        if (!tx || !pids.includes(tx.profile_id)) continue
        const patch: Record<string, unknown> = {}
        for (const field of allowedFields) {
          if (field in updateData) {
            if (field === 'reconciled') {
              patch.reconciled = updateData.reconciled ? 1 : 0
            } else if (field === 'type') {
              const t = updateData.type as string
              if (!['income', 'expense', 'transfer'].includes(t)) continue
              patch.type = t
            } else {
              patch[field] = updateData[field]
            }
          }
        }
        if (Object.keys(patch).length > 0) {
          await db.put('transactions', { ...tx, ...patch })
          updated++
        }
      }
      return json({ ok: true, updated })
    }

    return json({ error: `Unknown action: ${action}` }, 400)
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
}

// ── Category Auto-Map ─────────────────────────────────────────────────────────

export async function categoriesAutoMap(body: unknown): Promise<Response> {
  try {
    const db = await getDB()
    const pid = await adapter.getCurrentProfileId()
    const data = body as Record<string, unknown>
    const transactionIds = data.transaction_ids as number[] | undefined

    // Get all categories for this profile
    const categories = await db.getAllFromIndex('categories', 'by_profile', pid)
    const catMap = new Map<string, Record<string, unknown>>()
    for (const c of categories as Record<string, unknown>[]) {
      catMap.set((c.name as string).toLowerCase(), c)
    }

    // Get category mappings for learned patterns
    const mappingPatterns: { pattern: string; categoryId: number }[] = []
    try {
      const rawMappings = await db.getAll('category_mappings')
      for (const m of rawMappings as Record<string, unknown>[]) {
        if (m.profile_id === pid) {
          mappingPatterns.push({ pattern: (m.pattern as string).toLowerCase(), categoryId: m.category_id as number })
        }
      }
    } catch {
      // category_mappings store may not exist yet
    }

    // Get uncategorized transactions
    let txns: Record<string, unknown>[]
    if (transactionIds && transactionIds.length > 0) {
      txns = []
      for (const id of transactionIds) {
        const t = await db.get('transactions', id)
        if (t && t.profile_id === pid) txns.push(t)
      }
    } else {
      const all = await db.getAllFromIndex('transactions', 'by_profile', pid)
      txns = (all as Record<string, unknown>[]).filter(
        (t) => !t.category_id || t.category_id === 0
      )
    }

    let mapped = 0
    for (const tx of txns) {
      const toStr = (v: unknown) => (typeof v === 'string' ? v : '')
      const searchText = `${toStr(tx.description)} ${toStr(tx.beneficiary)} ${toStr(tx.payor)}`.toLowerCase()
      const normalized = searchText.replace(/[^a-z0-9]/g, '')

      // Check learned mappings first
      let bestCategoryId: number | null = null
      for (const mp of mappingPatterns) {
        if (normalized.includes(mp.pattern.replace(/[^a-z0-9]/g, ''))) {
          bestCategoryId = mp.categoryId
          break
        }
      }

      // Check keyword-based classification
      if (bestCategoryId === null) {
        const incomeKeywords = ['salary', 'wage', 'income', 'revenue', 'refund', 'dividend', 'interest', 'bonus', 'freelance', 'deposit', 'paycheck']
        const expenseKeywords = ['groceries', 'restaurant', 'rent', 'utility', 'insurance', 'health', 'transport', 'shopping', 'entertainment', 'subscription', 'phone', 'internet', 'electric', 'water', 'gas', 'gym', 'travel', 'education', 'medical', 'dental', 'pharmacy', 'clothing', 'charity', 'gift', 'tax', 'fee', 'bank fee', 'maintenance', 'repair', 'fuel', 'parking', 'toll', 'hotel', 'flight', 'coffee', 'food', 'drink']
        const accountKeywords = ['revolut', 'rev', 'n26', 'wise', 'paypal', 'pbz', 'current', 'giro', 'savings', 'wallet', 'transfer', 'wire']

        for (const kw of incomeKeywords) {
          if (normalized.includes(kw)) { bestCategoryId = (catMap.get('income') || catMap.get('salary'))?.id as number; break }
        }
        if (bestCategoryId === null) {
          for (const kw of accountKeywords) {
            if (normalized.includes(kw)) { bestCategoryId = (catMap.get('transfer') || catMap.get('account transfer'))?.id as number; break }
          }
        }
        if (bestCategoryId === null) {
          for (const kw of expenseKeywords) {
            if (normalized.includes(kw)) { bestCategoryId = (catMap.get('other'))?.id as number; break }
          }
        }
      }

      if (bestCategoryId !== null) {
        await db.put('transactions', { ...tx, category_id: bestCategoryId })
        mapped++
      }
    }

    return json({ ok: true, mapped })
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
}

export async function categoriesApplyMappings(body: unknown): Promise<Response> {
  try {
    const db = await getDB()
    const pid = await adapter.getCurrentProfileId()
    const data = body as Record<string, unknown>
    const mappingIds = data.mapping_ids as number[] | undefined
    const applyTo = (data.apply_to || 'uncategorized') as string

    // Get category mappings (either specific or all)
    const patterns: { pattern: string; categoryId: number }[] = []
    if (mappingIds && mappingIds.length > 0) {
      try {
        const allMappings = await db.getAll('category_mappings')
        for (const m of allMappings as Record<string, unknown>[]) {
          if (m.profile_id === pid && mappingIds.includes(m.id as number)) {
            patterns.push({ pattern: (m.pattern as string).toLowerCase(), categoryId: m.category_id as number })
          }
        }
      } catch { /* store may not exist */ }
    }

    // Get transactions to apply to
    const allTxns = await db.getAllFromIndex('transactions', 'by_profile', pid)
    const targets = (allTxns as Record<string, unknown>[]).filter((t) => {
      if (applyTo === 'all') return true
      return !t.category_id || t.category_id === 0
    })

    let applied = 0
    for (const tx of targets) {
      const toStr = (v: unknown) => (typeof v === 'string' ? v : '')
      const searchText = `${toStr(tx.description)} ${toStr(tx.beneficiary)} ${toStr(tx.payor)}`.toLowerCase()
      const normalized = searchText.replace(/[^a-z0-9]/g, '')
      for (const mp of patterns) {
        if (normalized.includes(mp.pattern.replace(/[^a-z0-9]/g, ''))) {
          await db.put('transactions', { ...tx, category_id: mp.categoryId })
          applied++
          break
        }
      }
    }

    return json({ ok: true, applied })
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
}

// ── Account History & Reconciliation ──────────────────────────────────────────

export async function accountsTimeline(): Promise<Response> {
  try {
    const db = await getDB()
    const pids = adapter.getCurrentProfileIds()
    const allHistory = await db.getAll('balanceHistory')
    const timeline = new Map<string, number>()
    for (const entry of allHistory as Record<string, unknown>[]) {
      const accountId = entry.account_id as number
      // Get account to check profile
      try {
        const acct = await db.get('accounts', accountId)
        if (!acct || !pids.includes(acct.profile_id)) continue
      } catch { continue }
      const date = (entry.recorded_at as string || entry.date as string || '').slice(0, 10)
      const balance = entry.balance as number
      timeline.set(date, (timeline.get(date) || 0) + balance)
    }
    const result = Array.from(timeline.entries())
      .map(([date, netWorth]) => ({ date, net_worth: netWorth }))
      .sort((a, b) => a.date.localeCompare(b.date))
    return json(result)
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
}

export async function accountsReconciliationSummary(
  params: Record<string, string>
): Promise<Response> {
  try {
    const db = await getDB()
    const pid = await adapter.getCurrentProfileId()
    const accountId = idParam(params)
    const account = await db.get('accounts', accountId)
    if (!account || account.profile_id !== pid) return notFound('Account')

    const allTxns = await db.getAllFromIndex('transactions', 'by_profile', pid)
    const txns = (allTxns as Record<string, unknown>[]).filter(
      (t) => t.account_id === accountId
    )

    const unreconciled = txns.filter((t) => !t.reconciled)
    const reconciled = txns.filter((t) => !!t.reconciled)

    return json({
      account_id: accountId,
      account_name: account.name,
      unreconciled_count: unreconciled.length,
      unreconciled_total: unreconciled.reduce((s, t) => s + (t.amount as number || 0), 0),
      reconciled_count: reconciled.length,
      total_transactions: txns.length,
    })
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
}

