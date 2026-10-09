import { Hono } from 'hono'
import type { AppEnv } from '../index'
import {
  checkExtraPaymentCreate,
  checkExtraPaymentEdit,
  checkLoanCreate,
  checkLoanEdit,
  checkRatePeriodCreate,
  checkRatePeriodEdit,
  extraPaymentTotals,
} from '../../../shared/loanSchema'
import { requireAuth } from '../auth'
import { getProfileId } from '../profile'
import { accept, HttpError } from '../http'
import * as db from '../db'
import { localToday } from '../local-date'
import { calculateLoan, loanStatus } from '../../../shared/loanSchedule'
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

// List loans with prepayment rollups, plus where each loan stands today: remaining_balance (after
// every payment due by today, extra payments and rate periods included), monthly_payment (the next
// one due; 0 once paid off) and payoff_date. They come from the shared engine, as in the
// local-first list, so the Loans page and API clients read the same figures. Rate periods and extra
// payments are fetched in one query each for all the loans, ordered as the calculate route orders
// them. Additions only: every column the list had is kept. total_prepaid is the extra payments'
// total to the cent, 0 for a loan without any (shared/loanSchema.ts), as local-first answers it;
// a SUM in SQL answered null there. "Today" is the person's date (local-date.ts), as it is in the
// local-first list.
loansRoutes.get('/api/loans', requireAuth, async (c) => {
  const pid = await getProfileId(c)
  const [rows, ratePeriods, prepayments] = await Promise.all([
    db.all<Record<string, any>>(
      c.env.DB,
      `SELECT l.*
        FROM loans l
        WHERE l.profile_id = ?
        ORDER BY l.created_at DESC, l.id DESC`,
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
  const today = localToday(c)
  return c.json(
    rows.map((loan) => ({
      ...loan,
      ...extraPaymentTotals(extrasOf.get(loan.id)),
      ...loanStatus(
        engineInput(loan, periodsOf.get(loan.id) ?? [], extrasOf.get(loan.id) ?? []),
        today
      ),
    }))
  )
})

// A loan, its rate periods and its extra payments are checked by shared/loanSchema.ts, as the
// local-first handlers and the Loans forms check them. A refused body answers 400 with what is
// wrong at each field, and nothing is written.
loansRoutes.post('/api/loans', requireAuth, async (c) => {
  const pid = await getProfileId(c)
  const { rate_periods: ratePeriods, ...loan } = accept(checkLoanCreate(await c.req.json()))
  const res = await db.insert(c.env.DB, 'loans', { ...loan, profile_id: pid })
  const loanId = res.meta.last_row_id

  // Only the periods sent. The loan's own interest_rate is the engine's base rate for every month
  // no period covers (shared/loanSchedule.ts); a period copying it from month 1 used to be added
  // here, and since the Loans form sends a loan's periods back on every edit, that copy then
  // outranked any new interest rate the form saved.
  for (const rp of ratePeriods) {
    await db.insert(c.env.DB, 'loan_rate_periods', { loan_id: loanId, ...rp })
  }

  return c.json({ id: loanId, ...loan, profile_id: pid })
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
  if (!loan) throw new HttpError(404, 'Loan not found')
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

// An edit checks and writes only what it changes (decision 2), so a loan an older version stored
// under other rules can still be renamed: the Loans form sends every field on every save. Rate
// periods sent replace the stored ones when they differ from them; sent back unchanged, they are
// left as they are, ids and all.
loansRoutes.put('/api/loans/:id', requireAuth, async (c) => {
  const pid = await getProfileId(c)
  const id = c.req.param('id')
  const existing = await db.first<Record<string, any>>(
    c.env.DB,
    'SELECT * FROM loans WHERE id = ? AND profile_id = ?',
    id,
    pid
  )
  if (!existing) throw new HttpError(404, 'Loan not found')
  existing.rate_periods = await db.all(
    c.env.DB,
    'SELECT * FROM loan_rate_periods WHERE loan_id = ? ORDER BY start_month, id',
    id
  )
  const body = await c.req.json()
  const { rate_periods: ratePeriods, ...edit } = accept(checkLoanEdit(body, existing))
  if (Object.keys(edit).length > 0) {
    await db.update(c.env.DB, 'loans', edit, 'id = ? AND profile_id = ?', id, pid)
  }

  if (ratePeriods !== undefined) {
    await db.del(c.env.DB, 'loan_rate_periods', 'loan_id = ?', id)
    for (const rp of ratePeriods) {
      await db.insert(c.env.DB, 'loan_rate_periods', { loan_id: id, ...rp })
    }
  }

  return c.json({ ok: true })
})

// The loan's rate periods and extra payments go with it, in one batch. They have no foreign key to
// cascade, and every later sweep (a profile's deletion, the account's, a restore) finds them through
// the loan, so once the loan alone was gone they stayed in D1 for good.
loansRoutes.delete('/api/loans/:id', requireAuth, async (c) => {
  const pid = await getProfileId(c)
  const id = c.req.param('id')
  const owned = 'loan_id IN (SELECT id FROM loans WHERE id = ? AND profile_id = ?)'
  const results = await c.env.DB.batch([
    c.env.DB.prepare(`DELETE FROM loan_rate_periods WHERE ${owned}`).bind(id, pid),
    c.env.DB.prepare(`DELETE FROM loan_prepayments WHERE ${owned}`).bind(id, pid),
    c.env.DB.prepare('DELETE FROM loans WHERE id = ? AND profile_id = ?').bind(id, pid),
  ])
  if (!results[2]?.meta.changes) throw new HttpError(404, 'Loan not found')
  return c.json({ ok: true })
})

// ── Rate periods CRUD ─────────────────────────────────────────────────────────
/** The loan's term, for checking a rate period or an extra payment against it, or a 404. */
async function termOf(c: { env: AppEnv['Bindings'] }, id: string, pid: number) {
  const loan = await db.first<{ term_months: number | null }>(
    c.env.DB,
    'SELECT term_months FROM loans WHERE id = ? AND profile_id = ?',
    id,
    pid
  )
  if (!loan) throw new HttpError(404, 'Loan not found')
  return loan.term_months
}

loansRoutes.post('/api/loans/:id/rates', requireAuth, async (c) => {
  const pid = await getProfileId(c)
  const id = c.req.param('id')
  const term = await termOf(c, id, pid)
  const period = accept(checkRatePeriodCreate(await c.req.json(), term))
  const res = await db.insert(c.env.DB, 'loan_rate_periods', { loan_id: id, ...period })
  return c.json({ id: res.meta.last_row_id })
})

loansRoutes.put('/api/loans/:id/rates/:rateId', requireAuth, async (c) => {
  const pid = await getProfileId(c)
  const id = c.req.param('id')
  const term = await termOf(c, id, pid)
  const stored = await db.first(
    c.env.DB,
    'SELECT * FROM loan_rate_periods WHERE id = ? AND loan_id = ?',
    c.req.param('rateId'),
    id
  )
  if (!stored) throw new HttpError(404, 'Rate period not found')
  const edit = accept(checkRatePeriodEdit(await c.req.json(), stored, term))
  if (Object.keys(edit).length > 0) {
    await db.update(
      c.env.DB,
      'loan_rate_periods',
      edit,
      'id = ? AND loan_id = ?',
      c.req.param('rateId'),
      id
    )
  }
  return c.json({ ok: true })
})

loansRoutes.delete('/api/loans/:id/rates/:rateId', requireAuth, async (c) => {
  const pid = await getProfileId(c)
  const id = c.req.param('id')
  const loan = await db.first(c.env.DB, 'SELECT id FROM loans WHERE id = ? AND profile_id = ?', id, pid)
  if (!loan) throw new HttpError(404, 'Loan not found')
  const res = await db.del(c.env.DB, 'loan_rate_periods', 'id = ? AND loan_id = ?', c.req.param('rateId'), id)
  if (!res.meta.changes) throw new HttpError(404, 'Rate period not found')
  return c.json({ ok: true })
})

// ── Prepayments CRUD ──────────────────────────────────────────────────────────
// An extra payment goes with one of the loan's payments, within its term, and is an amount above
// zero with an optional note. A change is checked for what it changes, so one that goes with a
// payment a since-shortened term has passed keeps its month while its amount changes.
loansRoutes.post('/api/loans/:id/prepayments', requireAuth, async (c) => {
  const pid = await getProfileId(c)
  const id = c.req.param('id')
  const term = await termOf(c, id, pid)
  const extra = accept(checkExtraPaymentCreate(await c.req.json(), term))
  const res = await db.insert(c.env.DB, 'loan_prepayments', { loan_id: id, ...extra })
  return c.json({ id: res.meta.last_row_id })
})

loansRoutes.put('/api/loans/:id/prepayments/:prepayId', requireAuth, async (c) => {
  const pid = await getProfileId(c)
  const id = c.req.param('id')
  const term = await termOf(c, id, pid)
  const stored = await db.first(
    c.env.DB,
    'SELECT * FROM loan_prepayments WHERE id = ? AND loan_id = ?',
    c.req.param('prepayId'),
    id
  )
  if (!stored) throw new HttpError(404, 'Extra payment not found')
  const edit = accept(checkExtraPaymentEdit(await c.req.json(), stored, term))
  if (Object.keys(edit).length > 0) {
    await db.update(
      c.env.DB,
      'loan_prepayments',
      edit,
      'id = ? AND loan_id = ?',
      c.req.param('prepayId'),
      id
    )
  }
  return c.json({ ok: true })
})

loansRoutes.delete('/api/loans/:id/prepayments/:prepayId', requireAuth, async (c) => {
  const pid = await getProfileId(c)
  const id = c.req.param('id')
  const loan = await db.first(c.env.DB, 'SELECT id FROM loans WHERE id = ? AND profile_id = ?', id, pid)
  if (!loan) throw new HttpError(404, 'Loan not found')
  const res = await db.del(c.env.DB, 'loan_prepayments', 'id = ? AND loan_id = ?', c.req.param('prepayId'), id)
  if (!res.meta.changes) throw new HttpError(404, 'Extra payment not found')
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
  if (!loan) throw new HttpError(404, 'Loan not found')

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
