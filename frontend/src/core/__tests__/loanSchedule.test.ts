/**
 * Tests for the shared loan engine (shared/loanSchedule.ts).
 *
 * Expected numbers come from closed forms, never from the engine's own output. With
 * r = annual % / 100 / 12:
 *
 *   installment          A   = P r (1+r)^n / ((1+r)^n - 1)
 *   balance after k      B_k = P (1+r)^k - A ((1+r)^k - 1) / r
 *   total interest       I   = n A - P, with no extra payments
 *   installments to pay  n   = ceil(-ln(1 - r B / A) / ln(1 + r)), to repay B at A a month
 *
 * Between two events (an extra payment, a rate change) a loan follows the balance formula from
 * wherever the last event left it, so a schedule with events is checked segment by segment.
 *
 * The example loan, used throughout: 100,000 at 5 % over 120 months from 2026-01-01.
 * A = 1,060.66 and I = 27,278.62.
 *
 * `defects of the engines this replaced` holds one test per defect of the two copies that lived
 * in frontend/src/core/loanCalculator.ts and worker/src/routes/loans.ts, and of the Loans page's
 * own remaining-balance estimate. Each fails against that code; the ninth (the badge charging
 * months outside every rate period at 0 %) is pinned where the badge is decided, in
 * achievements/__tests__/evaluate.test.ts.
 */
import { describe, expect, it } from 'vitest'
import {
  addCalendarMonths,
  amortize,
  annuityPayment,
  calculateLoan,
  loanStatus,
  MAX_TERM_MONTHS,
  payoffDate,
  summarize,
  todayUtc,
} from '../../../../shared/loanSchedule'
import type { LoanInput, ScheduleRow } from '../../../../shared/loanSchedule'

// The engine does no Date arithmetic, so its dates must not depend on the zone it runs in. West
// of UTC is where the code it replaced went wrong even for a loan starting on the 1st. Node
// re-reads TZ on assignment, and each test file runs in its own worker.
process.env.TZ = 'America/New_York'

// ── Closed forms ─────────────────────────────────────────────────────────────

const monthlyRate = (pct: number) => pct / 100 / 12

/** A = P r (1+r)^n / ((1+r)^n - 1); P / n at 0 %. */
function annuity(P: number, pct: number, n: number): number {
  const r = monthlyRate(pct)
  if (r === 0) return P / n
  return (P * r * (1 + r) ** n) / ((1 + r) ** n - 1)
}

/** B_k = B (1+r)^k - A ((1+r)^k - 1) / r: what is owed k installments of A after owing B. */
function balanceAfter(B: number, pct: number, A: number, k: number): number {
  const r = monthlyRate(pct)
  if (r === 0) return B - A * k
  return B * (1 + r) ** k - (A * ((1 + r) ** k - 1)) / r
}

/** ceil(-ln(1 - rB/A) / ln(1+r)): installments of A that repay B, the last one partial. */
function installmentsFor(B: number, pct: number, A: number): number {
  const r = monthlyRate(pct)
  return Math.ceil(r === 0 ? B / A : -Math.log(1 - (r * B) / A) / Math.log(1 + r))
}

const sum = (rows: ScheduleRow[], pick: (r: ScheduleRow) => number) =>
  rows.reduce((s, r) => s + pick(r), 0)

// ── The example loan ─────────────────────────────────────────────────────────

const P = 100_000
const RATE = 5
const N = 120
const r5 = monthlyRate(RATE)
/** 1,060.66 */
const A = annuity(P, RATE, N)

function loan(over: Partial<LoanInput> = {}): LoanInput {
  return {
    principal: P,
    interest_rate: RATE,
    start_date: '2026-01-01',
    term_months: N,
    rate_periods: [],
    prepayments: [],
    ...over,
  }
}

it('runs west of UTC, so a date that leaned on the local zone would show', () => {
  expect(new Date('2026-07-01T00:00:00Z').getTimezoneOffset()).not.toBe(0)
})

// ── annuityPayment ───────────────────────────────────────────────────────────

describe('annuityPayment', () => {
  it('is the closed-form installment', () => {
    expect(A).toBeCloseTo(1060.66, 2)
    expect(annuityPayment(P, RATE, N)).toBeCloseTo(A, 9)
  })

  it('divides evenly at 0 %', () => {
    expect(annuityPayment(12000, 0, 12)).toBeCloseTo(1000, 9)
  })

  it('matches the closed form on a 30-year loan', () => {
    // 100,000 at 5 % over 360 months: 536.82.
    expect(annuityPayment(P, RATE, 360)).toBeCloseTo(annuity(P, RATE, 360), 9)
    expect(annuityPayment(P, RATE, 360)).toBeCloseTo(536.82, 2)
  })

  it('charges interest on a short loan', () => {
    const payment = annuityPayment(5000, 10, 6)
    expect(payment).toBeGreaterThan(5000 / 6)
    expect(payment).toBeLessThan(1000)
  })

  it('stays accurate at a rate close to zero', () => {
    // The textbook form loses half its digits to (1+r)^n - 1 here; the payment must still be
    // indistinguishable from an even split.
    expect(annuityPayment(P, 1e-9, N) / (P / N)).toBeCloseTo(1, 9)
  })

  it('is 0, not Infinity, with no months to pay in', () => {
    expect(annuityPayment(P, RATE, 0)).toBe(0)
    expect(annuityPayment(P, RATE, -3)).toBe(0)
  })
})

