/**
 * Import handlers — IndexedDB-backed implementations
 */
import { getLocalCurrency } from '../../api'
import { computeBalanceDeltas, getDB } from '../idb'
import { adapter, json } from './helpers'
import type { WorkBook } from 'xlsx'

function toStr(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean') return ''
  return String(v)
}

/** Normalize a date value to yyyy-mm-dd format.
 *  Handles: Google Viz Date(Y,M,D), dd/mm/yyyy, dd-mm-yyyy, yyyy-mm-dd, yyyy/mm/dd, Excel serial numbers */
function normalizeDate(v: unknown): string {
  if (v === null || v === undefined) return ''
  // Zero / empty numeric value — not a date
  if (v === 0 || v === '0') return ''
  // Google Visualization API date: Date(2026,3,9) — month is 0-indexed
  const gvizMatch = toStr(v).match(/^Date\((\d{4}),\s*(\d{1,2}),\s*(\d{1,2})\)$/)
  if (gvizMatch) {
    const y = parseInt(gvizMatch[1])
    const m = parseInt(gvizMatch[2]) + 1 // 0-indexed → 1-indexed
    const d = parseInt(gvizMatch[3])
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    }
  }
  // Excel serial date (days since 1900-01-01, with the 1900 leap year bug)
  if (typeof v === 'number' && v > 1 && v < 200000) {
    const d = new Date(Math.round((v - 25569) * 86400 * 1000))
    if (isNaN(d.getTime())) return ''
    return d.toISOString().slice(0, 10)
  }
  const s = toStr(v).trim()
  if (!s) return ''
  // Already yyyy-mm-dd
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  // yyyy/mm/dd
  const slashYmd = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/)
  if (slashYmd) {
    return `${slashYmd[1]}-${slashYmd[2].padStart(2, '0')}-${slashYmd[3].padStart(2, '0')}`
  }
  // dd/mm/yyyy or dd-mm-yyyy
  const dmy = s.match(/^(\d{1,2})[/\-. ](\d{1,2})[/\-. ](\d{4})$/)
  if (dmy) {
    const d = parseInt(dmy[1]),
      m = parseInt(dmy[2]),
      y = parseInt(dmy[3])
    if (d > 12 && m <= 12) {
      return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    }
    if (d <= 31 && m <= 12) {
      return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    }
    return ''
  }
  // Try native Date parse as fallback
  const dt = new Date(s)
  if (!isNaN(dt.getTime())) {
    const y = dt.getFullYear()
    if (y >= 1971 && y <= 2100) return dt.toISOString().slice(0, 10)
  }
  return ''
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
        cleaned.date = normalizeDate(value) || value
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
  const profileId = await adapter.getCurrentProfileId()
  const existing = await db.getAllFromIndex('transactions', 'by_profile', profileId)

  // Bucket existing transactions by (date, normalized-description) ONCE so the
  // per-row check is a small local scan instead of a full O(M) find per row.
  // The matching key mirrors the original find() exactly: date and normalized
  // description must be equal, and amounts must be within 0.01 (a penny). The
  // amount tolerance is not an equivalence relation, so it stays a real
  // comparison — but it only ever needs to run against existing rows that
  // already share the same (date, description), which is what this map groups.
  // The two key parts are joined with a NUL byte so the (date, description) pair
  // round-trips unambiguously and can never collide across different pairs (a
  // NUL never appears in a date or a description), keeping this exactly as
  // strict as the original tuple comparison.
  const keyOf = (date: string, desc: string) => `${date}\x00${desc}`
  const existingByKey = new Map<string, number[]>()
  for (const t of existing) {
    const k = keyOf(t.date as string, (t.description as string).toLowerCase().trim())
    const amt = Number(t.amount)
    const bucket = existingByKey.get(k)
    if (bucket) bucket.push(amt)
    else existingByKey.set(k, [amt])
  }

  const duplicates: number[] = []
  const clean: Record<string, unknown>[] = []

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const date = normalizeDate(row.date) || toStr(row.date)
    const desc = toStr(row.description).toLowerCase().trim()
    const amount = parseFloat(toStr(row.amount) || '0')

    const bucket = existingByKey.get(keyOf(date, desc))
    const isDup = bucket ? bucket.some((amt) => Math.abs(amt - amount) < 0.01) : false
    if (isDup) duplicates.push(i)
    else clean.push(row)
  }

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

    // eslint-disable-next-line sonarjs/pseudo-random
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
  const gidMatch = url.match(/[?&#]gid=(\d+)/)
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
        if (ch === '"') {
          inQuotes = !inQuotes
        } else if (ch === ',' && !inQuotes) {
          cols.push(cur.trim().replace(/^"|"$/g, ''))
          cur = ''
        } else cur += ch
      }
      cols.push(cur.trim().replace(/^"|"$/g, ''))
      rows.push(cols)
    }
    return { headers: rows[0] || [], rows: rows.slice(1).filter((r) => r.some((c) => c)) }
  }

  const GOOGLE_SHEETS_TIMEOUT = 10000

  // Fetch helper that rejects on non-ok or non-data response
  const tryFetch = async (url: string): Promise<Response> => {
    const controller = new AbortController()
    const timer = setTimeout(() => {
      controller.abort()
    }, GOOGLE_SHEETS_TIMEOUT)
    try {
      const res = await fetch(url, { signal: controller.signal })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res
    } finally {
      clearTimeout(timer)
    }
  }

  // Try a single strategy — returns the parsed result or throws
  const tryStrategy = async (
    url: string,
    parser: (text: string) => ReturnType<typeof json> | null
  ): Promise<ReturnType<typeof json>> => {
    const res = await tryFetch(url)
    const text = await res.text()
    // Reject HTML responses (Google login walls, CORS errors disguised as HTML)
    const trimmed = text.trim()
    if (trimmed.startsWith('<!DOCTYPE') || trimmed.startsWith('<html')) {
      throw new Error('HTML response — likely CORS or auth wall')
    }
    const parsed = parser(trimmed)
    if (parsed) return parsed
    throw new Error('Parse returned empty')
  }

  /** Strip trailing columns that are both empty-headed and empty-bodied */
  const cleanColumns = (
    headers: string[],
    rows: string[][]
  ): { headers: string[]; rows: string[][] } => {
    // Find last column with a meaningful header or data
    let lastUsed = -1
    for (let c = 0; c < headers.length; c++) {
      const hasHeader = headers[c] && !/^[A-Z]{1,2}$/.test(headers[c])
      const hasData = rows.some((r) => r[c] && r[c].trim())
      if (hasHeader || hasData) lastUsed = c
    }
    if (lastUsed >= 0 && lastUsed < headers.length - 1) {
      return {
        headers: headers.slice(0, lastUsed + 1),
        rows: rows.map((r) => r.slice(0, lastUsed + 1)),
      }
    }
    return { headers, rows }
  }

  // Strategy 0: CORS proxy (required for browser — Google doesn't set CORS headers)
  const rawUrl = gid
    ? `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`
    : `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv`
  const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(rawUrl)}`
  const strategy0 = tryStrategy(proxyUrl, (text) => {
    const { headers, rows } = parseCSV(text)
    const cleaned = cleanColumns(headers, rows)
    return json({
      headers: cleaned.headers,
      rows: cleaned.rows,
      sheetNames: [sheetName || 'Sheet1'],
      selectedSheet: sheetName || 'Sheet1',
    })
  })

  // Strategy 1: Published CSV
  const pubUrl = gid
    ? `https://docs.google.com/spreadsheets/d/${sheetId}/pub?output=csv&gid=${gid}`
    : `https://docs.google.com/spreadsheets/d/${sheetId}/pub?output=csv`
  const strategy1 = tryStrategy(pubUrl, (text) => {
    const { headers, rows } = parseCSV(text)
    const cleaned = cleanColumns(headers, rows)
    return json({
      headers: cleaned.headers,
      rows: cleaned.rows,
      sheetNames: [sheetName || 'Sheet1'],
      selectedSheet: sheetName || 'Sheet1',
    })
  })

  // Strategy 2: Google Visualization API
  const gvizUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:json${gid ? `&gid=${gid}` : ''}${sheetName ? `&sheet=${encodeURIComponent(sheetName)}` : ''}`
  const strategy2 = tryStrategy(gvizUrl, (text) => {
    const jsonStr = text
      .replace(/^\)\]\}'/, '')
      .replace(/^\/\*O_o\*\/\s*google\.visualization\.Query\.setResponse\(/, '')
      .replace(/\);?\s*$/, '')
    const parsed = JSON.parse(jsonStr)
    if (!parsed.table) return null
    const rawCols = parsed.table.cols.map((c: Record<string, unknown>) => {
      const label = (c.label as string) || ''
      const id = (c.id as string) || ''
      // Google Viz uses Excel-style column letters (A, B, ..., L, M, ...) as id
      // If label is empty and id is a single/double uppercase letter, treat as empty header
      if (!label && /^[A-Z]{1,2}$/.test(id)) return ''
      return label || id
    })
    const dataRows = (parsed.table.rows || []).map((r: Record<string, unknown>) =>
      (r.c as Array<{ v: unknown }>).map((cell) => {
        const v = cell?.v
        if (v === null || v === undefined) return ''
        return typeof v === 'string'
          ? v
          : typeof v === 'number'
            ? String(v)
            : typeof v === 'boolean'
              ? String(v)
              : JSON.stringify(v)
      })
    )
    const gvizCleaned = cleanColumns(rawCols, dataRows)
    return json({
      headers: gvizCleaned.headers,
      rows: gvizCleaned.rows,
      sheetNames: [sheetName || 'Sheet1'],
      selectedSheet: sheetName || 'Sheet1',
    })
  })

  // Strategy 3: CSV export (rarely works from browser, but try)
  const csvUrl = gid
    ? `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`
    : `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv`
  const strategy3 = tryStrategy(csvUrl, (text) => {
    const { headers, rows } = parseCSV(text)
    const cleaned = cleanColumns(headers, rows)
    return json({
      headers: cleaned.headers,
      rows: cleaned.rows,
      sheetNames: [sheetName || 'Sheet1'],
      selectedSheet: sheetName || 'Sheet1',
    })
  })

  // Race all strategies against each other and a hard deadline
  const deadline = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new Error('TIMEOUT'))
    }, GOOGLE_SHEETS_TIMEOUT + 500)
  })

  const strategies: Promise<ReturnType<typeof json>>[] = [
    strategy0,
    strategy1,
    strategy2,
    strategy3,
  ]
  const errors: string[] = []

  // Try strategies sequentially with fast failure — first success wins,
  // but each gets at most GOOGLE_SHEETS_TIMEOUT total across all attempts
  try {
    const result = await Promise.race([
      (async () => {
        for (const s of strategies) {
          try {
            return await s
          } catch (e) {
            errors.push((e as Error).message)
          }
        }
        throw new Error(errors.join('; ') || 'All strategies failed')
      })(),
      deadline,
    ])
    return result as ReturnType<typeof json>
  } catch {
    return json(
      {
        error: 'Could not access the Google Sheet from the browser.',
        message:
          'To import this sheet, either: (1) Publish it to the web (File → Share → Publish to web), ' +
          'or (2) Set sharing to "Anyone with the link can view", ' +
          'or (3) Download as CSV and use the File Upload tab.',
        serverlessMode: true,
      },
      422
    )
  }
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

    // Auto-detect "IB" / "Interactive Brokers" categories as account type.
    // Use case-insensitive check to avoid duplicates like "IB" + "ib".
    const ibPattern = /^(ib|interactive\s*brokers)$/i
    for (const row of clean) {
      const rawCat = toStr(row.category).trim()
      if (ibPattern.test(rawCat)) {
        const key = rawCat.toLowerCase()
        const exists = Object.keys(categoryTypes).some((k) => k.toLowerCase() === key)
        if (!exists) {
          categoryTypes[key] = 'account'
          accountTypes[key] = accountTypes[key] || 'ib'
        }
      }
    }

    const profileId = await adapter.getCurrentProfileId()
    const db = await getDB()
    const categories = await db.getAllFromIndex('categories', 'by_profile', profileId)
    // Names of records this import actually created (reused ones excluded) — reported
    // back to the UI for the import session log.
    const newlyCreatedAccounts: string[] = []
    const newlyCreatedCategories: string[] = []

    // Normalize keys to lowercase so lookups are case-insensitive
    const normalizeKeys = (obj: Record<string, string>) => {
      const out: Record<string, string> = {}
      for (const [k, v] of Object.entries(obj)) out[k.toLowerCase()] = v
      return out
    }
    const catTypes = normalizeKeys(categoryTypes)
    const acctTypes = normalizeKeys(accountTypes)
    const acctBalances = normalizeKeys(accountBalances)
    const acctBalanceDates = normalizeKeys(accountBalanceDates)

    // Create accounts for categories marked as 'account' type
    const accountIdMap = new Map<string, number>()
    // Also track accounts from means_of_payment column values
    const mopAccountMap = new Map<string, number>()
    if (!dryRun) {
      // Check for existing accounts by name to avoid duplicates on re-import
      const existingAccounts = await db.getAllFromIndex('accounts', 'by_profile', profileId)
      // Track created account names (lowercase) to prevent duplicates from
      // case-variant keys like "IB" + "ib" both mapping to 'account'.
      const createdAccountNames = new Set<string>()
      for (const [catName, catType] of Object.entries(catTypes)) {
        if (catType !== 'account') continue
        const catLower = catName.toLowerCase()
        // Skip if already processed in this batch (case-insensitive duplicate)
        if (createdAccountNames.has(catLower)) continue
        // Reuse existing account if already present
        const existing = existingAccounts.find(
          (a: Record<string, unknown>) => ((a.name as string) || '').toLowerCase() === catLower
        )
        if (existing) {
          accountIdMap.set(catLower, existing.id as number)
          createdAccountNames.add(catLower)
          continue
        }
        const accType = (acctTypes[catName] || 'giro') as 'giro' | 'savings' | 'ib'
        const balance = parseFloat(acctBalances[catName]) || 0
        const balanceDate = acctBalanceDates[catName] || new Date().toISOString().split('T')[0]
        const account = {
          name: catName,
          type: accType,
          balance,
          starting_balance: balance,
          balance_date: balanceDate,
          profile_id: profileId,
          created_at: new Date().toISOString(),
        }
        const id = await db.add('accounts', account)
        accountIdMap.set(catLower, id as number)
        createdAccountNames.add(catLower)
        newlyCreatedAccounts.push(catName)
      }

      // Also build account map from means_of_payment column values.
      // Only link to EXISTING accounts — do NOT auto-create new ones.
      // Means of payment values may contain category names (e.g. "Salary Eur")
      // that should not become accounts.
      const existingAccounts2 = await db.getAllFromIndex('accounts', 'by_profile', profileId)
      for (const row of clean) {
        const mop = toStr(row.means_of_payment).trim()
        if (!mop) continue
        const mopLower = mop.toLowerCase()
        if (mopAccountMap.has(mopLower) || accountIdMap.has(mopLower)) continue
        const existing = existingAccounts2.find(
          (a: Record<string, unknown>) => ((a.name as string) || '').toLowerCase() === mopLower
        )
        if (existing) {
          mopAccountMap.set(mopLower, existing.id as number)
        }
        // Only link to accounts the user explicitly created — never auto-create.
      }
    }

    const imported: number[] = []
    const skipped: { index: number; reason: string }[] = []
    // Collected transaction objects to insert in a single batched IndexedDB
    // transaction (see below). One-by-one inserts with an awaited read-modify-
    // write balance update per row are O(N) sequential round-trips; batching
    // makes it O(N) inserts + O(A) account updates in one atomic transaction.
    const toInsert: Record<string, unknown>[] = []

    for (let i = 0; i < clean.length; i++) {
      const row = clean[i]
      const description = toStr(row.description)
      const date = normalizeDate(row.date) || toStr(row.date)
      const amount = parseFloat(toStr(row.amount) || '0')
      // Determine transaction type.
      // An explicit "transfer" always wins — a transfer between two accounts is a
      // transfer regardless of sign, and the category names the destination account
      // (e.g. bank imports: means_of_payment = source, category = destination).
      // Otherwise, for account-type categories (IB, Revolut, etc.), the type is from
      // the account's perspective: positive amount = money INTO account (income),
      // negative = money OUT (expense). Bank statement types are ignored for accounts
      // because the bank's perspective (e.g. "Expense" for a deposit) is inverted.
      let type = 'expense'
      const rawType = toStr(row.type).trim().toLowerCase()
      const catName = toStr(row.category).toLowerCase().trim()
      const catType = catTypes[catName]

      if (rawType === 'transfer') {
        type = 'transfer'
      } else if (catType === 'account') {
        type = amount < 0 ? 'expense' : amount > 0 ? 'income' : 'expense'
      } else if (rawType === 'income' || rawType === 'expense') {
        type = rawType
      } else if (catType && (catType === 'income' || catType === 'expense')) {
        type = catType
      } else {
        type = amount < 0 ? 'expense' : amount > 0 ? 'income' : 'expense'
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
      let transferAccountId: number | null = null
      const rawCat = toStr(row.category)
      const mopValue = toStr(row.means_of_payment).trim().toLowerCase()
      if (rawCat) {
        // Use lowered version only for matching; store original case in DB
        const catLower = rawCat.toLowerCase().trim()
        let cat = categories.find((c) => c.name.toLowerCase().trim() === catLower)
        // Auto-create category if not found
        if (!cat) {
          const palette = [
            '#EF4444',
            '#F97316',
            '#EAB308',
            '#22C55E',
            '#14B8A6',
            '#06B6D4',
            '#3B82F6',
            '#6366F1',
            '#8B5CF6',
            '#A855F7',
            '#EC4899',
            '#F43F5E',
            '#D946EF',
            '#84CC16',
            '#10B981',
            '#0EA5E9',
            '#2563EB',
            '#7C3AED',
            '#C026D3',
            '#E11D48',
          ]
          const defaultColor = palette[categories.length % palette.length]
          // Preserve original casing: capitalize first letter only
          const displayName = rawCat.trim()
          const storedName = displayName.charAt(0).toUpperCase() + displayName.slice(1)
          const id = await db.add('categories', {
            name: storedName,
            type,
            color: defaultColor,
            icon: 'tag',
            tax_deductible: false,
            profile_id: profileId,
          })
          cat = {
            id: id as number,
            name: storedName,
            type,
            color: defaultColor,
            icon: 'tag',
          } as any
          categories.push(cat)
          newlyCreatedCategories.push(storedName)
        }
        if (cat) categoryId = cat.id
        // Map category to account: for transfers on account-type categories,
        // the account is the DESTINATION (money arriving from external source,
        // e.g. selling stock → proceeds arrive at brokerage account).
        // For income/expense, the account is the primary account.
        if (accountIdMap.has(catLower)) {
          if (type === 'transfer') {
            transferAccountId = accountIdMap.get(catLower)!
          } else {
            accountId = accountIdMap.get(catLower)!
          }
        }
      }

      // Map means_of_payment to account (e.g. "Erste Current" as the account
      // where salary arrives or where transfer proceeds land).
      if (mopValue && mopAccountMap.has(mopValue)) {
        const mopId = mopAccountMap.get(mopValue)!
        if (type === 'income' && !accountId) {
          accountId = mopId
        } else if (type === 'transfer') {
          // Two-account transfer: the category already resolved the DESTINATION
          // account, so means_of_payment is the SOURCE — link it as account_id so
          // the balance moves on both sides (matches the worker import, which sets
          // account_id from means_of_payment and transfer_account_id from category).
          // When no destination was resolved, keep the prior behavior of treating
          // means_of_payment as the transfer account.
          if (transferAccountId && transferAccountId !== mopId && !accountId) {
            accountId = mopId
          } else if (!transferAccountId) {
            transferAccountId = mopId
          }
        }
        // For expense: money leaves the means_of_payment account
        if (type === 'expense' && !accountId) {
          accountId = mopId
        }
      }

      // Currency fields (mirrors the worker import): the sheet's "amount in local
      // currency" column becomes amount_local — the value in the user's base
      // currency, which the app reports as the transaction's value. Without that
      // column the amount is already in the base currency, so amount_local = amount.
      const currency = toStr(row.currency).trim() || getLocalCurrency()
      const amountLocalRaw = toStr(row.amount_local).trim()
      const amountLocal = amountLocalRaw ? Math.abs(parseFloat(amountLocalRaw)) : Math.abs(amount)
      const exchangeRateRaw = toStr(row.exchange_rate).trim()
      const exchangeRate = exchangeRateRaw ? parseFloat(exchangeRateRaw) : 1

      const transaction = {
        profile_id: profileId,
        type,
        description,
        date,
        amount: Math.abs(amount),
        amount_local: Number.isFinite(amountLocal) ? amountLocal : Math.abs(amount),
        currency,
        exchange_rate: Number.isFinite(exchangeRate) ? exchangeRate : 1,
        category_id: categoryId,
        notes: toStr(row.notes),
        beneficiary: toStr(row.beneficiary),
        payor: toStr(row.payor),
        account_id:
          accountId !== null ? accountId : data.account_id ? Number(data.account_id) : null,
        transfer_account_id: transferAccountId || undefined,
        created_at: new Date().toISOString(),
      }

      if (!dryRun) {
        // Defer the actual insert + balance update to a single batched
        // transaction after the loop (below). Category auto-creation above still
        // happens inline so category IDs are assigned in the same order as before.
        toInsert.push(transaction as Record<string, unknown>)
      } else {
        imported.push(-1)
      }
    }

    if (!dryRun && toInsert.length > 0) {
      // Insert every row and apply all account-balance adjustments inside ONE
      // atomic IndexedDB transaction. Balances are applied per-delta in exact
      // row order against a lazily-seeded in-memory cache, reproducing the exact
      // sequential float accumulation of the previous per-row read-modify-write
      // (starting balance b0, then b0+d1, +d2, ...), and each touched account is
      // written back exactly once. Transaction IDs are still auto-incremented in
      // insertion order, so imported_ids is identical to the unbatched version.
      const tx = db.transaction(['transactions', 'accounts'], 'readwrite')
      const txStore = tx.objectStore('transactions')
      const acctStore = tx.objectStore('accounts')

      for (const record of toInsert) {
        const id = (await txStore.add(record)) as number
        imported.push(id)
      }

      // Lazily read each touched account's current balance, then replay deltas.
      const balances = new Map<number, number>()
      const missing = new Set<number>()
      for (const record of toInsert) {
        for (const adj of computeBalanceDeltas(
          record as {
            account_id?: number | null
            transfer_account_id?: number | null
            type: string
            amount: number
            amount_local?: number | null
          }
        )) {
          if (missing.has(adj.accountId)) continue
          let bal = balances.get(adj.accountId)
          if (bal === undefined) {
            const acct = await acctStore.get(adj.accountId)
            if (!acct) {
              // Account not found — mirror _adjustAccountBalance's `if (acct)`
              // guard, which silently skips the adjustment.
              missing.add(adj.accountId)
              continue
            }
            bal = (acct.balance as number) ?? 0
          }
          balances.set(adj.accountId, bal + adj.delta)
        }
      }

      // Write each touched account's final balance once.
      for (const [accountId, balance] of balances) {
        const acct = await acctStore.get(accountId)
        if (acct) {
          acct.balance = balance
          await acctStore.put(acct)
        }
      }

      await tx.done
    }

    return json({
      imported: imported.length,
      skipped: skipped.length,
      dry_run: dryRun,
      imported_ids: dryRun ? [] : imported,
      skipped_items: skipped,
      // Count what this run actually created (accountIdMap also holds reused accounts)
      accounts_created: dryRun ? 0 : newlyCreatedAccounts.length,
      categories_created: dryRun ? 0 : newlyCreatedCategories.length,
      created_accounts: newlyCreatedAccounts,
      created_categories: newlyCreatedCategories,
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

    const profileId = await adapter.getCurrentProfileId()
    const imported: number[] = []

    for (const item of items) {
      const transaction = {
        profile_id: profileId,
        type: toStr(item.type) || 'expense',
        description: toStr(item.description),
        date: toStr(item.date) || new Date().toISOString().slice(0, 10),
        amount: Math.abs(Number(item.amount) || 0),
        category_id: item.category_id ? Number(item.category_id) : null,
        notes: toStr(item.notes),
        beneficiary: toStr(item.beneficiary),
        payor: toStr(item.payor),
        account_id: item.account_id ? Number(item.account_id) : null,
        transfer_account_id: item.transfer_account_id
          ? Number(item.transfer_account_id)
          : undefined,
        created_at: new Date().toISOString(),
      }
      const id = await adapter.createTransaction(transaction as any)
      imported.push(id as number)
    }

    return json({ imported: imported.length, imported_ids: imported })
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
}
