import { Hono } from 'hono'
import type { AppEnv } from '../index'
import { requireAuth } from '../auth'
import { getProfileId, getProfileIds } from '../profile'
import { HttpError } from '../http'
import * as db from '../db'

// Port of backend/routes/importRoutes.js.
//
// What's ported (pure DB / pure-JS text work — Workers-safe):
//   - POST /api/import/execute    — insert transactions (+ create accounts/categories
//                                   on the fly) from an already-parsed JSON `rows` array.
//   - POST /api/import/googlesheet — fetch a published Google Sheet as CSV and parse it
//                                   in pure JS (preview only; the actual insert is /execute).
//
// What's left 501 (needs a Workers-compatible spreadsheet parser + R2/upload handling):
//   - POST /api/import/upload      — multipart xlsx/csv FILE upload + SheetJS parse.
//   - POST /api/import/file-sheet  — re-read a previously uploaded workbook by fileId.
//   - the XLSX fallback branch of /googlesheet (when CSV export isn't available) also
//     depends on the spreadsheet parser, so it surfaces a 501-style error there.
export const importRoutes = new Hono<AppEnv>()

// ── getCategoryIcon — ported verbatim from backend/utils.js ───────────────────
// Maps a category name to an icon key when /execute auto-creates a category.
function getCategoryIcon(name: string): string {
  const lower = name.toLowerCase()
  const patterns: Array<[RegExp, string]> = [
    [/car|auto|vehicle|transport|gas|fuel|parking|uber|lyft|toll/i, 'car'],
    [/food|dining|grocer|restaurant|eat|meal|lunch|dinner|breakfast|cafe|coffee/i, 'coffee'],
    [/hous|rent|mortgage|home|lease|property|real\s*estate/i, 'home'],
    [/utilit|electric|water|gas\s*bill|sewer|trash|garbage|recycling|power|energy/i, 'zap'],
    [
      /entertain|fun|game|movie|cinema|theatre|theater|concert|music|stream|netflix|spotify|hulu|disney|hbo/i,
      'film',
    ],
    [/shop|retail|cloth|apparel|mall|amazon|walmart|target|costco/i, 'shopping-cart'],
    [
      /health|medical|doctor|dentist|pharma|hospital|clinic|therapy|vet|vision|eye|glasses/i,
      'heart',
    ],
    [/edu|school|college|university|tuition|book|course|class|learn|study|student/i, 'book'],
    [/travel|flight|airfare|airline|hotel|airbnb|vacation|trip|holiday/i, 'plane'],
    [/insur/i, 'shield'],
    [/sav|invest|retire|ira|401|stock|broker|dividend|interest/i, 'trending-up'],
    [/phone|mobile|cell|internet|wifi|broadband|telecom|data\s*plan/i, 'smartphone'],
    [/gift|donat|charit|present/i, 'gift'],
    [/pet|dog|cat|animal/i, 'smile'],
    [/fit|gym|sport|exercise|workout|yoga|bike|cycling|run/i, 'bar-chart-2'],
    [/subscri|member|recur/i, 'arrow-right'],
    [/child|kid|baby|daycare|nanny|babysit|school\s*supp/i, 'baby'],
    [/beaut|spa|salon|hair|nail|cosmet|skin|makeup|barber/i, 'sun'],
    [/business|work|office|supplies|desk/i, 'briefcase'],
    [/tax|irs|government/i, 'folder'],
    [/credit|debt|loan|card|payment/i, 'creditcard'],
    [/income|salary|wage|paycheck|payroll|earn|revenue|reimbursement/i, 'dollar-sign'],
    [/misc|other|general|uncategor|unknown|various|catch.?all/i, 'more-horizontal'],
    [/bill/i, 'file-text'],
  ]
  for (const [pattern, icon] of patterns) {
    if (pattern.test(lower)) return icon
  }
  return 'tag'
}

// ── parseDateString — ported from importRoutes.parseDateString ────────────────
// The numeric Excel-serial branch is dropped: it relied on spreadsheetService and
// only fires for binary-spreadsheet imports, which aren't supported on Workers.
function parseDateString(dateStr: unknown): string {
  const today = () => new Date().toISOString().split('T')[0]
  if (dateStr === null || dateStr === undefined || dateStr === '') return today()
  const s = String(dateStr).trim()
  const euMatch = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
  if (euMatch) {
    const [, d, m, y] = euMatch
    return new Date(parseInt(y, 10), parseInt(m, 10) - 1, parseInt(d, 10))
      .toISOString()
      .split('T')[0]
  }
  const date = new Date(s)
  if (!isNaN(date.getTime())) return date.toISOString().split('T')[0]
  return today()
}

