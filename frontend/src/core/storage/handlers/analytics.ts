/**
 * Analytics handlers — IndexedDB-backed implementations
 */
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
