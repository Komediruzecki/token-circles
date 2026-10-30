/**
 * The benchmark cards (shared/guidance/cards.ts): each band in both directions gets a title with the
 * person's number, a sentence that names the region and the year, and one step; borrowed and
 * missing figures say so; every card says where its figures come from. Round invented values.
 */
import { describe, expect, it } from 'vitest'
import { BENCHMARKS, referencesFor } from '../../../../shared/guidance/benchmarks'
import {
  circleCards,
  cushionCard,
  debtPaymentsCard,
  debtRateCards,
  MARKET_RATES,
  percentText,
  savingsCard,
  shockCard,
} from '../../../../shared/guidance/cards'
import { facts, words } from './guidanceFixtures'
import type { RegionId } from '../../../../shared/guidance/benchmarks'
import type { CardContext } from '../../../../shared/guidance/cards'
import type { Debt, WindowCategory } from '../../../../shared/guidance/facts'

const at = (region: RegionId, over: Partial<CardContext> = {}): CardContext => ({
  region,
  currency: BENCHMARKS.regions.find((one) => one.id === region)!.currency,
  tenure: null,
  ...over,
})

const loan: Debt = {
  kind: 'loan',
  id: 7,
  name: 'Car loan',
  owed: 5000,
  rate: 12,
  payment: 250,
  carried: true,
  expensive: true,
  ends: '2028-03-01',
}

const card: Debt = {
  kind: 'card',
  id: 3,
  name: 'Travel card',
  owed: 300,
  rate: 6,
  payment: 100,
  carried: true,
  expensive: false,
}

const flexible: WindowCategory = {
  id: 23,
  name: 'Takeaway',
  type: 'expense',
  perMonth: 300,
  essential: false,
  via: 'kind',
}

describe('the savings rate', () => {
  const rated = (rate: number) =>
    facts({ savings: { rate, cash: rate, withPrincipal: rate }, income: 3000 })

  it('says what a high rate leads to', () => {
    const shown = savingsCard(rated(30), words, at('DE'))!
    expect(shown.title).toBe('You kept 30% of your income')
    expect(shown.tags).toEqual([{ kind: 'band', text: 'Above typical' }])
    expect(shown.body).toEqual([
      "That's above the German household average of 18.9% (2025). The retirement calculator shows where this rate leads in 10 or 20 years.",
    ])
    expect(shown.step).toEqual({ label: 'See where it leads', hash: '#retirement' })
  })

  it('says what one more point is, in the typical band', () => {
    const shown = savingsCard(rated(15), words, at('EU27'))!
    expect(shown.tags).toEqual([{ kind: 'band', text: 'Typical' }])
    expect(shown.body).toEqual([
      'Close to the EU average of 14.3% (2025). One more point is €30 a month.',
    ])
    expect(shown.step).toEqual({ label: 'Try one point more', hash: '#compound' })
  })

  it('names the pay that statements miss, and the largest flexible line, below typical', () => {
    const low = facts({
      savings: { rate: 2, cash: 2, withPrincipal: 2 },
      windowCategories: [flexible],
    })
    const shown = savingsCard(low, words, at('DE'))!
    expect(shown.tags).toEqual([{ kind: 'band', text: 'Below typical' }])
    expect(shown.body).toEqual([
      "Households in Germany save about 18.9% on average (2025), much of it through pension payments taken from pay, which bank statements don't show. Your largest flexible line was Takeaway, €300 a month.",
    ])
    expect(shown.step).toEqual({ label: 'Look at Takeaway', hash: '#analytics' })
  })

  it('leads with the money when more went out than came in, with the heaviest month', () => {
    const short = facts({
      income: 3000,
      spending: 3300,
      savings: { rate: -10, cash: -10, withPrincipal: -10 },
      heaviestMonth: { month: '2025-03', spent: 4100, category: 'Rent' },
    })
    const shown = savingsCard(short, words, at('HR'))!
    expect(shown.title).toBe('€300 a month more out than in')
    expect(shown.body).toEqual([
      'Over the last 12 months, spending ran ahead of income. About 1 in 4 households in the EU spends more than its income over a year (Eurostat, around 2020). March was the heaviest month, mostly Rent.',
    ])
    expect(shown.step).toEqual({ label: 'See what made March heavier', hash: '#analytics' })
    // The EU sentence is European evidence: the UK and US cards leave it out.
    expect(savingsCard(short, words, at('UK'))!.body[0]).toBe(
      'Over the last 12 months, spending ran ahead of income. March was the heaviest month, mostly Rent.'
    )
  })

  it('shows the cash fact even when the loan principal lifts the rate above zero', () => {
    const repaying = facts({
      income: 3000,
      spending: 3150,
      principalRepaid: 400,
      savings: { rate: 8.3, cash: -5, withPrincipal: 8.3 },
    })
    const shown = savingsCard(repaying, words, at('DE'))!
    expect(shown.title).toBe('€150 a month more out than in')
    expect(shown.body[1]).toBe(
      'Of your loan payments, €400 a month paid the debt down. Counting that, you saved 8.3%.'
    )
    // In the US, 8.3% would be typical; the band and the mark follow the cash.
    const us = savingsCard(repaying, words, at('US'))!
    expect(us.tags).toEqual([{ kind: 'band', text: 'Below typical' }])
    expect(us.bar!.label).toBe('Typical in the US: 0.4% to 10.4%. Yours: -5%.')
  })

  it('says what counts as saving when the principal moves the rate by more than a point', () => {
    const repaying = facts({
      income: 3000,
      principalRepaid: 300,
      savings: { rate: 20, cash: 10, withPrincipal: 20 },
    })
    expect(savingsCard(repaying, words, at('DE'))!.body[1]).toBe(
      'Of your loan payments, €300 a month on average paid the debt down; that counts as saving here. Cash alone: 10%.'
    )
  })

  it('never shows a rate past an edge it has not reached', () => {
    expect(percentText(13.86)).toBe('13.8')
    expect(percentText(13.9)).toBe('13.9')
    expect(percentText(-2.35)).toBe('-2.4')
    const edge = savingsCard(rated(13.86), words, at('DE'))!
    expect(edge.title).toBe('You kept 13.8% of your income')
    expect(edge.tags[0].text).toBe('Below typical')
  })

  it('says it firms up at 12 months, and shows nothing without an average', () => {
    const early = facts({
      firm: false,
      months: ['2025-10', '2025-11', '2025-12', '2026-01', '2026-02'],
    })
    expect(savingsCard(early, words, at('DE'))!.provisional).toBe(
      'Based on 5 months. It firms up at 12.'
    )
    expect(
      savingsCard(
        facts({ savings: { rate: null, cash: null, withPrincipal: null } }),
        words,
        at('DE')
      )
    ).toBeNull()
  })
})

