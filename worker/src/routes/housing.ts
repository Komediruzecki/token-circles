import { Hono } from 'hono'
import type { AppEnv } from '../index'
import { requireAuth } from '../auth'
import { getProfileId } from '../profile'
import { HttpError } from '../http'
import * as db from '../db'

// Port of backend/routes/housing.js (repo: backend/repositories/housingRepo.js).
// Table: housings. The backend file is pure CRUD — there is no mortgage/affordability
// calculator endpoint to port. Responses stay snake_case to match the Express API.
export const housingRoutes = new Hono<AppEnv>()

housingRoutes.get('/api/housing', requireAuth, async (c) => {
  const pid = await getProfileId(c)

  // Custom ordering by due_date ASC (the repo default is created_at DESC).
  const housings = await db.all<Record<string, any>>(
    c.env.DB,
    `SELECT id, name, type, monthly_amount, due_date, autopay, notes, created_at
     FROM housings WHERE profile_id = ? ORDER BY due_date ASC`,
    pid
  )

  const totalMonthly = housings.reduce(
    (sum, h) => sum + Math.abs(parseFloat(h.monthly_amount) || 0),
    0
  )

  return c.json({
    housings: housings.map((h) => ({ ...h, profile_id: pid })),
    total_monthly: Math.round(totalMonthly),
  })
})

housingRoutes.post('/api/housing', requireAuth, async (c) => {
  const pid = await getProfileId(c)
  const b = (await c.req.json()) as Record<string, any>

  const amount = parseFloat(b.monthly_amount)
  if (!b.property_name || isNaN(amount) || amount <= 0) {
    throw new HttpError(400, 'Property name and a valid monthly amount are required')
  }

  const dueMonth = (b.due_month || 1).toString().padStart(2, '0')
  const dueDay = (b.due_day || 1).toString().padStart(2, '0')
  const due_date = `${dueMonth}-${dueDay}`

  const res = await db.insert(c.env.DB, 'housings', {
    profile_id: pid,
    name: b.property_name,
    type: b.type || 'other',
    monthly_amount: amount,
    due_date,
    autopay: b.autopay ? 1 : 0,
    notes: b.notes || '',
  })

  return c.json({ id: res.meta.last_row_id })
})

housingRoutes.put('/api/housing/:id', requireAuth, async (c) => {
  const pid = await getProfileId(c)
  const id = c.req.param('id')
  const b = (await c.req.json()) as Record<string, any>

  const existing = await db.first(
    c.env.DB,
    'SELECT id FROM housings WHERE id = ? AND profile_id = ?',
    id,
    pid
  )
  if (!existing) throw new HttpError(404, 'Not found')

  const due_date = `${b.due_month.toString().padStart(2, '0')}-${b.due_day.toString().padStart(2, '0')}`

  await db.update(
    c.env.DB,
    'housings',
    {
      name: b.property_name,
      monthly_amount: parseFloat(b.monthly_amount),
      due_date,
      autopay: b.autopay ? 1 : 0,
      notes: b.notes || '',
    },
    'id = ? AND profile_id = ?',
    id,
    pid
  )

  return c.json({ success: true })
})

housingRoutes.delete('/api/housing/:id', requireAuth, async (c) => {
  const pid = await getProfileId(c)
  const id = c.req.param('id')

  const existing = await db.first(
    c.env.DB,
    'SELECT id FROM housings WHERE id = ? AND profile_id = ?',
    id,
    pid
  )
  if (!existing) throw new HttpError(404, 'Not found')

  await db.del(c.env.DB, 'housings', 'id = ? AND profile_id = ?', id, pid)
  return c.json({ success: true })
})
