/**
 * Local API Handlers — IndexedDB-backed route handlers for serverless mode
 */
import * as XLSX from 'xlsx'
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
  return json(txns)
}

export async function transactionsCreate(body: unknown): Promise<Response> {
  if (!body || typeof body !== 'object') return json({ error: 'Invalid transaction data' }, 400)
  const tx = body as Record<string, unknown>
  tx.profile_id = adapter.getCurrentProfileId ? await adapter.getCurrentProfileId() : 1
  const id = await adapter.createTransaction(tx as unknown as Parameters<typeof adapter.createTransaction>[0])
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
  const id = await adapter.createCategory(cat as unknown as Parameters<typeof adapter.createCategory>[0])
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
  const id = await adapter.createAccount(acct as unknown as Parameters<typeof adapter.createAccount>[0])
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

// ── Budgets ──────────────────────────────────────────────────────────────────

export async function budgetsList(): Promise<Response> {
  const budgets = await adapter.listBudgets()
  return json(budgets)
}

export async function budgetsCreate(body: unknown): Promise<Response> {
  if (!body || typeof body !== 'object') return json({ error: 'Invalid budget data' }, 400)
  const budget = body as Record<string, unknown>
  budget.profile_id = await adapter.getCurrentProfileId()
  const id = await adapter.createBudget(budget as unknown as Parameters<typeof adapter.createBudget>[0])
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
  body: unknown
): Promise<Response> {
  if (!body || typeof body !== 'object') return json({ error: 'Invalid data' }, 400)
  await adapter.updateBudget(idParam(params), body as Record<string, unknown>)
  return ok()
}

export async function budgetsDelete(params: Record<string, string>): Promise<Response> {
  await adapter.deleteBudget(idParam(params))
  return ok()
}

// ── Budget alerts ────────────────────────────────────────────────────────────

export async function budgetsAlerts(query: URLSearchParams): Promise<Response> {
  try {
    const db = await getDB()
    const pid = await adapter.getCurrentProfileId()
    const threshold = parseFloat(query.get('threshold')!) || 80

    let startDate: string
    let endDate: string
    if (query.get('year') && query.get('month')) {
      const y = parseInt(query.get('year')!)
      const m = parseInt(query.get('month')!)
      startDate = monthStart(y, m)
      const nm = nextMonth(y, m)
      endDate = monthStart(nm.year, nm.month)
    } else {
      const now = new Date()
      const y = now.getFullYear()
      const m = now.getMonth() + 1
      startDate = monthStart(y, m)
      const nm = nextMonth(y, m)
      endDate = monthStart(nm.year, nm.month)
    }

    const budgets = (await db.getAllFromIndex('budgets', 'by_profile', pid)).filter(
      (b: Record<string, unknown>) => !b.end_date || (b.end_date as string) >= startDate
    )

    const txns = (await db.getAllFromIndex('transactions', 'by_profile', pid)).filter(
      (t: Record<string, unknown>) =>
        t.type === 'expense' &&
        t.category_id !== null &&
        (t.date as string) >= startDate &&
        (t.date as string) < endDate
    )

    const spentMap: Record<number, number> = {}
    for (const t of txns) {
      const cid = t.category_id as number
      spentMap[cid] = (spentMap[cid] || 0) + Math.abs(getAmount(t))
    }

    const cats = await db.getAllFromIndex('categories', 'by_profile', pid)
    const catMap: Record<number, Record<string, unknown>> = {}
    for (const c of cats) catMap[c.id as number] = c

    const alerts = budgets
      .map((b: Record<string, unknown>) => {
        const s = spentMap[b.category_id as number] || 0
        const amount = (b.amount as number) || 0
        const pct = amount > 0 ? (s / amount) * 100 : 0
        const rem = amount - s
        const cat = catMap[b.category_id as number]
        return {
          categoryId: b.category_id,
          categoryName: cat?.name,
          categoryColor: cat?.color,
          categoryIcon: cat?.icon,
          budgetAmount: amount,
          spent: s,
          remaining: rem,
          percentage: Math.round(pct),
          status: pct > 100 ? 'over' : pct >= threshold ? 'warning' : 'ok',
        }
      })
      .filter((b: Record<string, unknown>) => (b.percentage as number) >= threshold)
      .sort(
        (a: Record<string, unknown>, b: Record<string, unknown>) =>
          (b.percentage as number) - (a.percentage as number)
      )

    return json({ alerts, threshold, startDate, endDate })
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
}

// ── Budget history ───────────────────────────────────────────────────────────

export async function budgetsHistory(query: URLSearchParams): Promise<Response> {
  try {
    const db = await getDB()
    const pid = await adapter.getCurrentProfileId()
    const categoryId = parseInt(query.get('category_id')!)
    const months = parseInt(query.get('months')!) || 6

    const budgets = (await db.getAllFromIndex('budgets', 'by_profile', pid))
      .filter((b: Record<string, unknown>) => b.category_id === categoryId)
      .sort((a: Record<string, unknown>, b: Record<string, unknown>) =>
        (b.start_date as string).localeCompare(a.start_date as string)
      )

    const txns = (await db.getAllFromIndex('transactions', 'by_profile', pid)).filter(
      (t: Record<string, unknown>) => t.type === 'expense' && t.category_id === categoryId
    )

    const history = budgets.slice(0, months).map((b: Record<string, unknown>) => {
      const start = b.start_date as string
      const end = endOfNextMonth(start)
      const spent = txns
        .filter(
          (t: Record<string, unknown>) => (t.date as string) >= start && (t.date as string) < end
        )
        .reduce((sum: number, t: Record<string, unknown>) => sum + getAmount(t), 0)
      return { month: start, budget_amount: b.amount, spent }
    })

    return json(history)
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
}

// ── Budget improvements ──────────────────────────────────────────────────────

export async function budgetsImprovements(query: URLSearchParams): Promise<Response> {
  try {
    const db = await getDB()
    const pid = await adapter.getCurrentProfileId()
    const numMonths = parseInt(query.get('months')!) || 6

    const budgets = (await db.getAllFromIndex('budgets', 'by_profile', pid)) as Record<
      string,
      unknown
    >[]
    const txns = (await db.getAllFromIndex('transactions', 'by_profile', pid)) as Record<
      string,
      unknown
    >[]

    // Aggregate monthly budget + spent
    const monthlyMap: Record<string, { budget: number; spent: number }> = {}
    for (const b of budgets) {
      const mo = (b.start_date as string).slice(0, 7)
      if (!monthlyMap[mo]) monthlyMap[mo] = { budget: 0, spent: 0 }
      monthlyMap[mo].budget += (b.amount as number) || 0
    }
    for (const t of txns) {
      if (t.type !== 'expense') continue
      const mo = (t.date as string).slice(0, 7)
      if (monthlyMap[mo]) {
        monthlyMap[mo].spent += getAmount(t)
      }
    }

    const months = Object.keys(monthlyMap).sort().reverse().slice(0, numMonths)
    const history = months.map((mo, idx) => {
      const d = monthlyMap[mo]
      const prev = months[idx + 1] ? monthlyMap[months[idx + 1]] : null
      const adherence = d.budget > 0 ? (d.spent / d.budget) * 100 : 0
      const prevAdherence = prev && prev.budget > 0 ? (prev.spent / prev.budget) * 100 : null
      return {
        month: mo,
        total_budget: d.budget,
        total_spent: d.spent,
        adherence_pct: adherence,
        prev_adherence: prevAdherence,
        change_pct: prevAdherence !== null ? adherence - prevAdherence : null,
      }
    })

    // Category breakdown for latest month
    if (history.length > 0) {
      const latestMo = history[0].month
      const cats = await db.getAllFromIndex('categories', 'by_profile', pid)
      const catMap: Record<number, Record<string, unknown>> = {}
      for (const c of cats) catMap[c.id as number] = c

      const latestBudgets = budgets.filter(
        (b: Record<string, unknown>) => (b.start_date as string).slice(0, 7) === latestMo
      )
      const catBreakdown = latestBudgets
        .map((b: Record<string, unknown>) => {
          const cat = catMap[b.category_id as number]
          return {
            name: cat?.name,
            color: cat?.color,
            budget_amount: b.amount,
          }
        })
        .sort(
          (a: Record<string, unknown>, b: Record<string, unknown>) =>
            (b.budget_amount as number) - (a.budget_amount as number)
        )
      ;(history[0] as Record<string, unknown>).category_budgets = JSON.stringify(catBreakdown)
    }

    return json(history)
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
}

// ── Budget summary ───────────────────────────────────────────────────────────

export async function budgetsSummary(query: URLSearchParams): Promise<Response> {
  try {
    const db = await getDB()
    const pid = await adapter.getCurrentProfileId()
    const now = new Date()
    const y = parseInt(query.get('year')!) || now.getFullYear()
    const m = parseInt(query.get('month')!) || now.getMonth() + 1

    const startDate = monthStart(y, m)
    const nm = nextMonth(y, m)
    const endDate = monthStart(nm.year, nm.month)

    const pm = prevMonth(y, m)
    const prevStart = monthStart(pm.year, pm.month)

    const budgets = (await db.getAllFromIndex('budgets', 'by_profile', pid)).filter(
      (b: Record<string, unknown>) => !b.end_date || (b.end_date as string) >= startDate
    )

    const txns = (await db.getAllFromIndex('transactions', 'by_profile', pid)).filter(
      (t: Record<string, unknown>) =>
        t.type === 'expense' &&
        t.category_id !== null &&
        (t.date as string) >= startDate &&
        (t.date as string) < endDate
    )

    const prevTxns = (await db.getAllFromIndex('transactions', 'by_profile', pid)).filter(
      (t: Record<string, unknown>) =>
        t.type === 'expense' &&
        t.category_id !== null &&
        (t.date as string) >= prevStart &&
        (t.date as string) < startDate
    )

    const spentMap: Record<number, number> = {}
    for (const t of txns) {
      const cid = t.category_id as number
      spentMap[cid] = (spentMap[cid] || 0) + getAmount(t)
    }

    const prevSpentMap: Record<number, number> = {}
    for (const t of prevTxns) {
      const cid = t.category_id as number
      prevSpentMap[cid] = (prevSpentMap[cid] || 0) + getAmount(t)
    }

    // Previous month budgets for auto-rollover
    const prevBudgets = (await db.getAllFromIndex('budgets', 'by_profile', pid)).filter(
      (b: Record<string, unknown>) =>
        (b.start_date as string) >= prevStart && (b.start_date as string) < startDate
    )

    const prevUnusedMap: Record<number, { unused: number; rollover_enabled: boolean }> = {}
    for (const pb of prevBudgets) {
      const unused = Math.max(
        0,
        (pb.amount as number) - (prevSpentMap[pb.category_id as number] || 0)
      )
      prevUnusedMap[pb.category_id as number] = {
        unused,
        rollover_enabled: !!(pb as Record<string, unknown>).rollover_enabled,
      }
    }

    const cats = await db.getAllFromIndex('categories', 'by_profile', pid)
    const catMap: Record<number, Record<string, unknown>> = {}
    for (const c of cats) catMap[c.id as number] = c

    const summary = budgets.map((b: Record<string, unknown>) => {
      const spentAmt = spentMap[b.category_id as number] || 0
      const baseRemaining = (b.amount as number) - spentAmt
      const cat = catMap[b.category_id as number]

      let rollover_contribution = 0
      let auto_rollover = 0
      const re = !!(b as Record<string, unknown>).rollover_enabled

      if (re) {
        const prevInfo = prevUnusedMap[b.category_id as number]
        if (prevInfo && prevInfo.rollover_enabled) {
          auto_rollover = prevInfo.unused
        }
        rollover_contribution =
          (((b as Record<string, unknown>).rollover_amount as number) || 0) +
          auto_rollover -
          (((b as Record<string, unknown>).rollover_used as number) || 0)
      }

      const effective_budget = (b.amount as number) + Math.max(0, rollover_contribution)
      const effective_remaining = effective_budget - spentAmt

      return {
        ...b,
        category_name: cat?.name,
        category_color: cat?.color,
        category_icon: cat?.icon,
        type: cat?.type,
        spent: spentAmt,
        remaining: baseRemaining,
        effective_budget,
        effective_remaining,
        rollover_contribution: Math.max(0, rollover_contribution),
        auto_rollover,
        percentage:
          (b.amount as number) > 0 ? Math.min(100, (spentAmt / (b.amount as number)) * 100) : 0,
      }
    })

    return json(summary)
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
}

// ── Zero-based budgeting ─────────────────────────────────────────────────────

export async function budgetsZeroBased(query: URLSearchParams): Promise<Response> {
  try {
    const db = await getDB()
    const pid = await adapter.getCurrentProfileId()
    const month = query.get('month') || new Date().toISOString().slice(0, 7)
    const startOfMonth = `${month}-01`
    const endOfMonth = endOfNextMonth(startOfMonth)

    const cats = (await db.getAllFromIndex('categories', 'by_profile', pid))
      .filter((c: Record<string, unknown>) => c.type === 'expense')
      .sort((a: Record<string, unknown>, b: Record<string, unknown>) =>
        (a.name as string).localeCompare(b.name as string)
      )

    const budgets = (await db.getAllFromIndex('budgets', 'by_profile', pid)).filter(
      (b: Record<string, unknown>) =>
        (b.start_date as string) >= startOfMonth &&
        (b.start_date as string) < endOfMonth &&
        b.period === 'monthly'
    )

    const budgetMap: Record<number, Record<string, unknown>> = {}
    for (const b of budgets) budgetMap[b.category_id as number] = b

    const txns = await db.getAllFromIndex('transactions', 'by_profile', pid)
    const spentMap: Record<number, number> = {}
    for (const t of txns) {
      if (t.type !== 'expense' || !t.category_id) continue
      if ((t.date as string) >= startOfMonth && (t.date as string) < endOfMonth) {
        spentMap[t.category_id as number] =
          (spentMap[t.category_id as number] || 0) + Math.abs(getAmount(t))
      }
    }

    const income = txns
      .filter(
        (t: Record<string, unknown>) =>
          t.type === 'income' &&
          (t.date as string) >= startOfMonth &&
          (t.date as string) < endOfMonth
      )
      .reduce((sum: number, t: Record<string, unknown>) => sum + getAmount(t), 0)

    let alreadyBudgeted = 0
    for (const b of budgets) alreadyBudgeted += (b.amount as number) || 0
    const unassignedBudget = Math.max(0, income - alreadyBudgeted)

    const allocations = cats.map((cat: Record<string, unknown>) => {
      const budget = budgetMap[cat.id as number]
      const spentAmt = spentMap[cat.id as number] || 0
      const budgetAmount = (budget?.amount as number) || 0
      const remainingBudget = budgetAmount - spentAmt
      const percentUsed = budgetAmount > 0 ? (spentAmt / budgetAmount) * 100 : 0

      return {
        budget_id: budget?.id ?? null,
        category_id: cat.id,
        category_name: cat.name,
        category_color: cat.color,
        category_icon: cat.icon,
        amount: budgetAmount,
        spent: spentAmt,
        remaining_budget: remainingBudget,
        percent_used: Math.min(100, Math.round(percentUsed)),
        is_budgeted: !!budget,
        can_allocate: unassignedBudget > 0,
        rollover_enabled: !!(budget as Record<string, unknown>)?.rollover_enabled,
      }
    })

    return json({
      categories: cats.map((c: Record<string, unknown>) => ({
        id: c.id,
        name: c.name,
        color: c.color,
        icon: c.icon,
      })),
      allocations,
      remaining_income: income,
      alreadyBudgeted,
      unassigned_budget: unassignedBudget,
      period: month,
      can_allocate: unassignedBudget > 0,
    })
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
}

// ── Zero-based budget summary ───────────────────────────────────────────────

export async function budgetsZeroBasedSummary(query: URLSearchParams): Promise<Response> {
  try {
    const db = await getDB()
    const pid = await adapter.getCurrentProfileId()
    const month = query.get('month') || new Date().toISOString().slice(0, 7)
    const startOfMonth = `${month}-01`
    const endOfMonth = endOfNextMonth(startOfMonth)

    const budgets = (await db.getAllFromIndex('budgets', 'by_profile', pid)).filter(
      (b: Record<string, unknown>) =>
        (b.start_date as string) >= startOfMonth &&
        (b.start_date as string) < endOfMonth &&
        b.period === 'monthly'
    )

    const txns = await db.getAllFromIndex('transactions', 'by_profile', pid)
    const spentMap: Record<number, number> = {}
    for (const t of txns) {
      if (t.type !== 'expense' || !t.category_id) continue
      if ((t.date as string) >= startOfMonth && (t.date as string) < endOfMonth) {
        spentMap[t.category_id as number] =
          (spentMap[t.category_id as number] || 0) + Math.abs(getAmount(t))
      }
    }

    const income = txns
      .filter(
        (t: Record<string, unknown>) =>
          t.type === 'income' &&
          (t.date as string) >= startOfMonth &&
          (t.date as string) < endOfMonth
      )
      .reduce((sum: number, t: Record<string, unknown>) => sum + getAmount(t), 0)

    const cats = await db.getAllFromIndex('categories', 'by_profile', pid)
    const catMap: Record<number, Record<string, unknown>> = {}
    for (const c of cats) catMap[c.id as number] = c

    const totalBudget = budgets.reduce(
      (sum: number, b: Record<string, unknown>) => sum + ((b.amount as number) || 0),
      0
    )
    const totalSpent = Object.values(spentMap).reduce((sum: number, val: number) => sum + val, 0)
    const remaining = totalBudget - totalSpent
    const zero_based_remaining = income - totalBudget

    const summary = budgets.map((b: Record<string, unknown>) => {
      const cat = catMap[b.category_id as number]
      const s = spentMap[b.category_id as number] || 0
      const amt = (b.amount as number) || 0
      const pct = amt > 0 ? (s / amt) * 100 : 0
      return {
        budget_id: b.id,
        category_id: b.category_id,
        category_name: cat?.name,
        category_color: cat?.color,
        category_icon: cat?.icon,
        allocated: amt,
        spent: s,
        remaining: amt - s,
        percent_used: pct,
        status: s > amt ? 'over' : 'ok',
        is_fully_allocated: amt > 0 && s <= amt,
        rollover_enabled: !!(b as Record<string, unknown>).rollover_enabled,
        alerts: [] as string[],
        is_unallocated: false,
      }
    })

    // Unallocated income
    if (zero_based_remaining > 0) {
      summary.push({
        budget_id: 0,
        category_id: 0,
        category_name: 'Unallocated / Future',
        category_color: '#9ca3af',
        category_icon: 'wallet',
        allocated: 0,
        spent: 0,
        remaining: zero_based_remaining,
        percent_used: 0,
        status: 'ok',
        is_fully_allocated: true,
        rollover_enabled: false,
        alerts: [
          'You have unallocated income. Consider adding a savings allocation or increase existing budgets.',
        ],
        is_unallocated: true,
      })
    }

    // Alerts
    for (const item of summary) {
      if (item.percent_used >= 90) {
        item.alerts.push(`Approaching limit: ${Math.round(item.percent_used)}% used`)
      }
      if (item.percent_used >= 100) {
        item.alerts.push(`Over budget by $${Math.abs(item.remaining).toFixed(2)}`)
      }
    }

    return json({
      allocations: summary,
      total_budget: totalBudget,
      total_spent: totalSpent,
      remaining,
      zero_based_remaining,
      income,
      period: month,
    })
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
}

// ── Budget allocate ──────────────────────────────────────────────────────────

export async function budgetsAllocate(query: URLSearchParams, body: unknown): Promise<Response> {
  try {
    const pid = await adapter.getCurrentProfileId()
    if (!body || typeof body !== 'object') return json({ error: 'Invalid data' }, 400)
    const { category_id, amount, period } = body as Record<string, unknown>
    if (!category_id || amount === null) {
      return json({ error: 'Category ID and amount are required' }, 400)
    }

    const month = query.get('month') || new Date().toISOString().slice(0, 7)
    const start_date = `${month}-01`
    const budgetPeriod = (period as string) || 'monthly'

    // Check if budget already exists
    const db = await getDB()
    const existing = (await db.getAllFromIndex('budgets', 'by_profile', pid)).find(
      (b: Record<string, unknown>) =>
        b.category_id === category_id && b.start_date === start_date && b.period === budgetPeriod
    )

    if (existing) {
      return json(
        {
          error: `Budget already exists for ${month}. Use PUT /api/budgets/${existing.id} to update it.`,
        },
        400
      )
    }

    const id = await adapter.createBudget({
      category_id: category_id as number,
      amount: amount as number,
      period: budgetPeriod as 'monthly' | 'weekly' | 'yearly',
      start_date,
      profile_id: pid,
      rollover_enabled: false,
      rollover_amount: 0,
    } as Parameters<typeof adapter.createBudget>[0])

    return json({
      id,
      category_id,
      amount,
      period: budgetPeriod,
      start_date,
      profile_id: pid,
      message: 'Budget allocated successfully',
    })
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
}

// ── Budget rollover ──────────────────────────────────────────────────────────

export async function budgetsRollover(
  params: Record<string, string>,
  body: unknown
): Promise<Response> {
  try {
    const db = await getDB()
    const pid = await adapter.getCurrentProfileId()
    const id = idParam(params)

    if (!body || typeof body !== 'object') return json({ error: 'Invalid data' }, 400)
    const { rollover_amount, rollover_used, rollover_enabled } = body as Record<string, unknown>

    if (
      rollover_amount === undefined &&
      rollover_used === undefined &&
      rollover_enabled === undefined
    ) {
      return json({ error: 'No rollover fields provided' }, 400)
    }

    const budget = await db.get('budgets', id)
    if (!budget || (budget.profile_id as number) !== pid) {
      return json({ error: 'Budget not found' }, 404)
    }

    if (rollover_amount !== undefined) budget.rollover_amount = rollover_amount as number
    if (rollover_used !== undefined) budget.rollover_used = rollover_used as number
    if (rollover_enabled !== undefined) budget.rollover_enabled = rollover_enabled ? true : false

    await db.put('budgets', budget)

    return json({ ok: true, budget })
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
}

// ── Budget from-expenses ─────────────────────────────────────────────────────

export async function budgetsFromExpenses(body: unknown): Promise<Response> {
  try {
    const db = await getDB()
    const pid = await adapter.getCurrentProfileId()

    if (!body || typeof body !== 'object') return json({ error: 'Invalid data' }, 400)
    const { year, month } = body as Record<string, unknown>

    const targetYear = (year as number) || new Date().getFullYear()
    const targetMonth = (month as number) || new Date().getMonth() + 1

    const pm = prevMonth(targetYear, targetMonth)
    const prevStart = monthStart(pm.year, pm.month)
    const prevEnd = monthStart(targetYear, targetMonth)

    // Get expenses by category for previous month
    const txns = (await db.getAllFromIndex('transactions', 'by_profile', pid)).filter(
      (t: Record<string, unknown>) =>
        t.type === 'expense' &&
        t.category_id !== null &&
        (t.date as string) >= prevStart &&
        (t.date as string) < prevEnd
    )

    const expensesByCat: Record<number, number> = {}
    for (const t of txns) {
      const cid = t.category_id as number
      expensesByCat[cid] = (expensesByCat[cid] || 0) + getAmount(t)
    }

    const entries = Object.entries(expensesByCat)
    if (entries.length === 0) {
      return json({ ok: false, message: 'No expenses found for previous month' })
    }

    // Clear existing budgets for target month
    const currStart = monthStart(targetYear, targetMonth)
    const currEnd = targetMonth === 12
      ? monthStart(targetYear + 1, 1)
      : monthStart(targetYear, targetMonth + 1)

    const existingBudgets = (await db.getAllFromIndex('budgets', 'by_profile', pid)).filter(
      (b: Record<string, unknown>) =>
        (b.start_date as string) >= currStart && (b.start_date as string) < currEnd
    )

    const tx = db.transaction('budgets', 'readwrite')
    for (const b of existingBudgets) await tx.store.delete(b.id as number)

    for (const [catId, total] of entries) {
      await tx.store.add({
        category_id: parseInt(catId),
        amount: total,
        period: 'monthly',
        start_date: currStart,
        profile_id: pid,
        rollover_enabled: false,
        rollover_amount: 0,
      })
    }
    await tx.done

    return json({ ok: true, count: entries.length })
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
}

// ── Budget duplicate-last ────────────────────────────────────────────────────

export async function budgetsDuplicateLast(body: unknown): Promise<Response> {
  try {
    const db = await getDB()
    const pid = await adapter.getCurrentProfileId()

    if (!body || typeof body !== 'object') return json({ error: 'Invalid data' }, 400)
    const { year, month } = body as Record<string, unknown>

    const targetYear = (year as number) || new Date().getFullYear()
    const targetMonth = (month as number) || new Date().getMonth() + 1

    const pm = prevMonth(targetYear, targetMonth)
    const prevStart = monthStart(pm.year, pm.month)
    const prevEnd = monthStart(targetYear, targetMonth)

    // Get previous month's budgets
    const prevBudgets = (await db.getAllFromIndex('budgets', 'by_profile', pid)).filter(
      (b: Record<string, unknown>) =>
        (b.start_date as string) >= prevStart && (b.start_date as string) < prevEnd
    )

    if (prevBudgets.length === 0) {
      return json({ ok: false, message: 'No budgets found for previous month' })
    }

    // Clear existing budgets for target month
    const currStart = monthStart(targetYear, targetMonth)
    const currEnd = monthStart(
      targetMonth === 12 ? targetYear + 1 : targetYear,
      targetMonth === 12 ? 1 : targetMonth + 1
    )

    const existingBudgets = (await db.getAllFromIndex('budgets', 'by_profile', pid)).filter(
      (b: Record<string, unknown>) =>
        (b.start_date as string) >= currStart && (b.start_date as string) < currEnd
    )

    const tx = db.transaction('budgets', 'readwrite')
    for (const b of existingBudgets) await tx.store.delete(b.id as number)

    for (const b of prevBudgets) {
      await tx.store.add({
        category_id: b.category_id,
        amount: b.amount,
        period: b.period,
        start_date: currStart,
        profile_id: pid,
        rollover_enabled: (b as Record<string, unknown>).rollover_enabled || false,
        rollover_amount: (b as Record<string, unknown>).rollover_amount || 0,
      })
    }
    await tx.done

    return json({ ok: true, count: prevBudgets.length })
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
}

// ── Budget forecast ──────────────────────────────────────────────────────────

export async function budgetsForecast(query: URLSearchParams): Promise<Response> {
  try {
    const db = await getDB()
    const pid = await adapter.getCurrentProfileId()
    const month = query.get('month') || new Date().toISOString().slice(0, 7)

    const budgets = (await db.getAllFromIndex('budgets', 'by_profile', pid))
      .filter((b: Record<string, unknown>) => (b.start_date as string) <= month)
      .sort((a: Record<string, unknown>, b: Record<string, unknown>) =>
        (b.start_date as string).localeCompare(a.start_date as string)
      )

    if (budgets.length === 0) {
      return json({
        period: month,
        history: [],
        forecast: [],
        total_budget: 0,
        avg_adherence: 0,
      })
    }

    const txns = (await db.getAllFromIndex('transactions', 'by_profile', pid)) as Record<
      string,
      unknown
    >[]

    // Historical averages by category
    const catAvgs: Record<number, { total: number; count: number; avgAmount: number }> = {}
    for (const b of budgets) {
      const cid = b.category_id as number
      if (!catAvgs[cid]) catAvgs[cid] = { total: 0, count: 0, avgAmount: 0 }

      const bStart = b.start_date as string
      const bEnd = endOfNextMonth(bStart)
      const spent = txns
        .filter(
          (t: Record<string, unknown>) =>
            t.type === 'expense' &&
            t.category_id === cid &&
            (t.date as string) >= bStart &&
            (t.date as string) < bEnd
        )
        .reduce((sum: number, t: Record<string, unknown>) => sum + getAmount(t), 0)
      if (spent > 0) {
        catAvgs[cid].total += spent
        catAvgs[cid].count += 1
      }
    }
    for (const cid in catAvgs) {
      if (catAvgs[cid].count > 0) catAvgs[cid].avgAmount = catAvgs[cid].total / catAvgs[cid].count
    }

    // Forecast next 6 months
    const now = new Date()
    const forecastMonths = []
    for (let i = 1; i <= 6; i++) {
      const date = new Date(now.getFullYear(), now.getMonth() + i, 1)
      forecastMonths.push({
        month: date.toISOString().slice(0, 7),
        label: date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
      })
    }

    const forecastData = forecastMonths.map((fm) => {
      const fmMonthStr = `${fm.month}-01`
      const currentBudget =
        budgets.find((b: Record<string, unknown>) => b.start_date === fmMonthStr) ||
        budgets[budgets.length - 1]
      const cid = currentBudget.category_id as number
      const avgSpending = catAvgs[cid]
        ? catAvgs[cid].avgAmount
        : (currentBudget.amount as number) * 0.5

      const monthDiff =
        (parseInt(fm.month.slice(0, 4)) - now.getFullYear()) * 12 +
        parseInt(fm.month.slice(5, 7)) -
        (now.getMonth() + 1)
      const inflationFactor = Math.pow(1.03, Math.max(0, monthDiff))

      const predictedSpent = avgSpending * inflationFactor
      const budgetAmount = (currentBudget.amount as number) || 0
      const adherence = budgetAmount > 0 ? Math.min(100, (predictedSpent / budgetAmount) * 100) : 0
      const status = adherence > 100 ? 'over' : adherence >= 80 ? 'warning' : 'ok'

      return {
        month: fm.month,
        label: fm.label,
        budget_amount: budgetAmount,
        predicted_spent: predictedSpent,
        adherence,
        status,
        forecast_remaining: Math.max(0, budgetAmount - predictedSpent),
      }
    })

    // Historical adherence for last 6 months
    // Aggregate by month
    const histMap: Record<string, { budget: number; spent: number }> = {}
    for (const b of budgets) {
      const mo = (b.start_date as string).slice(0, 7)
      if (!histMap[mo]) histMap[mo] = { budget: 0, spent: 0 }
      histMap[mo].budget += (b.amount as number) || 0
    }
    for (const t of txns) {
      if (t.type !== 'expense') continue
      const mo = (t.date as string).slice(0, 7)
      if (histMap[mo]) histMap[mo].spent += getAmount(t)
    }

    const historyMonths = Object.keys(histMap)
      .filter((mo) => mo <= now.toISOString().slice(0, 7))
      .sort()
      .reverse()
      .slice(0, 6)

    const history = historyMonths.map((mo) => {
      const d = histMap[mo]
      return {
        month: mo,
        label: new Date(`${mo}-01`).toLocaleDateString('en-US', {
          month: 'short',
          year: 'numeric',
        }),
        total_budget: d.budget,
        total_spent: d.spent,
        adherence: d.budget > 0 ? Math.min(100, (d.spent / d.budget) * 100) : 0,
      }
    })

    const avgAdherence =
      history.length > 0
        ? history.reduce(
            (sum: number, h: Record<string, unknown>) => sum + (h.adherence as number),
            0
          ) / history.length
        : 0

    return json({
      period: month,
      history,
      forecast: forecastData,
      total_budget: budgets.reduce(
        (sum: number, b: Record<string, unknown>) => sum + ((b.amount as number) || 0),
        0
      ),
      avg_adherence: Math.round(avgAdherence),
    })
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
}

// ── Helper: end of month after start_date ────────────────────────────────────

function endOfNextMonth(startDate: string): string {
  const d = new Date(startDate)
  d.setMonth(d.getMonth() + 1)
  return d.toISOString().slice(0, 10)
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
  return json(loans)
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
    const month = parseInt(query.get('month')!) || now.getMonth() + 1

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

    // Recent transactions (top 10)
    const recent = [...currentTxns]
      .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id)
      .slice(0, 10)

    // Category breakdown (expenses)
    const cats = await adapter.listCategories()
    const catMap = new Map(cats.map((c) => [c.id, c]))
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
    const pid = await adapter.getCurrentProfileId()
    const accts = await adapter.listAccounts()
    const totalNetWorth = accts.reduce((s, a) => s + (a.balance || 0), 0)

    // Monthly net flow from all transactions
    const allTxns = await adapter.listTransactions()
    const profileTxns = allTxns.filter(
      (t) => t.profile_id === pid && (t.type === 'income' || t.type === 'expense')
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
        (t) => t.profile_id === pid && t.type === type && t.date >= cmpStart && t.date <= cmpEnd
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
      (t) => t.profile_id === pid && t.type === 'expense' && t.date >= startStr && t.date <= endStr
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
  }
}

// ── Receipts ────────────────────────────────────────────────────────────────

function getProfileIdFromStorage(): number {
  const stored = localStorage.getItem('currentProfileId')
  return stored ? parseInt(stored, 10) : 1
}

// ── Reports ─────────────────────────────────────────────────────────────────

export async function reportHandler(ctx: {
  path: string
  query: URLSearchParams
}): Promise<Response> {
  const path = ctx.path
  const query = ctx.query

  // PDF generation requires puppeteer/pdfkit — not available client-side
  if (path.includes('-pdf')) {
    return json(
      {
        error: 'PDF report generation is not available in serverless mode.',
        message:
          'Please switch to self-hosted mode (Settings → Storage Mode) to generate PDF reports.',
        serverlessMode: true,
      },
      501
    )
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
  workbook: XLSX.WorkBook
  uploadedAt: number
}

const importSessions = new Map<string, ImportSession>()

function parseSheetData(workbook: XLSX.WorkBook) {
  const sheetName = workbook.SheetNames[0] || 'Sheet1'
  const sheet = workbook.Sheets[sheetName]
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
    let workbook: XLSX.WorkBook

    if (ext === 'csv') {
      const text = new TextDecoder().decode(buffer)
      workbook = XLSX.read(text, { type: 'string', raw: true })
    } else {
      workbook = XLSX.read(buffer, { type: 'array' })
    }

    const sessionId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    importSessions.set(sessionId, { workbook, uploadedAt: Date.now() })

    const rows = parseSheetData(workbook)
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

    const rows = parseSheetData(session.workbook)
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

export async function importGoogleSheet(): Promise<Response> {
  return json(
    {
      error: 'Google Sheets import is not available in serverless mode due to CORS restrictions.',
      message: 'Please download your sheet as CSV or Excel and import the file instead.',
      serverlessMode: true,
    },
    501
  )
}

export async function importExecute(body: unknown): Promise<Response> {
  try {
    const data = body as Record<string, unknown>
    const sessionId = toStr(data.session_id)
    const session = importSessions.get(sessionId)
    if (!session) return json({ error: 'Session expired or not found' }, 404)

    const mapping = (data.mapping as Record<string, string>) || {}
    const dryRun = Boolean(data.dry_run)
    const categoryTypes = (data.categoryTypes as Record<string, string>) || {}
    const accountTypes = (data.accountTypes as Record<string, string>) || {}
    const accountBalances = (data.accountBalances as Record<string, string>) || {}
    const accountBalanceDates = (data.accountBalanceDates as Record<string, string>) || {}

    const rows = parseSheetData(session.workbook)
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
      const description = mapping.description
        ? toStr(row[mapping.description]) || toStr(row.description)
        : toStr(row.description)
      const date = mapping.date ? toStr(row[mapping.date]) || toStr(row.date) : toStr(row.date)
      const amount = parseFloat(
        mapping.amount
          ? toStr(row[mapping.amount]) || toStr(row.amount) || '0'
          : toStr(row.amount) || '0'
      )
      // Determine transaction type: use type column > categoryTypes > amount sign
      let type = 'expense'
      if (mapping.type) {
        const rawType = toStr(row[mapping.type]).trim().toLowerCase()
        if (['income', 'expense', 'transfer'].includes(rawType)) {
          type = rawType
        } else {
          const catName = mapping.category ? toStr(row[mapping.category]).toLowerCase().trim() : ''
          const catType = categoryTypes[catName]
          if (catType && (catType === 'income' || catType === 'expense')) {
            type = catType
          } else {
            type = amount < 0 ? 'expense' : amount > 0 ? 'income' : 'expense'
          }
        }
      } else {
        const catName = mapping.category ? toStr(row[mapping.category]).toLowerCase().trim() : ''
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
      if (mapping.category && row[mapping.category]) {
        const catName = toStr(row[mapping.category]).toLowerCase().trim()
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
        notes: mapping.notes ? toStr(row[mapping.notes]) : '',
        beneficiary: mapping.beneficiary ? toStr(row[mapping.beneficiary]) : '',
        payor: mapping.payor ? toStr(row[mapping.payor]) : '',
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
