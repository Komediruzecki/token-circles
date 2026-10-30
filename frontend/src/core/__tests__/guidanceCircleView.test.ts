/**
 * One circle, opened (shared/guidance/circleView.ts): the checks in the method's order, what a check
 * not known waits on, the person's numbers behind them, and which questions each circle's view
 * asks. Round invented values, none of them anyone's.
 */
import { describe, expect, it } from 'vitest'
import { placeCircle } from '../../../../shared/guidance/circles'
import {
  checkRows,
  checksLine,
  circleNumbers,
  circleQuestions,
} from '../../../../shared/guidance/circleView'
import { facts, words } from './guidanceFixtures'
import type { CircleNumber } from '../../../../shared/guidance/circles'
import type { Debt, GuidanceFacts, WindowCategory } from '../../../../shared/guidance/facts'

const place = (f: GuidanceFacts, circle: CircleNumber, freeMoney = false) =>
  placeCircle(f, { freeMoney }).circles[circle - 1]

const rows = (f: GuidanceFacts, circle: CircleNumber, current: CircleNumber | null = 4) =>
  checkRows(place(f, circle, true), f, words, current)

const row = (f: GuidanceFacts, circle: CircleNumber, id: string, current?: CircleNumber | null) =>
  rows(f, circle, current).find((one) => one.id === id)

const numbers = (f: GuidanceFacts, circle: CircleNumber, holdings: number | null = null) =>
  circleNumbers(circle, f, words, { holdings, kindsAsked: false })

const card: Debt = {
  kind: 'card',
  id: 3,
  name: 'Travel card',
  owed: 300,
  rate: null,
  payment: null,
  carried: null,
  expensive: null,
  since: '2026-09-02',
}

const loan: Debt = {
  kind: 'loan',
  id: 7,
  name: 'Car loan',
  owed: 5000,
  rate: 12,
  payment: 250,
  carried: true,
  expensive: true,
}

const category = (over: Partial<WindowCategory>): WindowCategory => ({
  id: 1,
  name: 'Salary',
  type: 'income',
  perMonth: 3000,
  essential: false,
  via: null,
  ...over,
})

