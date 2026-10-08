/**
 * Tests for shared/loanScenarios.ts: what-ifs on top of a loan, and the facts that compare two of
 * them (plan 03, part 1).
 *
 * Expected numbers come from closed forms, as in loanSchedule.test.ts, and were checked separately
 * in Python with 50-digit decimals. The example loan is 100,000 at 5 % over 120 months, first
 * payment 2026-01-01, installment A = 1,060.66, seen from before its first payment (month 1):
 *
 *   10,000 in month 12, finish sooner     106 payments, done 2034-10-01, 5,236.32 less interest
 *   10,000 in month 12, pay less          945.48 from month 13 (2027-01-01), 2,438.66 less interest
 *   50 more each month, finish sooner     114 payments, done 2035-06-01, 1,668.92 less interest
 *   done 1, 2, 5 years earlier            92, 206, 827 more each month; one less misses the month
 *
 * Template presets follow plan 03's table for the example: +50, +100, +200; round up to 1,100 or
 * 1,200; 1,000, 5,000 or 10,000 in 1, 6 or 12 months; 1,000 or 2,000 each December; one
 * installment each December; 1, 2 or 5 years earlier; +1, +2 or -1 point.
 */
import { describe, expect, it } from 'vitest'
import {
  applyWhatIf,
  buildWhatIf,
  compareScenarios,
  monthlyExtraToFinishBy,
  nextPaymentMonth,
  niceAmount,
  runScenario,
  stepAmount,
  TEMPLATE_IDS,
  templateOptions,
  templateTakesMode,
} from '../../../../shared/loanScenarios'
import { amortize, amortizeLoan, rateStretches } from '../../../../shared/loanSchedule'
import type { WhatIf, WhatIfChoice } from '../../../../shared/loanScenarios'
import type { LoanInput } from '../../../../shared/loanSchedule'

process.env.TZ = 'America/New_York'

// ── Closed forms ─────────────────────────────────────────────────────────────

const monthlyRate = (pct: number) => pct / 100 / 12

function annuity(P: number, pct: number, n: number): number {
  const r = monthlyRate(pct)
  if (r === 0) return P / n
  return (P * r * (1 + r) ** n) / ((1 + r) ** n - 1)
}

function balanceAfter(B: number, pct: number, A: number, k: number): number {
  const r = monthlyRate(pct)
  if (r === 0) return B - A * k
  return B * (1 + r) ** k - (A * ((1 + r) ** k - 1)) / r
}

/**
 * Payments of X a month that repay B, by the schedule's rule that half a cent left counts as
 * repaid: the smallest n with B_n <= h, n = ceil(ln((X - r h) / (X - r B)) / ln(1 + r)).
 */
function paymentsToRepay(B: number, pct: number, X: number): number {
  const r = monthlyRate(pct)
  const h = 0.005
  return Math.ceil(Math.log((X - r * h) / (X - r * B)) / Math.log(1 + r) - 1e-9)
}

// ── The example loan ─────────────────────────────────────────────────────────

const P = 100_000
const RATE = 5
const N = 120
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

const NONE: WhatIf = { mode: 'shorten', once: [], every: [], rate: null }

it('runs west of UTC', () => {
  expect(new Date('2026-07-01T00:00:00Z').getTimezoneOffset()).not.toBe(0)
})

// ── nextPaymentMonth ─────────────────────────────────────────────────────────

describe('nextPaymentMonth', () => {
  it('is the month of the first payment due after today', () => {
    expect(nextPaymentMonth(loan(), '2025-12-15')).toBe(1)
    expect(nextPaymentMonth(loan(), '2026-01-02')).toBe(2)
    expect(nextPaymentMonth(loan(), '2030-06-20')).toBe(55)
    expect(nextPaymentMonth(loan(), '2035-11-30')).toBe(120)
  })

  it('counts a payment due today as made, as loanStatus does', () => {
    expect(nextPaymentMonth(loan(), '2026-01-01')).toBe(2)
    expect(nextPaymentMonth(loan({ start_date: '2026-01-31' }), '2026-02-28')).toBe(3)
  })

  it('is null once the loan is repaid, extra payments included', () => {
    expect(nextPaymentMonth(loan(), '2035-12-01')).toBeNull()
    const prepaid = loan({ prepayments: [{ month: 12, amount: 10000 }] })
    expect(nextPaymentMonth(prepaid, '2034-09-15')).toBe(106)
    expect(nextPaymentMonth(prepaid, '2034-10-01')).toBeNull()
  })

  it('is month 1 when the start date cannot be read', () => {
    expect(nextPaymentMonth(loan({ start_date: '' }), '2030-01-01')).toBe(1)
  })

  it('is null for a loan with no schedule', () => {
    expect(nextPaymentMonth(loan({ principal: 0 }), '2030-01-01')).toBeNull()
  })
})

