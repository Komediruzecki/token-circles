import { Hono } from 'hono'
import type { AppEnv } from '../index'
import { requireAuth } from '../auth'
import { getProfileId, getProfileIds } from '../profile'
import { HttpError } from '../http'
import { recalcAllGoals, recalcGoalsByCategory } from '../recalc-goals'
import * as db from '../db'

const today = (): string => new Date().toISOString().slice(0, 10)

// Reference port of backend/routes/savingsGoals.js. This is the canonical pattern
// for a profile-scoped CRUD resource: requireAuth -> getProfileId -> async D1.
export const savingsGoalsRoutes = new Hono<AppEnv>()

savingsGoalsRoutes.get('/api/savings-goals', requireAuth, async (c) => {
  const pids = await getProfileIds(c)
  // Refresh category-linked progress on load so the page never shows a stale amount.
  // Best-effort: if the recompute fails, still return the stored values rather than 500.
  try {
    await recalcAllGoals(c.env.DB, pids)
  } catch (e) {
    console.error('recalcAllGoals failed', e)
  }
  const ph = pids.map(() => '?').join(',')
  const rows = await db.all(c.env.DB, `SELECT * FROM savings_goals WHERE profile_id IN (${ph}) ORDER BY id`, ...pids)
  return c.json(rows)
})

// The frontend sends `target_date`; the column is `deadline`. Accept either.
const readDeadline = (b: Record<string, any>): string | null | undefined => {
  if (b.deadline !== undefined) return b.deadline || null
  if (b.target_date !== undefined) return b.target_date || null
  return undefined
}

savingsGoalsRoutes.post('/api/savings-goals', requireAuth, async (c) => {
  const pid = await getProfileId(c)
  const b = (await c.req.json()) as Record<string, any>
  if (!b.name || b.target_amount == null) throw new HttpError(400, 'Name and target amount are required')
  const categoryId = b.category_id || null
  const res = await db.insert(c.env.DB, 'savings_goals', {
    profile_id: pid,
    name: b.name,
    target_amount: b.target_amount,
    current_amount: b.current_amount || 0,
    deadline: readDeadline(b) ?? null,
    notes: b.notes || '',
    monthly_contribution: b.monthly_contribution ?? 0,
    category_id: categoryId,
    // Category progress counts transactions from this day on; default to today so a
    // freshly-linked goal starts at 0 rather than inheriting the category's history.
    tracking_start_date: b.tracking_start_date || today(),
  })
  // Compute progress now so a category-linked goal shows the right starting value.
  if (categoryId) await recalcGoalsByCategory(c.env.DB, categoryId, [pid])
  return c.json({ id: res.meta.last_row_id }, 201)
})

savingsGoalsRoutes.put('/api/savings-goals/:id', requireAuth, async (c) => {
  const pid = await getProfileId(c)
  const b = (await c.req.json()) as Record<string, any>
  // Partial update: only set fields that were actually provided. Binding an
  // undefined value (e.g. current_amount, which the edit form doesn't send) makes
  // D1 throw a 500, and blindly writing null would wipe the saved progress.
  const fields: Record<string, unknown> = {}
  if (b.name !== undefined) fields.name = b.name
  if (b.target_amount !== undefined) fields.target_amount = b.target_amount
  if (b.current_amount !== undefined) fields.current_amount = b.current_amount
  const deadline = readDeadline(b)
  if (deadline !== undefined) fields.deadline = deadline
  if (b.notes !== undefined) fields.notes = b.notes || ''
  if (b.monthly_contribution !== undefined) fields.monthly_contribution = b.monthly_contribution ?? 0
  if (b.category_id !== undefined) fields.category_id = b.category_id ?? null
  if (b.tracking_start_date !== undefined)
    fields.tracking_start_date = b.tracking_start_date || null

  // Nothing to change: confirm the goal exists so the client still gets a clean result.
  if (Object.keys(fields).length === 0) {
    const exists = await db.first(
      c.env.DB,
      'SELECT id FROM savings_goals WHERE id = ? AND profile_id = ?',
      c.req.param('id'),
      pid
    )
    if (!exists) throw new HttpError(404, 'Not found')
    return c.json({ ok: true })
  }

  const res = await db.update(
    c.env.DB,
    'savings_goals',
    fields,
    'id = ? AND profile_id = ?',
    c.req.param('id'),
    pid
  )
  if (!res.meta.changes) throw new HttpError(404, 'Not found')
  // Category link or tracking window may have changed — recompute progress.
  const catId =
    fields.category_id !== undefined
      ? (fields.category_id as number | null)
      : (
          await db.first<{ category_id: number | null }>(
            c.env.DB,
            'SELECT category_id FROM savings_goals WHERE id = ? AND profile_id = ?',
            c.req.param('id'),
            pid
          )
        )?.category_id ?? null
  if (catId) await recalcGoalsByCategory(c.env.DB, catId, [pid])
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
