/**
 * The three invented people of the guidance research's examples.md, as entries the app would hold:
 * each month's lines as one entry apiece, the accounts and the loans as the example gives them.
 * Mia is in the first circle with seven months, the family in Leipzig in the fourth, Jordan in the
 * second. Where a figure here differs from the example, the comment says which side is right and
 * why; none is bent to pass.
 */
import { describe, expect, it } from 'vitest'
import { addCalendarMonths } from '../../../../shared/calendarMonths'
import { placeCircle } from '../../../../shared/guidance/circles'
import { cushionOf, guidanceFacts } from '../../../../shared/guidance/facts'
import { loanStatus } from '../../../../shared/loanSchedule'
import { orientationSteps } from '../../../../shared/orientation'
import type { CheckId, Placement } from '../../../../shared/guidance/circles'
import type {
  FactsAccount,
  FactsEntry,
  FactsLoan,
  GuidanceInput,
} from '../../../../shared/guidance/facts'
import type { OrientationFacts } from '../../../../shared/orientation'

const TODAY = '2026-10-11'

/** 'YYYY-MM' for `count` months from `first`. */
function monthsFrom(first: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => addCalendarMonths(`${first}-01`, i).slice(0, 7))
}

interface Line {
  category: number
  amount: number
  type?: 'income' | 'expense'
}

/** Every line once a month, from the 1st on: each month is tracked, and averages to the lines. */
function entries(months: string[], lines: Line[]): FactsEntry[] {
  return months.flatMap((month) =>
    lines.map((line, i) => ({
      date: `${month}-${String(i + 1).padStart(2, '0')}`,
      type: line.type ?? 'expense',
      amount: line.amount,
      category_id: line.category,
    }))
  )
}

/**
 * A loan that has `owed` left on TODAY at `rate`, paid since 24 payments ago, with an installment
 * as near `payment` as whole months allow. The engine says what is left; the test reads it back.
 */
function loanOwing(owed: number, rate: number, payment: number, name: string): FactsLoan {
  const r = rate / 1200
  const left = Math.round(-Math.log(1 - (r * owed) / payment) / Math.log(1 + r))
  const paid = 24
  const term = paid + left
  const grow = (n: number) => (1 + r) ** n
  return {
    name,
    principal: Math.round(((owed * (grow(term) - 1)) / (grow(term) - grow(paid))) * 100) / 100,
    interest_rate: rate,
    // The 24th payment fell due on the 1st of this month.
    start_date: addCalendarMonths('2026-10-01', -(paid - 1)),
    term_months: term,
    rate_periods: [],
    prepayments: [],
  }
}

const placed = (input: GuidanceInput) => {
  const facts = guidanceFacts(input)
  return { facts, placement: placeCircle(facts) }
}

const check = (placement: Placement, circle: number, id: CheckId) =>
  placement.circles[circle - 1].checks.find((c) => c.id === id)