// ── applyWhatIf ──────────────────────────────────────────────────────────────

describe('applyWhatIf', () => {
  it('adds to the extra payments the loan already has, in the what-if mode, and changes nothing else', () => {
    const saved = loan({ prepayments: [{ month: 3, amount: 500, note: 'gift' }] })
    const before = JSON.stringify(saved)
    const next = applyWhatIf(saved, {
      mode: 'lower',
      once: [{ month: 12, amount: 10000 }],
      every: [{ amount: 50, every_months: 1, from_month: 13, to_month: 24 }],
      rate: null,
    })
    expect(JSON.stringify(saved)).toBe(before)
    expect(next.prepayments).toEqual([
      { month: 3, amount: 500, note: 'gift' },
      { month: 12, amount: 10000, mode: 'lower' },
    ])
    expect(next.extra_rules).toEqual([
      { amount: 50, every_months: 1, from_month: 13, to_month: 24, mode: 'lower' },
    ])
    expect(next.rate_periods).toEqual(saved.rate_periods)
    expect({ ...next, prepayments: [], extra_rules: [] }).toEqual({
      ...saved,
      prepayments: [],
      extra_rules: [],
    })
  })

  it('is the loan itself with nothing in it', () => {
    expect(amortize(applyWhatIf(loan(), NONE))).toEqual(amortize(loan()))
  })

  it('moves every rate from a month on, whatever periods the loan already has', () => {
    // Base 5 %, 3 % for months 25-36, 7 % from month 61. One point more from month 13:
    // 5 % to month 12, then 6, 4 (25-36), 6, and 8 from month 61.
    const terms = loan({
      rate_periods: [
        { rate: 3, start_month: 25, end_month: 36 },
        { rate: 7, start_month: 61 },
      ],
    })
    const rates = amortize(
      applyWhatIf(terms, { ...NONE, rate: { from_month: 13, points: 1 } })
    ).map((r) => r.rate)
    expect(rates).toEqual([
      ...Array(12).fill(5),
      ...Array(12).fill(6),
      ...Array(12).fill(4),
      ...Array(24).fill(6),
      ...Array(60).fill(8),
    ])
  })

  it('recomputes the installment from that month, as any rate change does', () => {
    const s = amortize(applyWhatIf(loan(), { ...NONE, rate: { from_month: 13, points: 1 } }))
    const B12 = balanceAfter(P, RATE, A, 12)
    expect(s[11].payment).toBeCloseTo(A, 6)
    expect(s[12].payment).toBeCloseTo(annuity(B12, 6, 108), 6)
    expect(s).toHaveLength(N)
  })

  it('never moves a rate below zero', () => {
    const s = amortize(applyWhatIf(loan(), { ...NONE, rate: { from_month: 1, points: -6 } }))
    expect(s.every((r) => r.rate === 0)).toBe(true)
    expect(s[0].payment).toBeCloseTo(P / N, 9)
  })
})

describe('rateStretches', () => {
  it('lists the rate of each stretch of months from a month on, the last one open-ended', () => {
    const terms = loan({
      rate_periods: [
        { rate: 3, start_month: 25, end_month: 36 },
        { rate: 7, start_month: 61 },
      ],
    })
    expect(rateStretches(terms, 13)).toEqual([
      { start: 13, end: 24, rate: 5 },
      { start: 25, end: 36, rate: 3 },
      { start: 37, end: 60, rate: 5 },
      { start: 61, end: null, rate: 7 },
    ])
    expect(rateStretches(terms, 30)).toEqual([
      { start: 30, end: 36, rate: 3 },
      { start: 37, end: 60, rate: 5 },
      { start: 61, end: null, rate: 7 },
    ])
    expect(rateStretches(loan(), 1)).toEqual([{ start: 1, end: null, rate: 5 }])
  })
})

// ── runScenario and compareScenarios ─────────────────────────────────────────

