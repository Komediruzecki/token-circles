/**
 * Tests for what shared/loanSchedule.ts gained for the loan scenarios (plan 03, part 1): the two
 * extra-payment modes, repeating extra payments, the rate-change option, and loans that are
 * never repaid.
 *
 * As in loanSchedule.test.ts, expected numbers come from closed forms, never from the engine's
 * own output. With r = annual % / 100 / 12:
 *
 *   installment          A   = P r (1+r)^n / ((1+r)^n - 1)
 *   balance after k      B_k = P (1+r)^k - A ((1+r)^k - 1) / r
 *   installments to pay  n   = ceil(-ln(1 - r B / A) / ln(1 + r)), to repay B at A a month
 *
 * The example loan: 100,000 at 5 % over 120 months from 2026-01-01, A = 1,060.66. With 10,000
 * paid in month 12 (closed forms, checked separately in Python with 50-digit decimals):
 *
 *   finish sooner        106 payments, the last on 2034-10-01 for 673.51, 5,236.32 less interest
 *   pay less each month  945.48 a month from month 13, still 120 payments, 2,438.66 less interest
 *
 * Plan 03 drafted the second as "about 945.42"; the closed form is 945.48.
 *
 * Every loan in loanSchedule.test.ts leaves the new fields out, and those tests pass unchanged:
 * that is the proof that a loan without them gets exactly the schedule it got before.
 */
import { describe, expect, it } from 'vitest'
import {
  amortize,
  amortizeLoan,
  annuityPayment,
  calculateLoan,
  MAX_TERM_MONTHS,
} from '../../../../shared/loanSchedule'
import type { LoanInput, ScheduleRow } from '../../../../shared/loanSchedule'

// The engine does no Date arithmetic; run west of UTC anyway, as the engine's own tests do.
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

function installmentsFor(B: number, pct: number, A: number): number {
  const r = monthlyRate(pct)
  return Math.ceil(r === 0 ? B / A : -Math.log(1 - (r * B) / A) / Math.log(1 + r))
}

const sum = (rows: ScheduleRow[], pick: (r: ScheduleRow) => number) =>
  rows.reduce((s, r) => s + pick(r), 0)
const interestOf = (rows: ScheduleRow[]) => sum(rows, (r) => r.interest)

// ── The example loan ─────────────────────────────────────────────────────────

const P = 100_000
const RATE = 5
const N = 120
const A = annuity(P, RATE, N)
const PLAIN_INTEREST = N * A - P

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

it('runs west of UTC', () => {
  expect(new Date('2026-07-01T00:00:00Z').getTimezoneOffset()).not.toBe(0)
})

// ── Extra-payment modes ──────────────────────────────────────────────────────

