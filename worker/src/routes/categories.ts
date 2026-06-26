import { Hono } from 'hono'
import type { AppEnv } from '../index'
import { requireAuth } from '../auth'
import { getProfileId, getProfileIds } from '../profile'
import { HttpError } from '../http'
import * as db from '../db'

// Port of backend/routes/categories.js (repo: backend/repositories/categoriesRepo.js).
// Tables: categories, category_mappings. The backend's toCamelCase() is an identity
// function, so every response below stays snake_case to match the Express API exactly.
//
// Route order mirrors the backend: the literal /mappings and collection routes are
// registered before the /:id routes so 'mappings' is never captured as an :id.
export const categoriesRoutes = new Hono<AppEnv>()

// ── Categories: list (listFull, with parent_name join) ────────────────────────
categoriesRoutes.get('/api/categories', requireAuth, async (c) => {
  const pids = await getProfileIds(c)
  const ph = pids.map(() => '?').join(',')

  // type/income/expense query params narrow by category type.
  const type = c.req.query('type')
  const income = c.req.query('income')
  const expense = c.req.query('expense')
  const types: string[] = []
  if (type === 'income' || income === 'true') types.push('income')
  if (type === 'expense' || expense === 'true') types.push('expense')

  let sql = `SELECT c.id, c.name, c.color, c.icon, c.type, c.parent_id, c.tax_deductible, c.created_at, c.profile_id, p.name as parent_name
             FROM categories c
             LEFT JOIN categories p ON c.parent_id = p.id AND p.profile_id = c.profile_id
             WHERE c.profile_id IN (${ph})`
  const params: unknown[] = [...pids]
  if (types.length > 0) {
    const typePh = types.map(() => '?').join(',')
    sql += ` AND c.type IN (${typePh})`
    params.push(...types)
  }
  sql += ' ORDER BY c.type, c.name'

  const rows = await db.all(c.env.DB, sql, ...params)
  return c.json(rows)
})

categoriesRoutes.post('/api/categories', requireAuth, async (c) => {
  const pid = await getProfileId(c)
  const b = (await c.req.json()) as Record<string, any>

  const name = b.name
  if (!name || typeof name !== 'string' || name.trim() === '') {
    throw new HttpError(400, 'Category name is required')
  }
  const color = b.color ?? '#6b7280'
  const icon = b.icon ?? 'tag'
  const type = b.type ?? 'expense'
  const parent_id = b.parent_id !== undefined ? b.parent_id : b.parentId || null

  const existing = await db.first(
    c.env.DB,
    'SELECT id FROM categories WHERE name = ? AND profile_id = ?',
    name.trim(),
    pid
  )
  if (existing) throw new HttpError(400, 'Category name already exists for this profile')

  const res = await db.insert(c.env.DB, 'categories', {
    name: name.trim(),
    color: color.trim(),
    icon: icon || 'tag',
    type: type.trim(),
    parent_id,
    tax_deductible: b.tax_deductible ? 1 : 0,
    profile_id: pid,
  })

  return c.json({
    id: res.meta.last_row_id,
    name: name.trim(),
    color: color.trim(),
    icon,
    type: type.trim(),
    parent_id,
    profile_id: pid,
  })
})

// ── Category mappings (learned auto-categorization patterns) ──────────────────
categoriesRoutes.get('/api/categories/mappings', requireAuth, async (c) => {
  const pid = await getProfileId(c)
  const rows = await db.all(
    c.env.DB,
    `SELECT cm.*, c.name as category_name, c.color as category_color
     FROM category_mappings cm
     JOIN categories c ON cm.category_id = c.id
     WHERE cm.profile_id = ?
     ORDER BY cm.use_count DESC, cm.confidence DESC`,
    pid
  )
  return c.json(rows)
})

