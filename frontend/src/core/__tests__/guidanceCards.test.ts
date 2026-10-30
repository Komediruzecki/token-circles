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
  housingCard,
  MARKET_RATES,
  percentText,
  savingsBand,
  savingsCard,
  shockCard,
  spendingShareCards,
  subscriptionsCard,
} from '../../../../shared/guidance/cards'
import { principalLine } from '../../../../shared/guidance/savingsWords'
import { facts, words } from './guidanceFixtures'
import type { RegionId } from '../../../../shared/guidance/benchmarks'
import type { CardContext } from '../../../../shared/guidance/cards'
import type { Debt, WindowCategory } from '../../../../shared/guidance/facts'

const at = (region: RegionId, over: Partial<CardContext> = {}): CardContext => ({
  region,
  currency: BENCHMARKS.regions.find((one) => one.id === region)!.currency,
  tenure: null,
  adults: null,
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

describe("the savings rate's band, for the Dashboard gauge", () => {
  it("gives the typical band, its legend, and the card's sentence for the rate's band", () => {
    const band = savingsBand(facts(), words, at('EU27'))!
    expect(band).toEqual({
      from: 9.3,
      to: 19.3,
      legend: 'Typical in the EU: 9.3% to 19.3%',
      comparison: savingsCard(facts(), words, at('EU27'))!.body[0],
    })
    expect(savingsBand(facts(), words, at('HR'))!.legend).toBe('Typical in Croatia: 4% to 14%')
  })

  it('leaves out the principal line, which the gauge says in every build, in every region and band', () => {
    // No flexible line to name, so the low band's sentence is the region's figure alone.
    for (const region of ['DE', 'HR', 'EU27', 'UK', 'US'] as const) {
      for (const [cash, rate] of [
        [-8, -2],
        [0.5, 1.6],
        [12, 14],
        [40, 42],
      ]) {
        const paid = facts({
          windowCategories: [],
          principalRepaid: 33,
          savings: { rate, cash, withPrincipal: rate },
        })
        const principal = principalLine(paid, words)
        const said = savingsBand(paid, words, at(region))!.comparison
        expect(principal, `${region} ${cash}`).not.toBeNull()
        expect(said, `${region} ${cash}`).not.toBeNull()
        expect(said, `${region} ${cash}`).not.toBe(principal)
        expect(savingsCard(paid, words, at(region))!.body, `${region} ${cash}`).toEqual([
          said,
          principal,
        ])
      }
    }
  })

  it('has no sentence without a rate', () => {
    const none = facts({ savings: { rate: null, cash: null, withPrincipal: null } })
    expect(savingsBand(none, words, at('DE'))!.comparison).toBeNull()
  })
})

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

  it('says how many households repay a loan when there are no payments, and compares nothing', () => {
    const shown = debtPaymentsCard(facts(), words, at('EU27'))!
    expect(shown.title).toBe('No debt payments')
    expect(shown.body).toEqual([
      '24.1% of households in the EU repay a loan other than a mortgage (2020).',
    ])
    // Nothing to place on a line: no band, no bar, and no step that would not fit.
    expect(shown.tags).toEqual([])
    expect(shown.bar).toBeNull()
    expect(shown.step).toBeNull()
    // Nor a missing line, or a borrowed one, where the region has no line of its own.
    for (const region of ['UK', 'DE'] as const) {
      const none = debtPaymentsCard(facts(), words, at(region))!
      expect(none.title, region).toBe('No debt payments')
      expect(none.tags, region).toEqual([])
      expect(none.note, region).toBeNull()
      expect(none.bar, region).toBeNull()
    }
  })
})

/** Whole dollars, for the US cards' own currency. */
const usd = {
  money: (n: number): string =>
    new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(n),
}