// ── amortize against the closed forms ───────────────────────────────────────

describe('amortize', () => {
  it('follows the closed form month by month with no extra payments', () => {
    const s = amortize(loan())
    expect(s).toHaveLength(N)
    s.forEach((row, i) => {
      const k = i + 1
      expect(row.month).toBe(k)
      expect(row.payment).toBeCloseTo(A, 6)
      expect(row.interest).toBeCloseTo(balanceAfter(P, RATE, A, k - 1) * r5, 6)
      expect(row.balance).toBeCloseTo(balanceAfter(P, RATE, A, k), 5)
      expect(row.prepayment).toBe(0)
      expect(row.rate).toBe(RATE)
    })
    expect(s[N - 1].balance).toBe(0)
    // I = n A - P = 27,278.62.
    expect(sum(s, (r) => r.interest)).toBeCloseTo(N * A - P, 6)
    expect(N * A - P).toBeCloseTo(27278.62, 2)
  })

  it('shortens the loan after an extra payment, at the same installment', () => {
    // 10,000 extra in month 12: B_12 - 10,000 is then repaid at A, which takes
    // installmentsFor(B_12 - 10,000) = 94 more months, 106 in all.
    const s = amortize(loan({ prepayments: [{ month: 12, amount: 10000 }] }))
    const after12 = balanceAfter(P, RATE, A, 12) - 10000
    const left = installmentsFor(after12, RATE, A)
    expect(12 + left).toBe(106)
    expect(s).toHaveLength(106)
    expect(s[11].prepayment).toBe(10000)
    expect(s[11].balance).toBeCloseTo(after12, 5)
    for (let j = 1; j < left; j++) {
      expect(s[11 + j].payment).toBeCloseTo(A, 6)
      expect(s[11 + j].balance).toBeCloseTo(balanceAfter(after12, RATE, A, j), 5)
    }
  })

  it('recomputes the installment at a rate change so the loan ends on its term', () => {
    // 8 % from month 13: A' = annuity(B_12, 8 %, 108) = 1,198.93, paid to month 120.
    const s = amortize(loan({ rate_periods: [{ rate: 8, start_month: 13 }] }))
    const B12 = balanceAfter(P, RATE, A, 12)
    const A2 = annuity(B12, 8, 108)
    expect(A2).toBeCloseTo(1198.93, 2)
    expect(s).toHaveLength(N)
    expect(s[11].payment).toBeCloseTo(A, 6)
    for (let k = 13; k <= N; k++) {
      expect(s[k - 1].rate).toBe(8)
      expect(s[k - 1].payment).toBeCloseTo(A2, 6)
      expect(s[k - 1].balance).toBeCloseTo(balanceAfter(B12, 8, A2, k - 12), 5)
    }
    expect(s[N - 1].balance).toBe(0)
    // Twelve installments of A and 108 of A' repay P: I = 12 A + 108 A' - P.
    expect(sum(s, (r) => r.interest)).toBeCloseTo(12 * A + 108 * A2 - P, 6)
  })

  it('goes back to the base rate when a rate period ends, and recomputes again', () => {
    // 3 % for months 13-24, then the loan's own 5 % again: two recomputations, both to month 120.
    const s = amortize(loan({ rate_periods: [{ rate: 3, start_month: 13, end_month: 24 }] }))
    const B12 = balanceAfter(P, RATE, A, 12)
    const A2 = annuity(B12, 3, 108)
    const B24 = balanceAfter(B12, 3, A2, 12)
    const A3 = annuity(B24, RATE, 96)
    expect(s).toHaveLength(N)
    expect(s.map((r) => r.rate)).toEqual([
      ...Array(12).fill(5),
      ...Array(12).fill(3),
      ...Array(96).fill(5),
    ])
    expect(s[12].payment).toBeCloseTo(A2, 6)
    expect(s[23].balance).toBeCloseTo(B24, 5)
    expect(s[24].payment).toBeCloseTo(A3, 6)
    expect(s[N - 1].balance).toBe(0)
  })

  it('lets a period starting in month 1 replace the base rate from the first payment', () => {
    const s = amortize(loan({ rate_periods: [{ rate: 4, start_month: 1, end_month: null }] }))
    expect(s).toHaveLength(N)
    expect(s.every((r) => r.rate === 4)).toBe(true)
    expect(s[0].payment).toBeCloseTo(annuity(P, 4, N), 6)
  })

  it('applies the period that starts latest where periods overlap, as before', () => {
    // 6 % from month 13 open-ended, 7 % for months 25-36 inside it: 5, 6, 7, then 6 again.
    const s = amortize(
      loan({
        rate_periods: [
          { rate: 7, start_month: 25, end_month: 36 },
          { rate: 6, start_month: 13, end_month: null },
        ],
      })
    )
    expect(s[11].rate).toBe(5)
    expect(s[12].rate).toBe(6)
    expect(s[24].rate).toBe(7)
    expect(s[35].rate).toBe(7)
    expect(s[36].rate).toBe(6)
    expect(s[N - 1].rate).toBe(6)
    expect(s[N - 1].balance).toBe(0)
  })

  it('applies the one listed last when two periods start in the same month', () => {
    const s = amortize(
      loan({
        rate_periods: [
          { rate: 6, start_month: 13 },
          { rate: 9, start_month: 13 },
        ],
      })
    )
    expect(s[12].rate).toBe(9)
  })

  it('handles a rate change and an extra payment in the same month: rate first, then extra', () => {
    // Month 13 is charged 8 % at A' = annuity(B_12, 8 %, 108); the extra then shortens the loan
    // at A', which stays the installment.
    const s = amortize(
      loan({
        rate_periods: [{ rate: 8, start_month: 13 }],
        prepayments: [{ month: 13, amount: 10000 }],
      })
    )
    const B12 = balanceAfter(P, RATE, A, 12)
    const A2 = annuity(B12, 8, 108)
    const after13 = balanceAfter(B12, 8, A2, 1) - 10000
    expect(s[12].payment).toBeCloseTo(A2, 6)
    expect(s[12].prepayment).toBe(10000)
    expect(s[12].balance).toBeCloseTo(after13, 5)
    expect(s).toHaveLength(13 + installmentsFor(after13, 8, A2))
    expect(s[13].payment).toBeCloseTo(A2, 6)
  })

  it('recomputes to the earlier end date once an extra payment has moved it', () => {
    // 10,000 extra in month 12 moves the end to month 106; 8 % from month 13 then spreads the
    // balance over months 13-106, not over the original 13-120.
    const s = amortize(
      loan({
        rate_periods: [{ rate: 8, start_month: 13 }],
        prepayments: [{ month: 12, amount: 10000 }],
      })
    )
    const after12 = balanceAfter(P, RATE, A, 12) - 10000
    const A2 = annuity(after12, 8, 106 - 12)
    expect(s).toHaveLength(106)
    expect(s[12].payment).toBeCloseTo(A2, 6)
    expect(s[105].balance).toBe(0)
  })

  it('amortises at 0 % in equal parts', () => {
    const s = amortize(loan({ principal: 12000, interest_rate: 0, term_months: 12 }))
    expect(s).toHaveLength(12)
    expect(s.every((r) => r.interest === 0)).toBe(true)
    s.forEach((row, i) => {
      expect(row.principal).toBeCloseTo(1000, 9)
      expect(row.balance).toBeCloseTo(12000 - 1000 * (i + 1), 6)
    })
    expect(s[11].balance).toBe(0)
  })

  it('pays a one-month loan off with one month of interest', () => {
    const s = amortize(loan({ principal: 1000, interest_rate: 12, term_months: 1 }))
    expect(s).toEqual([
      {
        month: 1,
        date: '2026-01-01',
        payment: 1010,
        principal: 1000,
        interest: 10,
        balance: 0,
        prepayment: 0,
        rate: 12,
        note: '',
      },
    ])
  })

  it('takes an extra payment in month 1, with the first installment', () => {
    const s = amortize(loan({ prepayments: [{ month: 1, amount: 10000 }] }))
    const after1 = balanceAfter(P, RATE, A, 1) - 10000
    expect(s[0].payment).toBeCloseTo(A, 6)
    expect(s[0].prepayment).toBe(10000)
    expect(s[0].balance).toBeCloseTo(after1, 6)
    expect(s).toHaveLength(1 + installmentsFor(after1, RATE, A))
  })

  it('needs nothing from an extra payment in the last month: the installment already clears it', () => {
    const plain = amortize(loan())
    const s = amortize(loan({ prepayments: [{ month: N, amount: 5000, note: 'bonus' }] }))
    expect(s).toHaveLength(N)
    expect(s[N - 1].prepayment).toBe(0)
    expect(s[N - 1].note).toBe('')
    expect(s).toEqual(plain)
  })

  it('ignores an extra payment dated after the loan is paid off', () => {
    expect(amortize(loan({ prepayments: [{ month: N + 10, amount: 5000 }] }))).toEqual(
      amortize(loan())
    )
  })

  it('ignores an extra payment of zero, a negative amount, or a month that is not one', () => {
    const plain = amortize(loan())
    for (const p of [
      { month: 12, amount: 0 },
      { month: 12, amount: -500 },
      { month: 0, amount: 5000 },
      { month: 12.5, amount: 5000 },
    ]) {
      expect(amortize(loan({ prepayments: [p] }))).toEqual(plain)
    }
  })

  it('ends the loan in the month an extra payment equal to what is left is made', () => {
    // After month 60's installment the schedule shows B_60 owed. An extra payment of exactly that
    // ends the loan in month 60, with nothing carried into month 61.
    const shown = amortize(loan())[59].balance
    expect(shown).toBeCloseTo(balanceAfter(P, RATE, A, 60), 6)
    const exact = amortize(loan({ prepayments: [{ month: 60, amount: shown }] }))
    expect(exact).toHaveLength(60)
    expect(exact[59].prepayment).toBe(shown)
    expect(exact[59].balance).toBe(0)
  })

  it('charges a final month for what an extra payment leaves, however small', () => {
    // One cent short of the balance is still owed, with a month's interest on it.
    const shown = amortize(loan())[59].balance
    const s = amortize(loan({ prepayments: [{ month: 60, amount: shown - 0.01 }] }))
    expect(s).toHaveLength(61)
    expect(s[60].payment).toBeCloseTo(0.01 * (1 + r5), 9)
    expect(s[60].balance).toBe(0)
  })

  it("records only what was needed of an extra payment equal to last month's balance", () => {
    // B_59 is the balance the previous row showed; month 60's installment already took part of it.
    const B59 = balanceAfter(P, RATE, A, 59)
    const s = amortize(loan({ prepayments: [{ month: 60, amount: B59 }] }))
    expect(s).toHaveLength(60)
    expect(s[59].payment).toBeCloseTo(A, 6)
    expect(s[59].prepayment).toBeCloseTo(B59 * (1 + r5) - A, 6)
    expect(s[59].prepayment).toBeLessThan(B59)
    expect(s[59].balance).toBe(0)
  })

  it('adds up several extra payments in one month and keeps every note', () => {
    const split = amortize(
      loan({
        prepayments: [
          { month: 12, amount: 1000, note: 'bonus' },
          { month: 12, amount: 2000 },
          { month: 12, amount: 3000, note: 'tax refund' },
        ],
      })
    )
    const whole = amortize(loan({ prepayments: [{ month: 12, amount: 6000 }] }))
    expect(split[11].prepayment).toBe(6000)
    expect(split[11].note).toBe('bonus; tax refund')
    expect(split.map((r) => r.balance)).toEqual(whole.map((r) => r.balance))
  })

  it('keeps a loan starting on the 31st on the last day of shorter months, in any year', () => {
    const dates = (start: string) =>
      amortize(loan({ start_date: start, term_months: 14 })).map((r) => r.date)
    expect(dates('2026-01-31').slice(0, 4)).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
    ])
    expect(dates('2028-01-31').slice(0, 3)).toEqual(['2028-01-31', '2028-02-29', '2028-03-31'])
    // A leap day comes back as the 28th in the next year, and the 29th in the next leap year.
    expect(dates('2027-12-31')[2]).toBe('2028-02-29')
    expect(dates('2026-11-30').slice(0, 4)).toEqual([
      '2026-11-30',
      '2026-12-30',
      '2027-01-30',
      '2027-02-28',
    ])
  })

  it('reads only the calendar date of a start date given as a timestamp', () => {
    const s = amortize(loan({ start_date: '2026-01-31T23:30:00.000Z', term_months: 2 }))
    expect(s.map((r) => r.date)).toEqual(['2026-01-31', '2026-02-28'])
  })

  it('keeps the arithmetic, without dates, when the start date cannot be read', () => {
    const s = amortize(loan({ start_date: 'soon' }))
    expect(s).toHaveLength(N)
    expect(s.every((r) => r.date === '')).toBe(true)
    expect(s[0].payment).toBeCloseTo(A, 6)
    expect(payoffDate(s)).toBeNull()
  })

  it('stays fast and exact over 360 months', () => {
    const thirtyYears = loan({ term_months: 360 })
    const s = amortize(thirtyYears)
    expect(s).toHaveLength(360)
    expect(sum(s, (r) => r.interest)).toBeCloseTo(360 * annuity(P, RATE, 360) - P, 6)

    const busy = loan({
      term_months: 360,
      rate_periods: [
        { rate: 7, start_month: 61, end_month: 120 },
        { rate: 3.5, start_month: 200 },
      ],
      prepayments: [
        { month: 30, amount: 5000 },
        { month: 90, amount: 2500 },
      ],
    })
    const t0 = Date.now()
    for (let i = 0; i < 100; i++) calculateLoan(busy)
    // About 10 ms on a quiet machine. The bound is for a pathological slowdown, not a benchmark.
    expect(Date.now() - t0).toBeLessThan(2000)
  })

  it('returns no schedule, without throwing, for a principal or term of zero or less', () => {
    for (const over of [
      { principal: 0 },
      { principal: -5000 },
      { principal: Number.NaN },
      { term_months: 0 },
      { term_months: -12 },
      { term_months: Number.NaN },
      { term_months: MAX_TERM_MONTHS + 1 },
      { term_months: Number.MAX_VALUE },
    ]) {
      expect(amortize(loan(over))).toEqual([])
    }
  })

  it('treats a missing base rate, rate period list or extra payment list as none', () => {
    const bare = {
      principal: 12000,
      interest_rate: Number.NaN,
      start_date: '2026-01-01',
      term_months: 12,
    }
    const s = amortize(bare)
    expect(s).toHaveLength(12)
    expect(s.every((r) => r.rate === 0)).toBe(true)
    expect(amortize({ ...bare, rate_periods: null, prepayments: null })).toEqual(s)
  })
})

