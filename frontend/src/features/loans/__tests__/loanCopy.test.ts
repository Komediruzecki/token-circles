/**
 * The sentence under a comparison says what the numbers say, in both modes.
 *
 * The facts come from the shared engine, as on the page; the expected figures are the plan's,
 * checked with closed forms in shared/loanScenarios' tests: 10,000 in month 12 of 100,000 at 5 %
 * over 120 months finishes on 2034-10-01 with 5,236.32 less interest, or lowers the installment
 * from 1,060.66 to 945.48 from month 13 and saves 2,438.66.
 */
import { describe, expect, it } from 'vitest'
import { applyWhatIf, buildWhatIf, runScenario } from '../../../../../shared/loanScenarios'
import {
  bothModesSentence,
  choiceTitle,
  compareSentence,
  differenceLine,
  formatsFor,
  monthLong,
  monthShort,
  span,
} from '../loanCopy'
import type { WhatIfChoice } from '../../../../../shared/loanScenarios'
import type { LoanInput } from '../../../../../shared/loanSchedule'

const f = formatsFor('EUR')

const LOAN: LoanInput = {
  principal: 100000,
  interest_rate: 5,
  start_date: '2026-01-01',
  term_months: 120,
  rate_periods: [],
  prepayments: [],
}

const TEN_K: WhatIfChoice = { template: 'one-payment', amount: 10000, inMonths: 12 }

function facts(choice: WhatIfChoice | null, mode: 'shorten' | 'lower', loan = LOAN, from = 1) {
  const plan = runScenario(loan, from)
  const b = choice
    ? runScenario(applyWhatIf(loan, buildWhatIf(loan, from, choice, mode)), from)
    : plan
  return { plan, b }
}

