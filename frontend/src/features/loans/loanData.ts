/**
 * Loans as the two storage modes hand them over, and as the shared engine reads them.
 *
 * The list (`GET /api/loans`) works out where each loan stands today in both modes. Local-first
 * rows also carry their rate periods and extra payments; the Worker's list does not, so a loan's
 * own page reads them from `GET /api/loans/:id` there. Either way the page runs the same engine on
 * the same input as `POST /api/loans/:id/calculate`: rate periods by start month, extra payments by
 * month, ties in the order they were added.
 */
import { loanStatus } from '../../../../shared/loanSchedule'
import type { LoanInput } from '../../../../shared/loanSchedule'

export interface StoredRatePeriod {
  /** The Worker's rows have one; local-first periods are kept in a list, in the order added. */
  id?: number
  rate: number
  start_month: number
  end_month?: number | null
}

export interface StoredPrepayment {
  id?: number
  month: number
  amount: number
  note?: string | null
}

/** A loan as `GET /api/loans/:id` returns it, or as a local-first list row carries it. */
export interface StoredLoan {
  id: number
  name: string
  principal: number
  interest_rate: number
  term_months: number
  start_date: string
  profile_id?: number
  rate_periods?: StoredRatePeriod[]
  prepayments?: StoredPrepayment[]
}

/** A row of `GET /api/loans`, as either storage mode returns it. */
export interface ListedLoan extends StoredLoan {
  /** Worked out by the list with the shared engine. Missing only from a server older than that. */
  remaining_balance?: number
  monthly_payment?: number
  next_payment_date?: string | null
  payoff_date?: string | null
}

/** A loan on the overview: the list's row, with where it stands today worked out. */
export interface LoanRow {
  id: number
  name: string
  principal: number
  interest_rate: number
  term_months: number
  start_date: string
  profile_id: number
  remaining_balance: number
  monthly_payment: number
  next_payment_date: string | null
  payoff_date: string | null
  /** Nothing is left to pay. */
  paid: boolean
  /** The principal repaid so far, which the "% repaid" beside it measures. */
  repaid: number
  /** The row as the list returned it. */
  listed: ListedLoan
}

/**
 * What is owed today, the next payment and its date, and the payoff date, as the list worked them
 * out. A server that predates those fields gets the same engine run here, on what its row carries.
 */
export function toLoanRow(loan: ListedLoan, today: string, fallbackProfileId: number): LoanRow {
  const computed =
    typeof loan.remaining_balance === 'number' &&
    typeof loan.monthly_payment === 'number' &&
    loan.next_payment_date !== undefined
      ? {
          remaining_balance: loan.remaining_balance,
          monthly_payment: loan.monthly_payment,
          next_payment_date: loan.next_payment_date,
          payoff_date: loan.payoff_date ?? loanStatus(engineInput(loan), today).payoff_date,
        }
      : loanStatus(engineInput(loan), today)
  const principal = loan.principal || 0
  return {
    id: loan.id,
    name: loan.name,
    principal,
    interest_rate: loan.interest_rate || 0,
    term_months: loan.term_months || 0,
    start_date: loan.start_date,
    profile_id: loan.profile_id || fallbackProfileId,
    remaining_balance: computed.remaining_balance,
    monthly_payment: computed.monthly_payment,
    next_payment_date: computed.next_payment_date,
    payoff_date: computed.payoff_date,
    paid: computed.remaining_balance <= 0,
    repaid: principal - computed.remaining_balance,
    listed: loan,
  }
}

/** Ordered by `key`, ties keeping the order they were added in: by id where there is one. */
function ordered<T extends { id?: number }>(list: readonly T[], key: (item: T) => number): T[] {
  return list
    .map((item, index) => ({ item, index }))
    .sort((x, y) => key(x.item) - key(y.item) || (x.item.id ?? x.index) - (y.item.id ?? y.index))
    .map(({ item }) => item)
}

/** The engine's input for a stored loan, read in the order the calculate route reads it. */
export function engineInput(loan: StoredLoan): LoanInput {
  return {
    principal: loan.principal,
    interest_rate: loan.interest_rate,
    start_date: loan.start_date,
    term_months: loan.term_months,
    rate_periods: ordered(loan.rate_periods ?? [], (p) => p.start_month).map((p) => ({
      rate: p.rate,
      start_month: p.start_month,
      end_month: p.end_month || null,
    })),
    prepayments: ordered(loan.prepayments ?? [], (p) => p.month).map((p) => ({
      month: p.month,
      amount: p.amount,
      note: p.note ?? '',
    })),
  }
}

/**
 * A saved extra payment, with what removing it takes: the Worker deletes by id, the local-first
 * store by its place in the loan's list. Listed by month.
 */
export interface SavedExtra {
  ref: number
  month: number
  amount: number
  note: string
}

export function savedExtras(loan: StoredLoan): SavedExtra[] {
  const extras = (loan.prepayments ?? []).map((p, index) => ({
    ref: p.id ?? index,
    month: p.month,
    amount: p.amount,
    note: p.note || '',
  }))
  return extras.sort((x, y) => x.month - y.month || x.ref - y.ref)
}

/** Whether the loan has the details its own page needs: local-first rows carry them. */
export function hasDetails(loan: StoredLoan): boolean {
  return Array.isArray(loan.rate_periods) && Array.isArray(loan.prepayments)
}