describe('runScenario', () => {
  it('states the facts of the loan as it stands', () => {
    const s = runScenario(loan(), 1)
    expect(s.rows).toHaveLength(N)
    expect(s.neverPaysOffFrom).toBeNull()
    expect(s.payoffMonth).toBe(120)
    expect(s.payoffDate).toBe('2035-12-01')
    expect(s.totalInterest).toBeCloseTo(N * A - P, 6)
    expect(s.totalPaid).toBeCloseTo(N * A, 6)
    expect(s.totalExtra).toBe(0)
    expect(s.installmentNow).toBeCloseTo(A, 6)
    expect(s.installmentChanges).toEqual([])
  })

  it('lists the month the installment changes after a pay-less extra payment', () => {
    const s = runScenario(loan({ prepayments: [{ month: 12, amount: 10000, mode: 'lower' }] }), 1)
    const A2 = annuity(balanceAfter(P, RATE, A, 12) - 10000, RATE, 108)
    expect(s.installmentChanges).toHaveLength(1)
    expect(s.installmentChanges[0]).toEqual({
      month: 13,
      date: '2027-01-01',
      installment: expect.closeTo(A2, 6),
    })
    expect(s.installmentChanges[0].installment).toBeCloseTo(945.48, 2)
    expect(s.totalExtra).toBe(10000)
  })

  it('leaves out the last payment, which is only what is left', () => {
    const s = runScenario(loan({ prepayments: [{ month: 12, amount: 10000 }] }), 1)
    expect(s.rows[105].payment).toBeCloseTo(673.51, 2)
    expect(s.installmentChanges).toEqual([])
    expect(s.payoffMonth).toBe(106)
    expect(s.payoffDate).toBe('2034-10-01')
  })

  it('counts only the changes from the month it is seen from', () => {
    const terms = loan({
      rate_periods: [
        { rate: 6, start_month: 13 },
        { rate: 7, start_month: 37 },
      ],
    })
    expect(runScenario(terms, 1).installmentChanges.map((c) => c.month)).toEqual([13, 37])
    expect(runScenario(terms, 14).installmentChanges.map((c) => c.month)).toEqual([37])
    // Seen from month 13, its new installment is the installment now, not a change to come.
    expect(runScenario(terms, 13).installmentChanges.map((c) => c.month)).toEqual([37])
    expect(runScenario(terms, 13).installmentNow).toBeCloseTo(
      annuity(balanceAfter(P, RATE, A, 12), 6, 108),
      6
    )
    expect(runScenario(terms, 14).installmentNow).toBeCloseTo(
      annuity(balanceAfter(P, RATE, A, 12), 6, 108),
      6
    )
  })

  it('has no payoff for a loan that is never repaid', () => {
    const s = runScenario(
      loan({
        term_months: 360,
        rate_periods: [{ rate: 15, start_month: 13 }],
        on_rate_change: 'keep-installment',
      }),
      1
    )
    expect(s.neverPaysOffFrom).toBe(13)
    expect(s.payoffMonth).toBeNull()
    expect(s.payoffDate).toBeNull()
  })

  it('compares on month numbers when the start date cannot be read', () => {
    const s = runScenario(loan({ start_date: 'soon' }), 1)
    expect(s.payoffMonth).toBe(120)
    expect(s.payoffDate).toBeNull()
  })
})

describe('compareScenarios', () => {
  const plan = runScenario(loan(), 1)

  it('subtracts the facts of two scenarios: finish sooner', () => {
    const b = runScenario(loan({ prepayments: [{ month: 12, amount: 10000 }] }), 1)
    const c = compareScenarios(plan, b)
    expect(c.monthsSooner).toBe(14)
    expect(c.interestSaved).toBeCloseTo(5236.32, 2)
    expect(c.extraPaid).toBe(10000)
    expect(c.installmentNowChange).toBe(0)
  })

  it('subtracts the facts of two scenarios: pay less each month', () => {
    const b = runScenario(loan({ prepayments: [{ month: 12, amount: 10000, mode: 'lower' }] }), 1)
    const c = compareScenarios(plan, b)
    expect(c.monthsSooner).toBe(0)
    expect(c.interestSaved).toBeCloseTo(2438.66, 2)
    expect(c.extraPaid).toBe(10000)
    expect(c.installmentNowChange).toBe(0)
  })

  it('measures the installment now against the plan', () => {
    const b = runScenario(applyWhatIf(loan(), { ...NONE, rate: { from_month: 1, points: 1 } }), 1)
    expect(compareScenarios(plan, b).installmentNowChange).toBeCloseTo(annuity(P, 6, N) - A, 6)
  })

  it('has no months sooner or interest saved when either side is never repaid', () => {
    const never = runScenario(
      loan({
        term_months: 360,
        rate_periods: [{ rate: 15, start_month: 13 }],
        on_rate_change: 'keep-installment',
      }),
      1
    )
    const thirty = runScenario(loan({ term_months: 360 }), 1)
    expect(compareScenarios(thirty, never).monthsSooner).toBeNull()
    expect(compareScenarios(thirty, never).interestSaved).toBeNull()
    expect(compareScenarios(never, thirty).monthsSooner).toBeNull()
  })
})

