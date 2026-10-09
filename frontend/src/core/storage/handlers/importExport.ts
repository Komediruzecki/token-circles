/**
 * ExportImport handlers — IndexedDB-backed implementations
 */
import { EXPORT_MESSAGES, exportFile, isExportKind } from '../../../../../shared/exportColumns'
import { localToday } from '../../../utils/period'
import { getDB, seedDemoProfiles } from '../idb'
import { dashboardUpcomingBills } from './bills'
import {
  adapter,
  getAmount,
  json,
  monthEnd,
  monthStart,
  nextMonth,
  ok,
  prevMonth,
  targetProfileIdsFromHeaders,
} from './helpers'
import type { ExportKind } from '../../../../../shared/exportColumns'

export async function exportAll(query?: URLSearchParams, headers?: HeadersInit): Promise<Response> {
  const pids = targetProfileIdsFromHeaders(headers)
  const data = await adapter.exportData(pids)
  const pretty = query?.get('pretty') === 'true'
  return json(data, 200, pretty)
}

type Row = Record<string, unknown>

/** The rows of a store that belong to one of these profiles, in id order. */
async function profileRows(store: string, pids: readonly number[]): Promise<Row[]> {
  const db = await getDB()
  const rows = (
    await (db as unknown as { getAll(name: string): Promise<Row[]> }).getAll(store)
  ).filter((row) => pids.includes(row.profile_id as number))
  return rows.sort((a, b) => (a.id as number) - (b.id as number))
}

/**
 * A stored value, or, for a field the row was never given, what D1 stores for a column a row is
 * added without (its DEFAULT). A null the row holds stays null, as it does in D1.
 */
const or = (value: unknown, fallback: unknown): unknown => (value === undefined ? fallback : value)

/** One kind's rows with the columns the Worker reads them with (shared/exportColumns.ts). */
async function exportRows(kind: ExportKind, pids: readonly number[]): Promise<Row[]> {
  switch (kind) {
    case 'transactions': {
      const categories = await profileRows('categories', pids)
      const nameOf = (tx: Row) =>
        categories.find((c) => c.id === tx.category_id && c.profile_id === tx.profile_id)?.name ??
        null
      const rows = await profileRows('transactions', pids)
      const day = (tx: Row) => (typeof tx.date === 'string' ? tx.date : '')
      rows.sort((a, b) => day(b).localeCompare(day(a)) || (b.id as number) - (a.id as number))
      return rows.map((tx) => ({
        ...tx,
        means_of_payment: or(tx.means_of_payment, ''),
        beneficiary: or(tx.beneficiary, ''),
        payor: or(tx.payor, ''),
        notes: or(tx.notes, ''),
        category: nameOf(tx),
      }))
    }
    case 'categories':
      return (await profileRows('categories', pids)).map((c) => ({
        ...c,
        color: or(c.color, '#6b7280'),
        icon: or(c.icon, 'tag'),
        type: or(c.type, 'expense'),
      }))
    case 'accounts':
      return (await profileRows('accounts', pids)).map((a) => ({ ...a, notes: or(a.notes, '') }))
    case 'budgets': {
      const categories = await profileRows('categories', pids)
      return (await profileRows('budgets', pids)).flatMap((b) => {
        const category = categories.find(
          (c) => c.id === b.category_id && c.profile_id === b.profile_id
        )
        if (!category) return []
        return [
          {
            ...b,
            period: or(b.period, 'monthly'),
            rollover_enabled: or(b.rollover_enabled, 0),
            rollover_amount: or(b.rollover_amount, 0),
            rollover_used: or(b.rollover_used, 0),
            category_name: category.name,
          },
        ]
      })
    }
    case 'loans':
      return (await profileRows('loans', pids)).map((loan) => {
        const prepayments = Array.isArray(loan.prepayments)
          ? (loan.prepayments as { amount?: unknown }[])
          : []
        return {
          ...loan,
          total_prepaid:
            prepayments.length > 0
              ? prepayments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0)
              : null,
        }
      })
    case 'recurring':
      return (await profileRows('recurring', pids)).map((r) => ({
        ...r,
        notes: or(r.notes, ''),
        // Local-first stores the flag as is_active; D1 as active.
        active: r.active ?? r.is_active ?? 1,
      }))
  }
}

/**
 * One kind of row as CSV or JSON, for the profiles the request names (the open one when it names
 * none), as the Worker writes it: shared/exportColumns.ts.
 */
export async function exportByType(
  params: Record<string, string>,
  query: URLSearchParams,
  headers?: HeadersInit
): Promise<Response> {
  const kind = params.p1
  if (!isExportKind(kind)) return json({ error: EXPORT_MESSAGES.kind }, 400)
  const pids = targetProfileIdsFromHeaders(headers) ?? [await adapter.getCurrentProfileId()]
  const file = exportFile(
    kind,
    query.get('format'),
    await exportRows(kind, pids),
    query.get('pretty') === 'true'
  )
  return new Response(file.body, {
    headers: { 'Content-Type': file.contentType, 'Content-Disposition': file.disposition },
  })
}

