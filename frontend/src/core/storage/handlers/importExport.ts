/**
 * ExportImport handlers — IndexedDB-backed implementations
 */
import { seedDemoProfiles } from '../idb'
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

export async function exportAll(query?: URLSearchParams, headers?: HeadersInit): Promise<Response> {
  const pids = targetProfileIdsFromHeaders(headers)
  const data = await adapter.exportData(pids)
  const pretty = query?.get('pretty') === 'true'
  return json(data, 200, pretty)
}

export async function exportByType(
  params: Record<string, string>,
  query: URLSearchParams,
  headers?: HeadersInit
): Promise<Response> {
  const type = params.p1
  const fmt = query.get('format') || 'json'
  const pretty = query.get('pretty') === 'true'
  const pids = targetProfileIdsFromHeaders(headers)
  const data = await adapter.exportData(pids)

  if (fmt === 'csv') {
    const csvQuote = (s: string | null | undefined): string => `"${(s ?? '').replace(/"/g, '""')}"`

    if (type === 'transactions') {
      const csv = ['date,type,description,amount,currency,category_id,notes']
      for (const t of data.transactions) {
        csv.push(
          [
            t.date,
            t.type,
            csvQuote(t.description),
            t.amount,
            t.currency,
            t.category_id ?? '',
            csvQuote(t.notes),
          ].join(',')
        )
      }
      return new Response(csv.join('\n'), {
        headers: {
          'Content-Type': 'text/csv;charset=utf-8',
          'Content-Disposition': `attachment; filename=${type}.csv`,
        },
      })
    }

    if (type === 'categories') {
      const csv = ['id,profile_id,type,name,color,tax_deductible']
      for (const c of data.categories) {
        csv.push(
          [
            c.id,
            c.profile_id,
            c.type,
            csvQuote(c.name),
            c.color,
            c.tax_deductible ? 'true' : 'false',
          ].join(',')
        )
      }
      return new Response(csv.join('\n'), {
        headers: {
          'Content-Type': 'text/csv;charset=utf-8',
          'Content-Disposition': `attachment; filename=${type}.csv`,
        },
      })
    }

    if (type === 'budgets') {
      const csv = [
        'id,profile_id,category_id,amount,period,start_date,rollover_enabled,rollover_amount',
      ]
      for (const b of data.budgets) {
        csv.push(
          [
            b.id,
            b.profile_id,
            b.category_id,
            b.amount,
            b.period,
            b.start_date,
            b.rollover_enabled ? 'true' : 'false',
            b.rollover_amount,
          ].join(',')
        )
      }
      return new Response(csv.join('\n'), {
        headers: {
          'Content-Type': 'text/csv;charset=utf-8',
          'Content-Disposition': `attachment; filename=${type}.csv`,
        },
      })
    }

    if (type === 'accounts') {
      const csv = ['id,profile_id,name,type,currency,balance,notes,starting_balance,starting_date']
      for (const a of data.accounts) {
        csv.push(
          [
            a.id,
            a.profile_id,
            csvQuote(a.name),
            a.type,
            a.currency,
            a.balance,
            csvQuote(a.notes),
            a.starting_balance ?? 0,
            a.starting_date ?? '',
          ].join(',')
        )
      }
      return new Response(csv.join('\n'), {
        headers: {
          'Content-Type': 'text/csv;charset=utf-8',
          'Content-Disposition': `attachment; filename=${type}.csv`,
        },
      })
    }

    if (type === 'loans') {
      const csv = ['id,profile_id,name,principal,start_date,term_months']
      for (const l of data.loans) {
        csv.push(
          [l.id, l.profile_id, csvQuote(l.name), l.principal, l.start_date, l.term_months].join(',')
        )
      }
      return new Response(csv.join('\n'), {
        headers: {
          'Content-Type': 'text/csv;charset=utf-8',
          'Content-Disposition': `attachment; filename=${type}.csv`,
        },
      })
    }

    if (type === 'recurring') {
      const csv = [
        'id,profile_id,description,amount,type,frequency,category_id,account_id,start_date,end_date',
      ]
      const recurringList = data.recurring || []
      for (const r of recurringList) {
        csv.push(
          [
            r.id,
            r.profile_id,
            csvQuote(r.description as string),
            r.amount,
            r.type,
            r.frequency,
            r.category_id ?? '',
            r.account_id ?? '',
            r.start_date ?? '',
            r.end_date ?? '',
          ].join(',')
        )
      }
      return new Response(csv.join('\n'), {
        headers: {
          'Content-Type': 'text/csv;charset=utf-8',
          'Content-Disposition': `attachment; filename=${type}.csv`,
        },
      })
    }
  }

  if (type && type in data) {
    return json({ [type]: data[type as keyof typeof data] }, 200, pretty)
  }

  return json(data, 200, pretty)
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