describe('the cash cushion', () => {
  it('counts a cushion under a month in days, with the gap to one', () => {
    const shown = cushionCard(facts({ liquid: 1000, cushionMonths: 0.5 }), words, at('EU27'))!
    expect(shown.title).toBe('Your cash covers 15 days of essentials')
    expect(shown.body[0]).toBe(
      "The first cushion is one month of essential spending: €2,000. You're €1,000 away."
    )
    expect(shown.body[1]).toBe(
      "About half of EU households couldn't keep their usual living standard for three months on savings alone (Eurostat, 2020)."
    )
    expect(shown.step).toEqual({ label: 'Start a one-month cushion', hash: '#goals' })
  })

  it('names the next milestone in the typical band', () => {
    const shown = cushionCard(facts(), words, at('US'))!
    expect(shown.title).toBe('Your cash covers 2 months of essentials')
    expect(shown.body).toEqual([
      'Most guides aim for three to six months. That range is a convention, not a tested line; if your income moves around, the top of it fits better. Next milestone: 3 months, €2,000 away.',
      '55% of US adults have three months of expenses set aside (Federal Reserve, 2025).',
    ])
    expect(shown.step).toEqual({ label: 'Open the emergency fund calculator', hash: '#emergency' })
    expect(
      cushionCard(facts({ liquid: 8000, cushionMonths: 4 }), words, at('US'))!.body[0]
    ).toContain('Next milestone: 6 months, €4,000 away.')
  })

  it('points past six months to the next goal', () => {
    const shown = cushionCard(facts({ liquid: 14000, cushionMonths: 7 }), words, at('HR'))!
    expect(shown.tags[0]).toEqual({ kind: 'band', text: 'Above typical' })
    expect(shown.step).toEqual({ label: 'Plan your next goal', hash: '#goals' })
  })

  it('says Germany and the UK have no figure for three months on savings', () => {
    const shown = cushionCard(facts(), words, at('DE'))!
    expect(shown.tags).toContainEqual({ kind: 'missing', text: 'No German figure' })
    expect(shown.note).toBe(
      'Germany has no official figure for how many households could live three months on savings.'
    )
    expect(cushionCard(facts(), words, at('UK'))!.note).toBe(
      'The UK has no official figure for how many households could live three months on savings.'
    )
  })

  it('shows nothing when nothing is needed every month, or the money is not known', () => {
    expect(
      cushionCard(
        facts({ essentials: 0, cushionMonths: Number.POSITIVE_INFINITY }),
        words,
        at('DE')
      )
    ).toBeNull()
    expect(cushionCard(facts({ liquid: null, cushionMonths: null }), words, at('DE'))).toBeNull()
  })
})

