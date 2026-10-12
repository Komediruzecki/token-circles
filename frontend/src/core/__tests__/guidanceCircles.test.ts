/**
 * The seven circles (shared/guidance/circles.ts): each is reached when the one inside it is and
 * its own checks are met, the current circle is the first one not reached, and the next step is
 * its first check not met. A year on file firms them up; a hard month moves a person inward.
 */
import { describe, expect, it } from 'vitest'
import { addCalendarMonths } from '../../../../shared/calendarMonths'
import {
  CIRCLE_NAMES,
  CIRCLES,
  CLEAR_PICTURE_MONTHS,
  FREE_MONEY_REGIONS,
  MORE_THAN_ENOUGH_DEFAULT,
  placeCircle,
} from '../../../../shared/guidance/circles'
import { guidanceFacts } from '../../../../shared/guidance/facts'
import type { CheckId, Placement } from '../../../../shared/guidance/circles'
import type { FactsEntry, GuidanceFacts, GuidanceInput } from '../../../../shared/guidance/facts'

/** A year on file, every circle up to the seventh reached: the number for it is not given. */
const outer: GuidanceFacts = {
  today: '2026-10-11',
  region: 'DE',
  months: [],
  monthsInYear: 12,
  firm: true,
  averaged: true,
  sortedShare: 100,
  income: 6000,
  ownIncome: 6000,
  spending: 3000,
  annualSpending: 36000,
  essentials: 2000,
  unsure: { categories: 0, uncategorised: 0, all: false },
  liquid: 13000,
  cushionMonths: 6.5,
  invested: 900000,
  debts: [],
  accountsKnown: true,
  principalRepaid: 0,
  savings: { rate: 50, cash: 50, withPrincipal: 50 },
  withdrawalRatePct: 4,
  enoughPerYear: null,
  freeMoney: 'taken',
}

const facts = (over: Partial<GuidanceFacts>): GuidanceFacts => ({ ...outer, ...over })

const check = (placement: Placement, circle: number, id: CheckId) =>
  placement.circles[circle - 1].checks.find((c) => c.id === id)

describe('the circles (D1, D2)', () => {
  it('are seven, in order, with their names', () => {
    expect(CIRCLES.map((c) => c.circle)).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(placeCircle(outer).circles.map((c) => c.name)).toEqual([
      'Clear picture',
      'Paying your way',
      'Breathing room',
      'Solid ground',
      'Room to choose',
      'Work optional',
      'More than enough',
    ])
    expect(Object.values(CIRCLE_NAMES)).toHaveLength(7)
  })

  it('check what guidance.md 3.2 says each one checks, in the order the next step takes them', () => {
    expect(placeCircle(outer).circles.map((c) => c.checks.map((k) => k.id))).toEqual([
      ['year-on-file', 'sorted'],
      ['own-income'],
      ['first-cushion'],
      ['free-money', 'no-expensive-debt', 'solid-cushion', 'full-cushion'],
      ['two-years'],
      ['work-optional'],
      ['enough'],
    ])
  })
})