// Pull a value from a row using any of the casing variants the Express code checks.
function pick(row: Record<string, any>, mapping: Record<string, any>, key: string): any {
  const variants = [
    key,
    key.charAt(0).toUpperCase() + key.slice(1),
    key.toUpperCase(),
  ]
  // Also support the CamelCase forms used for compound mapping keys.
  const camelMap: Record<string, string[]> = {
    amount_local: ['AmountLocal'],
    means_of_payment: ['MeansOfPayment', 'MEANS_OF_PAYMENT'],
    exchange_rate: ['ExchangeRate'],
  }
  if (camelMap[key]) variants.push(...camelMap[key])
  for (const v of variants) {
    const colIdx = mapping[v]
    if (colIdx === undefined) continue
    const cell = row[colIdx]
    if (cell !== undefined) return cell
  }
  return undefined
}

const NEW_CATEGORY_COLORS = [
  '#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16', '#22c55e',
  '#14b8a6', '#06b6d4', '#0ea5e9', '#3b82f6', '#6366f1', '#8b5cf6',
  '#a855f7', '#d946ef', '#ec4899', '#f43f5e', '#64748b', '#78716c',
]

const INCOME_KEYWORDS = [
  'salary', 'income', 'wages', 'wage', 'payroll', 'revenue', 'dividend', 'refund',
  'bonus', 'paycheck', 'pay cheque', 'interest', 'credit', 'received', 'royalt',
  'reimbursement',
]

// ── POST /api/import/upload — xlsx/csv FILE upload (NOT ported) ────────────────
// TODO: needs a Workers-compatible spreadsheet parser + R2/upload handling
importRoutes.post('/api/import/upload', requireAuth, async (c) => {
  return c.json({ error: 'Not ported yet' }, 501)
})

// ── POST /api/import/file-sheet — re-read uploaded workbook (NOT ported) ──────
// TODO: needs a Workers-compatible spreadsheet parser + R2/upload handling
importRoutes.post('/api/import/file-sheet', requireAuth, async (c) => {
  return c.json({ error: 'Not ported yet' }, 501)
})

// ── POST /api/import/googlesheet — fetch + parse a published sheet as CSV ──────
// Pure-JS CSV path is ported (handles quoted fields). The XLSX fallback (used when
// the sheet can't be exported as CSV, or to enumerate multiple tab names) needs the
// spreadsheet parser and is reported as a 501-style error.
importRoutes.post('/api/import/googlesheet', requireAuth, async (c) => {
  const b = (await c.req.json()) as Record<string, any>
  const { url, sheetName } = b
  if (!url) throw new HttpError(400, 'URL is required')

  const idMatch = String(url).match(/\/d\/([a-zA-Z0-9-_]+)/)
  if (!idMatch) throw new HttpError(400, 'Invalid Google Sheets URL or ID')
  const sheetId = idMatch[1]
  const gidMatch = String(url).match(/[?&#]gid=([0-9]+)/)
  const gid = gidMatch ? gidMatch[1] : null

  // CSV export (respects a specific tab via gid). Pure JS — Workers-safe.
  async function tryCsvExport(): Promise<{
    headers: string[]
    rows: string[][]
    sheetName: string
  } | { error: string }> {
    try {
      const csvUrl = gid
        ? `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`
        : `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv`
      const r = await fetch(csvUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } })
      if (!r.ok) throw new Error('HTTP ' + r.status)
      const text = await r.text()
      if (text.trim().startsWith('<!DOCTYPE') || text.trim().startsWith('<html')) {
        throw new Error('Sheet is not publicly accessible (got HTML instead of CSV)')
      }
      const rows: string[][] = []
      const lines = text.trim().split('\n')
      for (const line of lines) {
        const cols: string[] = []
        let cur = ''
        let inQuotes = false
        for (const ch of line) {
          if (ch === '"') inQuotes = !inQuotes
          else if (ch === ',' && !inQuotes) {
            cols.push(cur.trim().replace(/^"|"$/g, ''))
            cur = ''
          } else cur += ch
        }
        cols.push(cur.trim().replace(/^"|"$/g, ''))
        rows.push(cols)
      }
      const headers = rows[0] || []
      const dataRows = rows.slice(1).filter((row) => row.some((cell) => cell))
      return { headers, rows: dataRows, sheetName: sheetName || 'Sheet1' }
    } catch (err) {
      return { error: (err as Error).message }
    }
  }

  const csvResult = await tryCsvExport()
  if (!('error' in csvResult) && csvResult.headers.length > 0) {
    return c.json({
      headers: csvResult.headers,
      rows: csvResult.rows,
      selectedSheet: csvResult.sheetName,
      sheetNames: [csvResult.sheetName],
    })
  }

  // CSV export failed / returned nothing. The Express fallback parses the XLSX
  // export to enumerate tabs, which the spreadsheet parser can't do on Workers.
  // TODO: needs a Workers-compatible spreadsheet parser + R2/upload handling
  return c.json(
    {
      error:
        'Could not import this Google Sheet via CSV export' +
        ('error' in csvResult && csvResult.error ? ': ' + csvResult.error : '') +
        ". Make sure the sheet is shared as 'Anyone with link can view'. " +
        'The XLSX fallback is not available on this deployment yet.',
    },
    501
  )
})