describe('extra-payment modes', () => {
  it('finishes sooner by default, as a saved extra payment always has', () => {
    const plain = amortize(loan({ prepayments: [{ month: 12, amount: 10000 }] }))
    expect(
      amortize(loan({ prepayments: [{ month: 12, amount: 10000, mode: 'shorten' }] }))
    ).toEqual(plain)
    expect(plain).toHaveLength(106)
    expect(plain[105].date).toBe('2034-10-01')
    expect(plain[105].payment).toBeCloseTo(673.51, 2)
    expect(PLAIN_INTEREST - interestOf(plain)).toBeCloseTo(5236.32, 2)
  })

  it('pays less each month in lower mode, and keeps the end date', () => {
    // After month 12, B_12 - 10,000 is spread over the 108 months left: A' = 945.48.
    const s = amortize(loan({ prepayments: [{ month: 12, amount: 10000, mode: 'lower' }] }))
    const after12 = balanceAfter(P, RATE, A, 12) - 10000
    const A2 = annuity(after12, RATE, 108)
    expect(A2).toBeCloseTo(945.48, 2)
    expect(s).toHaveLength(N)
    expect(s[N - 1].date).toBe('2035-12-01')
    expect(s[11].payment).toBeCloseTo(A, 6)
    expect(s[11].prepayment).toBe(10000)
    for (let k = 13; k <= N; k++) {
      expect(s[k - 1].payment).toBeCloseTo(A2, 6)
      expect(s[k - 1].balance).toBeCloseTo(balanceAfter(after12, RATE, A2, k - 12), 5)
    }
    expect(s[N - 1].balance).toBe(0)
    // Twelve installments of A, the extra, and 108 of A' repay P.
    expect(interestOf(s)).toBeCloseTo(12 * A + 10000 + 108 * A2 - P, 6)
    expect(PLAIN_INTEREST - interestOf(s)).toBeCloseTo(2438.66, 2)
  })

  it('lowers the installment again at a second extra payment, still to the same end date', () => {
    const s = amortize(
      loan({
        prepayments: [
          { month: 12, amount: 10000, mode: 'lower' },
          { month: 24, amount: 5000, mode: 'lower' },
        ],
      })
    )
    const after12 = balanceAfter(P, RATE, A, 12) - 10000
    const A2 = annuity(after12, RATE, 108)
    const after24 = balanceAfter(after12, RATE, A2, 12) - 5000
    const A3 = annuity(after24, RATE, 96)
    expect(s).toHaveLength(N)
    expect(s[23].payment).toBeCloseTo(A2, 6)
    expect(s[24].payment).toBeCloseTo(A3, 6)
    expect(s[N - 1].payment).toBeCloseTo(A3, 6)
  })

  it('reads any mode other than lower as finish sooner', () => {
    const plain = amortize(loan({ prepayments: [{ month: 12, amount: 10000 }] }))
    for (const mode of [null, undefined, 'faster', ''] as const) {
      expect(
        amortize(loan({ prepayments: [{ month: 12, amount: 10000, mode: mode as never }] }))
      ).toEqual(plain)
    }
  })

  it('applies finish-sooner extras first, then pay-less ones against the new end month', () => {
    // 5,000 of each in month 12, the lower one listed first. Shorten first: B' = B_12 - 5,000
    // ends at month 12 + n(B'). Then lower: B'' = B' - 5,000 spread over the months to that end.
    const s = amortize(
      loan({
        prepayments: [
          { month: 12, amount: 5000, mode: 'lower', note: 'lower' },
          { month: 12, amount: 5000, mode: 'shorten', note: 'sooner' },
        ],
      })
    )
    const afterShorten = balanceAfter(P, RATE, A, 12) - 5000
    const end = 12 + installmentsFor(afterShorten, RATE, A)
    const afterLower = afterShorten - 5000
    const A2 = annuity(afterLower, RATE, end - 12)
    expect(end).toBe(113)
    expect(s).toHaveLength(end)
    expect(s[11].prepayment).toBe(10000)
    expect(s[11].balance).toBeCloseTo(afterLower, 6)
    expect(s[11].note).toBe('lower; sooner')
    expect(s[12].payment).toBeCloseTo(A2, 6)
    expect(s[end - 1].payment).toBeCloseTo(A2, 6)
    expect(s[end - 1].balance).toBe(0)
  })

  it('stops at what is owed when a pay-less extra is larger than the balance', () => {
    const owed = balanceAfter(P, RATE, A, 118)
    const s = amortize(loan({ prepayments: [{ month: 118, amount: 50000, mode: 'lower' }] }))
    expect(s).toHaveLength(118)
    expect(s[117].prepayment).toBeCloseTo(owed, 6)
    expect(s[117].balance).toBe(0)
  })
})

// ── Repeating extra payments ─────────────────────────────────────────────────