categoriesRoutes.post('/api/categories/mappings', requireAuth, async (c) => {
  const pid = await getProfileId(c)
  const b = (await c.req.json()) as Record<string, any>

  const pattern = b.pattern
  if (!pattern || typeof pattern !== 'string' || pattern.trim() === '') {
    throw new HttpError(400, 'Pattern is required')
  }
  const category_id = b.category_id
  if (!category_id || typeof category_id !== 'number' || category_id <= 0) {
    throw new HttpError(400, 'Valid category_id is required')
  }
  const confidence = b.confidence || 0.9

  // upsertMapping: bump use_count on an existing (profile_id, pattern), else insert.
  const existing = await db.first<{ id: number; use_count: number }>(
    c.env.DB,
    'SELECT id, use_count FROM category_mappings WHERE profile_id = ? AND pattern = ?',
    pid,
    pattern.trim()
  )
  if (existing) {
    const newUseCount = (existing.use_count || 0) + 1
    await db.run(
      c.env.DB,
      'UPDATE category_mappings SET category_id = ?, confidence = ?, use_count = ? WHERE id = ?',
      category_id,
      confidence,
      newUseCount,
      existing.id
    )
    return c.json({ ok: true, id: existing.id, use_count: newUseCount })
  }
  const res = await db.run(
    c.env.DB,
    'INSERT INTO category_mappings (profile_id, pattern, category_id, confidence, use_count) VALUES (?, ?, ?, ?, ?)',
    pid,
    pattern.trim(),
    category_id,
    confidence,
    1
  )
  return c.json({ ok: true, id: res.meta.last_row_id, use_count: 1 })
})

categoriesRoutes.delete('/api/categories/mappings/:id', requireAuth, async (c) => {
  const pid = await getProfileId(c)
  const res = await db.run(
    c.env.DB,
    'DELETE FROM category_mappings WHERE id = ? AND profile_id = ?',
    c.req.param('id'),
    pid
  )
  if (!res.meta.changes) throw new HttpError(404, 'Not found')
  return c.json({ ok: true })
})

