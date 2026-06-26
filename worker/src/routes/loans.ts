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

// ── Amortization calculator (pure math) ───────────────────────────────────────
// Inline port of backend/models/loanCalculator.js (standard amortization with
// variable rate periods + prepayments).

interface RatePeriod {
  rate: number
  start_month: number
  end_month?: number | null
}
interface Prepayment {
  month: number
  amount: number
  note?: string
}
interface ScheduleRow {
  month: number
  date: string
  payment: number
  principal: number
  interest: number
  balance: number
  prepayment: number
  rate: number
  note: string
}

function calcMonthlyPayment(principal: number, annualRate: number, months: number): number {
  if (annualRate === 0) return principal / months
  const r = annualRate / 100 / 12
  return (principal * (r * Math.pow(1 + r, months))) / (Math.pow(1 + r, months) - 1)
}

function calculateSchedule(
  principal: number,
  startDate: string,
  termMonths: number,
  ratePeriods: RatePeriod[],
  prepayments: Prepayment[]
): ScheduleRow[] {
  const sortedRates = [...ratePeriods].sort((a, b) => a.start_month - b.start_month)
  const sortedPrepayments = [...(prepayments || [])].sort((a, b) => a.month - b.month)

  const schedule: ScheduleRow[] = []
  let balance = principal
  let monthIndex = 0
  let lockedPayment: number | null = null

  while (balance > 0.01 && monthIndex < termMonths * 2) {
    monthIndex++

    // Determine current rate.
    let currentRate = 0
    for (const rp of sortedRates) {
      if (rp.start_month <= monthIndex) {
        if (!rp.end_month || monthIndex <= rp.end_month) {
          currentRate = rp.rate
        }
      }
    }

    // Determine if there's a prepayment this month.
    const prepayment = sortedPrepayments.find((p) => p.month === monthIndex)
    const prepayAmount = prepayment ? prepayment.amount : 0

    const remainingMonths = termMonths - monthIndex + 1
    if (remainingMonths <= 0) break

    // Only recalculate locked payment after prepayment (not on rate change).
    if (prepayment || lockedPayment === null) {
      lockedPayment = calcMonthlyPayment(balance, currentRate, remainingMonths)
    }

    const interestPortion = balance * (currentRate / 100 / 12)
    let principalPortion = lockedPayment - interestPortion

    // Apply prepayment.
    if (prepayment) {
      principalPortion += prepayAmount
    }

    // Don't overpay.
    if (principalPortion > balance) {
      principalPortion = balance
    }

    balance = Math.max(0, balance - principalPortion)

    // Calculate date for this month.
    const d = new Date(startDate)
    d.setMonth(d.getMonth() + monthIndex - 1)
    const monthDate = d.toISOString().split('T')[0]

    schedule.push({
      month: monthIndex,
      date: monthDate,
      payment: lockedPayment,
      principal: principalPortion - (prepayment ? prepayAmount : 0),
      interest: interestPortion,
      balance: balance,
      prepayment: prepayAmount || 0,
      rate: currentRate,
      note: prepayment ? prepayment.note || '' : '',
    })
  }

  return schedule
}

function totalInterest(schedule: ScheduleRow[]): number {
  return schedule.reduce((sum, row) => sum + row.interest, 0)
}

function totalPaid(schedule: ScheduleRow[]): number {
  return schedule.reduce((sum, row) => sum + row.payment + row.prepayment, 0)
}

function payoffDate(schedule: ScheduleRow[]): string | null {
  if (schedule.length === 0) return null
  return schedule[schedule.length - 1].date
}

function interestSaved(originalSchedule: ScheduleRow[], prepaySchedule: ScheduleRow[]): number {
  return totalInterest(originalSchedule) - totalInterest(prepaySchedule)
}

function monthsSaved(originalSchedule: ScheduleRow[], prepaySchedule: ScheduleRow[]): number {
  const saved = interestSaved(originalSchedule, prepaySchedule)
  const monthlyPayment = originalSchedule.length > 0 ? originalSchedule[0].payment : 1
  const equivMonths = Math.round(saved / monthlyPayment)
  const eliminatedMonths = originalSchedule.length - prepaySchedule.length
  return Math.max(equivMonths, eliminatedMonths)
}

function getSummary(schedule: ScheduleRow[], originalSchedule: ScheduleRow[]) {
  const originalInterest = totalInterest(originalSchedule)
  const newInterest = totalInterest(schedule)
  const originalMonths = originalSchedule.length

  return {
    totalPaid: totalPaid(schedule),
    totalInterest: newInterest,
    interestSaved: originalInterest - newInterest,
    monthsSaved: monthsSaved(originalSchedule, schedule),
    payoffDate: payoffDate(schedule),
    totalPayments: schedule.length,
    avgMonthlyPayment:
      schedule.length > 0 ? schedule.reduce((s, r) => s + r.payment, 0) / schedule.length : 0,
    maxBalance: schedule.length > 0 ? schedule[0].balance : 0,
    originalTotalInterest: originalInterest,
    originalTotalPayments: originalMonths,
  }
}

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

  const ratePeriods = await db.all<{ rate: number; start_month: number; end_month: number | null }>(
    c.env.DB,
    'SELECT * FROM loan_rate_periods WHERE loan_id = ? ORDER BY start_month',
    id
  )
  const prepayments = await db.all<{ month: number; amount: number; note: string }>(
    c.env.DB,
    'SELECT * FROM loan_prepayments WHERE loan_id = ? ORDER BY month',
    id
  )

  // Prepend the loan's initial rate as the first rate period (months 1 to before
  // first user-set change).
  const initialRatePeriod: RatePeriod[] = [
    { rate: loan.interest_rate, start_month: 1, end_month: undefined },
  ]
  const allRatePeriods: RatePeriod[] = [
    ...initialRatePeriod,
    ...ratePeriods.map((rp) => ({
      rate: rp.rate,
      start_month: rp.start_month,
      end_month: rp.end_month,
    })),
  ]

  const scheduleWithPrepayments = calculateSchedule(
    loan.principal,
    loan.start_date,
    loan.term_months,
    allRatePeriods,
    prepayments.map((p) => ({ month: p.month, amount: p.amount, note: p.note }))
  )

  const scheduleNoPrepayments = calculateSchedule(
    loan.principal,
    loan.start_date,
    loan.term_months,
    allRatePeriods,
    []
  )

  const summary = getSummary(scheduleWithPrepayments, scheduleNoPrepayments)

  return c.json({
    schedule: scheduleWithPrepayments,
    summary,
    comparison: {
      withPrepayments: summary,
      withoutPrepayments: getSummary(scheduleNoPrepayments, scheduleNoPrepayments),
    },
  })
})
