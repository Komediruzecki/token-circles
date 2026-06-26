import { Hono } from 'hono'
import type { AppEnv } from '../index'
import { requireAuth } from '../auth'
import { getProfileId } from '../profile'
import { HttpError } from '../http'
import * as db from '../db'

// Port of backend/routes/loans.js + backend/repositories/loansRepo.js.
// Loans are profile-scoped. Rate periods and prepayments are keyed by loan_id
// and only reachable after the parent loan is verified to belong to the active
// profile (the Express routes do the same getById guard before every sub-op).
export const loansRoutes = new Hono<AppEnv>()

// List loans with prepayment rollups (correlated subqueries, profile-scoped).
loansRoutes.get('/api/loans', requireAuth, async (c) => {
  const pid = await getProfileId(c)
  const rows = await db.all(
    c.env.DB,
    `SELECT l.*,
        (SELECT SUM(amount) FROM loan_prepayments WHERE loan_id = l.id) as total_prepaid,
        (SELECT COUNT(*) FROM loan_prepayments WHERE loan_id = l.id) as prepayment_count
      FROM loans l
      WHERE l.profile_id = ?
      ORDER BY l.created_at DESC`,
    pid
  )
  return c.json(rows)
})

loansRoutes.post('/api/loans', requireAuth, async (c) => {
  const pid = await getProfileId(c)
  const b = (await c.req.json()) as Record<string, any>
  const interestRate = b.interest_rate || 5.0
  const res = await db.insert(c.env.DB, 'loans', {
    name: b.name,
    principal: b.principal,
    interest_rate: interestRate,
    start_date: b.start_date,
    term_months: b.term_months,
    profile_id: pid,
  })
  const loanId = res.meta.last_row_id

  if (b.rate_periods && b.rate_periods.length > 0) {
    for (const rp of b.rate_periods) {
      await db.insert(c.env.DB, 'loan_rate_periods', {
        loan_id: loanId,
        rate: rp.rate,
        start_month: rp.start_month,
        end_month: rp.end_month || null,
      })
    }
  } else {
    await db.insert(c.env.DB, 'loan_rate_periods', {
      loan_id: loanId,
      rate: interestRate,
      start_month: 1,
      end_month: null,
    })
  }

  return c.json({
    id: loanId,
    name: b.name,
    principal: b.principal,
    interest_rate: b.interest_rate,
    start_date: b.start_date,
    term_months: b.term_months,
    profile_id: pid,
  })
})

loansRoutes.get('/api/loans/:id', requireAuth, async (c) => {
  const pid = await getProfileId(c)
  const id = c.req.param('id')
  const loan = await db.first<Record<string, any>>(
    c.env.DB,
    'SELECT * FROM loans WHERE id = ? AND profile_id = ?',
    id,
    pid
  )
  if (!loan) throw new HttpError(404, 'Not found')
  loan.rate_periods = await db.all(
    c.env.DB,
    'SELECT * FROM loan_rate_periods WHERE loan_id = ? ORDER BY start_month',
    id
  )
  loan.prepayments = await db.all(
    c.env.DB,
    'SELECT * FROM loan_prepayments WHERE loan_id = ? ORDER BY month',
    id
  )
  return c.json(loan)
})

loansRoutes.put('/api/loans/:id', requireAuth, async (c) => {
  const pid = await getProfileId(c)
  const id = c.req.param('id')
  const b = (await c.req.json()) as Record<string, any>
  const res = await db.update(
    c.env.DB,
    'loans',
    {
      name: b.name,
      principal: b.principal,
      interest_rate: b.interest_rate || 5.0,
      start_date: b.start_date,
      term_months: b.term_months,
    },
    'id = ? AND profile_id = ?',
    id,
    pid
  )
  if (!res.meta.changes) throw new HttpError(404, 'Not found')

  if (b.rate_periods !== undefined) {
    await db.del(c.env.DB, 'loan_rate_periods', 'loan_id = ?', id)
    for (const rp of b.rate_periods) {
      await db.insert(c.env.DB, 'loan_rate_periods', {
        loan_id: id,
        rate: rp.rate,
        start_month: rp.start_month,
        end_month: rp.end_month || null,
      })
    }
  }

  return c.json({ ok: true })
})