describe('A. Mia, 21, a student in Zagreb', () => {
  // The five lines she ticked as needed every month, and the rest not.
  const categories = [
    { id: 1, name: 'Rent', type: 'expense', kind: 'housing', essential: 1 },
    { id: 2, name: 'Utilities', type: 'expense', kind: 'utilities', essential: 1 },
    { id: 3, name: 'Groceries', type: 'expense', kind: 'groceries', essential: 1 },
    { id: 4, name: 'Eating out', type: 'expense', kind: 'eating_out', essential: 0 },
    { id: 5, name: 'Student pass', type: 'expense', kind: 'transport', essential: 1 },
    { id: 6, name: 'Phone', type: 'expense', kind: 'utilities', essential: 1 },
    { id: 7, name: 'Subscriptions', type: 'expense', kind: 'subscriptions', essential: 0 },
    { id: 8, name: 'Shopping', type: 'expense', kind: 'shopping', essential: 0 },
    { id: 9, name: 'Going out', type: 'expense', kind: 'leisure', essential: 0 },
    { id: 10, name: 'Books and course fees', type: 'expense', kind: 'childcare', essential: 0 },
    { id: 11, name: 'Other', type: 'expense', kind: 'other', essential: 0 },
    { id: 20, name: 'Part-time job', type: 'income' },
    { id: 21, name: 'From my parents', type: 'income' },
  ]
  const lines: Line[] = [
    { category: 20, amount: 430, type: 'income' },
    { category: 21, amount: 250, type: 'income' },
    { category: 1, amount: 200 },
    { category: 2, amount: 35 },
    { category: 3, amount: 170 },
    { category: 4, amount: 48 },
    { category: 5, amount: 25 },
    { category: 6, amount: 15 },
    { category: 7, amount: 21.47 },
    { category: 8, amount: 60 },
    { category: 9, amount: 45 },
    { category: 10, amount: 20 },
    { category: 11, amount: 15.53 },
  ]
  // Her current account never went below 140 in the last 30 days; savings 260, cash 20.
  const accounts: FactsAccount[] = [
    { id: 1, type: 'giro', balance: 140 },
    { id: 2, type: 'savings', balance: 260 },
    { id: 3, type: 'cash', balance: 20 },
  ]
  const input: GuidanceInput = {
    today: TODAY,
    region: 'HR',
    transactions: entries(monthsFrom('2026-03', 7), lines),
    categories,
    accounts,
    // She marked her parents' money as support she expects to stop.
    answers: { supportCategoryIds: [21] },
  }
  const { facts, placement } = placed(input)

  it('has seven months, EUR 680 coming in, 430 of it her own, and EUR 655 going out', () => {
    expect(facts.months).toHaveLength(7)
    expect(facts.monthsInYear).toBe(7)
    expect(facts.firm).toBe(false)
    expect(facts.income).toBeCloseTo(680, 6)
    expect(facts.ownIncome).toBeCloseTo(430, 6)
    expect(facts.spending).toBeCloseTo(655, 6)
    expect(facts.essentials).toBeCloseTo(445, 6)
    expect(facts.liquid).toBe(420)
    expect(facts.debts).toEqual([])
  })

  it('is in the first circle, Clear picture: 7 of 12 months are here, so all of it is provisional', () => {
    expect(placement.current).toBe(1)
    expect(placement.circles[0].name).toBe('Clear picture')
    expect(placement.provisional).toBe(true)
    expect(check(placement, 1, 'year-on-file')).toMatchObject({ met: false, value: 7, target: 12 })
    // Getting started's steps lead until a year is here.
    expect(placement.next).toBeNull()
  })

  it('is not yet paying her way: her own income covers 66% of her spending', () => {
    const own = check(placement, 2, 'own-income')!
    expect(own).toMatchObject({ met: false, provisional: true })
    expect(Math.round((own.value! / own.target!) * 100)).toBe(66)
  })

  it('has 28 days of essentials in cash, EUR 25 short of a month', () => {
    const cushion = check(placement, 3, 'first-cushion')!
    // Today's balances: not provisional, unlike the circle around it.
    expect(cushion).toMatchObject({ met: false, provisional: false, target: 1 })
    expect(Math.floor(facts.cushionMonths! * 30)).toBe(28)
    expect(Math.round(facts.essentials! - facts.liquid!)).toBe(25)
  })

  it('kept 3.7% of her income, her parents’ money counted, as it is money she has', () => {
    expect(facts.savings.rate!).toBeCloseTo(3.68, 2)
    expect(facts.savings.cash).toBe(facts.savings.rate)
  })

  it('gets the cushion as her third step, after the year and a budget for Groceries', () => {
    const steps = orientationSteps({
      today: TODAY,
      trackedMonthsInYear: facts.monthsInYear,
      subscriptionsSpotted: 0,
      billsSpotted: 0,
      entries: input.transactions.length,
      uncategorised: 0,
      topUnbudgeted: { categoryId: 1, name: 'Groceries' },
      heavyMonth: null,
      loans: 0,
      cushionMonths: facts.cushionMonths,
      cushionAgainst: cushionOf(input).against,
    } satisfies OrientationFacts)
    expect(steps.map((step) => step.id)).toEqual(['import-year', 'budget-top-category', 'cushion'])
    expect(steps[2]).toMatchObject({
      title: 'Build a one-month cushion',
      reason: 'The money you can reach covers 28 days of what you need.',
      link: { hash: '#goals', label: 'Goals' },
    })
  })
})

