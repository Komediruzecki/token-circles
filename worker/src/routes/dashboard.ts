import { Hono } from 'hono'
import type { AppEnv } from '../index'
import { requireAuth } from '../auth'
import { getProfileIds } from '../profile'
import * as db from '../db'
import { localNow, localToday } from '../local-date'
import { dueWithin, type ScheduledBill } from '../../../shared/billSchedule'

// Port of backend/routes/dashboard.js — read-only aggregations over
// transactions / accounts / budgets / bills. Every response object is built by
// hand with camelCase keys (totalIncome, totalExpenses, totalNetWorth, ...); the
// EXACT key casing/shape the Express backend produces is preserved here. None of
// these go through toCamelCase.
//
// All endpoints are cross-profile reads, so they use getProfileIds(c) (the Express
// `profile_id IN (...)`, expanded to placeholders). The Express routes guarded only
// /api/dashboard with requireAuth, but the Worker's profile scoping reads
// c.get('userId'), so requireAuth is applied to every route here.
export const dashboardRoutes = new Hono<AppEnv>()

interface TypeTotalRow {
  type: string | null
  total: number | null
  count?: number | null
}

interface AccountRow {
  id: number
  name: string
  type: string
  currency: string
  balance: number | null
}

// ── GET /api/dashboard ────────────────────────────────────────────────────────
dashboardRoutes.get('/api/dashboard', requireAuth, async (c) => {
  const pids = await getProfileIds(c)
  const inClause = pids.map(() => '?').join(',')

  // Currency setting (kept for parity; not part of the response, matching Express).
  await db.first<{ value: string }>(
    c.env.DB,
    `SELECT value FROM settings WHERE key = ? AND (profile_id IN (${inClause}) OR profile_id IS NULL) ORDER BY profile_id DESC LIMIT 1`,
    'local_currency',
    ...pids
  )

  const dateFrom = c.req.query('date_from')
  const dateTo = c.req.query('date_to')
  const allTime = c.req.query('all') === 'true'
  let startDate: string
  let endDate: string
  // "This month" and "today" on the person's calendar, not the Worker's UTC one.
  const now = localNow(c)
  const year = parseInt(c.req.query('year') || '') || now.getFullYear()
  const month = parseInt(c.req.query('month') || '') || now.getMonth() + 1
  if (allTime) {
    startDate = '0000-01-01'
    endDate = '9999-12-31'
  } else if (dateFrom && dateTo) {
    startDate = dateFrom
    endDate = dateTo
  } else {
    startDate = `${year}-${String(month).padStart(2, '0')}-01`
    const lastDay = new Date(year, month, 0).getDate()
    endDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
  }

  // Previous month calculation.
  const prevMonth = month === 1 ? 12 : month - 1
  const prevYear = month === 1 ? year - 1 : year
  const prevStartDate = `${prevYear}-${String(prevMonth).padStart(2, '0')}-01`
  const prevLastDay = new Date(prevYear, prevMonth, 0).getDate()
  const prevEndDate = `${prevYear}-${String(prevMonth).padStart(2, '0')}-${String(prevLastDay).padStart(2, '0')}`

  const monthly = await db.all<TypeTotalRow>(
    c.env.DB,
    `SELECT type, SUM(COALESCE(amount_local, amount)) as total, COUNT(*) as count FROM transactions WHERE profile_id IN (${inClause}) AND date >= ? AND date <= ? GROUP BY type`,
    ...pids,
    startDate,
    endDate
  )

  const summary = { income: 0, expense: 0, balance: 0 }
  for (const r of monthly) {
    if (r.type === 'income') summary.income = r.total ?? 0
    else if (r.type === 'expense') summary.expense = r.total ?? 0
    else if (r.type === 'transfer') summary.balance += r.total ?? 0
  }

  // Previous month summary for MoM deltas.
  const prevMonthly = await db.all<TypeTotalRow>(
    c.env.DB,
    `SELECT type, SUM(COALESCE(amount_local, amount)) as total FROM transactions WHERE profile_id IN (${inClause}) AND date >= ? AND date <= ? GROUP BY type`,
    ...pids,
    prevStartDate,
    prevEndDate
  )

  const prevSummary = { income: 0, expense: 0, balance: 0 }
  for (const r of prevMonthly) {
    if (r.type === 'income') prevSummary.income = r.total ?? 0
    else if (r.type === 'expense') prevSummary.expense = r.total ?? 0
    else if (r.type === 'transfer') prevSummary.balance += r.total ?? 0
  }

  const momIncomeDelta = summary.income - prevSummary.income
  const momExpenseDelta = summary.expense - prevSummary.expense
  const momBalanceDelta = summary.income - summary.expense - (prevSummary.income - prevSummary.expense)

  const recent = await db.all(
    c.env.DB,
    `SELECT t.*, c.name as category_name, c.color as category_color, c.icon as category_icon FROM transactions t LEFT JOIN categories c ON t.category_id = c.id AND c.profile_id = t.profile_id WHERE t.profile_id IN (${inClause}) AND t.date >= ? AND t.date <= ? ORDER BY t.date DESC, t.id DESC LIMIT 10`,
    ...pids,
    startDate,
    endDate
  )

  // Category breakdown for expenses.
  const expenseByCategory = await db.all(
    c.env.DB,
    `SELECT c.name as category_name, c.color as category_color, SUM(COALESCE(t.amount_local, t.amount)) as total FROM transactions t LEFT JOIN categories c ON t.category_id = c.id AND c.profile_id = t.profile_id WHERE t.profile_id IN (${inClause}) AND t.type = 'expense' AND t.date >= ? AND t.date <= ? GROUP BY c.id, c.name, c.color ORDER BY total DESC`,
    ...pids,
    startDate,
    endDate
  )

  // Account balances.
  const accounts = await db.all<AccountRow>(
    c.env.DB,
    `SELECT id, name, type, currency, balance FROM accounts WHERE profile_id IN (${inClause})`,
    ...pids
  )
  const balance = accounts.reduce((sum, a) => sum + (a.balance || 0), 0)

  // Upcoming bills: the active ones that fall due from today through the next 30 days, by the one
  // rule for when a bill falls due next (shared/billSchedule.ts), five at most. It read the due date
  // a bill was saved with, which marking it paid never moves, so a monthly bill left the card for
  // good once that first date had passed; and it listed paused bills.
  const bills = await db.all<ScheduledBill & Record<string, unknown>>(
    c.env.DB,
    `SELECT b.*, p.name as profile_name FROM bills b LEFT JOIN profiles p ON b.profile_id = p.id WHERE b.profile_id IN (${inClause})`,
    ...pids
  )
  const upcomingBills = dueWithin(bills, localToday(c), 30).slice(0, 5)

  return c.json({
    totalIncome: summary.income,
    totalExpenses: summary.expense,
    balance,
    incomeByCategory: [],
    expenseByCategory,
    recentTransactions: recent,
    upcomingBills,
    momIncomeDelta,
    momExpenseDelta,
    momBalanceDelta,
  })
})