// ── The solver ───────────────────────────────────────────────────────────────

describe('monthlyExtraToFinishBy', () => {
  /** Payments the example takes at A + extra a month from month 1. */
  const paymentsAt = (extra: number) => paymentsToRepay(P, RATE, A + extra)

  it('finds the smallest monthly extra that repays the loan by the month, and one less misses it', () => {
    for (const [by, extra] of [
      [108, 92],
      [96, 206],
      [60, 827],
    ] as const) {
      expect(paymentsAt(extra)).toBeLessThanOrEqual(by)
      expect(paymentsAt(extra - 1)).toBeGreaterThan(by)
      const found = monthlyExtraToFinishBy(loan(), 1, by)
      expect(found).toBe(extra)
      const pay = (x: number) =>
        amortize(loan({ extra_rules: [{ amount: x, every_months: 1, from_month: 1 }] })).length
      expect(pay(extra)).toBeLessThanOrEqual(by)
      expect(pay(extra - 1)).toBeGreaterThan(by)
    }
  })

  it('finds the smallest multiple of the step', () => {
    expect(monthlyExtraToFinishBy(loan(), 1, 108, 10)).toBe(100)
    expect(monthlyExtraToFinishBy(loan(), 1, 108, 25)).toBe(100)
    expect(monthlyExtraToFinishBy(loan(), 1, 108, 50)).toBe(100)
  })

  it('starts paying from the month given', () => {
    // From month 25: B_24 at A + x a month must be repaid within 108 - 24 payments.
    const B24 = balanceAfter(P, RATE, A, 24)
    let x = 0
    while (24 + paymentsToRepay(B24, RATE, A + x) > 108) x++
    expect(monthlyExtraToFinishBy(loan(), 25, 108)).toBe(x)
  })

  it('is 0 when the loan already ends by then', () => {
    expect(monthlyExtraToFinishBy(loan(), 1, 120)).toBe(0)
    expect(monthlyExtraToFinishBy(loan(), 1, 200)).toBe(0)
  })

  it('is null when the month is before the first one it could be paid in', () => {
    expect(monthlyExtraToFinishBy(loan(), 25, 24)).toBeNull()
  })

  it('can ask for everything owed in the month it starts', () => {
    // Done by month 25 from month 25: the extra clears what is left after that installment.
    const extra = monthlyExtraToFinishBy(loan(), 25, 25)
    const pay = (x: number) =>
      amortize(loan({ extra_rules: [{ amount: x, every_months: 1, from_month: 25 }] })).length
    expect(extra).toBeCloseTo(balanceAfter(P, RATE, A, 25), -1)
    expect(pay(extra!)).toBe(25)
    expect(pay(extra! - 1)).toBeGreaterThan(25)
  })

  it('finds what repays a loan that is otherwise never repaid', () => {
    const never = loan({
      term_months: 360,
      rate_periods: [{ rate: 15, start_month: 13 }],
      on_rate_change: 'keep-installment',
    })
    const extra = monthlyExtraToFinishBy(never, 20, 200)
    // The month it is repaid in, Infinity when it never is.
    const ends = (x: number) => {
      const run = amortizeLoan({
        ...never,
        extra_rules: [{ amount: x, every_months: 1, from_month: 20 }],
      })
      return run.neverPaysOffFrom === null ? run.rows.length : Infinity
    }
    expect(ends(0)).toBe(Infinity)
    expect(extra).not.toBeNull()
    expect(ends(extra!)).toBeLessThanOrEqual(200)
    expect(ends(extra! - 1)).toBeGreaterThan(200)
  })

  it('is null for a loan with nothing to repay', () => {
    expect(monthlyExtraToFinishBy(loan({ principal: 0 }), 1, 60)).toBeNull()
  })
})

// ── Amounts a person would type ──────────────────────────────────────────────