describe('compareSentence', () => {
  it('finish sooner: what it costs, and when the loan is done', () => {
    const { plan, b } = facts(TEN_K, 'shorten')
    expect(compareSentence({ a: plan, b, from: 1, aIsPlan: true }, f)).toBe(
      'You pay €10,000 extra and €5,236 less interest. Done in October 2034, 14 months sooner.'
    )
  })

  it('pay less each month: what it costs, and what the installment becomes', () => {
    const { plan, b } = facts(TEN_K, 'lower')
    expect(compareSentence({ a: plan, b, from: 1, aIsPlan: true }, f)).toBe(
      'You pay €10,000 extra and €2,439 less interest. From January 2027 the installment is €945.48 instead of €1,060.66.'
    )
  })

  it('pay less each month, every month: the installment keeps falling, to where it ends', () => {
    const { plan, b } = facts({ template: 'more-each-month', amount: 50 }, 'lower')
    const sentence = compareSentence({ a: plan, b, from: 1, aIsPlan: true }, f)
    // 119 installments of their own, each lower than the last: month 119 is November 2035.
    expect(b.installmentChanges).toHaveLength(118)
    expect(sentence).toBe(
      `You pay ${f.wholeMoney(b.totalExtra)} extra and ${f.wholeMoney(plan.totalInterest - b.totalInterest)} less interest. ` +
        `From February 2026 the installment falls with each extra payment, to ${f.money(b.rows[118].payment)} by November 2035.`
    )
  })

  it('a rate change: more interest, and the new installment from the next payment', () => {
    const { plan, b } = facts({ template: 'rate-change', points: 1 }, 'shorten')
    const r = 0.06 / 12
    const A6 = (100000 * r * (1 + r) ** 120) / ((1 + r) ** 120 - 1)
    expect(b.installmentNow).toBeCloseTo(A6, 9)
    expect(compareSentence({ a: plan, b, from: 1, aIsPlan: true }, f)).toBe(
      `You pay ${f.wholeMoney(b.totalInterest - plan.totalInterest)} more interest. ` +
        `From January 2026 the installment is ${f.money(A6)} instead of €1,060.66.`
    )
    expect(f.money(A6)).toBe('€1,110.21')
  })

  it('a pinned pick that pays more: less in extra payments, more interest, done later', () => {
    const plan = runScenario(LOAN, 1)
    const pinned = runScenario(
      applyWhatIf(
        LOAN,
        buildWhatIf(LOAN, 1, { template: 'more-each-month', amount: 200 }, 'shorten')
      ),
      1
    )
    const { b } = facts(TEN_K, 'shorten')
    const sentence = compareSentence({ a: pinned, b, from: 1, aIsPlan: false }, f)
    const months = (b.payoffMonth ?? 0) - (pinned.payoffMonth ?? 0)
    expect(months).toBeGreaterThan(0)
    expect(sentence).toBe(
      `You pay ${f.wholeMoney(pinned.totalExtra - b.totalExtra)} less in extra payments and ` +
        `${f.wholeMoney(b.totalInterest - pinned.totalInterest)} more interest. ` +
        `Done in October 2034, ${span(months)} later.`
    )
    expect(plan.payoffMonth).toBe(120)
  })

  it('a payment after the loan is repaid changes nothing, and says so', () => {
    const { plan, b } = facts({ template: 'one-payment', amount: 1000, inMonths: 130 }, 'shorten')
    expect(compareSentence({ a: plan, b, from: 1, aIsPlan: true }, f)).toBe(
      'This changes nothing: the loan is repaid before it would make a difference.'
    )
  })

  it('compares on month numbers when the start date cannot be read', () => {
    const undated = { ...LOAN, start_date: '' }
    const { plan, b } = facts(TEN_K, 'shorten', undated)
    expect(compareSentence({ a: plan, b, from: 1, aIsPlan: true }, f)).toBe(
      'You pay €10,000 extra and €5,236 less interest. Done in month 106, 14 months sooner.'
    )
    const lower = facts(TEN_K, 'lower', undated)
    expect(compareSentence({ a: lower.plan, b: lower.b, from: 1, aIsPlan: true }, f)).toContain(
      'From month 13 the installment is €945.48 instead of €1,060.66.'
    )
  })

  it('says when a loan would never be repaid, and at what rate', () => {
    // 30 years at 5 %, then 15 % from month 13 while the installment stays: it no longer covers
    // the interest, so the balance grows from there on.
    const loan: LoanInput = {
      ...LOAN,
      term_months: 360,
      rate_periods: [{ rate: 15, start_month: 13 }],
      on_rate_change: 'keep-installment',
    }
    const plan = runScenario({ ...loan, on_rate_change: 'keep-term' }, 1)
    const b = runScenario(loan, 1)
    expect(b.neverPaysOffFrom).toBe(13)
    expect(
      compareSentence(
        { a: plan, b, from: 1, aIsPlan: true, never: { rate: 15, date: '2027-01-01' } },
        f
      )
    ).toBe(
      'At 15% from January 2027 the installment no longer covers the interest, so this loan would never be repaid.'
    )
    expect(compareSentence({ a: plan, b, from: 1, aIsPlan: true }, f)).toBe(
      'From month 13 the installment no longer covers the interest, so this loan would never be repaid.'
    )
    expect(differenceLine(plan, b, 1, f)).toBe('Never repaid')
  })

  it('says when the loan as planned is never repaid and the pick repays it', () => {
    const loan: LoanInput = {
      ...LOAN,
      term_months: 360,
      rate_periods: [{ rate: 15, start_month: 13 }],
      on_rate_change: 'keep-installment',
    }
    const never = runScenario(loan, 1)
    const rescued = runScenario(
      applyWhatIf(
        loan,
        buildWhatIf(loan, 1, { template: 'one-payment', amount: 90000, inMonths: 12 }, 'shorten')
      ),
      1
    )
    expect(rescued.payoffMonth).not.toBeNull()
    expect(compareSentence({ a: never, b: rescued, from: 1, aIsPlan: true }, f)).toBe(
      `As planned this loan is never repaid. With this change it is, in ${monthLong(rescued.payoffDate, rescued.payoffMonth!)}.`
    )
  })
})