describe('where a person is', () => {
  it('is the first circle not reached, and the next step its first check not met', () => {
    const placement = placeCircle(outer)
    expect(placement.current).toBe(7)
    // The number for it is not given: asked for, not advised, and the circle not known reached.
    expect(placement.next).toEqual({ circle: 7, check: 'enough', unknown: 'not-on-file' })
    expect(placement.provisional).toBe(true)
    // With the number, the step is known.
    const named = placeCircle(facts({ enoughPerYear: 80000 }))
    expect(named.next).toEqual({ circle: 7, check: 'enough', unknown: null })
    expect(named.provisional).toBe(false)
  })

  it('has no default for More than enough (D11): it waits for the person’s own number', () => {
    expect(MORE_THAN_ENOUGH_DEFAULT).toBeNull()
    expect(check(placeCircle(outer), 7, 'enough')).toMatchObject({ met: null, target: null })
    // 80,000 a year at 4% is two million.
    const named = placeCircle(facts({ enoughPerYear: 80000 }))
    expect(check(named, 7, 'enough')).toMatchObject({ met: false, target: 2000000 })
    const there = placeCircle(facts({ enoughPerYear: 30000 }))
    expect(there.current).toBeNull()
    expect(there.next).toBeNull()
    expect(there.circles.every((c) => c.reached)).toBe(true)
  })

  it('reaches a circle only with every circle inside it', () => {
    // Plenty invested, but a card at 19.9%: Solid ground is not reached, nor anything past it.
    const placement = placeCircle(
      facts({
        debts: [
          {
            kind: 'card',
            id: 1,
            name: null,
            owed: 900,
            rate: 19.9,
            payment: null,
            carried: true,
            expensive: true,
          },
        ],
      })
    )
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
    // Work optional's own check is met all the same, and shows as met.
    expect(check(placement, 6, 'work-optional')!.met).toBe(true)
    expect(placement.next).toEqual({ circle: 4, check: 'no-expensive-debt', unknown: null })
  })

  it('needs a year for the first circle (D10), and 90% of spending sorted', () => {
    expect(CLEAR_PICTURE_MONTHS).toBe(12)
    expect(placeCircle(facts({ monthsInYear: 11, firm: false })).current).toBe(1)
    const unsorted = placeCircle(facts({ sortedShare: 89.9 }))
    expect(unsorted.current).toBe(1)
    expect(unsorted.next).toEqual({ circle: 1, check: 'sorted', unknown: null })
    expect(placeCircle(facts({ sortedShare: 90 })).current).toBe(7)
  })

  it('stays provisional until a year is on file, and leaves the next step to Getting started', () => {
    const early = placeCircle(facts({ monthsInYear: 7, firm: false }))
    expect(early.provisional).toBe(true)
    expect(early.next).toBeNull()
    expect(check(early, 2, 'own-income')!.provisional).toBe(true)
    // The cushion is today's balances against the months there are.
    expect(check(early, 3, 'first-cushion')!.provisional).toBe(false)
  })
})

describe('Solid ground', () => {
  it('asks about free money first, where there is a scheme to ask about', () => {
    expect([...FREE_MONEY_REGIONS].sort()).toEqual(['DE', 'HR', 'UK', 'US'])
    const unanswered = placeCircle(facts({ freeMoney: null, cushionMonths: 2.9, liquid: 5800 }))
    expect(unanswered.current).toBe(4)
    expect(unanswered.next).toEqual({ circle: 4, check: 'free-money', unknown: 'not-on-file' })
    // It is asked about, and only a required check not known leaves the placement provisional.
    expect(unanswered.provisional).toBe(false)
    // The EU average has no one scheme: the debts and the cushion come first there.
    const eu = placeCircle(
      facts({ region: 'EU27', freeMoney: null, cushionMonths: 2.9, liquid: 5800 })
    )
    expect(check(eu, 4, 'free-money')).toBeUndefined()
    expect(eu.next).toEqual({ circle: 4, check: 'solid-cushion', unknown: null })
  })

  it('takes free money as met when taken or not offered, and as the step still to take otherwise', () => {
    const met = (freeMoney: GuidanceFacts['freeMoney']) =>
      check(placeCircle(facts({ freeMoney })), 4, 'free-money')!.met
    expect(met('taken')).toBe(true)
    expect(met('not-offered')).toBe(true)
    expect(met('not-taken')).toBe(false)
    expect(met('not-sure')).toBe(false)
    expect(met(null)).toBeNull()
    expect(check(placeCircle(facts({ freeMoney: null })), 4, 'free-money')!.unknown).toBe(
      'not-on-file'
    )
    // It is on the checklist, not a condition: Solid ground is reached without it.
    expect(placeCircle(facts({ freeMoney: 'not-taken' })).circles[3].reached).toBe(true)
  })

  it('is reached at three months, and keeps six on its checklist', () => {
    const three = placeCircle(facts({ cushionMonths: 3, liquid: 6000, invested: 0 }))
    expect(three.circles[3].reached).toBe(true)
    expect(check(three, 4, 'full-cushion')).toMatchObject({ met: false, required: false })
    expect(three.current).toBe(5)
  })

  it('cannot say there is no expensive debt without the accounts, where cards are', () => {
    expect(
      check(placeCircle(facts({ accountsKnown: false })), 4, 'no-expensive-debt')
    ).toMatchObject({ met: null, unknown: 'unread' })
  })
})