describe('niceAmount', () => {
  it('is the nearest 1, 2, 2.5 or 5 times a power of ten, in whole units', () => {
    expect(niceAmount(53.03)).toBe(50)
    expect(niceAmount(106.07)).toBe(100)
    expect(niceAmount(212.13)).toBe(200)
    expect(niceAmount(1060.66)).toBe(1000)
    expect(niceAmount(2121.32)).toBe(2000)
    expect(niceAmount(4675)).toBe(5000)
    expect(niceAmount(26)).toBe(25)
    expect(niceAmount(35.76)).toBe(25)
    expect(niceAmount(1000)).toBe(1000)
    expect(niceAmount(9_999_999)).toBe(10_000_000)
    // Below 10 there is no 2.5: amounts stay whole.
    expect(niceAmount(2.4)).toBe(2)
    expect(niceAmount(3.6)).toBe(5)
    expect(niceAmount(8)).toBe(10)
    expect(niceAmount(0.3)).toBe(1)
  })

  it('breaks a tie towards the rounder amount', () => {
    expect(niceAmount(22.5)).toBe(20)
    expect(niceAmount(150)).toBe(100)
    expect(niceAmount(22500)).toBe(20000)
  })

  it('is 0 for nothing, a negative amount or not a number', () => {
    expect(niceAmount(0)).toBe(0)
    expect(niceAmount(-5)).toBe(0)
    expect(niceAmount(Number.NaN)).toBe(0)
    expect(niceAmount(Infinity)).toBe(0)
  })
})

// ── Templates ────────────────────────────────────────────────────────────────

const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]

describe('templateOptions', () => {
  it('offers the plan table for the example loan, every preset worked out from the loan', () => {
    expect(templateOptions(loan(), 1)).toEqual([
      {
        template: 'more-each-month',
        presets: { amount: [50, 100, 200] },
        steps: { amount: 50 },
        first: { template: 'more-each-month', amount: 50 },
      },
      {
        template: 'round-up',
        presets: { target: [1100, 1200] },
        steps: { target: 100 },
        first: { template: 'round-up', target: 1100 },
      },
      {
        template: 'one-payment',
        presets: { amount: [1000, 5000, 10000], inMonths: [1, 6, 12] },
        steps: { amount: 1000 },
        first: { template: 'one-payment', amount: 1000, inMonths: 1 },
      },
      {
        template: 'yearly-bonus',
        presets: { amount: [1000, 2000], monthOfYear: MONTHS },
        steps: { amount: 1000 },
        first: { template: 'yearly-bonus', amount: 1000, monthOfYear: 12 },
      },
      {
        template: 'extra-installment',
        presets: { monthOfYear: MONTHS },
        steps: {},
        first: { template: 'extra-installment', monthOfYear: 12 },
      },
      {
        template: 'done-by',
        presets: { yearsEarlier: [1, 2, 5] },
        steps: {},
        first: { template: 'done-by', yearsEarlier: 1 },
      },
      {
        template: 'rate-change',
        presets: { points: [1, 2, -1] },
        steps: {},
        first: { template: 'rate-change', points: 1 },
      },
    ])
    expect(templateOptions(loan(), 1).map((o) => o.template)).toEqual(TEMPLATE_IDS)
  })

  it('works the presets out for a small loan', () => {
    // 3,000 at 9 % over 18 months: A = 178.79, the balance 3,000.
    const small = loan({ principal: 3000, interest_rate: 9, term_months: 18 })
    const options = Object.fromEntries(
      templateOptions(small, 1).map((o) => [o.template, o.presets])
    )
    expect(options['more-each-month']).toEqual({ amount: [10, 20, 25] })
    expect(options['round-up']).toEqual({ target: [180, 200] })
    expect(options['one-payment']).toEqual({ amount: [25, 100, 250], inMonths: [1, 6, 12] })
    expect(options['yearly-bonus']).toEqual({ amount: [200, 250], monthOfYear: MONTHS })
    expect(options['done-by']).toEqual({ yearsEarlier: [1] })
  })

  it('works the presets out for a large loan', () => {
    // 450,000 at 3.8 % over 30 years: A = 2,096.81.
    const large = loan({ principal: 450000, interest_rate: 3.8, term_months: 360 })
    const options = Object.fromEntries(
      templateOptions(large, 1).map((o) => [o.template, o.presets])
    )
    expect(options['more-each-month']).toEqual({ amount: [100, 200, 500] })
    expect(options['round-up']).toEqual({ target: [2200, 2400] })
    expect(options['one-payment']).toEqual({ amount: [5000, 20000, 50000], inMonths: [1, 6, 12] })
    expect(options['yearly-bonus']).toEqual({ amount: [2000, 5000], monthOfYear: MONTHS })
    expect(options['done-by']).toEqual({ yearsEarlier: [1, 2, 5] })
    expect(options['rate-change']).toEqual({ points: [1, 2, -1] })
  })

  it('steps each amount by a share of the loan: small for a monthly extra, large for a one-off', () => {
    const steps = (l: LoanInput) =>
      Object.fromEntries(templateOptions(l, 1).map((o) => [o.template, o.steps]))
    // A = 1,060.66: 5 % of it is 53, a tenth 106; 1 % of the balance is 1,000.
    expect(steps(loan())).toMatchObject({
      'more-each-month': { amount: 50 },
      'round-up': { target: 100 },
      'one-payment': { amount: 1000 },
      'yearly-bonus': { amount: 1000 },
    })
    // 3,000 at 9 % over 18 months: A = 178.79, 1 % of the balance 30.
    expect(steps(loan({ principal: 3000, interest_rate: 9, term_months: 18 }))).toMatchObject({
      'more-each-month': { amount: 10 },
      'round-up': { target: 20 },
      'one-payment': { amount: 25 },
      'yearly-bonus': { amount: 200 },
    })
    // 450,000 at 3.8 % over 30 years: A = 2,096.81, 1 % of the balance 4,500.
    expect(steps(loan({ principal: 450000, interest_rate: 3.8, term_months: 360 }))).toMatchObject({
      'more-each-month': { amount: 100 },
      'round-up': { target: 200 },
      'one-payment': { amount: 5000 },
      'yearly-bonus': { amount: 2000 },
    })
  })

  it('works from the loan as it stands in the month it is seen from', () => {
    // Month 61: half the term gone, 56,204.87 still owed, so a tenth of the balance is 5,620.
    const later = Object.fromEntries(
      templateOptions(loan(), 61).map((o) => [o.template, o.presets])
    )
    expect(balanceAfter(P, RATE, A, 60)).toBeCloseTo(56204.87, 2)
    expect(later['one-payment']).toEqual({ amount: [500, 2500, 5000], inMonths: [1, 6, 12] })
    // Five years earlier would be before month 61.
    expect(later['done-by']).toEqual({ yearsEarlier: [1, 2] })
  })

  it('offers a rate cut only when the rate allows a whole point', () => {
    const low = loan({ interest_rate: 0.75 })
    const rate = templateOptions(low, 1).find((o) => o.template === 'rate-change')
    expect(rate?.presets).toEqual({ points: [1, 2] })
  })

  it('leaves out what cannot happen near the end of a loan', () => {
    // Month 115: six payments left. A payment in 6 or 12 months, a yearly one, or finishing a
    // year earlier would all land after the loan is repaid.
    const options = Object.fromEntries(
      templateOptions(loan(), 115).map((o) => [o.template, o.presets])
    )
    expect(options['one-payment']).toEqual({ amount: expect.any(Array), inMonths: [1] })
    expect(options['yearly-bonus']).toBeUndefined()
    expect(options['extra-installment']).toBeUndefined()
    expect(options['done-by']).toBeUndefined()
    expect(options['more-each-month']).toBeDefined()
  })

  it('offers nothing once the loan is repaid or down to its last payment', () => {
    expect(templateOptions(loan(), 121)).toEqual([])
    expect(templateOptions(loan(), 120)).toEqual([])
    expect(templateOptions(loan({ principal: 0 }), 1)).toEqual([])
  })

  it('takes a mode in every template but done-by, rate-change and round-up', () => {
    expect(TEMPLATE_IDS.filter(templateTakesMode)).toEqual([
      'more-each-month',
      'one-payment',
      'yearly-bonus',
      'extra-installment',
    ])
  })
})