/** The kinds of rows a restore writes, as the Worker counts them in `rows_restored`. */
const RESTORED_ROWS = [
  'categories',
  'accounts',
  'loans',
  'tags',
  'transactions',
  'budgets',
  'budgetsZeroBased',
  'goals',
  'retirementGoals',
  'emergencyFundConfig',
  'portfolioHoldings',
  'bills',
  'recurring',
  'housings',
  'categoryMappings',
  'balanceHistoryRows',
  'tagRules',
  'importLogs',
  'importSources',
  'receipts',
] as const

/** How many of `key`'s rows the file carries, or of the rows `from` gives when it has none. */
function rowsIn(data: Record<string, unknown>, key: string, from?: () => number): number {
  const rows = data[key]
  if (Array.isArray(rows) && rows.length > 0) return rows.length
  return from?.() ?? 0
}

/**
 * The answer the Worker gives a restore (worker/src/backup.ts restoreBackup): how many profiles
 * and rows came back, and the first restored profile, which the restore made the active one.
 */
function restoreSummary(data: Record<string, unknown>) {
  const list = (key: string) => (Array.isArray(data[key]) ? (data[key] as unknown[]) : [])
  const nested = (key: string, field: string) => () =>
    list(key).reduce<number>((sum, row) => {
      const inner = (row as Record<string, unknown>)[field]
      return sum + (Array.isArray(inner) ? inner.length : 0)
    }, 0)
  const settings =
    data.settings && typeof data.settings === 'object' ? Object.keys(data.settings) : []
  const rows =
    RESTORED_ROWS.reduce((sum, key) => sum + rowsIn(data, key), 0) +
    rowsIn(data, 'loanRatePeriods', nested('loans', 'rate_periods')) +
    rowsIn(data, 'loanPrepayments', nested('loans', 'prepayments')) +
    rowsIn(data, 'transactionTags', nested('transactions', 'tag_ids')) +
    rowsIn(data, 'settingsRows', () => settings.length)
  return {
    profiles_restored: list('profiles').length,
    rows_restored: rows,
    first_profile_id: Number(localStorage.getItem('currentProfileId')),
  }
}

export async function importData(body: unknown): Promise<Response> {
  if (!body || typeof body !== 'object') return json({ error: 'Invalid import data' }, 400)
  await adapter.importData(body as Parameters<typeof adapter.importData>[0])
  return json(restoreSummary(body as Record<string, unknown>))
}

export async function clearAll(): Promise<Response> {
  await adapter.clearAllData()
  return ok({ message: 'All data cleared' })
}

export async function deleteAllTransactions(headers?: HeadersInit): Promise<Response> {
  // Target the profile(s) named in the request header (Danger Zone can act on a
  // non-active profile); fall back to the active profile when none is given.
  const pids = targetProfileIdsFromHeaders(headers) ?? adapter.getCurrentProfileIds()
  await adapter.deleteAllTransactions(pids)
  return ok({ message: 'All transactions deleted' })
}

export async function deleteAllCategories(headers?: HeadersInit): Promise<Response> {
  const pid = targetProfileIdsFromHeaders(headers)?.[0] ?? (await adapter.getCurrentProfileId())
  await adapter.resetProfileCategories(pid)
  return ok({ message: 'Categories reset to defaults' })
}

export async function reseedDemoData(): Promise<Response> {
  await adapter.clearAllData({ includeProfiles: true })
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
      endDate = monthEnd(year, month)
    }

    // Previous period (for MoM delta)
    const pm = prevMonth(year, month)
    const prevStart = monthStart(pm.year, pm.month)
    const prevEnd = monthEnd(pm.year, pm.month)

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

    const upcomingBills = await dashboardUpcomingBills()

    return json({
      totalIncome: currentIncome,
      totalExpenses: currentExpense,
      balance,
      incomeByCategory: [],
      expenseByCategory,
      recentTransactions: recent,
      upcomingBills,
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
    // The 1st of the first month. setMonth() before setDate(1) overflowed on the 29th to the 31st:
    // on 31 October, twelve months back from the 31st is 31 November, which is 1 December.
    const startDate = new Date(endDate.getFullYear(), endDate.getMonth() - monthsCount + 1, 1)
    // Both ends on the person's calendar. toISOString() gives the UTC date: east of UTC the range
    // ended yesterday for the first hours of every day and began on the last day of the month
    // before (local midnight on the 1st is still the day before in UTC); west of UTC it ran into
    // tomorrow every evening.
    const startStr = localToday(startDate)
    const endStr = localToday(endDate)

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
    const profileTxns = allTxns.filter((t) => t.type === 'income' || t.type === 'expense')
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