describe('what a circle checks', () => {
  it('counts what it needs and what is optional', () => {
    expect(checksLine(place(facts(), 2))).toBe('It needs this one.')
    expect(checksLine(place(facts(), 1))).toBe('It needs both of these.')
    expect(checksLine(place(facts(), 4))).toBe('It needs 2 of these, and 1 more is optional.')
    expect(
      checksLine(place(facts({ yearlyBills: { count: 2, perYear: 1200, perMonth: 100 } }), 4))
    ).toBe('It needs 2 of these, and 2 more are optional.')
  })

  it('lists Clear picture with the months and the share sorted', () => {
    expect(rows(facts(), 1)).toEqual([
      {
        id: 'year-on-file',
        title: 'A year on file',
        detail: '12 of the last 13 months are tracked. A month counts once it holds 3 entries.',
        state: 'met',
        waiting: null,
        needed: 'Needed to reach Clear picture',
      },
      {
        id: 'sorted',
        title: 'Spending sorted',
        detail: '96% of your spending has a category; 90% is needed.',
        state: 'met',
        waiting: null,
        needed: 'Needed to reach Clear picture',
      },
    ])
    expect(row(facts({ monthsInYear: 1, firm: false }), 1, 'year-on-file')?.detail).toBe(
      '1 of the last 13 months is tracked. A month counts once it holds 3 entries.'
    )
    expect(row(facts({ monthsInYear: 0, firm: false }), 1, 'year-on-file')?.detail).toBe(
      'None of the last 13 months is tracked yet. A month counts once it holds 3 entries.'
    )
  })

  it('never shows a share as reaching 90% before it does', () => {
    const sorted = row(facts({ sortedShare: 89.9 }), 1, 'sorted')
    expect(sorted?.state).toBe('not-yet')
    expect(sorted?.detail).toBe('89% of your spending has a category; 90% is needed.')
  })

  it('reads own income against spending, or the investments that cover it', () => {
    expect(row(facts(), 2, 'own-income')?.detail).toBe('€3,000 in, €2,500 out a month.')
    const covered = row(
      facts({ ownIncome: 1000, invested: 1_000_000, withdrawalRatePct: 4 }),
      2,
      'own-income'
    )
    expect(covered?.state).toBe('met')
    expect(covered?.detail).toBe(
      'Your investments could cover what you spend, which counts as paying your way.'
    )
  })

  it('counts the first cushion in whole days', () => {
    expect(row(facts(), 3, 'first-cushion')?.detail).toBe(
      '60 days: €4,000 you can reach, against €2,000 needed a month.'
    )
    expect(row(facts({ liquid: 1990, cushionMonths: 0.995 }), 3, 'first-cushion')).toMatchObject({
      state: 'not-yet',
      detail: '29 days: €1,990 you can reach, against €2,000 needed a month.',
    })
  })

  it('gives Solid ground the debt check, then the cushion with its gap', () => {
    expect(rows(facts(), 4).map(({ id, state, needed }) => ({ id, state, needed }))).toEqual([
      { id: 'no-expensive-debt', state: 'met', needed: 'Needed to reach Solid ground' },
      { id: 'solid-cushion', state: 'not-yet', needed: 'Needed to reach Solid ground' },
      { id: 'full-cushion', state: 'not-yet', needed: null },
    ])
    expect(row(facts(), 4, 'no-expensive-debt')?.detail).toBe('No loans or cards on file.')
    expect(
      row(facts({ debts: [{ ...loan, rate: 5, expensive: false }] }), 4, 'no-expensive-debt')
        ?.detail
    ).toBe('Your loans and cards are under 10% a year, or carry nothing.')
    expect(row(facts(), 4, 'solid-cushion')?.detail).toBe(
      '2 months: €4,000 against €2,000 a month. €2,000 to go.'
    )
    expect(row(facts(), 4, 'full-cushion')?.detail).toBe(
      '€12,000 would be six months: €8,000 to go. Six is where most guides stop.'
    )
    const full = facts({ liquid: 13000, cushionMonths: 6.5 })
    expect(row(full, 4, 'solid-cushion')?.detail).toBe(
      '6.5 months: €13,000 against €2,000 a month.'
    )
    expect(row(full, 4, 'full-cushion')?.detail).toBe('6.5 months put by.')
  })

  it('says the gap where two figures would read the same beside Not yet', () => {
    // 1,999.60 against 2,000.40 rounds to "€2,000 in, €2,000 out": not met, so the gap says it.
    const close = facts({ ownIncome: 1999.6, income: 1999.6, spending: 2000.4 })
    expect(row(close, 2, 'own-income')).toMatchObject({
      state: 'not-yet',
      detail: '€1 a month short of covering what you spend.',
    })
    expect(
      row(facts({ ownIncome: 1500, income: 1500, spending: 2000 }), 2, 'own-income')?.detail
    ).toBe('€1,500 in, €2,000 out a month.')
    const nearlyAMonth = facts({
      liquid: 1999.6,
      essentials: 2000.4,
      cushionMonths: 1999.6 / 2000.4,
    })
    expect(row(nearlyAMonth, 3, 'first-cushion')).toMatchObject({
      state: 'not-yet',
      detail: '29 days: €1 to a month of essentials.',
    })
    // Two years is 60,000; 59,999.60 invested reads as 60,000.
    const twoYears = facts({ cushionMonths: 4, liquid: 8000, invested: 59999.6 })
    expect(row(twoYears, 5, 'two-years')).toMatchObject({
      state: 'not-yet',
      detail: '€1 to go: invested, plus money in reach beyond six months of essentials.',
    })
    const workOptional = facts({ cushionMonths: 4, liquid: 8000, invested: 749999.6 })
    expect(row(workOptional, 6, 'work-optional')).toMatchObject({
      state: 'not-yet',
      detail: '€1 to go. At 4% a year, €750,000 covers what you spend.',
    })
    const enough = facts({
      cushionMonths: 4,
      liquid: 8000,
      invested: 999999.6,
      enoughPerYear: 40000,
    })
    expect(row(enough, 7, 'enough', 7)).toMatchObject({ state: 'not-yet', detail: '€1 to go.' })
    // Met, the two figures stand: they are what met it.
    expect(
      row(facts({ cushionMonths: 4, liquid: 8000, invested: 60000 }), 5, 'two-years')?.detail
    ).toBe('€60,000 of €60,000: invested, plus money in reach beyond six months of essentials.')
  })

  it('names the expensive debt, and the card it waits on an answer for', () => {
    expect(row(facts({ debts: [loan] }), 4, 'no-expensive-debt')).toMatchObject({
      state: 'not-yet',
      detail: 'Car loan at 12%, €5,000 owed.',
      waiting: null,
    })
    expect(row(facts({ debts: [card] }), 4, 'no-expensive-debt')).toMatchObject({
      state: 'not-known',
      detail:
        'Travel card has been here since September 2026, too short to show whether you carry its €300.',
      waiting: 'Waiting on your answer',
    })
    expect(row(facts({ debts: [{ ...card, since: null }] }), 4, 'no-expensive-debt')?.detail).toBe(
      'Travel card has too few entries to show whether you carry its €300.'
    )
  })

  it('says when a check waits on the accounts, not on the person', () => {
    const unread = facts({ accountsKnown: false, liquid: null, cushionMonths: null })
    expect(row(unread, 4, 'solid-cushion')).toMatchObject({
      state: 'not-known',
      waiting: "Your accounts didn't load",
    })
    expect(row(unread, 4, 'no-expensive-debt')).toMatchObject({
      state: 'not-known',
      waiting: "Your accounts didn't load",
      detail: null,
    })
  })

  it('says a check waits on three tracked months while there are fewer', () => {
    const short = facts({
      monthsInYear: 2,
      firm: false,
      averaged: false,
      income: null,
      ownIncome: null,
      spending: null,
      essentials: null,
      cushionMonths: null,
    })
    expect(row(short, 2, 'own-income')).toMatchObject({
      state: 'not-known',
      waiting: 'Known once 3 months are tracked',
      detail: null,
    })
  })

  it('lists yearly bills on Solid ground, waiting on the answer', () => {
    const one = facts({ yearlyBills: { count: 1, perYear: 600, perMonth: 50 } })
    expect(row(one, 4, 'yearly-bills')).toMatchObject({
      title: 'Yearly bills set aside',
      detail: 'One yearly bill on Bills comes to €600 a year: about €50 a month.',
      state: 'not-known',
      waiting: 'Waiting on your answer',
      needed: null,
    })
    const two = facts({
      yearlyBills: { count: 2, perYear: 1210, perMonth: 1210 / 12 },
      setsAsideYearly: true,
    })
    expect(row(two, 4, 'yearly-bills')).toMatchObject({
      detail: '2 yearly bills on Bills come to €1,210 a year: about €101 a month.',
      state: 'met',
      waiting: null,
    })
  })

  it("reads back the free-money answer in its chip's words", () => {
    expect(row(facts({ region: 'DE', freeMoney: 'taken' }), 4, 'free-money')).toMatchObject({
      title: 'Free money from your employer',
      detail: 'Your answer: I use it.',
      state: 'met',
    })
    expect(row(facts({ region: 'US', freeMoney: 'partly' }), 4, 'free-money')).toMatchObject({
      title: "Your employer's match",
      detail: 'Your answer: Some of it.',
      state: 'not-yet',
    })
    expect(row(facts({ region: 'UK' }), 4, 'free-money')).toMatchObject({
      detail: null,
      state: 'not-known',
      waiting: 'Waiting on your answer',
    })
  })

  it('asks for the own number only once More than enough is the circle worked on', () => {
    expect(row(facts(), 7, 'enough', 4)).toMatchObject({
      state: 'not-known',
      waiting: 'Asked once you reach Work optional',
    })
    expect(row(facts(), 7, 'enough', 7)).toMatchObject({ waiting: 'Waiting on your answer' })
  })

  it('reads the investments against their targets', () => {
    const rich = facts({ invested: 100_000, enoughPerYear: 48_000 })
    expect(row(rich, 5, 'two-years')?.detail).toBe(
      '€100,000 of €60,000: invested, plus money in reach beyond six months of essentials.'
    )
    expect(row(rich, 6, 'work-optional')?.detail).toBe(
      '€100,000 of €750,000. At 4% a year, €750,000 covers what you spend.'
    )
    expect(row(rich, 7, 'enough', 7)?.detail).toBe('€100,000 of €1,200,000.')
  })
})

