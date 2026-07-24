/**
 * Reports handlers — IndexedDB-backed implementations
 */
import {
  generateAnnualPdf,
  generateMonthlyPdf,
  generatePlSummaryPdf,
  generateTaxSummaryPdf,
} from '../clientPdfReports'
import { getDB } from '../idb'
import { adapter, getAmount, json } from './helpers'

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
      const pids = adapter.getCurrentProfileIds()
      const cats: any[] = []
      const txns: any[] = []
      for (const pid of pids) {
        cats.push(...(await db.getAllFromIndex('categories', 'by_profile', pid)))
        txns.push(...(await db.getAllFromIndex('transactions', 'by_profile', pid)))
      }

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
        const amount = getAmount(t)
        if (cat?.tax_deductible) {
          taxDeductible.push({ category_name: cat.name, amount })
        } else {
          nonDeductible.push({ category_name: cat?.name || 'Unknown', amount })
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
        totalExpenses: rows.reduce((s, r) => s + getAmount(r), 0),
        taxDeductibleCategories: byCategory(taxDeductible),
        nonDeductibleCategories: byCategory(nonDeductible),
        transactionCount: rows.length,
      })
    }

    if (path === '/api/reports/pl-summary') {
      const db = await getDB()
      const pids = adapter.getCurrentProfileIds()
      const cats: any[] = []
      const txns: any[] = []
      for (const pid of pids) {
        cats.push(...(await db.getAllFromIndex('categories', 'by_profile', pid)))
        txns.push(...(await db.getAllFromIndex('transactions', 'by_profile', pid)))
      }

      const startStr = `${year}-01-01`
      const endStr = `${year}-12-31`
      const rows = txns.filter((t) => t.date >= startStr && t.date <= endStr)
      const catMap = new Map(cats.map((c) => [c.id, c]))

      const normalizedRows = rows.map((r) => ({
        ...r,
        amount: getAmount(r),
        category_name: catMap.get(r.category_id)?.name || 'Unknown',
      }))
      const income = normalizedRows.filter((r) => r.type === 'income')
      const expenses = normalizedRows.filter((r) => r.type === 'expense')

      const byCategory = (txs: typeof rows) => {
        const map: Record<string, { total: number; count: number }> = {}
        for (const r of txs) {
          if (!map[r.category_name]) map[r.category_name] = { total: 0, count: 0 }
          map[r.category_name].total += r.amount
          map[r.category_name].count++
        }
        return map
      }

      const incomeByCat = byCategory(income)
      const expenseByCat = byCategory(expenses)

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

export async function reportsCustom(body: unknown): Promise<Response> {
  if (!body || typeof body !== 'object') return json({ error: 'Invalid data' }, 400)
  const b = body as Record<string, unknown>
  const name = (typeof b.name === 'string' ? b.name.trim() : '') || 'Custom Report'
  const reportType = (b.type as string) || 'custom'
  const dateFrom = b.date_from as string | undefined
  const dateTo = b.date_to as string | undefined
  const categoryId = b.category_id as number | undefined

  const db = await getDB()
  const pids = adapter.getCurrentProfileIds()
  const txns: Record<string, unknown>[] = []
  const categories: Record<string, unknown>[] = []
  for (const pid of pids) {
    txns.push(...(await db.getAllFromIndex('transactions', 'by_profile', pid)))
    categories.push(...(await db.getAllFromIndex('categories', 'by_profile', pid)))
  }

  let filtered = txns
  if (dateFrom) filtered = filtered.filter((t) => (t.date as string) >= dateFrom)
  if (dateTo) filtered = filtered.filter((t) => (t.date as string) <= dateTo)
  if (categoryId) filtered = filtered.filter((t) => t.category_id === categoryId)

  const totalIncome = filtered
    .filter((t) => t.type === 'income')
    .reduce((s, t) => s + getAmount(t), 0)
  const totalExpenses = filtered
    .filter((t) => t.type === 'expense')
    .reduce((s, t) => s + getAmount(t), 0)
  const netTotal = totalIncome - totalExpenses

  const categoryNames = new Map(
    categories.map((category) => [category.id, (category.name as string) || 'Uncategorized'])
  )
  const byCategory: Record<string, { count: number; total: number }> = {}
  for (const t of filtered) {
    const catName = categoryNames.get(t.category_id) || 'Uncategorized'
    if (!byCategory[catName]) byCategory[catName] = { count: 0, total: 0 }
    byCategory[catName].count++
    byCategory[catName].total += getAmount(t)
  }

  return json({
    reportId: Date.now(),
    name,
    type: reportType,
    createdAt: new Date().toISOString(),
    summary: {
      totalIncome,
      totalExpenses,
      netTotal,
      transactionCount: filtered.length,
    },
    byCategory,
  })
}