// ── POST /api/import/execute — insert transactions from a parsed JSON `rows` ──
// Faithful port of the Express handler: creates accounts for category names typed
// as 'account', creates missing categories, inserts each transaction scoped to the
// active profile, then recomputes affected account balances. All pure DB work.
importRoutes.post('/api/import/execute', requireAuth, async (c) => {
  const pid = await getProfileId(c)
  const pids = await getProfileIds(c)
  const inClause = pids.map(() => '?').join(',')
  const b = (await c.req.json()) as Record<string, any>
  const { rows, mapping, categoryTypes, accountTypes, accountBalances, accountBalanceDates } = b
  if (!rows || !mapping) throw new HttpError(400, 'Missing data')

  const today = () => new Date().toISOString().split('T')[0]

  // name(lowercased) -> accountId, seeded with the profile(s)' existing accounts.
  const accountIdMap = new Map<string, number>()
  const existingAccounts = await db.all<{ id: number; name: string }>(
    c.env.DB,
    `SELECT id, name FROM accounts WHERE profile_id IN (${inClause})`,
    ...pids
  )
  for (const acc of existingAccounts) accountIdMap.set(acc.name.toLowerCase(), acc.id)

  // Create accounts for category names the user flagged as 'account' type.
  if (categoryTypes) {
    for (const [catName, catType] of Object.entries(categoryTypes as Record<string, string>)) {
      if (catType !== 'account') continue
      if (accountIdMap.has(String(catName).trim().toLowerCase())) continue
      const accType = (accountTypes && accountTypes[catName]) || 'giro'
      const balance = parseFloat((accountBalances && accountBalances[catName]) || '0') || 0
      const balanceDate = (accountBalanceDates && accountBalanceDates[catName]) || today()
      const result = await db.run(
        c.env.DB,
        'INSERT INTO accounts (name, type, currency, balance, notes, profile_id, starting_balance, starting_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        catName,
        accType,
        'USD',
        balance,
        '',
        pid,
        balance,
        balanceDate
      )
      const accountId = result.meta.last_row_id as number
      accountIdMap.set(String(catName).toLowerCase(), accountId)
      await db.run(
        c.env.DB,
        'INSERT INTO account_balance_history (account_id, balance, recorded_at) VALUES (?, ?, ?)',
        accountId,
        balance,
        balanceDate
      )
    }
  }

  let colorIndex = 0
  let imported = 0

  // Resolve-or-create the category for a row; returns its id (or null).
  async function resolveCategoryId(row: Record<string, any>): Promise<number | null> {
    const catName = pick(row, mapping, 'category')
    if (!catName || !String(catName).trim()) return null
    const existing = await db.first<{ id: number; color: string }>(
      c.env.DB,
      'SELECT id, color FROM categories WHERE LOWER(name) = LOWER(?) AND profile_id = ? LIMIT 1',
      String(catName).trim(),
      pid
    )
    if (existing) return existing.id
    const color = NEW_CATEGORY_COLORS[colorIndex % NEW_CATEGORY_COLORS.length]
    colorIndex++
    const icon = getCategoryIcon(String(catName).trim())
    const catType =
      (categoryTypes && categoryTypes[catName]) ||
      (INCOME_KEYWORDS.some((kw) => String(catName).toLowerCase().includes(kw)) ? 'income' : 'expense')
    const r = await db.run(
      c.env.DB,
      'INSERT INTO categories (name, type, color, icon, profile_id) VALUES (?, ?, ?, ?, ?)',
      String(catName).trim(),
      catType,
      color,
      icon,
      pid
    )
    return r.meta.last_row_id as number
  }

  // D1 has no synchronous multi-statement transaction wrapper like better-sqlite3's
  // db.transaction(); insert rows sequentially (same ordering/semantics).
  for (const row of rows as Array<Record<string, any>>) {
    const categoryId = await resolveCategoryId(row)

    const amountRaw = parseFloat(pick(row, mapping, 'amount')) || 0
    const amount = Math.abs(amountRaw)
    const dateRaw = pick(row, mapping, 'date') ?? today()
    const currency = pick(row, mapping, 'currency') || 'USD'

    const catName = pick(row, mapping, 'category')
    const catType = catName ? (categoryTypes && categoryTypes[String(catName).trim()]) : null

    // Determine transaction type (mirrors the Express precedence exactly).
    let validatedType: string
    if (mapping.type !== undefined) {
      const rawType = String(pick(row, mapping, 'type') || '').trim().toLowerCase()
      if (['income', 'expense', 'transfer'].includes(rawType)) {
        validatedType = rawType
      } else if (catType && (catType === 'income' || catType === 'expense')) {
        validatedType = catType
      } else {
        validatedType =
          amountRaw < 0 ||
          rawType.includes('expense') ||
          rawType.includes('debit') ||
          rawType.includes('spent')
            ? 'expense'
            : amountRaw > 0 ||
                rawType.includes('income') ||
                rawType.includes('credit') ||
                rawType.includes('received')
              ? 'income'
              : 'expense'
      }
    } else if (catType && (catType === 'income' || catType === 'expense')) {
      validatedType = catType
    } else {
      validatedType = amountRaw < 0 ? 'expense' : amountRaw > 0 ? 'income' : 'expense'
    }

    // account_id from Means of Payment (FROM), transfer_account_id from Category (TO).
    const mopName = pick(row, mapping, 'means_of_payment') || ''
    const accountId = mopName
      ? accountIdMap.get(String(mopName).trim().toLowerCase()) || null
      : null
    const transferAccountId = catName
      ? accountIdMap.get(String(catName).trim().toLowerCase()) || null
      : null

    await db.run(
      c.env.DB,
      `INSERT INTO transactions (description, amount, date, beneficiary, payor, category_id,
        currency, amount_local, means_of_payment, exchange_rate, type, notes, profile_id, account_id, transfer_account_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      pick(row, mapping, 'description') || '',
      amount,
      parseDateString(dateRaw),
      pick(row, mapping, 'beneficiary') || '',
      pick(row, mapping, 'payor') || '',
      categoryId,
      currency,
      parseFloat(pick(row, mapping, 'amount_local') ?? amount) || amount,
      mopName,
      parseFloat(pick(row, mapping, 'exchange_rate') ?? 1.0) || 1.0,
      validatedType,
      pick(row, mapping, 'notes') || '',
      pid,
      accountId,
      transferAccountId
    )
    imported++
  }

  // Recompute each touched account's balance from its linked transactions.
  for (const [, accountId] of accountIdMap) {
    const account = await db.first<{ starting_balance: number | null }>(
      c.env.DB,
      'SELECT starting_balance FROM accounts WHERE id = ?',
      accountId
    )
    const startBalance = account ? account.starting_balance || 0 : 0
    const moneyOut = await db.first<{ total: number }>(
      c.env.DB,
      "SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE account_id = ? AND type IN ('expense', 'transfer')",
      accountId
    )
    const moneyInDirect = await db.first<{ total: number }>(
      c.env.DB,
      "SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE account_id = ? AND type = 'income'",
      accountId
    )
    const moneyInTransfer = await db.first<{ total: number }>(
      c.env.DB,
      "SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE transfer_account_id = ? AND type IN ('income', 'transfer')",
      accountId
    )
    const computedBalance =
      startBalance -
      (moneyOut?.total || 0) +
      (moneyInDirect?.total || 0) +
      (moneyInTransfer?.total || 0)
    await db.run(
      c.env.DB,
      'UPDATE accounts SET balance = ? WHERE id = ?',
      Math.round(computedBalance * 100) / 100,
      accountId
    )
  }

  return c.json({
    imported,
    accounts_created: accountIdMap.size,
    message: `Successfully imported ${imported} transactions`,
  })
})