// ── Summary and status ───────────────────────────────────────────────────────

describe('calculateLoan', () => {
  it('summarises the example loan with no extra payments', () => {
    const { schedule, summary, comparison } = calculateLoan(loan())
    expect(schedule).toHaveLength(N)
    expect(summary).toEqual({
      totalPaid: expect.closeTo(N * A, 6),
      totalInterest: expect.closeTo(N * A - P, 6),
      interestSaved: 0,
      monthsSaved: 0,
      payoffDate: '2035-12-01',
      totalPayments: N,
      avgMonthlyPayment: expect.closeTo(A, 6),
      maxBalance: expect.closeTo(balanceAfter(P, RATE, A, 1), 6),
      originalTotalInterest: expect.closeTo(N * A - P, 6),
      originalTotalPayments: N,
    })
    expect(comparison.withPrepayments).toBe(summary)
    expect(comparison.withoutPrepayments).toEqual(summary)
  })

  it('measures an extra payment against the same loan without it', () => {
    const { summary, comparison } = calculateLoan(
      loan({ prepayments: [{ month: 12, amount: 10000 }] })
    )
    expect(summary.monthsSaved).toBe(N - 106)
    expect(summary.interestSaved).toBeCloseTo(
      summary.originalTotalInterest - summary.totalInterest,
      9
    )
    expect(summary.originalTotalPayments).toBe(N)
    expect(comparison.withoutPrepayments.totalPayments).toBe(N)
    expect(comparison.withoutPrepayments.interestSaved).toBe(0)
  })

  it('reports an empty loan as zeros, with no payoff date', () => {
    const { schedule, summary } = calculateLoan(loan({ principal: 0 }))
    expect(schedule).toEqual([])
    expect(summary).toEqual({
      totalPaid: 0,
      totalInterest: 0,
      interestSaved: 0,
      monthsSaved: 0,
      payoffDate: null,
      totalPayments: 0,
      avgMonthlyPayment: 0,
      maxBalance: 0,
      originalTotalInterest: 0,
      originalTotalPayments: 0,
    })
  })

  it('summarize compares two schedules', () => {
    const original = amortize(loan())
    const shorter = amortize(loan({ prepayments: [{ month: 3, amount: 50000 }] }))
    const s = summarize(shorter, original)
    expect(s.interestSaved).toBeGreaterThan(0)
    expect(s.totalPayments).toBeLessThan(s.originalTotalPayments)
    expect(s.monthsSaved).toBe(original.length - shorter.length)
  })
})