describe('subscriptions', () => {
  const held = (count: number, perMonth: number) => facts({ subscriptions: { count, perMonth } })
  const KEEP =
    'Want fewer, or more out of the ones you keep? Each one on Bills is a quick yes or no.'
  const NOT_HERE =
    "If some are paid from a card that isn't here yet, import that statement and the scan will find them. And if there's a chore you repeat every week, a service that does it might be worth its price in time saved."

  it("reads guidance.md's worked example: 30 subscriptions in the US, about $350 a month", () => {
    const shown = subscriptionsCard(held(30, 350), usd, at('US'))!
    expect(shown).toMatchObject({
      eyebrow: 'Subscriptions',
      tags: [{ kind: 'band', text: 'Above typical' }],
      title: '30 subscriptions, about $350 a month',
      body: [
        "That's about $4,200 a year. People in the US report about 3 subscriptions, and $35 to $111 a month on average depending on the survey (Self Financial and CNET, 2026). In the March poll, 6 in 10 paid for at least one they hadn't used in a month.",
      ],
      step: { label: 'Review them on Bills', hash: '#bills' },
      note: null,
      ask: 'household',
    })
    expect(shown.bar!.label).toBe('Typical in the US: 2 to 6 per adult. Yours: 30.')
    expect(shown.bar).toMatchObject({ from: 0, to: 11, mark: 11 })
    expect(shown.where!.sources.map((source) => source.publisher)).toEqual(
      expect.arrayContaining(['Self Financial', 'WFSB / CNET'])
    )
  })

  it('calls the usual range usual, and a low count a sign of a card not here yet', () => {
    expect(subscriptionsCard(held(4, 62), usd, at('US'))!).toMatchObject({
      tags: [{ kind: 'band', text: 'Typical' }],
      title: '4 subscriptions, about $62 a month',
      body: [
        `That's in the usual range in the US. Recent surveys put the average between $35 and $111 a month, depending on what they count. ${KEEP}`,
      ],
      step: { label: 'Open Bills', hash: '#bills' },
    })
    expect(subscriptionsCard(held(1, 9.99), usd, at('US'))!).toMatchObject({
      tags: [{ kind: 'band', text: 'Below typical' }],
      title: '1 subscription, about $10 a month',
      body: [`Fewer than most people in the US, who report about 3. ${NOT_HERE}`],
      step: { label: 'Import another account', hash: '#import' },
    })
    expect(subscriptionsCard(held(0, 0), usd, at('US'))!.title).toBe('No subscriptions on Bills')
  })

  it('takes the higher band of the count and the spend, the spend only in its own currency', () => {
    // Three is a usual count; $200 a month is past the usual spend.
    expect(subscriptionsCard(held(3, 200), usd, at('US'))!.tags).toEqual([
      { kind: 'band', text: 'Above typical' },
    ])
    expect(subscriptionsCard(held(3, 200), words, at('US', { currency: 'EUR' }))!.tags).toEqual([
      { kind: 'band', text: 'Typical' },
    ])
    expect(subscriptionsCard(held(3, 100), words, at('UK'))!.tags).toEqual([
      { kind: 'band', text: 'Above typical' },
    ])
  })

  it("compares the euro regions' count with the UK's, named as borrowed, and says the spend has no figure", () => {
    const shown = subscriptionsCard(held(30, 320), words, at('DE'))!
    expect(shown).toMatchObject({
      tags: [
        { kind: 'band', text: 'Above typical' },
        { kind: 'borrowed', text: "The UK's figures" },
      ],
      title: '30 subscriptions, about €320 a month',
      body: [
        "That's about €3,840 a year. Germany has no official count yet; in the UK, where there is one, adults hold about 3 (Department for Business and Trade, 2023). In an EU survey, 37% of people said they often keep paying for subscriptions they no longer use (European Commission, 2024).",
      ],
      note: 'Germany has no official figure for what subscriptions cost, so only the count is compared.',
    })
    expect(shown.bar!.label).toBe('Typical in the UK: 2 to 5 per adult. Yours: 30.')
    expect(shown.where!.sources.map((source) => source.publisher)).toContain('European Commission')
    expect(subscriptionsCard(held(3, 40), words, at('EU27'))!.body).toEqual([
      `That's in the usual range for the UK, where adults hold about 3 (Department for Business and Trade, 2023); the EU has no official count yet. ${KEEP}`,
    ])
    expect(subscriptionsCard(held(1, 10), words, at('HR'))!.body).toEqual([
      `Fewer than most adults in the UK, who hold about 3; Croatia has no official count yet. ${NOT_HERE}`,
    ])
    expect(subscriptionsCard(held(3, 40), words, at('UK'))!.note).toBeNull()
  })

  it('counts per adult once the household is known, and asks until it is', () => {
    const two = subscriptionsCard(held(8, 120), words, at('UK', { adults: 2 }))!
    expect(two.bar!.label).toBe('Typical in the UK: 2 to 5 per adult. Yours: 4.')
    expect(two.body[1]).toBe("The surveys count per adult: with 2 adults here, that's 4 each.")
    expect(two.ask).toBeUndefined()
    const three = subscriptionsCard(held(8, 120), words, at('UK', { adults: 3 }))!
    expect(three.body[1]).toBe(
      "The surveys count per adult: with 3 or more adults here, that's 2.7 each."
    )
    // Unknown counts as one adult, with no per-adult line, and the card asks.
    const one = subscriptionsCard(held(8, 120), words, at('UK'))!
    expect(one.body).toHaveLength(1)
    expect(one.ask).toBe('household')
    expect(one.tags[0].text).toBe('Above typical')
  })

  it('holds the figures its sentences quote to the file', () => {
    const about = (
      metric: 'subscriptions.count' | 'subscriptions.monthlySpend',
      region: RegionId
    ) => referencesFor(metric, region)[0]
    expect(Math.round(about('subscriptions.count', 'US').value!)).toBe(3)
    expect(Math.round(about('subscriptions.count', 'UK').value!)).toBe(3)
    expect(about('subscriptions.monthlySpend', 'UK').value).toBe(41)
    expect(about('subscriptions.monthlySpend', 'US').value).toBe(111)
    expect(about('subscriptions.monthlySpend', 'US').label).toContain('$35')
  })

  it('shows nothing without the bills or 3 months, and firms up at 12', () => {
    expect(subscriptionsCard(facts(), words, at('DE'))).toBeNull()
    expect(
      subscriptionsCard(
        facts({ subscriptions: { count: 3, perMonth: 40 }, averaged: false }),
        words,
        at('DE')
      )
    ).toBeNull()
    const early = facts({
      subscriptions: { count: 3, perMonth: 40 },
      firm: false,
      months: ['2026-04', '2026-05', '2026-06', '2026-07'],
    })
    expect(subscriptionsCard(early, words, at('DE'))!.provisional).toBe(
      'Based on 4 months. It firms up at 12.'
    )
    expect(subscriptionsCard(held(3, 40), words, at('DE'))!.provisional).toBeNull()
  })
})