describe('buildWhatIf', () => {
  const run = (
    choice: WhatIfChoice,
    mode: 'shorten' | 'lower' = 'shorten',
    terms = loan(),
    from = 1
  ) => runScenario(applyWhatIf(terms, buildWhatIf(terms, from, choice, mode)), from)
  const plan = runScenario(loan(), 1)

  it('more each month: an extra every month from the month it is seen from', () => {
    expect(buildWhatIf(loan(), 1, { template: 'more-each-month', amount: 50 }, 'lower')).toEqual({
      mode: 'lower',
      once: [],
      every: [{ amount: 50, every_months: 1, from_month: 1 }],
      rate: null,
    })
    const b = run({ template: 'more-each-month', amount: 50 })
    expect(paymentsToRepay(P, RATE, A + 50)).toBe(114)
    expect(b.payoffMonth).toBe(114)
    expect(b.payoffDate).toBe('2035-06-01')
    expect(compareScenarios(plan, b).interestSaved).toBeCloseTo(1668.92, 2)
  })

  it('round up: the difference to the target, to the cent, every month', () => {
    expect(buildWhatIf(loan(), 1, { template: 'round-up', target: 1100 }, 'shorten').every).toEqual(
      [{ amount: 39.34, every_months: 1, from_month: 1 }]
    )
  })

  it('round up: nothing when the target is not above the installment', () => {
    expect(buildWhatIf(loan(), 1, { template: 'round-up', target: 1000 }, 'shorten')).toEqual({
      ...NONE,
    })
  })

  it('one payment: in the month that many payments from now', () => {
    expect(
      buildWhatIf(loan(), 1, { template: 'one-payment', amount: 10000, inMonths: 12 }, 'shorten')
        .once
    ).toEqual([{ month: 12, amount: 10000 }])
    expect(
      buildWhatIf(loan(), 30, { template: 'one-payment', amount: 10000, inMonths: 1 }, 'shorten')
        .once
    ).toEqual([{ month: 30, amount: 10000 }])
  })

  it("one payment: the plan's two figures for 10,000 in month 12", () => {
    const sooner = run({ template: 'one-payment', amount: 10000, inMonths: 12 }, 'shorten')
    expect(sooner.payoffDate).toBe('2034-10-01')
    expect(compareScenarios(plan, sooner).monthsSooner).toBe(14)
    expect(compareScenarios(plan, sooner).interestSaved).toBeCloseTo(5236.32, 2)
    const lower = run({ template: 'one-payment', amount: 10000, inMonths: 12 }, 'lower')
    expect(lower.payoffDate).toBe('2035-12-01')
    expect(
      lower.installmentChanges.map((c) => [c.month, Math.round(c.installment * 100) / 100])
    ).toEqual([[13, 945.48]])
    expect(compareScenarios(plan, lower).interestSaved).toBeCloseTo(2438.66, 2)
  })

  it('yearly bonus: every 12 months from the next month with that name', () => {
    // A loan whose first payment is in January pays its Decembers in months 12, 24, ...
    expect(
      buildWhatIf(loan(), 1, { template: 'yearly-bonus', amount: 1000, monthOfYear: 12 }, 'shorten')
        .every
    ).toEqual([{ amount: 1000, every_months: 12, from_month: 12 }])
    // From March 2026 (month 3 of a loan starting 2026-01-01), the next June is month 6.
    expect(
      buildWhatIf(loan(), 3, { template: 'yearly-bonus', amount: 1000, monthOfYear: 6 }, 'shorten')
        .every
    ).toEqual([{ amount: 1000, every_months: 12, from_month: 6 }])
    // A loan starting 2026-03-15, seen from month 3 (May): December is month 10.
    const march = loan({ start_date: '2026-03-15' })
    expect(
      buildWhatIf(march, 3, { template: 'yearly-bonus', amount: 1000, monthOfYear: 12 }, 'shorten')
        .every
    ).toEqual([{ amount: 1000, every_months: 12, from_month: 10 }])
    // The month it is seen from counts when it is that month.
    expect(
      buildWhatIf(
        loan(),
        12,
        { template: 'yearly-bonus', amount: 1000, monthOfYear: 12 },
        'shorten'
      ).every[0].from_month
    ).toBe(12)
  })

  it('yearly bonus: by month numbers when the start date cannot be read', () => {
    // Month 12 of each year of the loan stands in for December.
    const undated = loan({ start_date: '' })
    expect(
      buildWhatIf(
        undated,
        1,
        { template: 'yearly-bonus', amount: 1000, monthOfYear: 12 },
        'shorten'
      ).every[0].from_month
    ).toBe(12)
    expect(
      buildWhatIf(
        undated,
        13,
        { template: 'yearly-bonus', amount: 1000, monthOfYear: 12 },
        'shorten'
      ).every[0].from_month
    ).toBe(24)
  })

  it('one extra installment a year: the installment, to the cent', () => {
    expect(
      buildWhatIf(loan(), 1, { template: 'extra-installment', monthOfYear: 12 }, 'lower')
    ).toEqual({
      mode: 'lower',
      once: [],
      every: [{ amount: 1060.66, every_months: 12, from_month: 12 }],
      rate: null,
    })
  })

  it('done by a date: the smallest monthly extra, always finishing sooner', () => {
    const whatIf = buildWhatIf(loan(), 1, { template: 'done-by', yearsEarlier: 1 }, 'lower')
    expect(whatIf).toEqual({
      mode: 'shorten',
      once: [],
      every: [{ amount: 92, every_months: 1, from_month: 1 }],
      rate: null,
    })
    expect(run({ template: 'done-by', yearsEarlier: 2 }).payoffMonth).toBeLessThanOrEqual(96)
    expect(run({ template: 'done-by', yearsEarlier: 5 }).payoffMonth).toBeLessThanOrEqual(60)
  })

  it('rate change: from the month it is seen from, mode or not', () => {
    expect(buildWhatIf(loan(), 7, { template: 'rate-change', points: -1 }, 'lower')).toEqual({
      ...NONE,
      rate: { from_month: 7, points: -1 },
    })
  })

  it('compares both modes from one choice', () => {
    const choice: WhatIfChoice = { template: 'one-payment', amount: 10000, inMonths: 12 }
    const sooner = run(choice, 'shorten')
    const lower = run(choice, 'lower')
    // The trade-off in numbers: 2,797.66 more interest saved, or 115.17 less to pay each month.
    expect(compareScenarios(lower, sooner).interestSaved).toBeCloseTo(5236.32 - 2438.66, 2)
    expect(A - lower.installmentChanges[0].installment).toBeCloseTo(115.17, 2)
  })
})