describe('B. A family of four in Leipzig', () => {
  // Kinds alone say what is needed: nobody ticked a box.
  const categories = [
    { id: 1, name: 'Rent', type: 'expense', kind: 'housing' },
    { id: 2, name: 'Electricity', type: 'expense', kind: 'utilities' },
    { id: 3, name: 'Internet and phones', type: 'expense', kind: 'other' },
    { id: 4, name: 'Groceries', type: 'expense', kind: 'groceries' },
    { id: 5, name: 'Eating out', type: 'expense', kind: 'eating_out' },
    { id: 6, name: 'Car loan', type: 'expense', kind: 'debt' },
    { id: 7, name: 'Fuel', type: 'expense', kind: 'transport' },
    { id: 8, name: 'Car insurance and tax', type: 'expense', kind: 'transport' },
    { id: 9, name: 'Public transport', type: 'expense', kind: 'transport' },
    { id: 10, name: 'Subscriptions', type: 'expense', kind: 'subscriptions' },
    { id: 11, name: 'Childcare and school', type: 'expense', kind: 'childcare' },
    { id: 12, name: 'Insurance', type: 'expense', kind: 'insurance' },
    { id: 13, name: 'Health', type: 'expense', kind: 'health' },
    { id: 14, name: 'Clothes and shopping', type: 'expense', kind: 'shopping' },
    { id: 15, name: 'Leisure', type: 'expense', kind: 'leisure' },
    { id: 16, name: 'Other', type: 'expense', kind: 'other' },
    { id: 20, name: 'Salaries', type: 'income' },
    { id: 21, name: 'Child benefit', type: 'income' },
  ]
  const lines: Line[] = [
    { category: 20, amount: 5650, type: 'income' },
    { category: 21, amount: 250, type: 'income' },
    ...[1650, 120, 70, 780, 240, 310, 160, 70, 98, 96, 350, 85, 45, 330, 290, 456].map(
      (amount, i) => ({ category: i + 1, amount })
    ),
  ]
  const accounts: FactsAccount[] = [
    { id: 1, type: 'giro', balance: 700 },
    { id: 2, type: 'giro', balance: 500 },
    { id: 3, type: 'savings', balance: 9400 },
    { id: 4, type: 'cash', balance: 100 },
    { id: 5, type: 'ib', balance: 18500 },
  ]
  const carLoan = loanOwing(11200, 6.9, 310, 'Car loan')
  const input: GuidanceInput = {
    today: TODAY,
    region: 'DE',
    transactions: entries(monthsFrom('2025-08', 14), lines),
    categories,
    accounts,
    loans: [carLoan],
  }
  const { facts, placement } = placed(input)

  it('owes the car loan as the example has it: EUR 11,200 at 6.9%, about EUR 310 a month', () => {
    const status = loanStatus(carLoan, TODAY)
    expect(status.remaining_balance).toBeCloseTo(11200, 0)
    expect(Math.abs(status.monthly_payment - 310)).toBeLessThan(5)
  })

  it('averages the last twelve months: EUR 5,900 in, 5,150 out, 3,668 of it essential', () => {
    expect(facts.months).toEqual(monthsFrom('2025-10', 12))
    expect(facts.firm).toBe(true)
    expect(facts.income).toBeCloseTo(5900, 6)
    expect(facts.spending).toBeCloseTo(5150, 6)
    expect(facts.essentials).toBeCloseTo(3668, 6)
    expect(facts.liquid).toBe(10700)
    expect(facts.invested).toBe(18500)
  })

  it('is in the fourth circle, Solid ground, having reached the three inside it', () => {
    expect(placement.current).toBe(4)
    expect(placement.circles.map((c) => c.reached)).toEqual([
      true,
      true,
      true,
      false,
      false,
      false,
      false,
    ])
    expect(placement.circles[3].name).toBe('Solid ground')
    expect(placement.provisional).toBe(false)
  })

  it('has the checklist of the example: no debt at 10% or more, free money not answered, 2.9 months', () => {
    expect(check(placement, 4, 'no-expensive-debt')).toMatchObject({ met: true, value: 0 })
    expect(facts.debts).toEqual([
      expect.objectContaining({ kind: 'loan', name: 'Car loan', rate: 6.9, expensive: false }),
    ])
    expect(check(placement, 4, 'free-money')).toMatchObject({ met: null, required: false })
    const three = check(placement, 4, 'solid-cushion')!
    expect(three).toMatchObject({ met: false, target: 3 })
    expect(three.value!).toBeCloseTo(2.92, 2)
    // EUR 304 to three months; six months is EUR 22,008.
    expect(Math.round(3 * facts.essentials! - facts.liquid!)).toBe(304)
    expect(Math.round(6 * facts.essentials!)).toBe(22008)
  })

  it('checks the free money first, then grows the cushion to three months', () => {
    expect(placement.next).toEqual({ circle: 4, check: 'free-money' })
    const answered = placeCircle(guidanceFacts({ ...input, answers: { freeMoney: 'taken' } }))
    expect(answered.current).toBe(4)
    expect(answered.next).toEqual({ circle: 4, check: 'solid-cushion' })
  })

  it('is 15% of the way to Room to choose: EUR 18,500 against two years of spending', () => {
    const twoYears = check(placement, 5, 'two-years')!
    expect(twoYears.value).toBe(18500)
    expect(twoYears.target).toBeCloseTo(123600, 6)
    expect(Math.round((twoYears.value! / twoYears.target!) * 100)).toBe(15)
  })

  it('kept 12.7% in cash, and 16.7% counting what the car loan paid down', () => {
    expect(facts.savings.cash!).toBeCloseTo(12.71, 2)
    // examples.md says 16.9%: it adds back EUR 246 a month, the principal in the coming payment,
    // as if every month of the year had repaid that much. The year's own twelve payments repaid
    // less, as more was owed earlier: EUR 233 a month on average. Both are typical in Germany.
    expect(facts.principalRepaid!).toBeCloseTo(232.8, 0)
    expect(facts.savings.rate!).toBeCloseTo(16.66, 2)
    expect(facts.savings.rate).toBe(facts.savings.withPrincipal)
  })
})