/** A month's spending by kind, out of 2,500 spent and 3,000 earned: 35% of pay on the home. */
const SPENT = { groceries: 300, eating_out: 100, transport: 250, housing: 900, utilities: 150 }

describe('groceries, eating out and transport', () => {
  const card = (id: string, cards: ReturnType<typeof spendingShareCards>) =>
    cards.find((one) => one.id === id)!
  const shares = (spent: Partial<typeof SPENT>, region: RegionId, over = {}) =>
    spendingShareCards(
      facts({ spendingByKind: { ...SPENT, ...spent }, ...over }),
      words,
      at(region)
    )

  it('puts a typical share close to what households spend, across income groups', () => {
    const groceries = card('groceries', shares({}, 'DE'))
    expect(groceries).toMatchObject({
      eyebrow: 'Groceries',
      tags: [{ kind: 'band', text: 'Typical' }],
      title: 'Groceries are 12% of your spending',
      body: [
        'Close to what households in Germany spend: 11.7% to 14.7% on average, depending on income (2020).',
      ],
      step: { label: 'Compare with last year', hash: '#analytics' },
      note: null,
    })
    expect(groceries.bar!.label).toBe('Typical in Germany: 8.8% to 18.4%. Yours: 12%.')
    expect(groceries.bar).toMatchObject({ from: 0, to: 30, mark: 12 })
    expect(card('eating-out', shares({}, 'UK')).body).toEqual([
      'Close to what households in the UK spend: 3.5% to 6.0% on average, depending on income (2025).',
    ])
  })

  it('says what a high share often means, and how much eating out is a month', () => {
    const high = shares({ groceries: 600, eating_out: 250, transport: 800 }, 'DE')
    expect(card('groceries', high)).toMatchObject({
      tags: [{ kind: 'band', text: 'Above typical' }],
      body: [
        'Households in Germany spend 11.7% to 14.7%, depending on income (2020). A high share often means the rest of the budget is already lean, not that the shopping is lavish.',
      ],
      step: { label: 'Set a grocery budget', hash: '#budgets' },
    })
    expect(card('eating-out', high)).toMatchObject({
      title: 'Eating out is 10% of your spending, about €250 a month',
      body: [
        "Households in Germany spend 3.6% to 5.7% (2020). It's the line most people can move fastest, if they want to.",
      ],
      step: { label: 'Set an eating-out budget', hash: '#budgets' },
    })
    expect(card('transport', high)).toMatchObject({
      body: ['Households in Germany spend 8.5% to 20.5%, car purchases included (2020).'],
      step: { label: 'See transport by month', hash: '#analytics' },
    })
  })

  it('says what a low share may be missing', () => {
    expect(card('groceries', shares({}, 'HR'))).toMatchObject({
      tags: [{ kind: 'band', text: 'Below typical' }],
      body: [
        "Below most households in Croatia. If you also buy food in cash or on a card that isn't here, add it; otherwise eating out may be carrying the meals.",
      ],
      step: { label: 'Check how food is sorted', hash: '#transactions' },
    })
    expect(card('eating-out', shares({ eating_out: 0 }, 'DE'))).toMatchObject({
      title: 'Eating out is 0% of your spending',
      body: [
        'Below most households in Germany. If some meals are sorted under Groceries or Other, moving them sharpens this.',
      ],
      step: { label: 'Check the sorting', hash: '#transactions' },
    })
    // Transport in the US: yearly costs may not have come round before a year is on file.
    expect(card('transport', shares({}, 'US', { firm: false, months: ['2026-08'] }))).toMatchObject(
      {
        body: [
          'Below most households in the US. With fewer than 12 months here, yearly costs like insurance may not have come round yet.',
        ],
        step: { label: 'Import the rest of your year', hash: '#import' },
        provisional: 'Based on 1 month. It firms up at 12.',
      }
    )
    expect(card('transport', shares({}, 'US'))).toMatchObject({
      body: ['Below most households in the US.'],
      step: { label: 'See transport by month', hash: '#analytics' },
    })
  })

  it("says Croatia's and the EU's eating-out figures run low", () => {
    const note = 'These figures come from the 2020 survey wave and run low.'
    expect(card('eating-out', shares({}, 'HR')).note).toBe(note)
    expect(card('eating-out', shares({}, 'EU27')).note).toBe(note)
    expect(card('eating-out', shares({}, 'DE')).note).toBeNull()
    expect(card('groceries', shares({}, 'HR')).note).toBeNull()
  })

  it('shows one card in their place until 90% of the spending has a category', () => {
    const unsorted = shares({}, 'DE', { sortedShare: 89.9 })
    expect(unsorted).toEqual([
      {
        id: 'spending-unsorted',
        metric: 'spending.foodAtHome',
        eyebrow: 'Groceries, eating out and transport',
        tags: [],
        title: '89% of your spending has a category',
        body: ["They're compared with households in Germany once 90% has one."],
        bar: null,
        note: null,
        step: {
          label: 'Sort the entries without a category',
          hash: '#transactions?uncategorised=1',
        },
        where: null,
        provisional: null,
      },
    ])
    expect(shares({}, 'DE', { sortedShare: 90 }).map((one) => one.id)).toEqual([
      'groceries',
      'eating-out',
      'transport',
    ])
  })

  it('shows nothing without an average or any spending', () => {
    expect(spendingShareCards(facts({ spendingByKind: null }), words, at('DE'))).toEqual([])
    expect(spendingShareCards(facts(), words, at('DE'))).toEqual([])
    expect(shares({}, 'DE', { spending: 0 })).toEqual([])
  })
})

