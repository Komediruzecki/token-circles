import { Hono } from 'hono'
import type { AppEnv } from '../index'
import { requireAuth } from '../auth'
import { getProfileId, getProfileIds } from '../profile'
import { HttpError } from '../http'
import * as db from '../db'

// Reference port of backend/routes/savingsGoals.js. This is the canonical pattern
// for a profile-scoped CRUD resource: requireAuth -> getProfileId -> async D1.
export const savingsGoalsRoutes = new Hono<AppEnv>()

savingsGoalsRoutes.get('/api/savings-goals', requireAuth, async (c) => {
  const pids = await getProfileIds(c)
  const ph = pids.map(() => '?').join(',')
  const rows = await db.all(c.env.DB, `SELECT * FROM savings_goals WHERE profile_id IN (${ph}) ORDER BY id`, ...pids)
  return c.json(rows)
})

savingsGoalsRoutes.post('/api/savings-goals', requireAuth, async (c) => {
  const pid = await getProfileId(c)
  const b = (await c.req.json()) as Record<string, any>
  if (!b.name || b.target_amount == null) throw new HttpError(400, 'Name and target amount are required')
  const res = await db.insert(c.env.DB, 'savings_goals', {
    profile_id: pid,
    name: b.name,
    target_amount: b.target_amount,
    current_amount: b.current_amount || 0,
    deadline: b.deadline || null,
    notes: b.notes || '',
    category_id: b.category_id || null,
  })
  return c.json({ id: res.meta.last_row_id }, 201)
})

savingsGoalsRoutes.put('/api/savings-goals/:id', requireAuth, async (c) => {
  const pid = await getProfileId(c)
  const b = (await c.req.json()) as Record<string, any>
  const res = await db.update(
    c.env.DB,
    'savings_goals',
    {
      name: b.name,
      target_amount: b.target_amount,
      current_amount: b.current_amount,
      deadline: b.deadline || null,
      notes: b.notes || '',
      category_id: b.category_id !== undefined ? b.category_id : null,
    },
    'id = ? AND profile_id = ?',
    c.req.param('id'),
    pid
  )
  if (!res.meta.changes) throw new HttpError(404, 'Not found')
  return c.json({ ok: true })
})

savingsGoalsRoutes.delete('/api/savings-goals/:id', requireAuth, async (c) => {
  const pid = await getProfileId(c)
  const res = await db.del(c.env.DB, 'savings_goals', 'id = ? AND profile_id = ?', c.req.param('id'), pid)
  if (!res.meta.changes) throw new HttpError(404, 'Not found')
  return c.json({ ok: true })
})

savingsGoalsRoutes.post('/api/savings-goals/:id/contribute', requireAuth, async (c) => {
  const pid = await getProfileId(c)
  const id = c.req.param('id')
  const goal = await db.first<{ current_amount: number }>(
    c.env.DB,
    'SELECT current_amount FROM savings_goals WHERE id = ? AND profile_id = ?',
    id,
    pid
  )
  if (!goal) throw new HttpError(404, 'Goal not found')
  const b = (await c.req.json()) as Record<string, any>
  const newAmount = (goal.current_amount || 0) + (parseFloat(b.amount) || 0)
  await db.update(c.env.DB, 'savings_goals', { current_amount: newAmount }, 'id = ? AND profile_id = ?', id, pid)
  return c.json({ ok: true, current_amount: newAmount })
})