describe('C. Jordan, 34, a single adult with debt in Columbus, Ohio', () => {
  const categories = [
    { id: 1, name: 'Rent', type: 'expense', kind: 'housing' },
    { id: 2, name: 'Utilities', type: 'expense', kind: 'utilities' },
    { id: 3, name: 'Groceries', type: 'expense', kind: 'groceries' },
    { id: 4, name: 'Eating out', type: 'expense', kind: 'eating_out' },
    { id: 5, name: 'Car payment', type: 'expense', kind: 'debt' },
    { id: 6, name: 'Gas', type: 'expense', kind: 'transport' },
    { id: 7, name: 'Car insurance', type: 'expense', kind: 'transport' },
    { id: 8, name: 'Phone', type: 'expense', kind: 'utilities' },
    { id: 9, name: 'Health', type: 'expense', kind: 'health' },
    { id: 10, name: 'Credit card payment', type: 'expense', kind: 'debt' },
    { id: 11, name: 'Personal loan', type: 'expense', kind: 'debt' },
    { id: 12, name: 'Subscriptions', type: 'expense', kind: 'subscriptions' },
    { id: 13, name: 'Shopping', type: 'expense', kind: 'shopping' },
    { id: 14, name: 'Entertainment', type: 'expense', kind: 'leisure' },
    { id: 15, name: 'Other', type: 'expense', kind: 'other' },
    { id: 20, name: 'Paycheck', type: 'income' },
  ]
  const lines: Line[] = [
    { category: 20, amount: 3850, type: 'income' },
    ...[1450, 160, 420, 410, 345, 150, 130, 60, 90, 190, 105, 164, 180, 76, 60].map(
      (amount, i) => ({ category: i + 1, amount })
    ),
  ]
  const accounts: FactsAccount[] = [
    { id: 1, type: 'giro', balance: 150 },
    { id: 2, type: 'savings', balance: 600 },
  ]
  // As examples.md enters them: the card as a loan with a fixed payment, from before cards were an
  // account type. The card as an account is in guidanceFacts.test.ts.
  const loans = [
    loanOwing(6200, 24.9, 190, 'Credit card'),
    loanOwing(2400, 13.5, 105, 'Personal loan'),
    loanOwing(14000, 7.2, 345, 'Car loan'),
  ]
  const input: GuidanceInput = {
    today: TODAY,
    region: 'US',
    transactions: entries(monthsFrom('2025-10', 12), lines),
    categories,
    accounts,
    loans,
  }
  const { facts, placement } = placed(input)

  it('has a year: $3,850 in, $3,990 out, $3,100 of it essential, $750 he can reach', () => {
    expect(facts.firm).toBe(true)
    expect(facts.income).toBeCloseTo(3850, 6)
    expect(facts.spending).toBeCloseTo(3990, 6)
    expect(facts.essentials).toBeCloseTo(3100, 6)
    expect(facts.liquid).toBe(750)
  })

  it('has reached Clear picture, and is in the second circle, Paying your way', () => {
    expect(placement.current).toBe(2)
    expect(placement.circles[0].reached).toBe(true)
    expect(placement.circles[1].name).toBe('Paying your way')
    // $140 a month more went out than came in.
    const own = check(placement, 2, 'own-income')!
    expect(own.met).toBe(false)
    expect(Math.round(own.target! - own.value!)).toBe(140)
    expect(placement.next).toEqual({ circle: 2, check: 'own-income' })
  })

  it('has 7 days of essentials in cash, and two debts at 10% or more', () => {
    expect(Math.floor(facts.cushionMonths! * 30)).toBe(7)
    expect(check(placement, 3, 'first-cushion')!.met).toBe(false)
    expect(facts.debts.filter((d) => d.expensive).map((d) => d.name)).toEqual([
      'Credit card',
      'Personal loan',
    ])
    expect(check(placement, 4, 'no-expensive-debt')).toMatchObject({ met: false, value: 2 })
  })

  it('kept -3.6% in cash, and 6.0% counting what the loans paid down', () => {
    expect(facts.savings.cash!).toBeCloseTo(-3.64, 2)
    // examples.md says 6.8%: it adds back $400 a month, the principal in the coming payments, as
    // if every month of the year had repaid that much. The year's own payments repaid $371 a month
    // on average (these loans' whole-month terms make two installments a little under the
    // example's $105 and $345). Both are typical in the US.
    expect(facts.principalRepaid!).toBeCloseTo(370.7, 0)
    expect(facts.savings.rate!).toBeCloseTo(5.99, 2)
  })
})
