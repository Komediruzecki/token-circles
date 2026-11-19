/**
 * Where a loan stands on its own timeline: the schedule as planned (the shared engine, with the
 * loan's saved extra payments and rate periods), the payments made by today, what is repaid and
 * what is still owed, the months left and the last payment. The chart under a card on the
 * overview draws these.
 *
 * A payment due on or before today counts as made, as `loanStatus` counts it, so what is owed
 * here is what the card shows. A loan whose start date cannot be read has made none: no payment
 * has fallen due on a date nobody can read.
 */
import { amortizeLoan } from '../../../../shared/loanSchedule'
import type { LoanInput, ScheduleRow } from '../../../../shared/loanSchedule'

export interface TimelineExtra {
  month: number
  /** YYYY-MM-DD; '' when the start date cannot be read. */
  date: string
  /** What was applied: never more than was still owed. */
  amount: number
  /** Made by today, or still to come. */
  made: boolean
}

export interface LoanTimeline {
  /** The schedule as planned: rows[i] is payment i + 1. */
  rows: ScheduleRow[]
  principal: number
  /** Payments due on or before today. */
  made: number
  /** Owed after the payments made: the whole principal while none is. */
  owed: number
  /** The principal repaid so far. */
  repaid: number
  /** Payments still to make; null when the loan is never repaid. */
  left: number | null
  /** The month of the last payment; null when the loan is never repaid or has no schedule. */
  payoffMonth: number | null
  /** Its date; null as well when the start date cannot be read. */
  payoffDate: string | null
  /** See `LoanAmortization.neverPaysOffFrom`. */
  neverPaysOffFrom: number | null
  /** Every payment is made and nothing is owed. */
  paidOff: boolean
  extras: TimelineExtra[]
  /** The rows carry due dates. */
  dated: boolean
}

export function loanTimeline(loan: LoanInput, today: string): LoanTimeline {
  const { rows, neverPaysOffFrom } = amortizeLoan(loan)
  const principal = loan.principal > 0 && loan.principal < Infinity ? loan.principal : 0
  let made = 0
  for (const row of rows) {
    if (row.date === '' || row.date > today) break
    made++
  }
  const owed = made > 0 ? rows[made - 1].balance : principal
  const ends = neverPaysOffFrom === null && rows.length > 0
  const last = ends ? rows[rows.length - 1] : null
  return {
    rows,
    principal,
    made,
    owed,
    repaid: principal - owed,
    left: neverPaysOffFrom === null ? rows.length - made : null,
    payoffMonth: last ? last.month : null,
    payoffDate: last ? last.date || null : null,
    neverPaysOffFrom,
    paidOff: ends && made === rows.length,
    extras: rows
      .filter((row) => row.prepayment > 0)
      .map((row) => ({
        month: row.month,
        date: row.date,
        amount: row.prepayment,
        made: row.month <= made,
      })),
    dated: rows.length > 0 && rows[0].date !== '',
  }
}