describe('repeating extra payments', () => {
  /** The extra payments a rule makes, listed one by one: what the rule must equal. */
  function expand(
    amount: number,
    every: number,
    from: number,
    to: number,
    mode?: 'shorten' | 'lower'
  ) {
    const list = []
    for (let m = from; m <= to; m += every) list.push({ month: m, amount, mode })
    return list
  }

  it('pays every month: the same as an installment that much larger', () => {
    // 50 extra from month 1 repays at A + 50 a month: 114 payments, the last on 2035-06-01,
    // 1,668.92 less interest. The last month's 50 is not needed: what is owed is under A.
    const s = amortize(loan({ extra_rules: [{ amount: 50, every_months: 1, from_month: 1 }] }))
    const n = installmentsFor(P, RATE, A + 50)
    expect(n).toBe(114)
    expect(s).toHaveLength(114)
    expect(s[113].date).toBe('2035-06-01')
    s.slice(0, -1).forEach((row, i) => {
      expect(row.payment).toBeCloseTo(A, 6)
      expect(row.prepayment).toBe(50)
      expect(row.balance).toBeCloseTo(balanceAfter(P, RATE, A + 50, i + 1), 5)
    })
    expect(s[113].prepayment).toBe(0)
    expect(PLAIN_INTEREST - interestOf(s)).toBeCloseTo(1668.92, 2)
  })

  it('pays every 3 months up to its last month, exactly as the payments listed one by one', () => {
    const rule = amortize(
      loan({ extra_rules: [{ amount: 500, every_months: 3, from_month: 3, to_month: 24 }] })
    )
    const listed = amortize(loan({ prepayments: expand(500, 3, 3, 24) }))
    expect(rule).toEqual(listed)
    expect(rule.filter((r) => r.prepayment > 0).map((r) => r.month)).toEqual([
      3, 6, 9, 12, 15, 18, 21, 24,
    ])
  })

  it('pays every 12 months until the loan is repaid when it has no last month', () => {
    const rule = amortize(
      loan({ extra_rules: [{ amount: 2000, every_months: 12, from_month: 12, note: 'bonus' }] })
    )
    const listed = amortize(
      loan({
        prepayments: expand(2000, 12, 12, N).map((p) => ({ ...p, note: 'bonus' })),
      })
    )
    expect(rule).toEqual(listed)
    expect(rule.filter((r) => r.prepayment > 0).every((r) => r.note === 'bonus')).toBe(true)
  })

  it('pays every 12 months up to its last month', () => {
    const s = amortize(
      loan({ extra_rules: [{ amount: 2000, every_months: 12, from_month: 12, to_month: 36 }] })
    )
    expect(s.filter((r) => r.prepayment > 0).map((r) => r.month)).toEqual([12, 24, 36])
  })

  it('keeps its mode: a pay-less rule is the same as pay-less payments listed one by one', () => {
    const rule = amortize(
      loan({
        extra_rules: [{ amount: 1000, every_months: 12, from_month: 12, mode: 'lower' }],
      })
    )
    const listed = amortize(loan({ prepayments: expand(1000, 12, 12, N, 'lower') }))
    expect(rule).toEqual(listed)
    expect(rule).toHaveLength(N)
  })

  it('adds a rule to the extra payments of the same month', () => {
    const both = amortize(
      loan({
        prepayments: [{ month: 12, amount: 3000, note: 'gift' }],
        extra_rules: [{ amount: 1000, every_months: 12, from_month: 12, to_month: 12 }],
      })
    )
    const one = amortize(loan({ prepayments: [{ month: 12, amount: 4000 }] }))
    expect(both[11].prepayment).toBe(4000)
    expect(both[11].note).toBe('gift')
    expect(both.map((r) => r.balance)).toEqual(one.map((r) => r.balance))
  })

  it('ignores a rule whose months are not whole numbers of at least 1, or whose amount is not positive', () => {
    const plain = amortize(loan())
    for (const rule of [
      { amount: 500, every_months: 0, from_month: 1 },
      { amount: 500, every_months: 1.5, from_month: 1 },
      { amount: 500, every_months: -3, from_month: 1 },
      { amount: 500, every_months: 3, from_month: 0 },
      { amount: 500, every_months: 3, from_month: 2.5 },
      { amount: 500, every_months: 3, from_month: 3, to_month: 0 },
      { amount: 500, every_months: 3, from_month: 3, to_month: 7.5 },
      { amount: 0, every_months: 3, from_month: 3 },
      { amount: -500, every_months: 3, from_month: 3 },
      { amount: Number.NaN, every_months: 3, from_month: 3 },
      { amount: Infinity, every_months: 3, from_month: 3 },
      { amount: 500, every_months: Number.NaN, from_month: 3 },
    ]) {
      expect(amortize(loan({ extra_rules: [rule] })), JSON.stringify(rule)).toEqual(plain)
    }
  })

  it('pays nothing when the last month comes before the first', () => {
    expect(
      amortize(
        loan({ extra_rules: [{ amount: 500, every_months: 1, from_month: 30, to_month: 20 }] })
      )
    ).toEqual(amortize(loan()))
  })

  it('measures interest saved against the loan with neither extra payments nor rules', () => {
    const { summary, comparison } = calculateLoan(
      loan({ extra_rules: [{ amount: 50, every_months: 1, from_month: 1 }] })
    )
    expect(summary.originalTotalPayments).toBe(N)
    expect(summary.monthsSaved).toBe(N - 114)
    expect(summary.interestSaved).toBeCloseTo(1668.92, 2)
    expect(comparison.withoutPrepayments.totalPayments).toBe(N)
  })
})