// ── GET /api/dashboard/summary ────────────────────────────────────────────────
// Registered before nothing dynamic, but kept ordered with the rest for clarity.
dashboardRoutes.get('/api/dashboard/summary', requireAuth, async (c) => {
  const pids = await getProfileIds(c)
  const inClause = pids.map(() => '?').join(',')
  const year = c.req.query('year')
  const month = c.req.query('month')
  // Support both "YYYY-MM" format and just "MM".
  const monthPart = month ? (month.includes('-') ? month.split('-')[1] : month) : null
  // NOTE: mirrors the Express code. `y` is a number when defaulted, a string when it comes from
  // the query; `m` (monthPart) is a string, so the previous-period comparisons below behave
  // loosely. The current period is worked out on numbers: the Express `m + 1` concatenated, so
  // month=3 ended on '2025-31-01' and counted every later month of the year as March.
  const y: number | string = year || localNow(c).getFullYear()
  const m: string | null = monthPart
  const yNum = Number(y)
  const mNum = m ? parseInt(m, 10) : NaN
  let startDate: string
  let endDate: string

  if (m) {
    // Specific month.
    startDate = `${y}-${String(m).padStart(2, '0')}-01`
    const nextM = mNum === 12 ? 1 : mNum + 1
    const nextY = mNum === 12 ? yNum + 1 : yNum
    endDate = `${nextY}-${String(nextM).padStart(2, '0')}-01`
  } else {
    // Full year.
    startDate = `${y}-01-01`
    endDate = `${yNum + 1}-01-01`
  }

  const monthly = await db.all<TypeTotalRow>(
    c.env.DB,
    `
    SELECT type, SUM(COALESCE(amount_local, amount)) as total, COUNT(*) as count
    FROM transactions
    WHERE profile_id IN (${inClause}) AND date >= ? AND date < ?
    GROUP BY type
    `,
    ...pids,
    startDate,
    endDate
  )

  const summary = { income: 0, expense: 0, transfer: 0, balance: 0 }
  for (const r of monthly) {
    if (r.type === 'income') summary.income = r.total ?? 0
    else if (r.type === 'expense') summary.expense = r.total ?? 0
    else if (r.type === 'transfer') summary.transfer = r.total ?? 0
  }
  summary.balance = summary.income - summary.expense

  const recent = await db.all(
    c.env.DB,
    `
    SELECT t.*, c.name as category_name, c.color as category_color, c.icon as category_icon
    FROM transactions t
    LEFT JOIN categories c ON t.category_id = c.id AND c.profile_id = t.profile_id
    WHERE t.profile_id IN (${inClause}) AND t.date >= ? AND t.date < ?
    ORDER BY t.date DESC, t.id DESC
    LIMIT 10
    `,
    ...pids,
    startDate,
    endDate
  )

  const yearStart = `${y}-01-01`
  const ytd = await db.all<TypeTotalRow>(
    c.env.DB,
    `
    SELECT type, SUM(COALESCE(amount_local, amount)) as total FROM transactions WHERE profile_id IN (${inClause}) AND date >= ? GROUP BY type
    `,
    ...pids,
    yearStart
  )
  const ytdSummary: { income: number; expense: number; net?: number } = { income: 0, expense: 0 }
  for (const r of ytd) {
    if (r.type === 'income') ytdSummary.income = r.total ?? 0
    else if (r.type === 'expense') ytdSummary.expense = r.total ?? 0
  }
  ytdSummary.net = ytdSummary.income - ytdSummary.expense

  // Previous period comparison.
  let prevStartDate: string
  let prevEndDate: string
  if (m) {
    // Previous month. Mirrors the Express `==` (loose) comparisons.
    const mNum = m as unknown as number
    const pm = mNum == 1 ? 12 : mNum - 1
    const py = mNum == 1 ? (y as number) - 1 : y
    prevStartDate = `${py}-${String(pm).padStart(2, '0')}-01`
    const nextPm = pm == 12 ? 1 : pm + 1
    const nextPy = pm == 12 ? (py as number) + 1 : py
    prevEndDate = `${nextPy}-${String(nextPm).padStart(2, '0')}-01`
  } else {
    // Previous year.
    prevStartDate = `${(y as number) - 1}-01-01`
    prevEndDate = `${y}-01-01`
  }

  const prevMonthly = await db.all<TypeTotalRow>(
    c.env.DB,
    `SELECT type, SUM(COALESCE(amount_local, amount)) as total FROM transactions WHERE profile_id IN (${inClause}) AND date >= ? AND date < ? GROUP BY type`,
    ...pids,
    prevStartDate,
    prevEndDate
  )
  const prevSummary = { income: 0, expense: 0 }
  for (const r of prevMonthly) {
    if (r.type === 'income') prevSummary.income = r.total ?? 0
    else if (r.type === 'expense') prevSummary.expense = r.total ?? 0
  }

  // Currency setting.
  const currencyRows = await db.all<{ value: string }>(
    c.env.DB,
    `SELECT value FROM settings WHERE key = ? AND (profile_id IN (${inClause}) OR profile_id IS NULL) ORDER BY profile_id DESC LIMIT 1`,
    'local_currency',
    ...pids
  )
  const currency = currencyRows.length ? currencyRows[0]!.value : 'EUR'

  return c.json({
    summary,
    prevSummary,
    recent,
    ytd: ytdSummary,
    month: m ? `${y}-${String(m).padStart(2, '0')}` : y,
    currency,
  })
})