loansRoutes.delete('/api/loans/:id', requireAuth, async (c) => {
  const pid = await getProfileId(c)
  const res = await db.del(c.env.DB, 'loans', 'id = ? AND profile_id = ?', c.req.param('id'), pid)
  if (!res.meta.changes) throw new HttpError(404, 'Not found')
  return c.json({ ok: true })
})

// ── Rate periods CRUD ─────────────────────────────────────────────────────────
loansRoutes.post('/api/loans/:id/rates', requireAuth, async (c) => {
  const pid = await getProfileId(c)
  const id = c.req.param('id')
  const loan = await db.first(c.env.DB, 'SELECT id FROM loans WHERE id = ? AND profile_id = ?', id, pid)
  if (!loan) throw new HttpError(404, 'Loan not found')
  const b = (await c.req.json()) as Record<string, any>
  const res = await db.insert(c.env.DB, 'loan_rate_periods', {
    loan_id: id,
    rate: b.rate,
    start_month: b.start_month,
    end_month: b.end_month || null,
  })
  return c.json({ id: res.meta.last_row_id })
})

loansRoutes.put('/api/loans/:id/rates/:rateId', requireAuth, async (c) => {
  const pid = await getProfileId(c)
  const id = c.req.param('id')
  const loan = await db.first(c.env.DB, 'SELECT id FROM loans WHERE id = ? AND profile_id = ?', id, pid)
  if (!loan) throw new HttpError(404, 'Loan not found')
  const b = (await c.req.json()) as Record<string, any>
  await db.update(
    c.env.DB,
    'loan_rate_periods',
    {
      rate: b.rate,
      start_month: b.start_month,
      end_month: b.end_month || null,
    },
    'id = ? AND loan_id = ?',
    c.req.param('rateId'),
    id
  )
  return c.json({ ok: true })
})

loansRoutes.delete('/api/loans/:id/rates/:rateId', requireAuth, async (c) => {
  const pid = await getProfileId(c)
  const id = c.req.param('id')
  const loan = await db.first(c.env.DB, 'SELECT id FROM loans WHERE id = ? AND profile_id = ?', id, pid)
  if (!loan) throw new HttpError(404, 'Loan not found')
  await db.del(c.env.DB, 'loan_rate_periods', 'id = ? AND loan_id = ?', c.req.param('rateId'), id)
  return c.json({ ok: true })
})

// ── Prepayments CRUD ──────────────────────────────────────────────────────────
loansRoutes.post('/api/loans/:id/prepayments', requireAuth, async (c) => {
  const pid = await getProfileId(c)
  const id = c.req.param('id')
  const loan = await db.first(c.env.DB, 'SELECT id FROM loans WHERE id = ? AND profile_id = ?', id, pid)
  if (!loan) throw new HttpError(404, 'Loan not found')
  const b = (await c.req.json()) as Record<string, any>
  const res = await db.insert(c.env.DB, 'loan_prepayments', {
    loan_id: id,
    month: b.month,
    amount: b.amount,
    note: b.note || '',
  })
  return c.json({ id: res.meta.last_row_id })
})

loansRoutes.delete('/api/loans/:id/prepayments/:prepayId', requireAuth, async (c) => {
  const pid = await getProfileId(c)
  const id = c.req.param('id')
  const loan = await db.first(c.env.DB, 'SELECT id FROM loans WHERE id = ? AND profile_id = ?', id, pid)
  if (!loan) throw new HttpError(404, 'Loan not found')
  await db.del(c.env.DB, 'loan_prepayments', 'id = ? AND loan_id = ?', c.req.param('prepayId'), id)
  return c.json({ ok: true })
})

// Amortization schedule — pure math but pulls in the loanCalculator model
// (multi-rate compounding + prepayment comparison). Heavy/uncertain logic.
loansRoutes.post('/api/loans/:id/calculate', requireAuth, async (c) => {
  // TODO: port backend/models/loanCalculator.js (calculateSchedule + getSummary)
  return c.json({ error: 'Not ported yet' }, 501)
})