// ── The rate-change option ───────────────────────────────────────────────────

describe('what a rate change keeps', () => {
  it('keeps the end date by default: the installment is recomputed', () => {
    const terms = loan({ rate_periods: [{ rate: 8, start_month: 13 }] })
    expect(amortize({ ...terms, on_rate_change: 'keep-term' })).toEqual(amortize(terms))
    expect(amortize(terms)[12].payment).toBeCloseTo(1198.93, 2)
  })

  it('keeps the installment and moves the end date when asked to', () => {
    // 5 % to 8 % from month 13 at the same A: B_12 takes n(B_12, 8 %, A) more installments.
    const s = amortize(
      loan({ rate_periods: [{ rate: 8, start_month: 13 }], on_rate_change: 'keep-installment' })
    )
    const B12 = balanceAfter(P, RATE, A, 12)
    const left = installmentsFor(B12, 8, A)
    expect(12 + left).toBe(143)
    expect(s).toHaveLength(143)
    for (const row of s.slice(0, -1)) expect(row.payment).toBeCloseTo(A, 6)
    // Months 13 to 142 are 130 installments of A; month 143 pays what is left, 151.65 with interest.
    expect(s[141].balance).toBeCloseTo(balanceAfter(B12, 8, A, 130), 5)
    expect(s[142].payment).toBeCloseTo(balanceAfter(B12, 8, A, 130) * (1 + monthlyRate(8)), 6)
    expect(s[142].balance).toBe(0)
    expect(s[142].date).toBe('2037-11-01')
  })

  it('ends sooner at the same installment when the rate falls', () => {
    const s = amortize(
      loan({ rate_periods: [{ rate: 3, start_month: 13 }], on_rate_change: 'keep-installment' })
    )
    const B12 = balanceAfter(P, RATE, A, 12)
    expect(s).toHaveLength(12 + installmentsFor(B12, 3, A))
    expect(s.length).toBeLessThan(N)
  })

  it('sets the first installment from the rate of month 1 under either option', () => {
    const periods = [{ rate: 4, start_month: 1 }]
    expect(amortize(loan({ rate_periods: periods, on_rate_change: 'keep-installment' }))).toEqual(
      amortize(loan({ rate_periods: periods }))
    )
  })

  it('can charge more interest for a pay-less extra payment that a rate rise then keeps', () => {
    // Found by the random invariants (seed 20261008): 86,801 over 12 months at 6.64 %, 0 % from
    // month 4 and 7.71 % from month 10, with pay-less extras every 3 months. Each extra spreads
    // what is owed over the months left to the end month, at 0 %, slack of the partial last month
    // included, so the installment falls by more than the extra repays. Keeping that installment
    // at 7.71 % leaves more owed in month 10 than without the extras, and a 13th month to pay it.
    // That is what keeping the installment means; under keep-term the same extras save interest.
    const terms: LoanInput = {
      principal: 86801,
      interest_rate: 6.64,
      start_date: '2027-09-28',
      term_months: 12,
      rate_periods: [
        { rate: 0, start_month: 4 },
        { rate: 7.71, start_month: 10 },
      ],
      extra_rules: [
        { amount: 895.83, every_months: 3, from_month: 8, to_month: 23, mode: 'lower' },
        { amount: 651.82, every_months: 3, from_month: 2, mode: 'lower' },
      ],
      on_rate_change: 'keep-installment',
    }
    const kept = amortizeLoan(terms).rows
    const without = amortizeLoan({ ...terms, extra_rules: [] }).rows
    expect(kept[9].balance).toBeGreaterThan(without[9].balance)
    expect(kept).toHaveLength(13)
    expect(without).toHaveLength(12)
    expect(interestOf(kept)).toBeGreaterThan(interestOf(without))

    const recomputed = amortizeLoan({ ...terms, on_rate_change: 'keep-term' }).rows
    const recomputedWithout = amortizeLoan({
      ...terms,
      on_rate_change: 'keep-term',
      extra_rules: [],
    }).rows
    expect(recomputed).toHaveLength(12)
    expect(interestOf(recomputed)).toBeLessThan(interestOf(recomputedWithout))
  })

  it('keeps the installment that a pay-less extra payment set', () => {
    // Lower first (A' from month 13), then 8 % from month 25 at A'.
    const s = amortize(
      loan({
        prepayments: [{ month: 12, amount: 10000, mode: 'lower' }],
        rate_periods: [{ rate: 8, start_month: 25 }],
        on_rate_change: 'keep-installment',
      })
    )
    const after12 = balanceAfter(P, RATE, A, 12) - 10000
    const A2 = annuity(after12, RATE, 108)
    const B24 = balanceAfter(after12, RATE, A2, 12)
    expect(s[24].payment).toBeCloseTo(A2, 6)
    expect(s).toHaveLength(24 + installmentsFor(B24, 8, A2))
  })
})