// ── Heavy auto-categorization (merchant dictionary + token matching) ──────────
// Built-in merchant dictionary (50+ common merchants), copied verbatim from
// backend/routes/categories.js.
const MERCHANT_DICTIONARY: { pattern: string; category: string; confidence: number }[] = [
  // Streaming
  { pattern: 'netflix', category: 'Streaming', confidence: 0.95 },
  { pattern: 'spotify', category: 'Streaming', confidence: 0.95 },
  { pattern: 'youtube', category: 'Streaming', confidence: 0.9 },
  { pattern: 'disney+', category: 'Streaming', confidence: 0.95 },
  { pattern: 'hulu', category: 'Streaming', confidence: 0.95 },
  { pattern: 'apple tv', category: 'Streaming', confidence: 0.9 },
  { pattern: 'hbo', category: 'Streaming', confidence: 0.9 },
  { pattern: 'prime video', category: 'Streaming', confidence: 0.95 },
  // Shopping
  { pattern: 'amazon', category: 'Shopping', confidence: 0.9 },
  { pattern: 'ebay', category: 'Shopping', confidence: 0.95 },
  { pattern: 'walmart', category: 'Shopping', confidence: 0.95 },
  { pattern: 'target', category: 'Shopping', confidence: 0.95 },
  { pattern: 'costco', category: 'Shopping', confidence: 0.95 },
  { pattern: 'ikea', category: 'Shopping', confidence: 0.95 },
  { pattern: 'zara', category: 'Shopping', confidence: 0.95 },
  { pattern: 'h&m', category: 'Shopping', confidence: 0.95 },
  { pattern: 'macy', category: 'Shopping', confidence: 0.95 },
  // Food & Grocery
  { pattern: 'walmart grocery', category: 'Groceries', confidence: 0.95 },
  { pattern: 'costco', category: 'Groceries', confidence: 0.95 },
  { pattern: 'trader joe', category: 'Groceries', confidence: 0.95 },
  { pattern: 'whole foods', category: 'Groceries', confidence: 0.95 },
  { pattern: 'target grocery', category: 'Groceries', confidence: 0.95 },
  { pattern: 'kroger', category: 'Groceries', confidence: 0.9 },
  { pattern: 'safeway', category: 'Groceries', confidence: 0.9 },
  { pattern: 'albertsons', category: 'Groceries', confidence: 0.9 },
  { pattern: 'stop & shop', category: 'Groceries', confidence: 0.9 },
  { pattern: 'publix', category: 'Groceries', confidence: 0.9 },
  { pattern: 'whole foods market', category: 'Groceries', confidence: 0.95 },
  { pattern: 'sams club', category: 'Groceries', confidence: 0.9 },
  // Dining
  { pattern: 'starbucks', category: 'Dining', confidence: 0.95 },
  { pattern: 'mcdonalds', category: 'Dining', confidence: 0.95 },
  { pattern: 'burger king', category: 'Dining', confidence: 0.9 },
  { pattern: 'wendy', category: 'Dining', confidence: 0.9 },
  { pattern: 'taco bell', category: 'Dining', confidence: 0.9 },
  { pattern: 'pizza hut', category: 'Dining', confidence: 0.9 },
  { pattern: 'dominos', category: 'Dining', confidence: 0.9 },
  { pattern: 'subway', category: 'Dining', confidence: 0.9 },
  { pattern: 'panera', category: 'Dining', confidence: 0.9 },
  { pattern: 'chipotle', category: 'Dining', confidence: 0.9 },
  { pattern: 'chipotle mexican grill', category: 'Dining', confidence: 0.9 },
  { pattern: 'dunkin', category: 'Dining', confidence: 0.9 },
  { pattern: 'krispy kreme', category: 'Dining', confidence: 0.85 },
  { pattern: 'dunkin donuts', category: 'Dining', confidence: 0.85 },
  { pattern: 'starbucks coffee', category: 'Dining', confidence: 0.9 },
  { pattern: 'cafe', category: 'Dining', confidence: 0.85 },
  { pattern: 'restaurant', category: 'Dining', confidence: 0.85 },
  { pattern: 'dinner', category: 'Dining', confidence: 0.85 },
  { pattern: 'lunch', category: 'Dining', confidence: 0.85 },
  { pattern: 'breakfast', category: 'Dining', confidence: 0.85 },
  { pattern: 'brunch', category: 'Dining', confidence: 0.85 },
  { pattern: 'cafe coffee', category: 'Dining', confidence: 0.85 },
  // Utilities
  { pattern: 'electric', category: 'Utilities', confidence: 0.95 },
  { pattern: 'power', category: 'Utilities', confidence: 0.9 },
  { pattern: 'gas bill', category: 'Utilities', confidence: 0.9 },
  { pattern: 'gas', category: 'Utilities', confidence: 0.9 },
  { pattern: 'water bill', category: 'Utilities', confidence: 0.9 },
  { pattern: 'water', category: 'Utilities', confidence: 0.9 },
  { pattern: 'internet', category: 'Utilities', confidence: 0.85 },
  { pattern: 'phone', category: 'Utilities', confidence: 0.85 },
  { pattern: 'mobile', category: 'Utilities', confidence: 0.85 },
  { pattern: 'at&t', category: 'Utilities', confidence: 0.9 },
  { pattern: 'verizon', category: 'Utilities', confidence: 0.9 },
  { pattern: 't-mobile', category: 'Utilities', confidence: 0.9 },
  // Healthcare
  { pattern: 'pharmacy', category: 'Healthcare', confidence: 0.85 },
  { pattern: 'cvs', category: 'Healthcare', confidence: 0.95 },
  { pattern: 'walgreens', category: 'Healthcare', confidence: 0.95 },
  { pattern: 'hospital', category: 'Healthcare', confidence: 0.9 },
  { pattern: 'doctor', category: 'Healthcare', confidence: 0.85 },
  { pattern: 'clinic', category: 'Healthcare', confidence: 0.85 },
  { pattern: 'dental', category: 'Healthcare', confidence: 0.9 },
  { pattern: 'optometrist', category: 'Healthcare', confidence: 0.9 },
  // Entertainment
  { pattern: 'cinema', category: 'Entertainment', confidence: 0.9 },
  { pattern: 'theater', category: 'Entertainment', confidence: 0.9 },
  { pattern: 'concert', category: 'Entertainment', confidence: 0.9 },
  { pattern: 'ticketmaster', category: 'Entertainment', confidence: 0.95 },
  { pattern: 'steam', category: 'Entertainment', confidence: 0.9 },
  { pattern: 'playstation', category: 'Entertainment', confidence: 0.9 },
  { pattern: 'xbox', category: 'Entertainment', confidence: 0.9 },
  // Housing
  { pattern: 'rent', category: 'Housing', confidence: 0.95 },
  { pattern: 'mortgage', category: 'Housing', confidence: 0.95 },
  { pattern: 'hoa', category: 'Housing', confidence: 0.9 },
  { pattern: 'insurance', category: 'Housing', confidence: 0.7 },
  // Income
  { pattern: 'payroll', category: 'Salary', confidence: 0.95 },
  { pattern: 'salary', category: 'Salary', confidence: 0.95 },
  { pattern: 'direct deposit', category: 'Salary', confidence: 0.9 },
  { pattern: 'freelance', category: 'Freelance', confidence: 0.9 },
  { pattern: 'dividend', category: 'Investments', confidence: 0.95 },
  { pattern: 'interest', category: 'Investments', confidence: 0.9 },
]