describe('housing costs', () => {
  const housing = (
    spent: Partial<typeof SPENT>,
    region: RegionId,
    tenure: string | null = null,
    over = {}
  ) =>
    housingCard(
      facts({ spendingByKind: { ...SPENT, ...spent }, ...over }),
      words,
      at(region, { tenure })
    )

  it('reads rent and utilities over take-home pay, and asks how the household lives', () => {
    const shown = housing({}, 'DE')!
    expect(shown).toMatchObject({
      eyebrow: 'Housing costs',
      tags: [{ kind: 'band', text: 'Typical' }],
      title: 'Housing takes 35% of your take-home pay',
      body: ['Households in Germany spend 24.1% on average (2025).'],
      step: { label: 'Compare renting and buying', hash: '#rentBuy' },
      ask: 'tenure',
    })
    expect(shown.bar!.label).toBe('Typical in Germany: 24.1% to 40%. Yours: 35%.')
    // Answered, it asks no more; skipped counts as answered.
    expect(housing({}, 'DE', 'outright')!.ask).toBeUndefined()
    expect(housing({}, 'DE', 'skipped')!.ask).toBeUndefined()
  })

  it('compares renters with renters where the figures allow', () => {
    expect(housing({}, 'DE', 'rentPrivate')!.body).toEqual([
      'Households in Germany spend 24.1% on average (2025). Renters in Germany spend 27.9% of net income on rent (2022).',
    ])
    expect(housing({}, 'HR', 'rentPrivate')!.body).toEqual([
      'Households in Croatia spend 11.5% on average (2025). Most households in Croatia own their home outright, which keeps that average low; among people renting at market rates, 19.8% pay over 40%.',
    ])
    expect(housing({}, 'HR', 'mortgage')!.body).toEqual([
      'Households in Croatia spend 11.5% on average (2025).',
    ])
    expect(housing({}, 'US', 'rentPrivate')!.body).toEqual([
      'Over 30% is what US agencies call cost-burdened; about half of US renters are (2024).',
    ])
    expect(housing({}, 'US', 'mortgage')!.body).toEqual([
      'Over 30% is what US agencies call cost-burdened.',
    ])
  })

  it("compares the UK by tenure, with England's groups", () => {
    expect(housing({}, 'UK', 'rentPrivate')!).toMatchObject({
      body: ['Private renters in England spend 34% of gross income on average (2025).'],
    })
    expect(housing({}, 'UK', 'rentPrivate')!.bar!.label).toBe(
      'Typical in the UK: 34% to 40%. Yours: 35%.'
    )
    expect(housing({}, 'UK', 'rentSocial')!.body).toEqual([
      'Social renters in England spend 28% of gross income on average (2025).',
    ])
    expect(housing({}, 'UK')!.body).toEqual([
      'Mortgagors in England spend 19% of gross income on average (2025).',
    ])
    expect(housing({ housing: 300, utilities: 300 }, 'UK', 'rentPrivate')!.body).toEqual([
      'Below the 34% that private renters in England spend on average (2025). That gap is room the rest of your plan can use.',
    ])
  })

  it('names the overburden line above it, and how many are over it too', () => {
    const over = { housing: 1150, utilities: 150 }
    expect(housing(over, 'EU27')!).toMatchObject({
      tags: [{ kind: 'band', text: 'Above typical' }],
      title: 'Housing takes 43.3% of your take-home pay',
      body: [
        "That's over the 40% line Eurostat uses for a heavy housing burden; 7.7% of people in the EU are over it too (2025). Rent changes slowly, so room usually comes from the lines that move faster.",
      ],
      step: { label: 'See where the rest goes', hash: '#analytics' },
    })
    expect(housing(over, 'HR', 'rentPrivate')!.body).toEqual([
      "That's over the 40% line Eurostat uses for a heavy housing burden; 19.8% of people renting at market rates in Croatia are over it too (2025). Rent changes slowly, so room usually comes from the lines that move faster.",
    ])
    expect(housing(over, 'UK')!.body).toEqual([
      "That's over the 40% line Eurostat uses for a heavy housing burden. Rent changes slowly, so room usually comes from the lines that move faster.",
    ])
    expect(housing({ housing: 1450, utilities: 150 }, 'US')!.body).toEqual([
      "That's over the 50% line US housing agencies call a severe burden. They measure before tax, so their figure for you would be a little lower.",
    ])
  })

  it('calls the room below the average room for the rest of the plan', () => {
    const low = { housing: 500, utilities: 100 }
    expect(housing(low, 'DE')!).toMatchObject({
      tags: [{ kind: 'band', text: 'Below typical' }],
      body: [
        'Below the German household average of 24.1% (2025). That gap is room the rest of your plan can use.',
      ],
      step: { label: 'Put it toward your cushion', hash: '#goals' },
    })
    expect(housing(low, 'US')!.body).toEqual([
      'Under the 30% line US agencies call cost-burdened. That gap is room the rest of your plan can use.',
    ])
  })

  it('holds "about half of US renters" to the figure it stands for', () => {
    const renters = referencesFor('housing.share', 'US').find(
      (ref) => ref.unit === 'percent of renter households'
    )
    expect(renters!.value).toBeGreaterThanOrEqual(45)
    expect(renters!.value).toBeLessThanOrEqual(55)
  })

  it('shows nothing without income, an average or anything spent on the home', () => {
    expect(housing({ housing: 0, utilities: 0 }, 'DE')).toBeNull()
    expect(housing({}, 'DE', null, { income: null })).toBeNull()
    expect(housingCard(facts({ spendingByKind: null }), words, at('DE'))).toBeNull()
  })
})

describe('the cards each circle shows', () => {
  it('puts subscriptions, spending and housing in Paying your way', () => {
    const paying = facts({ spendingByKind: SPENT, subscriptions: { count: 3, perMonth: 40 } })
    expect(circleCards(2, paying, words, at('DE')).map((one) => one.id)).toEqual([
      'subscriptions',
      'groceries',
      'eating-out',
      'transport',
      'housing',
    ])
  })

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
    const shown = [
      ...circleCards(
        2,
        facts({ spendingByKind: SPENT, subscriptions: { count: 3, perMonth: 40 } }),
        words,
        at('DE')
      ),
      ...circleCards(4, facts({ debts: [loan] }), words, at('DE')),
    ]
    expect(shown.length).toBeGreaterThan(5)
    for (const card of shown) {
      const where = card.where!
      expect(where.rule, card.id).not.toBe('')
      expect(where.sources.length, card.id).toBeGreaterThan(0)
      for (const source of where.sources) expect(source.url).toMatch(/^https:\/\//)
      expect(where.strength, card.id).toMatch(/evidence/)
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