// ── Loans that are never repaid ──────────────────────────────────────────────

describe('a loan that is never repaid', () => {
  // 100,000 at 5 % over 30 years: A = 536.82, which 15 % interest on the balance outgrows.
  const thirty = (over: Partial<LoanInput> = {}) => loan({ term_months: 360, ...over })
  const A30 = annuity(P, RATE, 360)

  it('says so from the month the installment stops covering the interest, and stops there', () => {
    const result = amortizeLoan(
      thirty({ rate_periods: [{ rate: 15, start_month: 13 }], on_rate_change: 'keep-installment' })
    )
    expect(balanceAfter(P, RATE, A30, 12) * monthlyRate(15)).toBeGreaterThan(A30)
    expect(result.neverPaysOffFrom).toBe(13)
    expect(result.rows).toHaveLength(12)
    expect(result.rows[11].balance).toBeCloseTo(balanceAfter(P, RATE, A30, 12), 5)
  })

  it('says so when the loan would run past the longest term the engine amortises', () => {
    // A rate at which A still covers the interest, but only just: 99.99 % of it goes to interest,
    // so repaying B_12 takes ln(10,000) / ln(1 + r) months, more than MAX_TERM_MONTHS.
    const B12 = balanceAfter(P, RATE, A30, 12)
    const rate = ((0.9999 * A30) / B12) * 1200
    expect(12 + installmentsFor(B12, rate, A30)).toBeGreaterThan(MAX_TERM_MONTHS)
    const result = amortizeLoan(
      thirty({ rate_periods: [{ rate, start_month: 13 }], on_rate_change: 'keep-installment' })
    )
    expect(result.neverPaysOffFrom).toBe(13)
    expect(result.rows).toHaveLength(12)
  })

  it('is repaid after all when a later rate change brings the interest back under the installment', () => {
    // 15 % for months 13-24 only: the balance grows for a year, then 5 % repays it at A.
    const result = amortizeLoan(
      thirty({
        rate_periods: [{ rate: 15, start_month: 13, end_month: 24 }],
        on_rate_change: 'keep-installment',
      })
    )
    const B12 = balanceAfter(P, RATE, A30, 12)
    const B24 = balanceAfter(B12, 15, A30, 12)
    expect(B24).toBeGreaterThan(B12)
    expect(result.neverPaysOffFrom).toBeNull()
    expect(result.rows[23].balance).toBeCloseTo(B24, 4)
    expect(result.rows).toHaveLength(24 + installmentsFor(B24, RATE, A30))
    expect(result.rows[result.rows.length - 1].balance).toBe(0)
  })

  it('is repaid after all when an extra payment brings the balance back within reach', () => {
    const result = amortizeLoan(
      thirty({
        rate_periods: [{ rate: 15, start_month: 13 }],
        prepayments: [{ month: 20, amount: 80000 }],
        on_rate_change: 'keep-installment',
      })
    )
    expect(result.neverPaysOffFrom).toBeNull()
    expect(result.rows[result.rows.length - 1].balance).toBe(0)
  })

  it('cannot happen when a rate change keeps the end date', () => {
    const result = amortizeLoan(thirty({ rate_periods: [{ rate: 15, start_month: 13 }] }))
    expect(result.neverPaysOffFrom).toBeNull()
    expect(result.rows).toHaveLength(360)
  })

  it('leaves amortize as the rows of amortizeLoan', () => {
    for (const terms of [
      loan(),
      loan({ prepayments: [{ month: 12, amount: 10000, mode: 'lower' }] }),
      thirty({ rate_periods: [{ rate: 15, start_month: 13 }], on_rate_change: 'keep-installment' }),
    ]) {
      expect(amortize(terms)).toEqual(amortizeLoan(terms).rows)
    }
    expect(amortizeLoan(loan()).neverPaysOffFrom).toBeNull()
  })
})