describe('loanStatus', () => {
  it('counts every payment due on or before today, and shows the next one', () => {
    // Started 2021-01-01: by 2025-12-15 sixty payments are due, the last on 2025-12-01.
    const status = loanStatus(loan({ start_date: '2021-01-01' }), '2025-12-15')
    expect(status.remaining_balance).toBeCloseTo(balanceAfter(P, RATE, A, 60), 6)
    expect(status.monthly_payment).toBeCloseTo(A, 6)
    expect(status.payoff_date).toBe('2030-12-01')
  })

  it('counts a payment due today as paid', () => {
    const status = loanStatus(loan({ start_date: '2021-01-01' }), '2025-12-01')
    expect(status.remaining_balance).toBeCloseTo(balanceAfter(P, RATE, A, 60), 6)
  })

  it('owes the whole principal before the first payment, and nothing after the last', () => {
    const before = loanStatus(loan(), '2025-12-31')
    expect(before.remaining_balance).toBe(P)
    expect(before.monthly_payment).toBeCloseTo(A, 6)
    const after = loanStatus(loan(), '2036-01-01')
    expect(after.remaining_balance).toBe(0)
    expect(after.monthly_payment).toBe(0)
    expect(after.payoff_date).toBe('2035-12-01')
  })

  it('includes extra payments and rate changes already made', () => {
    const terms = loan({
      start_date: '2021-01-01',
      rate_periods: [{ rate: 8, start_month: 13 }],
      prepayments: [{ month: 12, amount: 10000 }],
    })
    const s = amortize(terms)
    const status = loanStatus(terms, '2025-12-15')
    expect(status.remaining_balance).toBe(s[59].balance)
    expect(status.monthly_payment).toBe(s[60].payment)
    expect(status.payoff_date).toBe(s[s.length - 1].date)
  })

  it('treats a loan with an unreadable start date as not started', () => {
    const status = loanStatus(loan({ start_date: '' }), '2030-01-01')
    expect(status.remaining_balance).toBe(P)
    expect(status.monthly_payment).toBeCloseTo(A, 6)
    expect(status.payoff_date).toBeNull()
  })

  it('reports an invalid loan without throwing', () => {
    expect(loanStatus(loan({ principal: -1 }), '2030-01-01')).toEqual({
      remaining_balance: 0,
      monthly_payment: 0,
      payoff_date: null,
    })
    expect(loanStatus(loan({ term_months: 0 }), '2030-01-01')).toEqual({
      remaining_balance: P,
      monthly_payment: 0,
      payoff_date: null,
    })
  })
})

