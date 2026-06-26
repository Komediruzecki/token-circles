import { Hono } from 'hono'
import type { AppEnv } from '../index'
import { requireAuth } from '../auth'
import { getProfileId, getProfileIds } from '../profile'
import { HttpError } from '../http'
import * as db from '../db'

// Port of backend/routes/budgets.js + backend/repositories/budgetsRepo.js.
// The core budget CRUD is ported fully. The analytical endpoints (summary,
// history, improvements, alerts, forecast, zero-based, allocate, from-expenses,
// duplicate) do multi-table aggregation and are stubbed 501 — see TODOs below.
export const budgetsRoutes = new Hono<AppEnv>()

// budgetsRepo.listByProfiles — aggregating read across owned profiles.
budgetsRoutes.get('/api/budgets', requireAuth, async (c) => {
  const pids = await getProfileIds(c)
  const inClause = pids.map(() => '?').join(',')
  const rows = await db.all(
    c.env.DB,
    `SELECT b.*, c.name as category_name, c.color as category_color, c.icon as category_icon
     FROM budgets b
     JOIN categories c ON b.category_id = c.id AND c.profile_id = b.profile_id
     WHERE b.profile_id IN (${inClause})
     ORDER BY b.id DESC`,
    ...pids
  )
  return c.json(rows)
})

budgetsRoutes.post('/api/budgets', requireAuth, async (c) => {
  const pid = await getProfileId(c)
  const b = (await c.req.json()) as Record<string, any>
  const res = await db.insert(c.env.DB, 'budgets', {
    category_id: b.category_id,
    amount: b.amount,
    period: b.period || 'monthly',
    start_date: b.start_date,
    end_date: b.end_date || null,
    rollover_enabled: b.rollover_enabled ? 1 : 0,
    profile_id: pid,
  })
  return c.json({ id: res.meta.last_row_id, ...b, profile_id: pid })
})

budgetsRoutes.put('/api/budgets/:id', requireAuth, async (c) => {
  const pid = await getProfileId(c)
  const b = (await c.req.json()) as Record<string, any>
  const res = await db.update(
    c.env.DB,
    'budgets',
    {
      category_id: b.category_id,
      amount: b.amount,
      period: b.period,
      start_date: b.start_date,
      end_date: b.end_date || null,
      rollover_enabled: b.rollover_enabled ? 1 : 0,
    },
    'id = ? AND profile_id = ?',
    c.req.param('id'),
    pid
  )
  if (!res.meta.changes) throw new HttpError(404, 'Not found')
  return c.json({ ok: true })
})

budgetsRoutes.delete('/api/budgets/:id', requireAuth, async (c) => {
  const pid = await getProfileId(c)
  const res = await db.del(c.env.DB, 'budgets', 'id = ? AND profile_id = ?', c.req.param('id'), pid)
  if (!res.meta.changes) throw new HttpError(404, 'Not found')
  return c.json({ ok: true })
})

// Manual rollover adjustment — dynamic single-table update on the budget row.
budgetsRoutes.put('/api/budgets/:id/rollover', requireAuth, async (c) => {
  const pid = await getProfileId(c)
  const id = c.req.param('id')
  const b = (await c.req.json()) as Record<string, any>

  const updates: string[] = []
  const values: unknown[] = []
  if (b.rollover_amount !== undefined) {
    updates.push('rollover_amount = ?')
    values.push(b.rollover_amount)
  }
  if (b.rollover_used !== undefined) {
    updates.push('rollover_used = ?')
    values.push(b.rollover_used)
  }
  if (b.rollover_enabled !== undefined) {
    updates.push('rollover_enabled = ?')
    values.push(b.rollover_enabled ? 1 : 0)
  }
  if (updates.length === 0) throw new HttpError(400, 'No rollover fields provided')

  values.push(id, pid)
  const res = await db.run(
    c.env.DB,
    `UPDATE budgets SET ${updates.join(', ')} WHERE id = ? AND profile_id = ?`,
    ...values
  )
  if (!res.meta.changes) throw new HttpError(404, 'Budget not found')

  const budget = await db.first(c.env.DB, 'SELECT * FROM budgets WHERE id = ? AND profile_id = ?', id, pid)
  return c.json({ ok: true, budget })
})

// ── Heavy analytical endpoints — multi-table aggregation, not ported yet ──────
// TODO: port budgets summary (joins budgets+transactions, computes auto-rollover).
budgetsRoutes.get('/api/budgets/summary', requireAuth, async (c) => c.json({ error: 'Not ported yet' }, 501))
// TODO: port budgets history (per-category budget vs spent over N months).
budgetsRoutes.get('/api/budgets/history', requireAuth, async (c) => c.json({ error: 'Not ported yet' }, 501))
// TODO: port budgets improvements (month-over-month adherence with window fns).
budgetsRoutes.get('/api/budgets/improvements', requireAuth, async (c) => c.json({ error: 'Not ported yet' }, 501))
// TODO: port budgets alerts (budget vs spend threshold alerts).
budgetsRoutes.get('/api/budgets/alerts', requireAuth, async (c) => c.json({ error: 'Not ported yet' }, 501))
// TODO: port budgets forecast (historical averages + inflation projection).
budgetsRoutes.get('/api/budgets/forecast', requireAuth, async (c) => c.json({ error: 'Not ported yet' }, 501))
// TODO: port zero-based allocation form (categories + budgets + spend + income).
budgetsRoutes.get('/api/budgets/zero-based', requireAuth, async (c) => c.json({ error: 'Not ported yet' }, 501))
// TODO: port zero-based summary (allocations vs spend vs income).
budgetsRoutes.get('/api/budgets/zero-based/summary', requireAuth, async (c) => c.json({ error: 'Not ported yet' }, 501))
// TODO: port allocate (creates a monthly budget after existence check).
budgetsRoutes.post('/api/budgets/allocate', requireAuth, async (c) => c.json({ error: 'Not ported yet' }, 501))
// TODO: port from-expenses (bulk-create budgets from prior-month expenses).
budgetsRoutes.post('/api/budgets/from-expenses', requireAuth, async (c) => c.json({ error: 'Not ported yet' }, 501))
// TODO: port duplicate-last (copy previous month's budgets into the current month).
budgetsRoutes.post('/api/budgets/duplicate-last', requireAuth, async (c) => c.json({ error: 'Not ported yet' }, 501))
