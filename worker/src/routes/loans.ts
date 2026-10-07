import { Hono } from 'hono'
import type { AppEnv } from '../index'
import { requireAuth } from '../auth'
import { getProfileId } from '../profile'
import { HttpError } from '../http'
import * as db from '../db'
import { calculateLoan, loanStatus, todayUtc } from '../../../shared/loanSchedule'
import type { LoanInput, LoanPrepayment, LoanRatePeriod } from '../../../shared/loanSchedule'

// Port of backend/routes/loans.js + backend/repositories/loansRepo.js.
// Loans are profile-scoped. Rate periods and prepayments are keyed by loan_id
// and only reachable after the parent loan is verified to belong to the active
// profile (the Express routes do the same getById guard before every sub-op).
export const loansRoutes = new Hono<AppEnv>()

/**
 * A stored loan as shared/loanSchedule.ts reads it. interest_rate is the base rate the engine
 * charges in every month no rate period covers; nothing is prepended to the periods.
 */
function engineInput(
  loan: Record<string, any>,
  ratePeriods: LoanRatePeriod[],
  prepayments: LoanPrepayment[]
): LoanInput {
  return {
    principal: loan.principal,
    interest_rate: loan.interest_rate,
    start_date: loan.start_date,
    term_months: loan.term_months,
    rate_periods: ratePeriods,
    prepayments,
  }
}

/** Rows grouped by their loan_id. */
function byLoan<T extends { loan_id: number }>(rows: T[]): Map<number, T[]> {
  const groups = new Map<number, T[]>()
  for (const row of rows) {
    const group = groups.get(row.loan_id)
    if (group) group.push(row)
    else groups.set(row.loan_id, [row])
  }
  return groups
}

/**
 * The base rate a create or an edit stores. 0 % is a rate, an interest-free loan; only a rate that
 * was not sent at all falls back to the 5 % these routes have always defaulted to.
 */
function sentRate(rate: unknown): unknown {
  return rate === undefined || rate === null || rate === '' ? 5.0 : rate
}

// List loans with prepayment rollups (correlated subqueries, profile-scoped), plus where each loan
// stands today: remaining_balance (after every payment due by today, extra payments and rate
// periods included), monthly_payment (the next one due; 0 once paid off) and payoff_date. They come
// from the shared engine, as in the local-first list, so the Loans page and API clients read the
// same figures. Rate periods and extra payments are fetched in one query each for all the loans,
// ordered as the calculate route orders them. Additions only: every column the list had is kept.
loansRoutes.get('/api/loans', requireAuth, async (c) => {
  const pid = await getProfileId(c)
  const [rows, ratePeriods, prepayments] = await Promise.all([
    db.all<Record<string, any>>(
      c.env.DB,
      `SELECT l.*,
          (SELECT SUM(amount) FROM loan_prepayments WHERE loan_id = l.id) as total_prepaid,
          (SELECT COUNT(*) FROM loan_prepayments WHERE loan_id = l.id) as prepayment_count
        FROM loans l
        WHERE l.profile_id = ?
        ORDER BY l.created_at DESC`,
      pid
    ),
    db.all<LoanRatePeriod & { loan_id: number }>(
      c.env.DB,
      `SELECT loan_id, rate, start_month, end_month FROM loan_rate_periods
        WHERE loan_id IN (SELECT id FROM loans WHERE profile_id = ?)
        ORDER BY start_month, id`,
      pid
    ),
    db.all<LoanPrepayment & { loan_id: number }>(
      c.env.DB,
      `SELECT loan_id, month, amount, note FROM loan_prepayments
        WHERE loan_id IN (SELECT id FROM loans WHERE profile_id = ?)
        ORDER BY month, id`,
      pid
    ),
  ])
  const periodsOf = byLoan(ratePeriods)
  const extrasOf = byLoan(prepayments)
  const today = todayUtc()
  return c.json(
    rows.map((loan) => ({
      ...loan,
      ...loanStatus(
        engineInput(loan, periodsOf.get(loan.id) ?? [], extrasOf.get(loan.id) ?? []),
        today
      ),
    }))
  )
})

loansRoutes.post('/api/loans', requireAuth, async (c) => {
  const pid = await getProfileId(c)
  const b = (await c.req.json()) as Record<string, any>
  const interestRate = sentRate(b.interest_rate)
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
      interest_rate: sentRate(b.interest_rate),
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

// ── Amortization ──────────────────────────────────────────────────────────────
// The schedule itself is shared/loanSchedule.ts, which the local-first handler calls too, so both
// runtimes answer this route identically. The loan's own interest_rate is part of the engine's
// input and covers the months no rate period does; nothing is prepended here. `id` breaks ties so
// periods starting in the same month, and notes of same-month extra payments, keep the order they
// were added in, as they do in local-first mode.
loansRoutes.post('/api/loans/:id/calculate', requireAuth, async (c) => {
  const pid = await getProfileId(c)
  const id = c.req.param('id')
  const loan = await db.first<Record<string, any>>(
    c.env.DB,
    'SELECT * FROM loans WHERE id = ? AND profile_id = ?',
    id,
    pid
  )
  if (!loan) throw new HttpError(404, 'Not found')

  const [ratePeriods, prepayments] = await Promise.all([
    db.all<LoanRatePeriod>(
      c.env.DB,
      'SELECT rate, start_month, end_month FROM loan_rate_periods WHERE loan_id = ? ORDER BY start_month, id',
      id
    ),
    db.all<LoanPrepayment>(
      c.env.DB,
      'SELECT month, amount, note FROM loan_prepayments WHERE loan_id = ? ORDER BY month, id',
      id
    ),
  ])

  return c.json(calculateLoan(engineInput(loan, ratePeriods, prepayments)))
})