describe("the person's numbers", () => {
  it('says which months the averages cover, or that they wait on three', () => {
    expect(numbers(facts(), 1).lead).toBe(
      'Averages over January 2025 to December 2025. Balances as of today.'
    )
    expect(numbers(facts({ averaged: false }), 1).lead).toBe(
      'Averages appear once 3 months are tracked. Balances as of today.'
    )
  })

  it('gives Clear picture its months, its share and what has no category', () => {
    expect(numbers(facts({ uncategorisedEntries: 4 }), 1).rows).toEqual([
      { label: 'Months on file', value: '12 of 12' },
      { label: 'Spending sorted', value: '96%' },
      { label: 'Entries without a category', value: '4' },
    ])
  })

  it('shows own income without the support marked', () => {
    const rows = numbers(facts({ income: 3000, ownIncome: 2500 }), 2).rows
    expect(rows[1]).toEqual({
      label: 'Own income a month',
      value: '€2,500',
      note: 'Without the €500 a month you marked as support.',
    })
    expect(numbers(facts(), 2).rows[1].note).toBeUndefined()
  })

  it('says where the money in reach is, and what counts as needed by default', () => {
    const f = facts({
      liquidParts: { savings: 3000, current: 800, cash: 200 },
      unsure: { categories: 2, uncategorised: 0, all: false },
      debts: [loan, card],
    })
    const rows = numbers(f, 3).rows
    expect(rows[0]).toEqual({
      label: 'Money you can reach',
      value: '€4,000',
      note: 'Savings €3,000, current accounts at their lowest in the last 30 days €800, cash €200.',
    })
    // One part holds it all: its figure would only repeat the row's, so the row stands alone.
    const reach = (savings: number, current: number, cash: number) =>
      numbers(facts({ liquidParts: { savings, current, cash } }), 4).rows[0]
    expect(reach(4000, 0, 0)).toEqual({ label: 'Money you can reach', value: '€4,000' })
    expect(reach(0, 0, 4000).note).toBeUndefined()
    // Current accounts alone still say how they are counted, without the figure again.
    expect(reach(0, 4000, 0).note).toBe(
      'Your current accounts at their lowest in the last 30 days.'
    )
    expect(rows[1]).toEqual({
      label: 'Needed every month',
      value: '€2,000',
      note: '2 categories count as needed because nothing says otherwise. Choose what you need every month.',
    })
    expect(rows[2]).toEqual({
      label: 'Debts',
      value: '€5,300',
      note: 'Car loan €5,000 at 12%, Travel card €300.',
    })
    expect(
      circleNumbers(4, f, words, { holdings: null, kindsAsked: true }).rows[1].note
    ).toBeUndefined()
    expect(numbers(facts({ accountsKnown: false }), 4).rows[0].value).toBe(
      "Couldn't read your accounts"
    )
  })

  it('says holdings count at what was paid for them', () => {
    expect(numbers(facts({ invested: 20_000 }), 5, 20_000).rows[0]).toEqual({
      label: 'Invested',
      value: '€20,000',
      note: 'Holdings at what you paid for them.',
    })
    expect(numbers(facts({ invested: 20_000 }), 5, null).rows[0].note).toBeUndefined()
  })

  it('links the withdrawal rate to Retirement, where it is set', () => {
    expect(numbers(facts({ withdrawalRatePct: 3.5 }), 6).rows[2]).toEqual({
      label: 'Withdrawal rate',
      value: '3.5%',
      link: { hash: '#retirement', label: 'Change it on Retirement' },
    })
  })

  it('works out the target from the own number', () => {
    expect(numbers(facts({ enoughPerYear: 48_000 }), 7).rows.slice(1)).toEqual([
      { label: 'Your number', value: '€48,000 a year' },
      { label: 'Target', value: '€1,200,000' },
    ])
    expect(numbers(facts(), 7).rows.slice(1)).toEqual([
      { label: 'Your number', value: 'Not set' },
      { label: 'Target', value: 'Not set' },
    ])
  })
})