// ── Invariants over random loans with the new fields ─────────────────────────

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

type Mode = 'shorten' | 'lower'

/** A random loan with extra payments in either mode, rules, and either rate-change option. */
function randomLoan(next: () => number, modes: Mode[]): LoanInput {
  const int = (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1))
  const pick = <T>(xs: readonly T[]): T => xs[int(0, xs.length - 1)]
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
    amount: Math.round(next() * principal * 0.3 * 100) / 100,
    mode: pick(modes),
  }))
  if (extras.length > 0 && next() < 0.3) extras.push({ ...extras[0], mode: pick(modes) })
  const rules = Array.from({ length: int(0, 2) }, () => {
    const from = int(1, term)
    return {
      amount: Math.round(next() * principal * 0.02 * 100) / 100 + 1,
      every_months: pick([1, 3, 6, 12, int(1, 24)]),
      from_month: from,
      to_month: next() < 0.5 ? null : int(from, term + 12),
      mode: pick(modes),
    }
  })
  const day = pick([1, 15, 28, 29, 30, 31])
  return {
    principal,
    interest_rate: rate,
    start_date: `${int(2000, 2040)}-${String(int(1, 12)).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    term_months: term,
    rate_periods: periods,
    prepayments: extras,
    extra_rules: rules,
    on_rate_change: next() < 0.25 ? 'keep-installment' : 'keep-term',
  }
}

function daysIn(y: number, m: number): number {
  if (m !== 2) return [4, 6, 9, 11].includes(m) ? 30 : 31
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28
}

describe('invariants over 400 seeded random loans with both modes and repeating extras', () => {
  const next = prng(20261008)
  const loans = Array.from({ length: 400 }, () => randomLoan(next, ['shorten', 'lower']))

  it('covers what the invariants are about, so none of them holds vacuously', () => {
    let lower = 0
    let rules = 0
    let keepInstallment = 0
    let mixedMonths = 0
    let never = 0
    for (const l of loans) {
      const { rows, neverPaysOffFrom } = amortizeLoan(l)
      if (
        rows.some((r) => r.prepayment > 0) &&
        (l.prepayments ?? []).some((p) => p.mode === 'lower')
      )
        lower++
      if ((l.extra_rules ?? []).length > 0 && rows.some((r) => r.prepayment > 0)) rules++
      if (
        l.on_rate_change === 'keep-installment' &&
        rows.some((r, i) => i > 0 && r.rate !== rows[i - 1].rate)
      )
        keepInstallment++
      const byMonth = new Map<number, Set<string>>()
      for (const p of l.prepayments ?? []) {
        const set = byMonth.get(p.month) ?? new Set()
        set.add(p.mode ?? 'shorten')
        byMonth.set(p.month, set)
      }
      if ([...byMonth.values()].some((s) => s.size > 1)) mixedMonths++
      if (neverPaysOffFrom !== null) never++
    }
    expect(lower).toBeGreaterThan(50)
    expect(rules).toBeGreaterThan(100)
    expect(keepInstallment).toBeGreaterThan(20)
    expect(mixedMonths).toBeGreaterThan(5)
    expect(never).toBeGreaterThan(0)
  })

  it('never shows a negative balance, and a loan that is repaid ends at exactly zero', () => {
    for (const l of loans) {
      const { rows, neverPaysOffFrom } = amortizeLoan(l)
      expect(rows.every((r) => r.balance >= 0 && r.prepayment >= 0)).toBe(true)
      if (neverPaysOffFrom === null) {
        expect(rows.length).toBeGreaterThan(0)
        expect(rows[rows.length - 1].balance).toBe(0)
      } else {
        expect(rows.length).toBe(neverPaysOffFrom - 1)
      }
    }
  })

  it('repays exactly the principal, with principal and extras together, to the cent', () => {
    for (const l of loans) {
      const { rows, neverPaysOffFrom } = amortizeLoan(l)
      if (neverPaysOffFrom !== null) continue
      const repaid = sum(rows, (r) => r.principal + r.prepayment)
      expect(Math.abs(repaid - l.principal)).toBeLessThan(0.005)
      const { summary } = calculateLoan(l)
      expect(Math.abs(summary.totalPaid - (l.principal + summary.totalInterest))).toBeLessThan(
        0.005
      )
    }
  })

  it('steps the dates by exactly one calendar month, on the start day or the month end', () => {
    for (const l of loans) {
      const startDay = Number(l.start_date.slice(8, 10))
      const { rows } = amortizeLoan(l)
      rows.forEach((row, i) => {
        const [y, m, d] = row.date.split('-').map(Number)
        if (i > 0) {
          const [py, pm] = rows[i - 1].date.split('-').map(Number)
          expect(y * 12 + m - (py * 12 + pm)).toBe(1)
        }
        expect(d).toBe(Math.min(startDay, daysIn(y, m)))
      })
    }
  })

  it('never charges more interest for an extra payment, unless it pays less under keep-installment', () => {
    // The exception has a test of its own, under "what a rate change keeps".
    let checked = 0
    for (const l of loans) {
      const paysLess =
        (l.prepayments ?? []).some((p) => p.mode === 'lower') ||
        (l.extra_rules ?? []).some((r) => r.mode === 'lower')
      if (l.on_rate_change === 'keep-installment' && paysLess) continue
      const withExtras = amortizeLoan(l)
      const without = amortizeLoan({ ...l, prepayments: [], extra_rules: [] })
      if (withExtras.neverPaysOffFrom !== null || without.neverPaysOffFrom !== null) continue
      expect(interestOf(withExtras.rows)).toBeLessThan(
        interestOf(without.rows) + l.principal * 1e-9
      )
      expect(withExtras.rows.length).toBeLessThanOrEqual(without.rows.length)
      checked++
    }
    expect(checked).toBeGreaterThan(300)
  })
})

describe('invariants of each mode on its own', () => {
  it('keeps the installment constant between rate changes when every extra finishes sooner', () => {
    const next = prng(1)
    for (let i = 0; i < 300; i++) {
      const l = randomLoan(next, ['shorten'])
      const { rows } = amortizeLoan(l)
      for (let k = 1; k < rows.length - 1; k++) {
        if (rows[k].rate === rows[k - 1].rate) expect(rows[k].payment).toBe(rows[k - 1].payment)
      }
    }
  })

  it('never moves the end date when every extra pays less each month and a rate change keeps it', () => {
    const next = prng(2)
    let checked = 0
    for (let i = 0; i < 300; i++) {
      const l = { ...randomLoan(next, ['lower']), on_rate_change: 'keep-term' as const }
      const { rows } = amortizeLoan(l)
      const last = rows[rows.length - 1]
      // Only an extra payment that clears the balance can end the loan before its term.
      if (last.prepayment > 0) continue
      expect(rows).toHaveLength(l.term_months)
      checked++
    }
    expect(checked).toBeGreaterThan(150)
  })
})

describe('annuityPayment over infinitely many months', () => {
  it('is the interest alone, which never repays anything', () => {
    // Used when a pay-less extra lands on a loan that will never be repaid.
    expect(annuityPayment(1000, 12, Infinity)).toBeCloseTo(10, 9)
  })
})