// ── Performance ──────────────────────────────────────────────────────────────

describe('speed', () => {
  it('compares two 360-month scenarios in well under 50 ms', () => {
    // A 30-year loan with saved extra payments and rate periods, against a yearly bonus that pays
    // less each month plus a rate rise, with the templates offered on the way, as the page does.
    const thirty = loan({
      principal: 320000,
      interest_rate: 3.9,
      term_months: 360,
      rate_periods: [
        { rate: 4.6, start_month: 61, end_month: 120 },
        { rate: 3.2, start_month: 200 },
      ],
      prepayments: [
        { month: 18, amount: 5000 },
        { month: 40, amount: 2500 },
      ],
    })
    const compare = () => {
      const options = templateOptions(thirty, 1)
      const a = runScenario(thirty, 1)
      const bonus = buildWhatIf(thirty, 1, options[3].first, 'lower')
      const b = runScenario(
        applyWhatIf(thirty, { ...bonus, rate: { from_month: 13, points: 1 } }),
        1
      )
      return compareScenarios(a, b)
    }
    expect(compare().interestSaved).not.toBeNull()
    const times: number[] = []
    for (let i = 0; i < 25; i++) {
      const t0 = window.performance.now()
      compare()
      times.push(window.performance.now() - t0)
    }
    times.sort((x, y) => x - y)
    // 0.16 ms measured (median of 200 runs). The median keeps one slow run on a loaded machine
    // from deciding it.
    expect(times[12]).toBeLessThan(50)
  })

  it('solves done-by on a 360-month loan in well under 50 ms', () => {
    const thirty = loan({ principal: 320000, interest_rate: 3.9, term_months: 360 })
    const times: number[] = []
    for (let i = 0; i < 15; i++) {
      const t0 = window.performance.now()
      buildWhatIf(thirty, 1, { template: 'done-by', yearsEarlier: 5 }, 'shorten')
      times.push(window.performance.now() - t0)
    }
    times.sort((x, y) => x - y)
    expect(times[7]).toBeLessThan(50)
  })
})

