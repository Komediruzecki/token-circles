/**
 * The ledger's words (shared/guidance/ledger.ts): the status over the rows, and each circle's row in
 * each state, from the placement and the facts. Rounding never shows a check as met early: shares
 * floor below 100% while not met, gaps round up, months floor to one decimal, days to whole days.
 */
import { describe, expect, it } from 'vitest'
import { placeCircle } from '../../../../shared/guidance/circles'
import {
  CIRCLE_LINES,
  gapOf,
  ledgerRows,
  ledgerStatus,
  monthsText,
  shareOf,
} from '../../../../shared/guidance/ledger'
import { BASE_FACTS as base, facts, words } from './guidanceFixtures'
import type { GuidanceFacts } from '../../../../shared/guidance/facts'

const rows = (f: GuidanceFacts) => ledgerRows(placeCircle(f), f, words)
const row = (f: GuidanceFacts, circle: number) => rows(f)[circle - 1]
const status = (f: GuidanceFacts) => ledgerStatus(placeCircle(f), f, words)

describe('the rounding', () => {
  it('floors a share below 100 until it is met, and rounds a met one', () => {
    expect(shareOf(99.96, 100, false)).toBe(99)
    expect(shareOf(150, 100, false)).toBe(99)
    expect(shareOf(-5, 100, false)).toBe(0)
    expect(shareOf(120.4, 100, true)).toBe(120)
    expect(shareOf(16.7, 100, false)).toBe(16)
  })

  it('rounds a gap up, and never to 0', () => {
    expect(gapOf(6000, 5999.01)).toBe(1)
    expect(gapOf(6000, 4000)).toBe(2000)
    expect(gapOf(6000, 4000.5)).toBe(2000)
    expect(gapOf(6000, 5999.999)).toBe(1)
  })

  it('floors months to one decimal', () => {
    expect(monthsText(2.96)).toBe('2.9')
    expect(monthsText(3)).toBe('3')
    expect(monthsText(2.999)).toBe('2.9')
    expect(monthsText(0.25)).toBe('0.2')
  })
})

describe('the status over the rows', () => {
  it('names the circle being worked on, and the gap to its first check not met', () => {
    expect(status(base)).toEqual({
      meta: 'Circle 4 of 7',
      line: "You're in the fourth circle: Solid ground.",
      sub: '€2,000 to three months of essentials.',
      waiting: null,
    })
  })

  it('says "for now" until a year is on file, whatever else is not known', () => {
    const seven = facts({ monthsInYear: 7, firm: false })
    expect(status(seven)).toMatchObject({
      meta: 'For now: 7 of 12 months',
      sub: "Circles firm up once a full year is here. For now, here's what we can see.",
    })
  })

  it('says the accounts did not load, before anything that waits on an answer', () => {
    const unread = facts({ accountsKnown: false, liquid: null, cushionMonths: null })
    expect(status(unread).sub).toBe(
      "Your accounts didn't load, so the checks that read them are waiting. Reload to try again."
    )
  })

  it('counts the checks that wait on an answer', () => {
    const card = facts({
      cushionMonths: 4,
      liquid: 8000,
      debts: [
        {
          kind: 'card',
          id: 3,
          name: 'Visa',
          owed: 400,
          rate: null,
          payment: null,
          carried: null,
          expensive: null,
        },
      ],
    })
    expect(status(card).sub).toBe('One check waits on your answer.')
  })

  it('says when no account holds money to count', () => {
    expect(status(facts({ liquid: null, cushionMonths: null })).sub).toBe(
      'None of your accounts holds money you can reach yet, so the cushion checks are waiting.'
    )
  })

  it.each([
    [
      'sorted',
      facts({ sortedShare: 89.9 }),
      '89% of your spending has a category. Clear picture needs 90%.',
    ],
    ['own income', facts({ ownIncome: 2400.2 }), '€100 a month short of covering what you spend.'],
    [
      'a first cushion',
      facts({ liquid: 1000, cushionMonths: 0.5 }),
      '€1,000 to a month of essentials.',
    ],
    [
      'one expensive debt',
      facts({
        cushionMonths: 4,
        liquid: 8000,
        debts: [
          {
            kind: 'card',
            id: 3,
            name: 'Visa',
            owed: 400,
            rate: 19.9,
            payment: 50,
            carried: true,
            expensive: true,
          },
        ],
      }),
      'One debt at 10% or more comes first.',
    ],
    [
      'two expensive debts',
      facts({
        cushionMonths: 4,
        liquid: 8000,
        debts: [
          {
            kind: 'card',
            id: 3,
            name: 'Visa',
            owed: 400,
            rate: 19.9,
            payment: 50,
            carried: true,
            expensive: true,
          },
          {
            kind: 'overdraft',
            id: 1,
            name: 'Everyday',
            owed: 90,
            rate: 11,
            payment: null,
            carried: true,
            expensive: true,
          },
        ],
      }),
      '2 debts at 10% or more come first.',
    ],
    [
      'two years',
      facts({ cushionMonths: 4, liquid: 8000, invested: 10000 }),
      '€50,000 to two years of spending.',
    ],
    [
      'work optional',
      facts({ cushionMonths: 4, liquid: 8000, invested: 70000 }),
      '€680,000 to €750,000, which at 4% a year covers what you spend.',
    ],
  ])('says the gap to %s', (_, f, sub) => {
    expect(status(f).sub).toBe(sub)
  })

  it('says every circle is reached', () => {
    const all = facts({
      cushionMonths: 7,
      liquid: 14000,
      invested: 2000000,
      enoughPerYear: 40000,
    })
    expect(status(all)).toEqual({
      meta: 'All seven reached',
      line: "You've reached all seven circles.",
      sub: null,
      waiting: null,
    })
  })

  it('says when the figures appear, before three months are tracked', () => {
    const none = facts({ months: [], monthsInYear: 0, firm: false, averaged: false })
    expect(status(none).waiting).toBe('Your figures appear once 3 months are tracked.')
    expect(
      status(facts({ months: ['2026-09'], monthsInYear: 1, firm: false, averaged: false })).waiting
    ).toBe('Your figures appear once 3 months are tracked. One is so far.')
    expect(
      status(
        facts({ months: ['2026-08', '2026-09'], monthsInYear: 2, firm: false, averaged: false })
      ).waiting
    ).toBe('Your figures appear once 3 months are tracked. Two are so far.')
  })
})