describe('bothModesSentence', () => {
  it('puts the trade-off in plain numbers: more interest saved, or money freed each month', () => {
    const plan = runScenario(LOAN, 1)
    const sooner = facts(TEN_K, 'shorten').b
    const lower = facts(TEN_K, 'lower').b
    // 5,236.32 - 2,438.66 = 2,797.66 more saved; 1,060.66 - 945.48 = 115.17 a month freed.
    expect(bothModesSentence(plan, sooner, lower, 1, f)).toBe(
      'Finishing sooner saves €2,798 more interest and ends in October 2034. ' +
        'Paying less each month frees €115.17 a month from January 2027.'
    )
  })

  it('for an extra every month, the money freed grows with each payment', () => {
    const plan = runScenario(LOAN, 1)
    const choice: WhatIfChoice = { template: 'more-each-month', amount: 100 }
    const sooner = facts(choice, 'shorten').b
    const lower = facts(choice, 'lower').b
    expect(bothModesSentence(plan, sooner, lower, 1, f)).toBe(
      `Finishing sooner saves ${f.wholeMoney(lower.totalInterest - sooner.totalInterest)} more interest and ends in ${monthLong(sooner.payoffDate, sooner.payoffMonth!)}. ` +
        `Paying less each month frees a little more with each extra payment, ${f.money(plan.rows[118].payment - lower.rows[118].payment)} a month by November 2035.`
    )
  })

  it('says so when neither mode changes anything', () => {
    const plan = runScenario(LOAN, 1)
    const late: WhatIfChoice = { template: 'one-payment', amount: 1000, inMonths: 130 }
    expect(bothModesSentence(plan, facts(late, 'shorten').b, facts(late, 'lower').b, 1, f)).toBe(
      'Neither mode changes anything: the loan is repaid before the extra payments would.'
    )
  })
})

describe('differenceLine', () => {
  it('fits the difference in one short line, for the bar on a phone', () => {
    const plan = runScenario(LOAN, 1)
    expect(differenceLine(plan, facts(TEN_K, 'shorten').b, 1, f)).toBe(
      '14 months sooner · €5,236 less interest'
    )
    expect(differenceLine(plan, facts(TEN_K, 'lower').b, 1, f)).toBe(
      '€945.48 a month · €2,439 less interest'
    )
    expect(differenceLine(plan, plan, 1, f)).toBe('No change')
  })
})

describe('words', () => {
  it('names a span the way a person says it', () => {
    expect(span(1)).toBe('a month')
    expect(span(14)).toBe('14 months')
    expect(span(-3)).toBe('3 months')
    expect(span(12)).toBe('a year')
    expect(span(24)).toBe('2 years')
    expect(span(60)).toBe('5 years')
  })

  it('names a month from its date, or by its number without one', () => {
    expect(monthLong('2034-10-01', 106)).toBe('October 2034')
    expect(monthLong(null, 106)).toBe('month 106')
    expect(monthShort('2027-01-01', 13)).toBe('Jan 2027')
    expect(monthShort('', 13)).toBe('Month 13')
  })

  it('heads a column with the what-if in a few words', () => {
    const titles = (
      [
        { template: 'more-each-month', amount: 50 },
        { template: 'round-up', target: 1100 },
        { template: 'one-payment', amount: 10000, inMonths: 12 },
        { template: 'one-payment', amount: 1000, inMonths: 1 },
        { template: 'yearly-bonus', amount: 2000, monthOfYear: 12 },
        { template: 'extra-installment', monthOfYear: 6 },
        { template: 'done-by', yearsEarlier: 2 },
        { template: 'rate-change', points: -1 },
        { template: 'rate-change', points: 2 },
      ] as WhatIfChoice[]
    ).map((c) => choiceTitle(c, f, 1060.655))
    expect(titles).toEqual([
      '€50 more each month',
      '€1,100 a month instead of €1,060.66',
      '€10,000 in a year',
      '€1,000 with the next payment',
      '€2,000 every December',
      'One more installment every June',
      'Done 2 years sooner',
      'Rate 1 point lower',
      'Rate 2 points higher',
    ])
  })
})