describe('calendar helpers', () => {
  it('adds calendar months with the day clamped, forwards and backwards', () => {
    expect(addCalendarMonths('2026-01-31', 1)).toBe('2026-02-28')
    expect(addCalendarMonths('2026-03-31', -1)).toBe('2026-02-28')
    expect(addCalendarMonths('2024-02-29', 12)).toBe('2025-02-28')
    expect(addCalendarMonths('2026-12-15', 1)).toBe('2027-01-15')
    expect(addCalendarMonths('2026-01-15', -13)).toBe('2024-12-15')
    expect(addCalendarMonths('not a date', 1)).toBe('')
    expect(addCalendarMonths('2026-13-01', 1)).toBe('')
  })

  it('takes today as the UTC calendar date', () => {
    expect(todayUtc(new Date('2026-03-01T03:30:00Z'))).toBe('2026-03-01')
    expect(todayUtc(new Date('2026-02-28T23:30:00-05:00'))).toBe('2026-03-01')
  })
})

// ── Carried over from the tests of frontend/src/core/loanCalculator.ts ───────

describe('cases carried over from the old loanCalculator tests', () => {
  const small = (over: Partial<LoanInput> = {}) =>
    loan({ principal: 10000, interest_rate: 6, start_date: '2024-01-01', term_months: 12, ...over })

  it('produces a twelve-month schedule with a first month of 50 interest', () => {
    const s = amortize(small())
    expect(s).toHaveLength(12)
    expect(s[0].balance).toBeLessThan(10000)
    expect(s[0].interest).toBeCloseTo(50, 9) // 10,000 * 6 % / 12
    expect(s[11].balance).toBe(0)
  })

  it('pays off sooner and charges less interest with an extra payment', () => {
    const withExtra = amortize(small({ prepayments: [{ month: 3, amount: 2000 }] }))
    const without = amortize(small())
    expect(withExtra.length).toBeLessThan(without.length)
    expect(sum(withExtra, (r) => r.interest)).toBeLessThan(sum(without, (r) => r.interest))
  })

  it('charges each rate period in its months', () => {
    const s = amortize(
      loan({
        start_date: '2024-01-01',
        term_months: 24,
        rate_periods: [
          { rate: 4, start_month: 1, end_month: 12 },
          { rate: 6, start_month: 13 },
        ],
      })
    )
    expect(s[0].rate).toBe(4)
    expect(s[12].rate).toBe(6)
  })

  it('totals interest and payments, and dates the payoff', () => {
    const s = amortize(small())
    const prepaid = amortize(small({ prepayments: [{ month: 2, amount: 3000 }] }))
    expect(sum(s, (r) => r.interest)).toBeGreaterThan(0)
    expect(sum(s, (r) => r.interest)).toBeLessThan(10000)
    expect(sum(prepaid, (r) => r.payment + r.prepayment)).toBeGreaterThan(10000)
    expect(payoffDate(s)).toBe(s[s.length - 1].date)
    expect(payoffDate([])).toBeNull()
    const saved = summarize(prepaid, s)
    expect(saved.interestSaved).toBeGreaterThan(0)
    expect(saved.monthsSaved).toBeGreaterThan(0)
  })

  it('summarises a schedule against itself and against an extra payment', () => {
    const s = amortize(small())
    const same = summarize(s, s)
    expect(same.totalPaid).toBeGreaterThan(0)
    expect(same.totalInterest).toBeGreaterThan(0)
    expect(same.interestSaved).toBe(0)
    expect(same.payoffDate).toBeTruthy()
    expect(same.totalPayments).toBe(12)
    expect(same.avgMonthlyPayment).toBeGreaterThan(0)
    expect(same.maxBalance).toBeGreaterThan(9000)

    const prepaid = summarize(amortize(small({ prepayments: [{ month: 3, amount: 5000 }] })), s)
    expect(prepaid.interestSaved).toBeGreaterThan(0)
    expect(prepaid.monthsSaved).toBeGreaterThan(0)
    expect(prepaid.totalPayments).toBeLessThan(prepaid.originalTotalPayments)
  })
})