// ── GET /api/dashboard/charts ─────────────────────────────────────────────────
dashboardRoutes.get('/api/dashboard/charts', requireAuth, async (c) => {
  const pids = await getProfileIds(c)
  const inClause = pids.map(() => '?').join(',')
  const months = c.req.query('months') ?? '12'
  // Ends today on the person's calendar (see /api/stats/monthly).
  const endDate = localNow(c)
  // From the 1st of the first month, as /api/stats/monthly and local-first count it.
  const startDate = new Date(
    endDate.getFullYear(),
    endDate.getMonth() - parseInt(String(months)) + 1,
    1
  )
  const startStr = startDate.toISOString().split('T')[0]
  const endStr = endDate.toISOString().split('T')[0]

  const byCategory = await db.all(
    c.env.DB,
    `
    SELECT c.name, c.color, c.icon, SUM(COALESCE(t.amount_local, t.amount)) as total, COUNT(*) as count
    FROM transactions t
    JOIN categories c ON t.category_id = c.id AND c.profile_id = t.profile_id
    WHERE t.profile_id IN (${inClause}) AND t.type = 'expense'
    GROUP BY c.id
    ORDER BY total DESC
    `,
    ...pids
  )

  const monthly = await db.all<{ month: string; type: string | null; total: number | null }>(
    c.env.DB,
    `
    SELECT strftime('%Y-%m', date) as month, type, SUM(COALESCE(amount_local, amount)) as total
    FROM transactions
    WHERE profile_id IN (${inClause}) AND date >= ? AND date <= ? AND type IN ('income', 'expense')
    GROUP BY month, type
    ORDER BY month
    `,
    ...pids,
    startStr,
    endStr
  )

  const monthlyMap: Record<string, { month: string; income: number; expense: number; cumulative?: number }> = {}
  for (const r of monthly) {
    if (!monthlyMap[r.month]) monthlyMap[r.month] = { month: r.month, income: 0, expense: 0 }
    if (r.type === 'income') monthlyMap[r.month]!.income = r.total ?? 0
    if (r.type === 'expense') monthlyMap[r.month]!.expense = r.total ?? 0
  }

  const cashFlow = Object.values(monthlyMap)
  let running = 0
  for (const row of cashFlow) {
    running += row.income - row.expense
    row.cumulative = running
  }

  // Currency setting.
  const currencyRows = await db.all<{ value: string }>(
    c.env.DB,
    `SELECT value FROM settings WHERE key = ? AND (profile_id IN (${inClause}) OR profile_id IS NULL) ORDER BY profile_id DESC LIMIT 1`,
    'local_currency',
    ...pids
  )
  const currency = currencyRows.length ? currencyRows[0]!.value : 'EUR'

  return c.json({
    byCategory,
    monthly: Object.values(monthlyMap),
    cashFlow,
    currency,
  })
})