describe('Room to choose and Work optional', () => {
  it('count liquid money beyond six months of essentials towards two years of spending', () => {
    // 72,000 is two years. 60,000 invested and 12,000 beyond six months of 2,000.
    const two = placeCircle(facts({ invested: 60000, liquid: 24000, cushionMonths: 12 }))
    expect(check(two, 5, 'two-years')).toMatchObject({ value: 72000, target: 72000, met: true })
    expect(check(placeCircle(facts({ invested: 60000 })), 5, 'two-years')!.met).toBe(false)
  })

  it('put work optional at a year of spending over the withdrawal rate', () => {
    expect(check(placeCircle(outer), 6, 'work-optional')!.target).toBe(900000)
    expect(check(placeCircle(facts({ withdrawalRatePct: 3 })), 6, 'work-optional')!.target).toBe(
      1200000
    )
    expect(placeCircle(facts({ invested: 899999 })).current).toBe(6)
  })
})

describe('moving inward', () => {
  /** A family with a year on file, nearly three months put by, and its free money taken. */
  const months = Array.from({ length: 12 }, (_, i) =>
    addCalendarMonths('2025-10-01', i).slice(0, 7)
  )
  const lines = (month: string): FactsEntry[] => [
    { date: `${month}-01`, type: 'income', amount: 5900, category_id: 9 },
    { date: `${month}-02`, type: 'expense', amount: 1650, category_id: 1 },
    { date: `${month}-03`, type: 'expense', amount: 2000, category_id: 2 },
    { date: `${month}-04`, type: 'expense', amount: 1500, category_id: 3 },
  ]
  const before: GuidanceInput = {
    today: '2026-10-11',
    region: 'DE',
    transactions: months.flatMap(lines),
    categories: [
      { id: 1, name: 'Rent', type: 'expense', kind: 'housing' },
      { id: 2, name: 'Groceries', type: 'expense', kind: 'groceries' },
      { id: 3, name: 'Leisure', type: 'expense', kind: 'leisure' },
      { id: 4, name: 'Car repairs', type: 'expense', kind: 'transport' },
      { id: 9, name: 'Salaries', type: 'income' },
    ],
    accounts: [
      { id: 1, type: 'giro', balance: 1200 },
      { id: 2, type: 'savings', balance: 9400 },
    ],
    answers: { freeMoney: 'taken' },
  }

  it('moves a person in after a hard month: the cushion paid for it, and is the next step', () => {
    const solid = placeCircle(guidanceFacts(before))
    expect(solid.current).toBe(4)

    // September: an 8,000 car repair, paid from savings.
    const after = placeCircle(
      guidanceFacts({
        ...before,
        transactions: [
          ...before.transactions,
          { date: '2026-09-20', type: 'expense', amount: 8000, category_id: 4 },
        ],
        accounts: [
          { id: 1, type: 'giro', balance: 1200 },
          { id: 2, type: 'savings', balance: 1400 },
        ],
      })
    )
    expect(after.current).toBe(3)
    expect(after.next).toEqual({ circle: 3, check: 'first-cushion', unknown: null })
  })
})

