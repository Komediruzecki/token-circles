import type { LoanInput } from '../loanSchedule';

/**
 * Test data, not app code: one loan that both runtimes' tests store through their own API and
 * calculate through their own `POST /api/loans/:id/calculate`, the Worker's in
 * worker/test/loans-calculate.test.ts and the local-first one in
 * frontend/src/core/storage/__tests__/localHandlers.loans.test.ts. Each must answer exactly
 * `calculateLoan(PARITY_LOAN)`, which makes the two answers the same schedule and summary.
 *
 * It has what the two used to handle differently or not at all: a base rate that has to cover the
 * months outside the rate period (before it and after it ends), a start on the 31st, two extra
 * payments in the same month with notes, and one more extra payment on its own.
 */
export const PARITY_LOAN = {
  principal: 25000,
  interest_rate: 4.5,
  start_date: '2025-01-31',
  term_months: 48,
  rate_periods: [{ rate: 6.25, start_month: 13, end_month: 30 }],
  prepayments: [
    { month: 6, amount: 1500, note: 'bonus' },
    { month: 6, amount: 500, note: 'gift' },
    { month: 20, amount: 3000, note: '' },
  ],
} satisfies LoanInput;