describe('amortizeLoan through the scenarios', () => {
  it('runs a what-if exactly as the engine runs the same loan written out', () => {
    const choice: WhatIfChoice = { template: 'yearly-bonus', amount: 2000, monthOfYear: 12 }
    const whatIf = buildWhatIf(loan(), 1, choice, 'lower')
    expect(amortizeLoan(applyWhatIf(loan(), whatIf)).rows).toEqual(
      amortize(
        loan({
          extra_rules: [{ amount: 2000, every_months: 12, from_month: 12, mode: 'lower' }],
        })
      )
    )
  })
})

describe('stepAmount', () => {
  it('moves to the next whole multiple of the step', () => {
    expect(stepAmount(1000, 1000, 1)).toBe(2000)
    expect(stepAmount(1234, 1000, 1)).toBe(2000)
    expect(stepAmount(1234, 1000, -1)).toBe(1000)
    expect(stepAmount(3000, 1000, -1)).toBe(2000)
    expect(stepAmount(3000, 2500, 1)).toBe(5000)
    expect(stepAmount(3000, 2500, -1)).toBe(2500)
  })

  it('never goes below one step, or below the floor it is given', () => {
    expect(stepAmount(1000, 1000, -1)).toBe(1000)
    expect(stepAmount(400, 1000, -1)).toBe(1000)
    // Round up stops at the first target that pays anything more.
    expect(stepAmount(1100, 100, -1, 1100)).toBe(1100)
    expect(stepAmount(1150, 100, -1, 1100)).toBe(1100)
    expect(stepAmount(1150, 100, 1, 1100)).toBe(1200)
  })
})