// ── GET /api/dashboard/net-worth ──────────────────────────────────────────────
dashboardRoutes.get('/api/dashboard/net-worth', requireAuth, async (c) => {
  const pids = await getProfileIds(c)
  const inClause = pids.map(() => '?').join(',')

  // Account balances.
  const accounts = await db.all<AccountRow>(
    c.env.DB,
    `SELECT id, name, type, currency, balance FROM accounts WHERE profile_id IN (${inClause})`,
    ...pids
  )
  const totalNetWorth = accounts.reduce((sum, a) => sum + (a.balance || 0), 0)

  // Monthly net flow (income - expense) across all transactions.
  const monthly = await db.all<{ month: string; type: string | null; total: number | null }>(
    c.env.DB,
    `
    SELECT strftime('%Y-%m', date) as month, type, SUM(COALESCE(amount_local, amount)) as total
    FROM transactions
    WHERE profile_id IN (${inClause}) AND type IN ('income', 'expense')
    GROUP BY month, type
    ORDER BY month
    `,
    ...pids
  )

  const monthlyMap: Record<string, { month: string; net: number }> = {}
  for (const r of monthly) {
    if (!monthlyMap[r.month]) monthlyMap[r.month] = { month: r.month, net: 0 }
    if (r.type === 'income') monthlyMap[r.month]!.net += r.total ?? 0
    if (r.type === 'expense') monthlyMap[r.month]!.net -= r.total ?? 0
  }

  // Build timeline from earliest transaction to now with running total.
  const timeline: { month: string; balance: number; netChange: number }[] = []
  const sortedMonths = Object.keys(monthlyMap).sort()
  if (sortedMonths.length > 0) {
    const totalNet = Object.values(monthlyMap).reduce((s, mm) => s + mm.net, 0)
    // Opening balance = current net worth - total net accumulated.
    const opening = totalNetWorth - totalNet

    let balance = opening
    for (const mm of sortedMonths) {
      balance += monthlyMap[mm]!.net
      timeline.push({
        month: mm,
        balance: Math.round(balance * 100) / 100,
        netChange: Math.round(monthlyMap[mm]!.net * 100) / 100,
      })
    }
  }

  return c.json({
    totalNetWorth: Math.round(totalNetWorth * 100) / 100,
    accounts,
    timeline,
  })
})