// Suggest categories for uncategorized transactions. Port of
// backend/routes/categories.js POST /api/categories/auto-map. Matches each
// uncategorized transaction against (1) learned mappings, (2) the merchant
// dictionary, (3) token overlap with category names, keeping the best score.
categoriesRoutes.post('/api/categories/auto-map', requireAuth, async (c) => {
  const pid = await getProfileId(c)
  const b = (await c.req.json()) as Record<string, any>
  const transaction_ids: any[] | undefined = b.transaction_ids
  const description: string | undefined = b.description
  const amount: any = b.amount

  // Fetch categories and learned mappings for matching (repo.list / repo.listMappings).
  const categories = await db.all<{ id: number; name: string; color: string }>(
    c.env.DB,
    'SELECT * FROM categories WHERE profile_id = ? ORDER BY type, name',
    pid
  )
  const learnedMappings = await db.all<{
    pattern: string
    category_id: number
    confidence: number
    use_count: number
  }>(
    c.env.DB,
    'SELECT cm.pattern, cm.category_id, cm.confidence, cm.use_count FROM category_mappings cm WHERE cm.profile_id = ?',
    pid
  )

  // If transaction_ids provided, use those; otherwise filter by description+amount.
  let txQuery = `
    SELECT t.id, t.description, t.beneficiary, t.payor, t.amount, c.name as category_name
    FROM transactions t
    LEFT JOIN categories c ON t.category_id = c.id
    WHERE t.profile_id = ? AND (t.category_id IS NULL OR c.name = 'Other')
    `
  let params: unknown[] = [pid]

  if (transaction_ids && transaction_ids.length > 0) {
    txQuery += ' AND t.id IN (' + transaction_ids.map(() => '?').join(',') + ')'
    params = params.concat(transaction_ids)
  } else if (description && amount) {
    // Match by description and amount.
    const normalizedDesc = description
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]/g, '')
    // amountMatch is computed but unused upstream; preserved for parity.
    amount.toString().replace(/[^0-9.]/g, '')
    txQuery += ' AND (LOWER(t.description) LIKE ? OR LOWER(t.beneficiary) LIKE ?)'
    params.push('%' + normalizedDesc + '%', '%' + normalizedDesc + '%')
  }

  const transactions = await db.all<{
    id: number
    description: string
    beneficiary: string | null
    payor: string | null
    amount: number
  }>(c.env.DB, txQuery, ...params)

  const proposedMappings: any[] = []

  for (const tx of transactions) {
    const searchText = `${tx.description} ${tx.beneficiary || ''} ${tx.payor || ''}`.toLowerCase()
    const normalizedSearch = searchText.replace(/[^a-z0-9]/g, '')

    let bestMatch: {
      category_id: number
      category_name: string
      category_color: string
      confidence: number
    } | null = null
    let bestScore = 0

    // 1. Check learned mappings first (highest priority, boosted by use_count).
    for (const mapping of learnedMappings) {
      const patternLower = mapping.pattern.toLowerCase()
      if (normalizedSearch.includes(patternLower.replace(/[^a-z0-9]/g, ''))) {
        const score = mapping.confidence * Math.min(1 + Math.log10(mapping.use_count + 1) * 0.2, 1.5)
        if (score > bestScore) {
          bestScore = score
          const cat = categories.find((cc) => cc.id === mapping.category_id)
          if (cat) {
            bestMatch = {
              category_id: cat.id,
              category_name: cat.name,
              category_color: cat.color,
              confidence: score,
            }
          }
        }
      }
    }

    // 2. Check merchant dictionary.
    if (!bestMatch || bestScore < 0.8) {
      for (const merchant of MERCHANT_DICTIONARY) {
        const patternLower = merchant.pattern.toLowerCase()
        if (normalizedSearch.includes(patternLower.replace(/[^a-z0-9]/g, ''))) {
          if (merchant.confidence > bestScore) {
            bestScore = merchant.confidence
            const cat = categories.find(
              (cc) => cc.name.toLowerCase() === merchant.category.toLowerCase()
            )
            if (cat) {
              bestMatch = {
                category_id: cat.id,
                category_name: cat.name,
                category_color: cat.color,
                confidence: merchant.confidence,
              }
            }
          }
        }
      }
    }

    // 3. Token overlap matching with category names.
    if (!bestMatch || bestScore < 0.6) {
      const searchTokens = normalizedSearch.split(/[0-9]+/).filter((t) => t.length > 2)

      for (const cat of categories) {
        const catTokens = cat.name
          .toLowerCase()
          .split(/[^a-z]+/)
          .filter((t) => t.length > 2)

        // Calculate token overlap.
        let matches = 0
        for (const token of searchTokens) {
          if (
            cat.name.toLowerCase().includes(token) ||
            (token.length > 3 &&
              cat.name
                .toLowerCase()
                .split('')
                .some((ch) => ch.startsWith(token.slice(0, 3))))
          ) {
            matches++
          }
        }

        if (matches > 0) {
          const score = (matches / Math.max(searchTokens.length, catTokens.length)) * 0.5
          if (score > bestScore) {
            bestScore = score
            bestMatch = {
              category_id: cat.id,
              category_name: cat.name,
              category_color: cat.color,
              confidence: score,
            }
          }
        }
      }
    }

    if (bestMatch) {
      proposedMappings.push({
        transaction_id: tx.id,
        description: tx.description,
        proposed_category_id: bestMatch.category_id,
        proposed_category_name: bestMatch.category_name,
        proposed_category_color: bestMatch.category_color,
        confidence: Math.min(bestMatch.confidence, 1),
      })
    }
  }

  return c.json({
    total: transactions.length,
    mapped: proposedMappings.length,
    mappings: proposedMappings,
  })
})