// ── Defects of the engines this replaced ─────────────────────────────────────

describe('defects of the engines this replaced', () => {
  it('1. a second extra payment keeps the installment, as the first one does', () => {
    // 10,000 in month 12 and 1.00 in month 24. The old engine re-spread the first payment over
    // the original end date once the second arrived: 120 months at 929.24, saving 2,747.51.
    const { schedule, summary } = calculateLoan(
      loan({
        prepayments: [
          { month: 12, amount: 10000 },
          { month: 24, amount: 1 },
        ],
      })
    )
    const after12 = balanceAfter(P, RATE, A, 12) - 10000
    const after24 = balanceAfter(after12, RATE, A, 12) - 1
    // Every installment but the partial last one is A.
    for (const row of schedule.slice(0, -1)) expect(row.payment).toBeCloseTo(A, 6)
    expect(schedule).toHaveLength(24 + installmentsFor(after24, RATE, A))
    expect(schedule).toHaveLength(106)
    // More than the 10,000 alone saves (5,236.32): the 1.00 saves its own interest on top.
    const first = calculateLoan(loan({ prepayments: [{ month: 12, amount: 10000 }] })).summary
    expect(first.interestSaved).toBeCloseTo(5236.32, 2)
    expect(summary.interestSaved).toBeGreaterThan(first.interestSaved)
  })

  it('2. a rate change recomputes the installment, and nothing is left owing at the end', () => {
    // 5 % to 8 % from month 13 used to keep 1,060.66 and stop at month 120 with 21,768.04 owed.
    const { schedule, summary } = calculateLoan(
      loan({ rate_periods: [{ rate: 8, start_month: 13 }] })
    )
    expect(schedule[12].payment).toBeCloseTo(1198.93, 2)
    expect(schedule).toHaveLength(N)
    expect(schedule[N - 1].balance).toBe(0)
    expect(summary.payoffDate).toBe('2035-12-01')
    expect(sum(schedule, (r) => r.principal + r.prepayment)).toBeCloseTo(P, 6)
  })

  it('3. month dates are calendar months, not Date#setMonth overflow', () => {
    // A 31 January start used to list 2026-01-31, 2026-03-03, 2026-03-30.
    const s = amortize(loan({ start_date: '2026-01-31' }))
    expect(s.slice(0, 3).map((r) => r.date)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31'])
    // And the 1st of the month stays the 1st west of UTC, where the old dates drifted to the 31st.
    expect(amortize(loan()).map((r) => r.date.slice(8))).toEqual(Array(N).fill('01'))
  })

  it('4. monthsSaved is the number of months removed, not an interest-based estimate', () => {
    const terms = loan({
      prepayments: [
        { month: 12, amount: 10000 },
        { month: 24, amount: 1 },
      ],
    })
    const { schedule, summary } = calculateLoan(terms)
    expect(summary.monthsSaved).toBe(
      amortize({ ...terms, prepayments: [] }).length - schedule.length
    )
    expect(summary.monthsSaved).toBe(14)
  })

  it('5. an extra payment larger than what is left pays it off and records only that', () => {
    // 10,000 in month 118, when 3,155.63 is owed. The old row showed principal -6,844.37 and
    // prepayment 10,000, and totalPaid 135,157.31.
    const { schedule, summary } = calculateLoan(
      loan({ prepayments: [{ month: 118, amount: 10000 }] })
    )
    const B117 = balanceAfter(P, RATE, A, 117)
    expect(B117).toBeCloseTo(3155.63, 2)
    const row = schedule[117]
    expect(schedule).toHaveLength(118)
    expect(row.payment).toBeCloseTo(A, 6)
    expect(row.principal).toBeCloseTo(A - B117 * r5, 6)
    expect(row.principal).toBeGreaterThan(0)
    expect(row.prepayment).toBeCloseTo(B117 * (1 + r5) - A, 6)
    expect(row.balance).toBe(0)
    // 117 installments plus month 118's installment and extra pay B_117 off with its interest.
    const interest = 118 * A + row.prepayment - P
    expect(summary.totalInterest).toBeCloseTo(interest, 6)
    expect(summary.totalPaid).toBeCloseTo(P + interest, 6)
    expect(summary.totalPaid).toBeCloseTo(127265.43, 2)
  })

  it('6. extra payments in the same month add up', () => {
    // 5,000 + 5,000 used to count as one 5,000.
    const pair = calculateLoan(
      loan({
        prepayments: [
          { month: 12, amount: 5000 },
          { month: 12, amount: 5000 },
        ],
      })
    )
    const single = calculateLoan(loan({ prepayments: [{ month: 12, amount: 10000 }] }))
    expect(pair.schedule[11].prepayment).toBe(10000)
    expect(pair.schedule).toEqual(single.schedule)
    expect(pair.summary.interestSaved).toBeCloseTo(5236.32, 2)
  })

  it('7. the last month pays what is owed, so totalPaid is principal plus interest', () => {
    // 10,000 in month 12 ends the loan in month 106, when B_105 (1+r) = 673.51 is owed. The old
    // row charged the full 1,060.66, and totalPaid came to 122,429.45 against 122,042.30.
    const { schedule, summary } = calculateLoan(
      loan({ prepayments: [{ month: 12, amount: 10000 }] })
    )
    const after12 = balanceAfter(P, RATE, A, 12) - 10000
    const B105 = balanceAfter(after12, RATE, A, 105 - 12)
    expect(schedule[105].payment).toBeCloseTo(B105 * (1 + r5), 6)
    expect(schedule[105].payment).toBeCloseTo(673.51, 2)
    expect(summary.totalPaid).toBeCloseTo(P + summary.totalInterest, 6)
    expect(summary.totalPaid).toBeCloseTo(122042.3, 2)
  })

  it("8. the remaining balance is the schedule's, not principal minus installments", () => {
    // After 60 payments 56,204.87 is owed. The Loans page subtracted 60 whole installments from the
    // principal and showed 36,360.69.
    const status = loanStatus(loan({ start_date: '2021-01-01' }), '2025-12-15')
    expect(status.remaining_balance).toBeCloseTo(balanceAfter(P, RATE, A, 60), 6)
    expect(status.remaining_balance).toBeCloseTo(56204.87, 2)
  })

  it('9. the base rate covers every month no rate period covers', () => {
    // A rate period from month 13 only. Months 1-12 are the loan's own 5 %, not 0 %.
    const s = amortize(loan({ rate_periods: [{ rate: 8, start_month: 13 }] }))
    expect(s.slice(0, 12).every((r) => r.rate === RATE)).toBe(true)
    expect(s[0].interest).toBeCloseTo(P * r5, 9)
    expect(s[0].payment).toBeCloseTo(A, 6)
  })
})

// ── Invariants over random loans ─────────────────────────────────────────────

/** mulberry32: small, seeded, and the same sequence on every run. */
function prng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function randomLoan(next: () => number): LoanInput {
  const int = (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1))
  const pick = <T>(xs: T[]): T => xs[int(0, xs.length - 1)]
  const term = pick([1, 2, 12, int(3, 480), int(3, 480), 360])
  const principal = Math.round(int(500, 750_000) * 100) / 100
  const rate = pick([0, int(1, 1500) / 100, int(1, 1500) / 100])
  const periods = Array.from({ length: int(0, 3) }, () => {
    const start = int(1, term)
    return {
      rate: pick([0, int(1, 1500) / 100]),
      start_month: start,
      end_month: next() < 0.5 ? null : int(start, term),
    }
  })
  const extras = Array.from({ length: int(0, 4) }, () => ({
    month: int(1, term + 6),
    amount: Math.round(next() * principal * 0.4 * 100) / 100,
  }))
  if (extras.length > 0 && next() < 0.3) extras.push({ ...extras[0] }) // a same-month pair
  const day = pick([1, 15, 28, 29, 30, 31])
  return {
    principal,
    interest_rate: rate,
    start_date: `${int(2000, 2040)}-${String(int(1, 12)).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    term_months: term,
    rate_periods: periods,
    prepayments: extras,
  }
}

/** Days in month m of year y, by the Gregorian rule. */
function daysIn(y: number, m: number): number {
  if (m !== 2) return [4, 6, 9, 11].includes(m) ? 30 : 31
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28
}

describe('invariants over 400 seeded random loans', () => {
  const next = prng(20261007)
  const loans = Array.from({ length: 400 }, () => randomLoan(next))

  it('covers what the invariants are about, so none of them holds vacuously', () => {
    let shortened = 0
    let rateChanges = 0
    let samePairs = 0
    let clamped = 0
    for (const l of loans) {
      const { schedule, summary } = calculateLoan(l)
      if (summary.monthsSaved > 0) shortened++
      if (schedule.some((r, i) => i > 0 && r.rate !== schedule[i - 1].rate)) rateChanges++
      const months = (l.prepayments ?? []).map((p) => p.month)
      if (new Set(months).size < months.length) samePairs++
      if (schedule.some((r) => Number(r.date.slice(8)) < Number(l.start_date.slice(8)))) clamped++
    }
    expect(shortened).toBeGreaterThan(50)
    expect(rateChanges).toBeGreaterThan(50)
    expect(samePairs).toBeGreaterThan(10)
    expect(clamped).toBeGreaterThan(50)
  })

  it('never shows a negative balance, and always ends at exactly zero', () => {
    for (const l of loans) {
      const s = amortize(l)
      expect(s.length).toBeGreaterThan(0)
      expect(s.length).toBeLessThanOrEqual(l.term_months)
      expect(s.every((r) => r.balance >= 0 && r.principal >= 0 && r.prepayment >= 0)).toBe(true)
      expect(s[s.length - 1].balance).toBe(0)
    }
  })

  it('repays exactly the principal, and totalPaid is principal plus interest', () => {
    for (const l of loans) {
      const { schedule, summary } = calculateLoan(l)
      const tolerance = l.principal * 1e-9
      expect(Math.abs(sum(schedule, (r) => r.principal + r.prepayment) - l.principal)).toBeLessThan(
        tolerance
      )
      expect(Math.abs(summary.totalPaid - (l.principal + summary.totalInterest))).toBeLessThan(
        tolerance
      )
    }
  })

  it('keeps the installment constant between rate changes', () => {
    for (const l of loans) {
      const s = amortize(l)
      for (let i = 1; i < s.length - 1; i++) {
        if (s[i].rate === s[i - 1].rate) expect(s[i].payment).toBe(s[i - 1].payment)
      }
    }
  })

  it('runs exactly the term, to zero, at a constant rate with no extra payments', () => {
    for (const l of loans) {
      const s = amortize({ ...l, rate_periods: [], prepayments: [] })
      expect(s).toHaveLength(l.term_months)
      expect(s[s.length - 1].balance).toBe(0)
      const A = annuity(l.principal, l.interest_rate, l.term_months)
      expect(Math.abs(sum(s, (r) => r.interest) - (l.term_months * A - l.principal))).toBeLessThan(
        l.principal * 1e-9
      )
    }
  })

  it('never charges more interest, or takes longer, for an extra payment', () => {
    for (const l of loans) {
      const { schedule, summary } = calculateLoan(l)
      expect(summary.interestSaved).toBeGreaterThan(-l.principal * 1e-9)
      expect(summary.monthsSaved).toBeGreaterThanOrEqual(0)
      expect(summary.monthsSaved).toBe(summary.originalTotalPayments - schedule.length)
    }
  })

  it('steps the dates by exactly one calendar month, on the start day or the month end', () => {
    for (const l of loans) {
      const startDay = Number(l.start_date.slice(8, 10))
      const s = amortize(l)
      s.forEach((row, i) => {
        const [y, m, d] = row.date.split('-').map(Number)
        if (i > 0) {
          const [py, pm] = s[i - 1].date.split('-').map(Number)
          expect(y * 12 + m - (py * 12 + pm)).toBe(1)
        }
        expect(d).toBe(Math.min(startDay, daysIn(y, m)))
      })
    }
  })
})