describe('the unexpected bill', () => {
  it("quotes the region's own test, and the gap to it", () => {
    const shown = shockCard(facts({ liquid: 1000, cushionMonths: 0.5 }), words, at('DE'))!
    expect(shown.title).toBe('An unexpected €1,300 bill would be more than your cash today')
    expect(shown.body).toEqual([
      "31.9% of people in Germany couldn't pay one from their own money either (Destatis, 2025). €300 more in savings would cover it.",
    ])
    expect(shown.step).toEqual({ label: 'Build toward €1,300', hash: '#goals' })
  })

  it('offers a month of essentials next, or nothing once that is in place', () => {
    const covered = shockCard(facts({ liquid: 1500, cushionMonths: 0.75 }), words, at('DE'))!
    expect(covered.title).toBe('You could pay an unexpected €1,300 bill from cash')
    expect(covered.body).toEqual(["31.9% of people in Germany couldn't (Destatis, 2025)."])
    expect(covered.step).toEqual({ label: 'Next: one month of essentials', hash: '#goals' })
    expect(shockCard(facts(), words, at('DE'))!.step).toBeNull()
    expect(shockCard(facts(), words, at('HR'))!.body[0]).toContain('(DZS, 2025)')
  })

  it('is left out for the EU, which has no single test, and in another currency', () => {
    expect(shockCard(facts(), words, at('EU27'))).toBeNull()
    expect(shockCard(facts(), words, at('DE', { currency: 'USD' }))).toBeNull()
  })
})