describe('the rows', () => {
  it('lists seven, each with its one-liner, state and pill', () => {
    const all = rows(base)
    expect(all.map((r) => [r.circle, r.state, r.pill])).toEqual([
      [1, 'reached', 'Reached'],
      [2, 'reached', 'Reached'],
      [3, 'reached', 'Reached'],
      [4, 'current', "You're here"],
      [5, 'later', 'Later'],
      [6, 'later', 'Later'],
      [7, 'later', 'Later'],
    ])
    expect(all.map((r) => r.line)).toEqual(Object.values(CIRCLE_LINES))
    expect(all[3].label).toBe("Solid ground. You're here. 2 of 3 months put by.")
  })

  it.each([0, 1, 3, 11, 12])('counts %i months on file in Clear picture', (n) => {
    const f = facts({
      monthsInYear: n,
      firm: n >= 12,
      averaged: n >= 3,
      sortedShare: n === 0 ? null : 80,
    })
    const first = row(f, 1)
    expect(first.key).toBe(`${n} of 12 months on file`)
    expect(first.months).toBe(n < 12 ? n : null)
    expect(first.measure).toBeCloseTo(n < 12 ? n / 12 : 80 / 90, 6)
  })

  it('says how much is sorted, and what is needed while Clear picture is the circle', () => {
    const f = facts({ sortedShare: 89.9 })
    expect(row(f, 1)).toMatchObject({
      state: 'current',
      detail: '89% of spending sorted; 90% is needed.',
    })
    expect(row(base, 1).detail).toBe('96% of spending sorted.')
  })

  it('gives rows 2 to 7 no figures before three months, and says so once', () => {
    const f = facts({ months: ['2026-09'], monthsInYear: 1, firm: false, averaged: false })
    for (const r of rows(f).slice(1)) {
      expect(r.key).toBeNull()
      expect(r.detail).toBeNull()
    }
  })

  it('reads Paying your way from own income, with support left out and investments that count', () => {
    expect(row(base, 2)).toMatchObject({
      key: 'Own income covers 120% of spending',
      detail: '€3,000 in, €2,500 out a month.',
    })
    const support = facts({ income: 3000, ownIncome: 2400, invested: 0 })
    expect(row(support, 2)).toMatchObject({
      state: 'current',
      key: 'Own income covers 96% of spending',
      detail: '€3,000 in, €2,500 out a month. €600 a month you marked as support is left out.',
    })
    const viaInvested = facts({ ownIncome: 1000, invested: 900000 })
    expect(row(viaInvested, 2)).toMatchObject({
      state: 'reached',
      key: 'Own income covers 40% of spending',
      detail: '€3,000 in, €2,500 out a month. Your investments could cover it, which counts too.',
    })
  })

  it('reads Breathing room in days under a month, and months over it', () => {
    expect(row(facts({ cushionMonths: 0.5, liquid: 1000 }), 3)).toMatchObject({
      state: 'current',
      key: '15 days of essentials',
      detail: '€1,000 you can reach, against €2,000 needed a month.',
    })
    expect(row(facts({ cushionMonths: 1, liquid: 2000 }), 3).key).toBe('1 month of essentials')
    expect(row(base, 3).key).toBe('2 months of essentials')
    const spentOnly = facts({ unsure: { categories: 4, uncategorised: 0, all: true } })
    expect(row(spentOnly, 3).detail).toBe('€4,000 you can reach, against €2,500 spent a month.')
  })

  it('reads Solid ground as the months put by: of three, then on their own once met', () => {
    // Where the cushion stands, not the gap: Your next step and the check say that.
    expect(row(base, 4)).toMatchObject({
      key: '2 of 3 months put by',
      detail: 'No debt at 10% or more.',
    })
    // Never "3 of 3" beside a check not met.
    expect(row(facts({ cushionMonths: 2.9999, liquid: 5999.8 }), 4).key).toBe(
      '2.9 of 3 months put by'
    )
    expect(row(facts({ cushionMonths: 4.25, liquid: 8500 }), 4).key).toBe('4.2 months put by')
  })

  it('names the debt that comes first, the answer it waits on, and the yearly bills', () => {
    const loan = facts({
      debts: [
        {
          kind: 'loan',
          id: 2,
          name: 'Car loan',
          owed: 9000,
          rate: 11.5,
          payment: 300,
          carried: true,
          expensive: true,
        },
      ],
    })
    expect(row(loan, 4).detail).toBe('Car loan at 11.5% comes first.')
    const card = facts({
      debts: [
        {
          kind: 'card',
          id: 3,
          name: null,
          owed: 400,
          rate: null,
          payment: null,
          carried: null,
          expensive: null,
        },
      ],
    })
    expect(row(card, 4).detail).toBe('The debt check waits on one answer.')
    const bills = facts({ yearlyBills: { count: 2, perYear: 770, perMonth: 770 / 12 } })
    expect(row(bills, 4).detail).toBe(
      'No debt at 10% or more. Yearly bills: about €65 a month to set aside.'
    )
  })

  it('says when no account holds money to count, and when the accounts did not load', () => {
    const none = facts({ liquid: null, cushionMonths: null })
    expect(row(none, 3).key).toBe('No account to count yet')
    expect(row(none, 4).key).toBe('No account to count yet')
    const unread = facts({ accountsKnown: false, liquid: null, cushionMonths: null })
    for (const circle of [3, 4, 5, 6]) {
      expect(row(unread, circle).key).toBe("Couldn't read your accounts")
    }
    // No own number yet: nothing in row 7 reads the accounts.
    expect(row(unread, 7).key).toBe('Your own number')
    expect(row({ ...unread, enoughPerYear: 40000 }, 7).key).toBe("Couldn't read your accounts")
    // A figure already past its target stays met, though the circles inside it wait.
    const rich = facts({
      accountsKnown: false,
      liquid: null,
      cushionMonths: null,
      invested: 900000,
    })
    expect(row(rich, 6)).toMatchObject({ key: '€900,000 of €750,000: 120%', measure: 1 })
  })

  it('has words for nothing marked as needed, never Infinity', () => {
    const f = facts({ essentials: 0, cushionMonths: Infinity })
    expect(row(f, 3).key).toBe('Nothing is marked as needed every month')
    expect(row(f, 4).key).toBe('Nothing is marked as needed every month')
    expect(JSON.stringify(rows(f))).not.toContain('Infinity')
  })

  it('reads Room to choose and Work optional towards their targets', () => {
    const f = facts({ cushionMonths: 4, liquid: 8000, invested: 10000 })
    expect(row(f, 5)).toMatchObject({
      state: 'current',
      key: '€10,000 of €60,000: 16%',
      detail: "Counts what you've invested, plus money in reach beyond six months of essentials.",
    })
    expect(row(f, 6)).toMatchObject({
      key: '€10,000 of €750,000: 1%',
      detail: 'Enough invested that taking 4% a year covers what you spend.',
    })
    const zero = facts({ cushionMonths: 4, liquid: 8000 })
    expect(row(zero, 5).key).toBe('Two years of spending: €60,000')
    expect(row(zero, 6).key).toBe('25 years of spending: €750,000')
  })

  it('asks for the own number in More than enough, and reads it once given', () => {
    expect(row(base, 7)).toMatchObject({
      key: 'Your own number',
      detail: 'Asked once you reach Work optional.',
    })
    const seventh = facts({ cushionMonths: 7, liquid: 14000, invested: 800000 })
    expect(row(seventh, 7)).toMatchObject({
      state: 'current',
      key: 'Your own number',
      detail: 'What would a year of more than enough cost?',
    })
    const set = facts({ cushionMonths: 7, liquid: 14000, invested: 800000, enoughPerYear: 40000 })
    expect(row(set, 7)).toMatchObject({
      state: 'current',
      key: '€800,000 of €1,000,000: 80%',
      detail: 'A year of more than enough: €40,000.',
    })
  })
})