// Apply confirmed mappings: bulk-update transactions.category_id and upsert learned
// mappings. Port of backend/routes/categories.js POST /api/categories/apply-mappings.
categoriesRoutes.post('/api/categories/apply-mappings', requireAuth, async (c) => {
  const pid = await getProfileId(c)
  const b = (await c.req.json()) as Record<string, any>
  const mappings: any[] | undefined = b.mappings

  if (!mappings || !Array.isArray(mappings)) {
    throw new HttpError(400, 'Invalid mappings array')
  }

  let updated = 0

  for (const mapping of mappings) {
    const { transaction_id, category_id, pattern } = mapping

    // Update transaction.
    const result = await db.run(
      c.env.DB,
      "UPDATE transactions SET category_id = ?, updated_at = datetime('now') WHERE id = ? AND profile_id = ?",
      category_id,
      transaction_id,
      pid
    )
    if (result.meta.changes > 0) updated++

    // Store mapping for future use (upsertMapping).
    if (pattern) {
      const normalizedPattern = String(pattern).toLowerCase().replace(/[^a-z0-9]/g, '')
      if (normalizedPattern.length >= 3) {
        try {
          const existing = await db.first<{ id: number; use_count: number }>(
            c.env.DB,
            'SELECT id, use_count FROM category_mappings WHERE profile_id = ? AND pattern = ?',
            pid,
            normalizedPattern
          )
          if (existing) {
            const newUseCount = (existing.use_count || 0) + 1
            await db.run(
              c.env.DB,
              'UPDATE category_mappings SET category_id = ?, confidence = ?, use_count = ? WHERE id = ?',
              category_id,
              0.9,
              newUseCount,
              existing.id
            )
          } else {
            await db.run(
              c.env.DB,
              'INSERT INTO category_mappings (profile_id, pattern, category_id, confidence, use_count) VALUES (?, ?, ?, ?, ?)',
              pid,
              normalizedPattern,
              category_id,
              0.9,
              1
            )
          }
        } catch (e) {
          // Ignore duplicate errors.
        }
      }
    }
  }

  return c.json({ ok: true, updated })
})