describe('the interest rate on each debt', () => {
  it('puts debt at 10% or more first, with what new loans cost', () => {
    const [shown] = debtRateCards(facts({ debts: [loan] }), words, at('DE'))
    expect(shown.title).toBe('Car loan costs 12% a year')
    expect(shown.body).toEqual([
      'Debt at 10% or more is where most guides put extra money first, once a one-month cushion is in place. New consumer loans in Germany average 8.99% (August 2026).',
    ])
    expect(shown.step).toEqual({ label: 'Compare paying it off faster', hash: '#loans/7' })
  })

  it("says a card's rate is below what cards cost, not close to it", () => {
    const [shown] = debtRateCards(facts({ debts: [card] }), words, at('DE'))
    expect(shown.tags[0].text).toBe('Typical')
    expect(shown.body).toEqual([
      'Below what credit cards cost in Germany (17.52%, August 2026). Paying it faster is a choice, not an emergency; the cushion comes first.',
    ])
    expect(shown.step).toEqual({ label: 'Open Accounts', hash: '#accounts' })
    const [close] = debtRateCards(facts({ debts: [{ ...loan, rate: 8 }] }), words, at('DE'))
    expect(close.body[0]).toMatch(/^Close to what new consumer loans cost in Germany \(8.99%/)
  })

  it('calls a low rate cheap, and leaves out a kind with no market figure', () => {
    const [cheap] = debtRateCards(facts({ debts: [{ ...loan, rate: 2.5 }] }), words, at('HR'))
    expect(cheap.title).toBe('Car loan costs 2.5% a year')
    expect(cheap.body[0]).toBe(
      "Cheap by today's rates. Paying it early saves little interest; the Loans page shows exactly how much."
    )
    const [noFigure] = debtRateCards(facts({ debts: [card] }), words, at('HR'))
    expect(noFigure.body[0]).toBe(
      'Paying it faster is a choice, not an emergency; the cushion comes first.'
    )
    expect(debtRateCards(facts({ debts: [{ ...card, rate: null }] }), words, at('DE'))).toEqual([])
  })

  it("holds each market rate to its region's reference", () => {
    for (const [region, rates] of Object.entries(MARKET_RATES)) {
      const label = referencesFor('debt.rate', region as RegionId)
        .map((ref) => ref.label)
        .join(' ')
      for (const rate of [rates.loan, rates.card, rates.overdraft]) {
        if (rate !== undefined) expect(label).toContain(`${rate.toFixed(2)}%`)
      }
    }
  })
})

describe('debt payments', () => {
  it("draws Croatia's lending line over its own share", () => {
    const shown = debtPaymentsCard(facts({ debts: [{ ...loan, payment: 1500 }] }), words, at('HR'))!
    expect(shown.title).toBe('Debt payments take 50% of your take-home pay')
    expect(shown.body).toEqual([
      "In Croatia, banks may lend past 40% of income only as a limited exception (Croatian National Bank, 2025). It's a lending limit, not a verdict, and a useful line to get back under.",
    ])
    expect(shown.step).toEqual({ label: 'See which loan ends first', hash: '#loans' })
    // A mortgage moves the line to 45%.
    expect(
      debtPaymentsCard(
        facts({ debts: [{ ...loan, payment: 1300 }] }),
        words,
        at('HR', { tenure: 'mortgage' })
      )!.tags[0].text
    ).toBe('Typical')
  })

  it("names Croatia's figures where Germany and the EU borrow them", () => {
    const shown = debtPaymentsCard(facts({ debts: [{ ...loan, payment: 1500 }] }), words, at('DE'))!
    expect(shown.tags).toContainEqual({ kind: 'borrowed', text: "Croatia's figures" })
    expect(shown.body).toEqual([
      "There's no official line in Germany; Croatia's central bank uses 40% as its limit for new loans.",
    ])
  })

  it('says which loan ends next in the typical band', () => {
    const shown = debtPaymentsCard(facts({ debts: [loan] }), words, at('EU27'))!
    expect(shown.title).toBe('Debt payments take 8.3% of your take-home pay')
    expect(shown.body).toEqual([
      'Car loan is the next to end, in March 2028; that frees €250 a month.',
    ])
  })

  it('shows the UK share with no line, and says so', () => {
    const shown = debtPaymentsCard(facts({ debts: [loan] }), words, at('UK'))!
    expect(shown.bar).toBeNull()
    expect(shown.tags).toEqual([{ kind: 'missing', text: 'No UK line' }])
    expect(shown.note).toBe('The UK has no official line for debt payments against income.')
  })

  it('says how many households repay a loan when there are no payments', () => {
    const shown = debtPaymentsCard(facts(), words, at('EU27'))!
    expect(shown.title).toBe('No debt payments')
    expect(shown.body).toEqual([
      '24.1% of households in the EU repay a loan other than a mortgage (2020).',
    ])
    expect(shown.step).toEqual({ label: 'Plan your next goal', hash: '#goals' })
  })
})

describe('the cards each circle shows', () => {
  it('puts the cushion, the bill and the debts in Breathing room and Solid ground, savings in Room to choose', () => {
    const f = facts({ debts: [loan], liquid: 1000, cushionMonths: 0.5 })
    expect(circleCards(3, f, words, at('DE')).map((one) => one.id)).toEqual(['cushion', 'shock'])
    expect(circleCards(4, f, words, at('DE')).map((one) => one.id)).toEqual([
      'cushion',
      'shock',
      'debt-rate-loan-7',
      'debt-payments',
    ])
    expect(circleCards(5, f, words, at('DE')).map((one) => one.id)).toEqual(['savings-rate'])
    for (const circle of [1, 2, 6, 7] as const) {
      expect(circleCards(circle, f, words, at('DE'))).toEqual([])
    }
  })

  it('says where every figure comes from, with links that open securely', () => {
    for (const shown of circleCards(4, facts({ debts: [loan] }), words, at('DE'))) {
      expect(shown.where.rule).not.toBe('')
      expect(shown.where.sources.length).toBeGreaterThan(0)
      for (const source of shown.where.sources) expect(source.url).toMatch(/^https:\/\//)
      expect(shown.where.strength).toMatch(/evidence/)
    }
  })

  it('holds the mark to the bar, and labels the edges', () => {
    const shown = cushionCard(facts({ liquid: 40000, cushionMonths: 20 }), words, at('DE'))!
    expect(shown.bar).toMatchObject({ from: 0, to: 9, mark: 9 })
    expect(shown.bar!.edges.map((edge) => edge.text)).toEqual(['1 month', '6 months'])
    expect(shown.bar!.label).toBe('Typical: 1 to 6 months. Yours: 20.')
  })
})

describe('the savings formula', () => {
  it('counts no deduction as spending, as flows.ts reads them', () => {
    const metric = BENCHMARKS.metrics.find((one) => one.id === 'savings.rate')!
    expect(metric.formula).toContain('spending = expense entries only')
    expect(metric.formula).not.toContain('deduction entries')
  })
})
