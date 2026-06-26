import { Hono } from 'hono'
import type { AppEnv } from '../index'
import { requireAuth } from '../auth'
import { getProfileId, getProfileIds } from '../profile'
import { HttpError } from '../http'
import * as db from '../db'

// Port of the retirement-GOALS CRUD from backend/routes/retirement.js +
// backend/repositories/retirementGoalsRepo.js. The projection / FIRE calculator
// endpoints (calculateRetirementProjection, /api/calculator/retire) are heavy
// pure-math and live elsewhere; they are stubbed 501 below.
export const retirementGoalsRoutes = new Hono<AppEnv>()

// List goals + the saved retirement_settings blob (aggregating read across
// profiles -> getProfileIds; settings keyed off the first profile, as upstream).
retirementGoalsRoutes.get('/api/retirement-goals', requireAuth, async (c) => {
  const pids = await getProfileIds(c)
  const inClause = pids.map(() => '?').join(',')
  const rows = await db.all(
    c.env.DB,
    `SELECT * FROM retirement_goals WHERE profile_id IN (${inClause}) ORDER BY created_at DESC`,
    ...pids
  )
  const settings = await db.first<{ value: string }>(
    c.env.DB,
    'SELECT * FROM settings WHERE key = ? AND profile_id = ?',
    'retirement_settings',
    pids[0]
  )
  return c.json({
    goals: rows,
    settings: settings ? JSON.parse(settings.value) : {},
  })
})

retirementGoalsRoutes.post('/api/retirement-goals', requireAuth, async (c) => {
  const pid = await getProfileId(c)
  const b = (await c.req.json()) as Record<string, any>
  const dl = b.deadline || b.target_date || null
  if (!b.name || b.target_amount == null) throw new HttpError(400, 'Name and target amount are required')
  const res = await db.insert(c.env.DB, 'retirement_goals', {
    profile_id: pid,
    name: b.name,
    target_amount: b.target_amount,
    current_amount: b.current_amount || 0,
    deadline: dl,
    notes: b.notes || '',
    current_age: b.current_age || 30,
    retirement_age: b.retirement_age || 65,
    monthly_contribution: b.monthly_contribution || 0,
    expected_return_rate: b.expected_return_rate || 7,
  })
  return c.json({
    id: res.meta.last_row_id,
    name: b.name,
    target_amount: b.target_amount,
    current_amount: b.current_amount || 0,
    deadline: dl,
    notes: b.notes,
    profile_id: pid,
  })
})

retirementGoalsRoutes.put('/api/retirement-goals/:id', requireAuth, async (c) => {
  const pid = await getProfileId(c)
  const b = (await c.req.json()) as Record<string, any>
  const dl = b.deadline || b.target_date || null
  const res = await db.update(
    c.env.DB,
    'retirement_goals',
    {
      name: b.name,
      target_amount: b.target_amount,
      current_amount: b.current_amount,
      deadline: dl,
      notes: b.notes || '',
      current_age: b.current_age || 30,
      retirement_age: b.retirement_age || 65,
      monthly_contribution: b.monthly_contribution || 0,
      expected_return_rate: b.expected_return_rate || 7,
    },
    'id = ? AND profile_id = ?',
    c.req.param('id'),
    pid
  )
  if (!res.meta.changes) throw new HttpError(404, 'Not found')
  return c.json({ ok: true })
})

retirementGoalsRoutes.delete('/api/retirement-goals/:id', requireAuth, async (c) => {
  const pid = await getProfileId(c)
  const res = await db.del(c.env.DB, 'retirement_goals', 'id = ? AND profile_id = ?', c.req.param('id'), pid)
  if (!res.meta.changes) throw new HttpError(404, 'Not found')
  return c.json({ ok: true })
})

// FIRE calculator — heavy pure-math projection (timelines, scenarios, withdrawal
// phase). Not ported.
retirementGoalsRoutes.post('/api/calculator/retire', requireAuth, async (c) => {
  // TODO: port the FIRE projection math from backend/routes/retirement.js
  return c.json({ error: 'Not ported yet' }, 501)
})

// Retirement projection — wraps calculateRetirementProjection (backend/utils).
// Not ported.
retirementGoalsRoutes.get('/api/retirement/projection', requireAuth, async (c) => {
  // TODO: port calculateRetirementProjection from backend/utils
  return c.json({ error: 'Not ported yet' }, 501)
})
