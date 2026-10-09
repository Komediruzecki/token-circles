/**
 * Analytics handlers — IndexedDB-backed implementations
 */
import {
  daysOfWeek,
  weekLabel,
  weeksOfMonth,
  weeksOfYear,
} from '../../../../../shared/calendarWeeks'
import { seedDefaultCategories } from '../idb'
import { adapter, getAmount, json } from './helpers'

export async function analyticsDistinctYears(): Promise<Response> {
  try {
    const allTxns = await adapter.listTransactions()
    const currentYear = new Date().getFullYear()
    const yearsSet = new Set<number>()
    for (const t of allTxns) {
      const y = parseInt(t.date.substring(0, 4))
      if (!isNaN(y) && y >= 1900 && y <= 2100) yearsSet.add(y)
    }
    const years = [...yearsSet].sort((a, b) => b - a)
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

    // Sunday to Saturday, every week that holds a day of the month, as the Worker lists them
    // (shared/calendarWeeks.ts). Stepping a week at a time from the 1st stopped at the week of the
    // 29th, so a month's last days that start a new week were in none.
    const weeks = month ? weeksOfMonth(year, month) : weeksOfYear(year)
    return json({ weeks: weeks.map((w) => ({ week: w.week, label: weekLabel(w) })) })
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
    const rows = allTxns.filter((t) => t.date.startsWith(String(year)) && t.type === type)

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

    // A week of the month as /api/analytics/weeks lists and labels it, Sunday to Saturday
    // (shared/calendarWeeks.ts). This used to read week N as days 7N-6 to 7N of the month, so week
    // 2 answered the 8th to the 14th under the label of the 2nd to the 8th.
    const picked =
      month && week ? weeksOfMonth(year, month).find((w) => w.week === week) : undefined
    // A week the month does not have (week 6 of February 2025) names no days, so it answers none,
    // as the Worker does: the whole month under a week's label would be wrong data.
    if (month && week && !picked) return json({ labels: [], datasets: [], numDays: 0 })

    // Date range
    let startStr: string, endStr: string
    if (picked) {
      startStr = picked.start
      endStr = picked.end
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
    const txns = allTxns.filter((t) => t.type === type && t.date >= startStr && t.date <= endStr)

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

    if (picked) {
      // Its seven days, Sunday to Saturday, the first or last of them in the month next door when
      // the week crosses into one, as its label says.
      daysOfWeek(picked).forEach((day, i) => {
        labels.push(dayNames[i])
        periodMap.set(day, i)
      })
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

    // Budgets for this month: the rows that start in it, as the Budgets page reads them (D13).
    // listBudgets answers every month's row, and taking the first per category showed the
    // earliest month's budget in every later month's flow. A row without a start date (the
    // router's schema requires one, so only a write around it leaves one out) is in no month.
    const budgetMap = new Map<number, (typeof budgets)[number]>()
    for (const b of budgets) {
      const inMonth =
        typeof b.start_date === 'string' && b.start_date.slice(0, 7) === startStr.slice(0, 7)
      if (b.period === 'monthly' && inMonth && !budgetMap.has(b.category_id)) {
        budgetMap.set(b.category_id, b)
      }
    }
    const activeBudgets = Array.from(budgetMap.values())

    // Get actual spending for this month
    const profileTxns = allTxns.filter(
      (t) => t.type === 'expense' && t.date >= startStr && t.date <= endStr
    )

    // Spending without a category is one row, as on the Worker: a row stored without the key and
    // one stored with null made two Uncategorized nodes of one name.
    const actualMap = new Map<number | null, number>()
    for (const t of profileTxns) {
      const key = t.category_id ?? null
      const prev = actualMap.get(key) || 0
      actualMap.set(key, prev + getAmount(t as unknown as Record<string, unknown>))
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

    // Categories to show: any with a budget or actual spending this month.
    const catIds = new Set<number | null>([...budgetMap.keys(), ...actualMap.keys()])
    // Nothing to visualize — let the UI show its empty state instead of an
    // orphan "Total Budget"/"Total Actual" pair with no flow between them.
    if (catIds.size === 0) return json({ nodes: [], links: [], hasBudgets: false })

    const hasBudgets = activeBudgets.length > 0
    const BUDGET = 'Total Budget'
    const ACTUAL = 'Total Actual'
    nodes.push({ name: BUDGET, category: 'budget' })

    // One row per category. When a category has no explicit budget we treat its
    // budget as its own spending, so an un-budgeted month still renders a proper
    // flow (Budget -> Category -> Actual) that simply collapses to spending ==
    // budget. Once the user sets real budgets, the planned-vs-actual gap appears.
    let totalBudget = 0
    let totalActual = 0
    for (const catId of catIds) {
      const cat = catId === null ? undefined : catMap.get(catId)
      const catName = cat?.name || 'Uncategorized'
      const actual = actualMap.get(catId) || 0
      const explicit = catId === null ? undefined : budgetMap.get(catId)
      const budget = explicit ? explicit.amount : actual
      if (budget <= 0 && actual <= 0) continue
      nodes.push({ name: catName, category: 'category', color: cat?.color })
      if (budget > 0) {
        totalBudget += budget
        links.push({
          source: BUDGET,
          target: catName,
          value: budget,
          sourceCategory: 'budget',
          targetCategory: 'category',
        })
      }
      if (actual > 0) {
        totalActual += actual
        links.push({
          source: catName,
          target: ACTUAL,
          value: actual,
          sourceCategory: 'category',
          targetCategory: 'actual',
        })
      }
    }

    nodes.push({ name: ACTUAL, category: 'actual' })

    // Any planned budget left unspent flows to a savings node.
    const budgetUnused = totalBudget - totalActual
    if (budgetUnused > 0) {
      nodes.push({ name: 'Unused Budget', category: 'savings' })
      links.push({
        source: BUDGET,
        target: 'Unused Budget',
        value: budgetUnused,
        sourceCategory: 'budget',
        targetCategory: 'savings',
      })
    }

    return json({ nodes, links, hasBudgets })
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
}

// ── Stats monthly ────────────────────────────────────────────────────────────

export async function statsMonthly(query: URLSearchParams): Promise<Response> {
  try {
    const months = parseInt(query.get('months') || '24')
    const profileTxns = await adapter.listTransactions()

    // Bucket income/expense by YYYY-MM in ONE pass instead of doing three full
    // filter/reduce passes per requested month. Buckets are keyed by
    // date.slice(0, 7), which matches the original date.startsWith('YYYY-MM')
    // check exactly for YYYY-MM-DD dates, and amounts accumulate in transaction
    // order — so the per-month totals are byte-for-byte identical to before.
    const buckets = new Map<string, { income: number; expense: number }>()
    for (const t of profileTxns) {
      if (t.type !== 'income' && t.type !== 'expense') continue
      const mo = t.date.slice(0, 7)
      let b = buckets.get(mo)
      if (!b) {
        b = { income: 0, expense: 0 }
        buckets.set(mo, b)
      }
      if (t.type === 'income') b.income += getAmount(t as unknown as Record<string, unknown>)
      else b.expense += getAmount(t as unknown as Record<string, unknown>)
    }

    const now = new Date()
    const result: Array<{ month: string; income: number; expense: number }> = []
    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const monthStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      const b = buckets.get(monthStr)
      result.push({ month: monthStr, income: b ? b.income : 0, expense: b ? b.expense : 0 })
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
