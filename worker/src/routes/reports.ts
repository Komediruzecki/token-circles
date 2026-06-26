import { Hono } from 'hono'
import type { AppEnv } from '../index'
import { requireAuth } from '../auth'
import { getProfileId, getProfileIds } from '../profile'
import * as db from '../db'

// Port of backend/routes/reports.js. The JSON/data endpoints (tax-summary,
// pl-summary, overview, compare, saved/save) and the custom-report CRUD are
// ported faithfully. The PDF export endpoints (monthly-pdf, tax-summary-pdf,
// pl-summary-pdf, annual-pdf) depend on pdfService / pdfRenderService (PDFKit +
// Puppeteer) and the spreadsheet service — none of which run on Workers — so they
// return 501. See each handler's TODO.
export const reportsRoutes = new Hono<AppEnv>()

// In-memory store for "custom reports", matching the Express Map(). NOTE: on
// Workers this lives only for the lifetime of a single isolate and is not shared
// across isolates/requests — same volatile semantics the Express version had
// per-process, but more aggressively ephemeral. A durable store would need D1/KV.
const customReports = new Map<number, Record<string, any>>()

// Ported verbatim from backend/routes/reports.js — strips command-injection,
// XSS and dangerous-SQL patterns from a user-supplied report name.
function sanitizeInput(input: unknown): string {
  if (typeof input !== 'string') return input as string
  const commandInjectionPatterns = [
    /[;|&]/,
    /`/,
    /\$\(/,
    /\$\{/,
    /\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/,
    />\s*(\||>>|>|<|&)/,
    /~\//,
    /etc\/(?:passwd|shadow|group)/,
    /home\/(?:root|admin)/,
    /\/(dev|proc|sys)\//,
    /sudo/,
    /ping\s+-/,
  ]
  for (const pattern of commandInjectionPatterns) {
    if (pattern.test(input)) {
      return ''
    }
  }
  let sanitized = input.replace(/['";\\]/g, '')
  sanitized = sanitized.replace(/<script[^>]*>.*?<\/script>/gi, '')
  sanitized = sanitized.replace(/javascript:/gi, '')
  sanitized = sanitized.replace(/on\w+\s*=/gi, '')
  const dangerousSQLPatterns = [
    /DROP\s+TABLE/i,
    /DROP\s+DB/i,
    /DROP\s+DATABASE/i,
    /DELETE\s+FROM/i,
    /INSERT\s+INTO/i,
    /UPDATE\s+\w+/i,
    /TRUNCATE/i,
    /ALTER\s+\w+/i,
    /\.\./i,
    /\*/i,
  ]
  for (const pattern of dangerousSQLPatterns) {
    if (pattern.test(sanitized)) {
      return ''
    }
  }
  return sanitized.trim()
}

// ── Monthly PDF ──────────────────────────────────────────────────────
// Renders an export HTML page to PDF via Puppeteer (pdfRenderService) with a
// PDFKit text fallback (pdfService). Neither runs on Workers.
reportsRoutes.get('/api/reports/monthly-pdf', requireAuth, async (c) => {
  // TODO: PDF/xlsx generation needs a Workers-compatible approach
  return c.json({ error: 'Not ported yet' }, 501)
})

// ── Year-End Tax Summary (JSON) ──────────────────────────────────────
reportsRoutes.get('/api/reports/tax-summary', requireAuth, async (c) => {
  const pids = await getProfileIds(c)
  const inClause = pids.map(() => '?').join(',')
  const year = c.req.query('year')
  if (!year) return c.json({ error: 'year is required' }, 400)

  const startStr = `${year}-01-01`
  const endStr = `${year}-12-31`

  const rows = await db.all<{
    id: number
    date: string
    description: string
    amount: number
    currency: string
    category_name: string
    tax_deductible: number
  }>(
    c.env.DB,
    `SELECT t.id, t.date, t.description, t.amount, t.currency, c.name as category_name, c.tax_deductible
       FROM transactions t
       JOIN categories c ON t.category_id = c.id AND c.profile_id = t.profile_id
       WHERE t.profile_id IN (${inClause}) AND t.date >= ? AND t.date <= ? AND t.type = 'expense'
       ORDER BY c.tax_deductible DESC, c.name, t.date`,
    ...pids,
    startStr,
    endStr
  )

  const taxDeductible = rows.filter((r) => r.tax_deductible)
  const nonDeductible = rows.filter((r) => !r.tax_deductible)

  const byCategory = (rs: typeof rows) => {
    const map: Record<string, { total: number; transactions: any[] }> = {}
    rs.forEach((r) => {
      if (!map[r.category_name]) map[r.category_name] = { total: 0, transactions: [] }
      map[r.category_name].total += r.amount
      map[r.category_name].transactions.push({
        id: r.id,
        date: r.date,
        description: r.description,
        amount: r.amount,
        currency: r.currency,
      })
    })
    return map
  }

  return c.json({
    year: parseInt(year),
    taxDeductibleTotal: taxDeductible.reduce((s, r) => s + r.amount, 0),
    nonDeductibleTotal: nonDeductible.reduce((s, r) => s + r.amount, 0),
    totalExpenses: rows.reduce((s, r) => s + r.amount, 0),
    taxDeductibleCategories: byCategory(taxDeductible),
    nonDeductibleCategories: byCategory(nonDeductible),
    transactionCount: rows.length,
  })
})

// ── Year-End Tax Summary (PDF) ───────────────────────────────────────
reportsRoutes.get('/api/reports/tax-summary-pdf', requireAuth, async (c) => {
  // TODO: PDF/xlsx generation needs a Workers-compatible approach
  return c.json({ error: 'Not ported yet' }, 501)
})

// ── Year-End P&L Summary (JSON) ──────────────────────────────────────
reportsRoutes.get('/api/reports/pl-summary', requireAuth, async (c) => {
  const pids = await getProfileIds(c)
  const inClause = pids.map(() => '?').join(',')
  const year = c.req.query('year')
  if (!year) return c.json({ error: 'year is required' }, 400)

  const startStr = `${year}-01-01`
  const endStr = `${year}-12-31`

  const rows = await db.all<{
    id: number
    date: string
    description: string
    amount: number
    currency: string
    type: string
    category_name: string
  }>(
    c.env.DB,
    `SELECT t.id, t.date, t.description, t.amount, t.currency, t.type, c.name as category_name
       FROM transactions t
       JOIN categories c ON t.category_id = c.id AND c.profile_id = t.profile_id
       WHERE t.profile_id IN (${inClause}) AND t.date >= ? AND t.date <= ?
       ORDER BY t.type, c.name, t.date`,
    ...pids,
    startStr,
    endStr
  )

  const income = rows.filter((r) => r.type === 'income')
  const expenses = rows.filter((r) => r.type === 'expense')

  const byCategory = (txs: typeof rows) => {
    const map: Record<string, { total: number; count: number }> = {}
    txs.forEach((r) => {
      if (!map[r.category_name]) map[r.category_name] = { total: 0, count: 0 }
      map[r.category_name].total += r.amount
      map[r.category_name].count++
    })
    return map
  }

  const incomeTotal = income.reduce((s, r) => s + r.amount, 0)
  const expenseTotal = expenses.reduce((s, r) => s + r.amount, 0)

  return c.json({
    year: parseInt(year),
    income: { total: incomeTotal, byCategory: byCategory(income) },
    expenses: { total: expenseTotal, byCategory: byCategory(expenses) },
    netSavings: incomeTotal - expenseTotal,
    savingsRate:
      incomeTotal > 0 ? parseFloat((((incomeTotal - expenseTotal) / incomeTotal) * 100).toFixed(1)) : 0,
    transactionCount: rows.length,
  })
})

// ── Year-End P&L Summary (PDF) ───────────────────────────────────────
reportsRoutes.get('/api/reports/pl-summary-pdf', requireAuth, async (c) => {
  // TODO: PDF/xlsx generation needs a Workers-compatible approach
  return c.json({ error: 'Not ported yet' }, 501)
})

// ── Custom Report (create) ───────────────────────────────────────────
// Accepts a custom report name — sanitized to prevent command injection.
reportsRoutes.post('/api/reports/custom', requireAuth, async (c) => {
  const b = (await c.req.json()) as Record<string, any>
  const sanitizedName = sanitizeInput(b.name || 'Custom Report')
  if (!sanitizedName || sanitizedName.trim().length < 1) {
    return c.json({ error: 'Invalid report name' }, 400)
  }
  const id = Date.now()
  const report = {
    id,
    reportId: id,
    name: sanitizedName,
    type: b.type || 'custom',
    createdAt: new Date().toISOString(),
  }
  customReports.set(id, report)
  return c.json(report)
})

// ── Annual Financial Report (PDF) ────────────────────────────────────
// Puppeteer-rendered charts embedded in a PDF, with a PDFKit text fallback.
reportsRoutes.get('/api/reports/annual-pdf', requireAuth, async (c) => {
  // TODO: PDF/xlsx generation needs a Workers-compatible approach
  return c.json({ error: 'Not ported yet' }, 501)
})

// ── Overview Report ──────────────────────────────────────────────────
reportsRoutes.get('/api/reports/overview', requireAuth, async (c) => {
  const pid = await getProfileId(c)
  const startDate = c.req.query('startDate')
  const endDate = c.req.query('endDate')
  const type = c.req.query('type')
  const includeCategories = c.req.query('includeCategories')

  let incomeWhere = `profile_id = ? AND type = 'income'`
  let expenseWhere = `profile_id = ? AND type = 'expense'`
  const incomeParams: unknown[] = [pid]
  const expenseParams: unknown[] = [pid]

  if (startDate) {
    incomeWhere += ` AND date >= ?`
    expenseWhere += ` AND date >= ?`
    incomeParams.push(startDate)
    expenseParams.push(startDate)
  }
  if (endDate) {
    incomeWhere += ` AND date <= ?`
    expenseWhere += ` AND date <= ?`
    incomeParams.push(endDate)
    expenseParams.push(endDate)
  }

  const totalIncome =
    (
      await db.first<{ total: number }>(
        c.env.DB,
        `SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE ${incomeWhere}`,
        ...incomeParams
      )
    )?.total || 0
  const totalExpenses =
    (
      await db.first<{ total: number }>(
        c.env.DB,
        `SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE ${expenseWhere}`,
        ...expenseParams
      )
    )?.total || 0

  const countParams: unknown[] = type
    ? [pid, type, ...(startDate ? [startDate] : []), ...(endDate ? [endDate] : [])]
    : [pid]

  let countQuery = `SELECT COUNT(*) as count FROM transactions WHERE profile_id = ?`
  if (type) countQuery += ` AND type = ?`
  if (startDate) countQuery += ` AND date >= ?`
  if (endDate) countQuery += ` AND date <= ?`

  const transactionCount =
    (await db.first<{ count: number }>(c.env.DB, countQuery, ...countParams))?.count || 0

  const response: Record<string, unknown> = {
    totalIncome,
    totalExpenses,
    netBalance: totalIncome - totalExpenses,
    transactionCount,
  }

  if (includeCategories === 'true') {
    response.categoryBreakdown = await db.all(
      c.env.DB,
      `SELECT c.name, c.id, SUM(t.amount) as total
         FROM transactions t
         LEFT JOIN categories c ON t.category_id = c.id
         WHERE t.profile_id = ?
         GROUP BY c.id
         ORDER BY total DESC`,
      pid
    )
  }

  return c.json(response)
})

// ── Custom Report CRUD ───────────────────────────────────────────────
reportsRoutes.get('/api/reports/custom/:id', requireAuth, async (c) => {
  const id = parseInt(c.req.param('id'))
  const report = customReports.get(id)
  if (!report) return c.json({ error: 'Report not found' }, 404)
  return c.json(report)
})

reportsRoutes.put('/api/reports/custom/:id', requireAuth, async (c) => {
  const id = parseInt(c.req.param('id'))
  const report = customReports.get(id)
  if (!report) return c.json({ error: 'Report not found' }, 404)
  const b = (await c.req.json()) as Record<string, any>
  const updated = { ...report, ...b, id, updatedAt: new Date().toISOString() }
  customReports.set(id, updated)
  return c.json(updated)
})

reportsRoutes.delete('/api/reports/custom/:id', requireAuth, async (c) => {
  const id = parseInt(c.req.param('id'))
  if (!customReports.has(id)) return c.json({ error: 'Report not found' }, 404)
  customReports.delete(id)
  return c.json({ ok: true })
})

// ── Report Comparison ────────────────────────────────────────────────
reportsRoutes.get('/api/reports/compare', requireAuth, async (c) => {
  const pid = await getProfileId(c)
  const comparison: Array<{ month: string; income: number; expenses: number; net: number }> = []
  const now = new Date()
  for (let i = 0; i < 3; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const startDate = d.toISOString().split('T')[0]
    const endDate = new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().split('T')[0]
    const income =
      (
        await db.first<{ total: number }>(
          c.env.DB,
          `SELECT COALESCE(SUM(amount), 0) as total FROM transactions
           WHERE profile_id = ? AND type = 'income' AND date >= ? AND date <= ?`,
          pid,
          startDate,
          endDate
        )
      )?.total || 0
    const expenses =
      (
        await db.first<{ total: number }>(
          c.env.DB,
          `SELECT COALESCE(SUM(amount), 0) as total FROM transactions
           WHERE profile_id = ? AND type = 'expense' AND date >= ? AND date <= ?`,
          pid,
          startDate,
          endDate
        )
      )?.total || 0
    comparison.push({
      month: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      income,
      expenses,
      net: income - expenses,
    })
  }
  return c.json({ comparison })
})

// ── Saved Reports ────────────────────────────────────────────────────
reportsRoutes.get('/api/reports/saved', requireAuth, async (c) => {
  return c.json({ reports: [] })
})

reportsRoutes.post('/api/reports/save', requireAuth, async (c) => {
  const b = (await c.req.json()) as Record<string, any>
  if (!b.name) return c.json({ error: 'Report name is required' }, 400)
  const id = Date.now()
  customReports.set(id, {
    id,
    name: b.name,
    type: b.type || 'custom',
    params: b.params || {},
    createdAt: new Date().toISOString(),
  })
  return c.json({ id, name: b.name, ok: true })
})