// ── Category CRUD by id (registered after the literal routes above) ───────────
categoriesRoutes.delete('/api/categories', requireAuth, async (c) => {
  const pid = await getProfileId(c)
  await db.del(c.env.DB, 'categories', 'profile_id = ?', pid)
  return c.json({ ok: true, message: 'All categories deleted' })
})

categoriesRoutes.get('/api/categories/:id', requireAuth, async (c) => {
  const pid = await getProfileId(c)
  const cat = await db.first(
    c.env.DB,
    'SELECT * FROM categories WHERE id = ? AND profile_id = ?',
    c.req.param('id'),
    pid
  )
  if (!cat) throw new HttpError(404, 'Not found')
  return c.json(cat)
})

categoriesRoutes.put('/api/categories/:id', requireAuth, async (c) => {
  const pid = await getProfileId(c)
  const id = c.req.param('id')
  const existing = await db.first<Record<string, any>>(
    c.env.DB,
    'SELECT * FROM categories WHERE id = ? AND profile_id = ?',
    id,
    pid
  )
  if (!existing) throw new HttpError(404, 'Category not found')

  const b = (await c.req.json()) as Record<string, any>
  const parent_id = b.parent_id !== undefined ? b.parent_id : b.parentId || null
  const res = await db.update(
    c.env.DB,
    'categories',
    {
      name: b.name !== undefined ? b.name : existing.name,
      color: b.color !== undefined ? b.color : existing.color,
      icon: b.icon !== undefined ? b.icon : existing.icon,
      type: b.type !== undefined ? b.type : existing.type,
      parent_id: parent_id || null,
      tax_deductible: b.tax_deductible ? 1 : 0,
    },
    'id = ? AND profile_id = ?',
    id,
    pid
  )
  if (!res.meta.changes) throw new HttpError(404, 'Not found')
  return c.json({ ok: true })
})

categoriesRoutes.delete('/api/categories/:id', requireAuth, async (c) => {
  const pid = await getProfileId(c)
  const res = await db.del(c.env.DB, 'categories', 'id = ? AND profile_id = ?', c.req.param('id'), pid)
  if (!res.meta.changes) throw new HttpError(404, 'Not found')
  return c.json({ ok: true })
})