describe('what is not known', () => {
  // The review's person: a year on file, 2,500 a month in, 1,500 of it on groceries, needed every
  // month, free money taken, and 32,000 within reach.
  const months = Array.from({ length: 12 }, (_, i) =>
    addCalendarMonths('2025-10-01', i).slice(0, 7)
  )
  const year: GuidanceInput = {
    today: '2026-10-11',
    region: 'DE',
    transactions: months.flatMap((month): FactsEntry[] => [
      { date: `${month}-01`, type: 'income', amount: 2500, category_id: 9 },
      { date: `${month}-02`, type: 'expense', amount: 900, category_id: 1 },
      { date: `${month}-03`, type: 'expense', amount: 600, category_id: 1 },
    ]),
    categories: [
      { id: 1, name: 'Groceries', type: 'expense', kind: 'groceries' },
      { id: 9, name: 'Salary', type: 'income' },
    ],
    accounts: [
      { id: 1, type: 'giro', balance: 2000 },
      { id: 2, type: 'savings', balance: 30000 },
    ],
    answers: { freeMoney: 'taken' },
  }
  const reached = (placement: Placement) => placement.circles.map((c) => c.reached)

  it('with the full picture, places the person and gives the next step', () => {
    const placement = placeCircle(guidanceFacts(year))
    expect(placement.current).toBe(5)
    expect(placement.provisional).toBe(false)
    expect(placement.next).toEqual({ circle: 5, check: 'two-years', unknown: null })
  })

  it('with the accounts not read, stops at the cushion it cannot read, and says so', () => {
    const placement = placeCircle(guidanceFacts({ ...year, accounts: null }))
    expect(placement.current).toBe(3)
    expect(reached(placement)).toEqual([true, true, false, false, false, false, false])
    expect(placement.provisional).toBe(true)
    expect(placement.next).toEqual({ circle: 3, check: 'first-cushion', unknown: 'unread' })
    expect(check(placement, 3, 'first-cushion')).toMatchObject({ met: null, unknown: 'unread' })
    expect(check(placement, 4, 'no-expensive-debt')).toMatchObject({
      met: null,
      unknown: 'unread',
    })
  })

  it('with only an investment account on file, says nothing on file holds the cushion', () => {
    const placement = placeCircle(
      guidanceFacts({ ...year, accounts: [{ id: 3, type: 'ib', balance: 9000 }] })
    )
    expect(placement.current).toBe(3)
    expect(placement.provisional).toBe(true)
    expect(placement.next).toEqual({ circle: 3, check: 'first-cushion', unknown: 'not-on-file' })
    // The accounts were read: no card or overdraft is on file.
    expect(check(placement, 4, 'no-expensive-debt')).toMatchObject({ met: true, unknown: null })
  })

  it('with a card too new to say whether it is carried, asks the card question', () => {
    const card: GuidanceInput = {
      ...year,
      // Opened in September: 300 spent on it, 100 paid in.
      transactions: [
        ...year.transactions,
        { date: '2026-09-10', type: 'expense', amount: 300, category_id: 1, account_id: 3 },
        {
          date: '2026-09-28',
          type: 'transfer',
          amount: 100,
          account_id: 1,
          transfer_account_id: 3,
        },
      ],
      accounts: [...(year.accounts ?? []), { id: 3, type: 'credit', balance: -200 }],
    }
    const asked = placeCircle(guidanceFacts(card))
    expect(asked.current).toBe(4)
    expect(asked.provisional).toBe(true)
    expect(asked.next).toEqual({ circle: 4, check: 'no-expensive-debt', unknown: 'not-on-file' })
    // Answered, the answer decides.
    const answered = (carriesCardBalance: boolean) =>
      placeCircle(guidanceFacts({ ...card, answers: { freeMoney: 'taken', carriesCardBalance } }))
    expect(answered(false).current).toBe(5)
    expect(answered(true).next).toEqual({ circle: 4, check: 'no-expensive-debt', unknown: null })
    expect(answered(true).provisional).toBe(false)
  })

  it('reads a figure without the accounts as unknown below its target, and as met above it', () => {
    const unread = { accountsKnown: false, liquid: null, cushionMonths: null }
    const short = placeCircle(facts({ ...unread, invested: 60000 }))
    expect(check(short, 5, 'two-years')).toMatchObject({ met: null, unknown: 'unread' })
    expect(check(short, 6, 'work-optional')).toMatchObject({ met: null, unknown: 'unread' })
    // The accounts can only add to what the portfolio holds.
    const plenty = placeCircle(facts({ ...unread, invested: 2000000, enoughPerYear: 80000 }))
    expect(check(plenty, 5, 'two-years')).toMatchObject({ met: true, unknown: null })
    expect(check(plenty, 6, 'work-optional')).toMatchObject({ met: true, unknown: null })
    expect(check(plenty, 7, 'enough')).toMatchObject({ met: true, unknown: null })
    // A check known not met says nothing is unknown.
    expect(check(placeCircle(facts({ invested: 60000 })), 5, 'two-years')).toMatchObject({
      met: false,
      unknown: null,
    })
  })

  it('says why each check is not known: what could not be read, or what is not on file yet', () => {
    const few = placeCircle(
      facts({ averaged: false, ownIncome: null, spending: null, sortedShare: null })
    )
    expect(check(few, 1, 'sorted')).toMatchObject({ met: null, unknown: 'not-on-file' })
    expect(check(few, 2, 'own-income')).toMatchObject({ met: null, unknown: 'not-on-file' })
    const noAccount = placeCircle(facts({ liquid: null, cushionMonths: null }))
    for (const id of ['first-cushion', 'solid-cushion', 'full-cushion'] as const) {
      const circle = id === 'first-cushion' ? 3 : 4
      expect(check(noAccount, circle, id), id).toMatchObject({ met: null, unknown: 'not-on-file' })
    }
  })
})
