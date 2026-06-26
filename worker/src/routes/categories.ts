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
// TODO: port the merchant dictionary + scoring + transactions join from
// backend/routes/categories.js (depends on the transactions repo). Stubbed for now.
categoriesRoutes.post('/api/categories/auto-map', requireAuth, async (c) => {
  return c.json({ error: 'Not ported yet' }, 501)
})

// TODO: port apply-mappings bulk reassignment (updates transactions.category_id and
// upserts learned mappings) from backend/routes/categories.js. Stubbed for now.
categoriesRoutes.post('/api/categories/apply-mappings', requireAuth, async (c) => {
  return c.json({ error: 'Not ported yet' }, 501)
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