describe('the questions each circle asks', () => {
  const at = { kindsAsked: false, current: 4 as CircleNumber | null, gate: false }

  it('asks about support in Paying your way while there is income to tick', () => {
    expect(circleQuestions(2, facts({ windowCategories: [category({})] }), at)).toEqual(['support'])
    expect(circleQuestions(2, facts({ windowCategories: [] }), at)).toEqual([])
  })

  it('asks which spending is needed while some counts so only by default', () => {
    const f = facts({
      unsure: { categories: 1, uncategorised: 0, all: false },
      windowCategories: [category({ id: 2, name: 'Rent', type: 'expense', via: 'no-kind' })],
    })
    expect(circleQuestions(3, f, at)).toEqual(['essentials'])
    expect(circleQuestions(4, f, at)).toEqual(['essentials'])
    expect(circleQuestions(3, f, { ...at, kindsAsked: true })).toEqual([])
    expect(circleQuestions(3, facts({ windowCategories: f.windowCategories }), at)).toEqual([])
  })

  it('asks the card question while a card or an overdraft is below zero, answered or not', () => {
    expect(circleQuestions(4, facts({ belowZero: 1, debts: [card] }), at)).toEqual(['card'])
    // After "No", the debts leave the card out; the question stays to change the answer.
    expect(circleQuestions(4, facts({ belowZero: 1, debts: [] }), at)).toEqual(['card'])
    expect(circleQuestions(4, facts({ debts: [loan] }), at)).toEqual([])
  })

  it('asks about yearly bills while Bills holds one, and free money only behind the gate', () => {
    const f = facts({ region: 'DE', yearlyBills: { count: 1, perYear: 600, perMonth: 50 } })
    expect(circleQuestions(4, f, at)).toEqual(['yearly-bills'])
    expect(circleQuestions(4, f, { ...at, gate: true })).toEqual(['free-money', 'yearly-bills'])
    expect(circleQuestions(4, facts({ region: 'EU27' }), { ...at, gate: true })).toEqual([])
  })

  it('asks about savings elsewhere in Room to choose, and the own number at the last circle', () => {
    expect(circleQuestions(5, facts(), at)).toEqual(['saved-elsewhere'])
    expect(circleQuestions(7, facts(), at)).toEqual([])
    expect(circleQuestions(7, facts(), { ...at, current: 7 })).toEqual(['enough'])
    expect(circleQuestions(1, facts(), at)).toEqual([])
    expect(circleQuestions(6, facts(), at)).toEqual([])
  })
})
