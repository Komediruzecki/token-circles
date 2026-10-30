/**
 * Your next step (shared/guidance/nextStep.ts): Getting started's first step until a year is on
 * file, then the current circle's first check not met, with "Then:" the next two. A check not
 * known is asked or read again, never advised, and the free-money question waits while the
 * benchmarks gate is closed.
 */
import { describe, expect, it } from 'vitest'
import { regionName } from '../../../../shared/guidance/cards'
import { placeCircle } from '../../../../shared/guidance/circles'
import { nextStepOf, stepCircleName, thenLine } from '../../../../shared/guidance/nextStep'
import { ASKED_ONCE } from '../../../../shared/guidance/questions'
import { REGIONS } from '../../../../shared/guidance/region'
import { orientationSteps } from '../../../../shared/orientation'
import { BASE_FACTS as base, facts, words } from './guidanceFixtures'
import type { PlaceOptions } from '../../../../shared/guidance/circles'
import type { Debt, GuidanceFacts } from '../../../../shared/guidance/facts'
import type { OrientationFacts } from '../../../../shared/orientation'

const debt = (over: Partial<Debt>): Debt => ({
  kind: 'card',
  id: 3,
  name: 'Visa',
  owed: 400,
  rate: 19.9,
  payment: 50,
  carried: true,
  expensive: true,
  ...over,
})

/** Getting started's steps for seven months on file, 30 of 200 entries unsorted, 15 days put by. */
const ORIENTATION: OrientationFacts = {
  today: '2026-10-15',
  trackedMonthsInYear: 7,
  subscriptionsSpotted: 0,
  billsSpotted: 0,
  entries: 200,
  uncategorised: 30,
  topUnbudgeted: null,
  heavyMonth: null,
  loans: 0,
  cushionMonths: 0.5,
  cushionAgainst: 'needs',
}

function step(f: GuidanceFacts, options: PlaceOptions = {}, orientation = null as never) {
  return nextStepOf({ placement: placeCircle(f, options), facts: f, orientation, words })
}

describe('before a year is on file', () => {
  it("takes Getting started's first step, and its next two as Then", () => {
    const seven = facts({ monthsInYear: 7, firm: false })
    const next = nextStepOf({
      placement: placeCircle(seven),
      facts: seven,
      orientation: orientationSteps(ORIENTATION),
      words,
    })
    expect(next).toEqual({
      id: 'import-year',
      circle: 1,
      title: 'Import the rest of your year',
      why: '7 of the last 13 months are tracked. A month counts once it holds 3 entries.',
      action: { kind: 'open', hash: '#import', label: 'Open Import' },
      meter: { kind: 'cells', on: 7, left: '7 of 12 months on file', right: 'A year' },
      then: 'Then: sort the 30 entries without a category, and build a one-month cushion.',
      fine: null,
    })
    expect(stepCircleName(next)).toBe('Clear picture')
  })

  it('reads the circles when Getting started has no steps to give', () => {
    const seven = facts({ monthsInYear: 7, firm: false })
    expect(step(seven)).toMatchObject({
      id: 'year-on-file',
      title: 'Import the rest of your year',
      meter: { kind: 'cells', on: 7 },
    })
    const none = facts({
      months: [],
      monthsInYear: 0,
      firm: false,
      averaged: false,
      sortedShare: null,
    })
    expect(step(none)).toMatchObject({
      id: 'year-on-file',
      title: 'Import a year of statements',
      why: 'None of the last 13 months is tracked yet. A month counts once it holds 3 entries.',
    })
  })
})

describe('once a year is on file', () => {
  it('names the first check not met, and the next two as Then', () => {
    expect(step(base)).toEqual({
      id: 'solid-cushion',
      circle: 4,
      title: 'Grow your cushion to three months',
      why: '€2,000 to go: €4,000 you can reach, against €2,000 needed a month.',
      action: { kind: 'open', hash: '#goals', label: 'Open Goals' },
      meter: { kind: 'bar', share: 2 / 3, left: '2 months', right: '3 months' },
      then: 'Then: grow your cushion to six months, and raise your savings rate by one point.',
      fine: null,
    })
  })

  it('sorts the entries without a category, short of 90%', () => {
    const next = step(facts({ sortedShare: 89.96 }))
    expect(next).toMatchObject({
      id: 'sorted',
      circle: 1,
      title: 'Sort the entries without a category',
      why: '89% of your spending has a category; Clear picture needs 90%.',
      action: { kind: 'open', hash: '#transactions?uncategorised=1', label: 'Open Transactions' },
      meter: { kind: 'bar', left: '89% sorted', right: '90%' },
    })
    // Never drawn full while the check is not met.
    const meter = next.meter
    expect(meter?.kind === 'bar' ? meter.share : null).toBeLessThan(1)
  })

  it('closes the gap own income leaves, and says when support is left out', () => {
    expect(step(facts({ income: 2400.2, ownIncome: 2400.2 }))).toMatchObject({
      id: 'own-income',
      circle: 2,
      title: 'Close the €100 a month gap',
      why: 'Over your last 12 tracked months, €100 a month more went out than came in.',
      action: { kind: 'open', hash: '#budgets', label: 'Open Budgets' },
      meter: { kind: 'bar', left: '€2,400 in', right: '€2,500 out' },
    })
    expect(step(facts({ ownIncome: 2400 })).why).toBe(
      'Over your last 12 tracked months, €100 a month more went out than your own income brought in.'
    )
  })

  it('builds a first cushion, in days', () => {
    expect(step(facts({ cushionMonths: 0.5, liquid: 1000 }))).toMatchObject({
      id: 'first-cushion',
      circle: 3,
      title: 'Build a one-month cushion',
      why: 'The money you can reach covers 15 days of what you need.',
      meter: { kind: 'bar', share: 0.5, left: '15 days', right: '1 month' },
    })
    expect(step(facts({ cushionMonths: 0.01, liquid: 20 })).why).toBe(
      "The money you can reach doesn't cover a day of what you need."
    )
    const spentOnly = facts({
      cushionMonths: 0.5,
      liquid: 1250,
      unsure: { categories: 3, uncategorised: 0, all: true },
    })
    expect(step(spentOnly).why).toBe('The money you can reach covers 15 days of what you spend.')
  })

  it('asks for an account to count, once, before the cushion checks', () => {
    expect(step(facts({ liquid: null, cushionMonths: null }))).toMatchObject({
      id: 'first-cushion',
      title: 'Add the accounts your money is in',
      action: { kind: 'open', hash: '#accounts', label: 'Open Accounts' },
      then: 'Then: raise your savings rate by one point, and check the withdrawal rate you plan with.',
    })
  })

  it('reads the accounts again when they did not load, and says it once', () => {
    const unread = facts({ accountsKnown: false, liquid: null, cushionMonths: null })
    expect(step(unread)).toMatchObject({
      id: 'first-cushion',
      title: 'Reload your accounts',
      why: "They didn't load, so the cushion check is waiting.",
      action: { kind: 'reload', label: 'Reload' },
      then: null,
    })
  })

  it('reads the accounts again before advising on income they might cover', () => {
    // Own income 500 short, and the accounts that might hold investments to cover it didn't load:
    // the check is waiting on them, not lost, so the step is to read them, not to cut 500.
    const unread = facts({
      ownIncome: 2000,
      spending: 2500,
      accountsKnown: false,
      liquid: null,
      cushionMonths: null,
    })
    expect(placeCircle(unread).circles[1].checks[0]).toMatchObject({ met: null, unknown: 'unread' })
    expect(step(unread)).toMatchObject({
      id: 'own-income',
      circle: 2,
      title: 'Reload your accounts',
      why: "They didn't load, so the income check is waiting.",
      action: { kind: 'reload', label: 'Reload' },
      meter: null,
    })
    // With the accounts read and nothing invested, the gap is the step.
    expect(step(facts({ ownIncome: 2000, spending: 2500 })).title).toBe(
      'Close the €500 a month gap'
    )
  })

  it('asks the free-money question for its region, and only while the gate is open', () => {
    const de = facts({ region: 'DE' })
    expect(step(de)).toMatchObject({
      id: 'free-money',
      circle: 4,
      title: 'Check the free money your employer adds',
      action: { kind: 'question', question: 'free-money' },
      fine: ASKED_ONCE,
    })
    expect(step(de).why).toContain('Entgeltumwandlung')
    expect(step(de, { freeMoney: false }).id).toBe('solid-cushion')
    expect(step(facts({ region: 'US' })).title).toBe("Check your employer's match")
    expect(step(facts({ region: 'HR' })).title).toBe("Check the state's top-up")
    expect(step(facts({ region: 'UK' })).title).toBe('Check your workplace pension')
    // Taken: the step moves on.
    expect(step(facts({ region: 'DE', freeMoney: 'taken' })).id).toBe('solid-cushion')
  })

  describe('the debt check', () => {
    it('asks about a card too new to judge, and says since when it is here', () => {
      const card = debt({
        rate: null,
        payment: null,
        carried: null,
        expensive: null,
        since: '2026-08-14',
      })
      expect(step(facts({ debts: [card] }))).toMatchObject({
        id: 'no-expensive-debt',
        circle: 4,
        title: 'Do you carry a balance on a credit card or overdraft?',
        why: 'Visa has been here since August 2026, too short for its entries to show whether you clear it each month. Your answer settles the debt check in Solid ground.',
        action: { kind: 'question', question: 'card' },
        fine: ASKED_ONCE,
      })
      const nameless = debt({ name: null, rate: null, carried: null, expensive: null })
      expect(step(facts({ debts: [nameless] })).why).toBe(
        'A card has too few entries to show whether you clear it each month. Your answer settles the debt check in Solid ground.'
      )
    })

    it('compares paying an expensive loan off faster', () => {
      const loan = debt({
        kind: 'loan',
        id: 2,
        name: 'Car loan',
        owed: 9000,
        rate: 11.5,
        payment: 300,
      })
      expect(step(facts({ debts: [loan] }))).toMatchObject({
        title: 'Compare paying Car loan off faster',
        why: 'It costs 11.5% a year. Solid ground asks for no debt at 10% or more.',
        action: { kind: 'open', hash: '#loans/2/compare', label: 'Open Loans' },
      })
    })

    it('names a card and its rate, or asks for the rate', () => {
      expect(step(facts({ debts: [debt({})] }))).toMatchObject({
        title: 'Visa costs 19.9% a year',
        why: 'It carries €400. Solid ground asks for no debt at 10% or more.',
        action: { kind: 'open', hash: '#accounts', label: 'Open Accounts' },
      })
      const noRate = debt({ kind: 'overdraft', name: null, owed: 90.4, rate: null })
      expect(step(facts({ debts: [noRate] }))).toMatchObject({
        title: 'An overdraft carries €90',
        why: 'With no rate set, it counts as debt at 10% or more. Add its rate in Accounts.',
      })
    })
  })

  describe('the yearly bills', () => {
    const two = { count: 2, perYear: 770, perMonth: 770 / 12 }

    it('asks whether they are set aside', () => {
      expect(step(facts({ yearlyBills: two }))).toMatchObject({
        id: 'yearly-bills',
        title: 'Do you set aside money for yearly bills each month?',
        why: '2 yearly bills on Bills come to €770 a year: about €65 a month.',
        action: { kind: 'question', question: 'yearly-bills' },
        fine: ASKED_ONCE,
        then: 'Then: grow your cushion to three months, and grow your cushion to six months.',
      })
      expect(step(facts({ yearlyBills: { count: 1, perYear: 600, perMonth: 50 } })).why).toBe(
        'One yearly bill on Bills comes to €600 a year: about €50 a month.'
      )
    })

    it('sets the monthly share aside once the answer is not yet, and moves on at yes', () => {
      expect(step(facts({ yearlyBills: two, setsAsideYearly: false }))).toMatchObject({
        title: 'Set aside €65 a month for yearly bills',
        action: { kind: 'open', hash: '#goals', label: 'Open Goals' },
        fine: null,
      })
      expect(step(facts({ yearlyBills: two, setsAsideYearly: true })).id).toBe('solid-cushion')
    })
  })

  it('raises the savings rate by a point towards two years of spending', () => {
    expect(step(facts({ cushionMonths: 4, liquid: 8000, invested: 10000 }))).toMatchObject({
      id: 'two-years',
      circle: 5,
      title: 'Raise your savings rate by one point',
      why: 'One more point is €30 a month. €50,000 to two years of spending.',
      meter: { kind: 'bar', left: '€10,000', right: '€60,000' },
      then: 'Then: check the withdrawal rate you plan with.',
    })
  })

  it('checks the withdrawal rate on the way to Work optional', () => {
    expect(step(facts({ cushionMonths: 4, liquid: 8000, invested: 70000 }))).toMatchObject({
      id: 'work-optional',
      circle: 6,
      title: 'Check the withdrawal rate you plan with',
      why: "At 4% a year, €750,000 would cover what you spend. You're at €70,000.",
      action: { kind: 'open', hash: '#retirement', label: 'Open Retirement' },
    })
  })

  it('asks for the own number in More than enough, then reads it', () => {
    const seventh = facts({ cushionMonths: 7, liquid: 14000, invested: 800000 })
    expect(step(seventh)).toMatchObject({
      id: 'enough',
      circle: 7,
      title: 'What would a year of more than enough cost?',
      why: 'Work optional is reached. Your own number decides the last circle; there is no default.',
      action: { kind: 'question', question: 'enough' },
      fine: ASKED_ONCE,
    })
    expect(step({ ...seventh, enoughPerYear: 40000 })).toMatchObject({
      title: 'Your own number: €1,000,000',
      why: "You're at €800,000. At 4% a year, €1,000,000 pays for a year of more than enough.",
    })
  })

  it('says every circle is reached', () => {
    const all = facts({ cushionMonths: 7, liquid: 14000, invested: 2000000, enoughPerYear: 40000 })
    expect(step(all)).toEqual({
      id: 'all-reached',
      circle: null,
      title: "You've reached all seven circles.",
      why: 'Every check the circles hold is met, from a year on file to your own number.',
      action: { kind: 'circles', hash: '#progress', label: 'See all seven circles' },
      meter: null,
      then: null,
      fine: null,
    })
    expect(stepCircleName(step(all))).toBeNull()
  })

  it('never quotes a regional figure in the why', () => {
    const cases = [
      base,
      facts({ sortedShare: 50 }),
      facts({ ownIncome: 2000 }),
      facts({ ownIncome: 2000, income: 2000 }),
      facts({ region: 'US' }),
      facts({ region: 'UK' }),
      facts({ cushionMonths: 0.5, liquid: 1000 }),
      facts({ cushionMonths: 4, liquid: 8000, invested: 10000 }),
    ]
    // The why is the person's own numbers: How you compare carries the comparisons. So no region
    // is named in it, and none of the words a comparison is made of.
    const places = [
      ...REGIONS,
      ...REGIONS.map((region) => regionName(region).replace(/^the /, '')),
      ...['German', 'Croatian', 'European', 'British', 'American', 'England'],
    ]
    const comparing = /\b(typical|average|median|households?|adults|people in)\b/i
    const whys = cases.map((f) => step(f).why)
    expect(new Set(whys).size).toBe(cases.length)
    for (const why of whys) {
      // Whole words only, so "US" is not found inside another word.
      const said = ` ${(why.match(/\w+/g) ?? []).join(' ')} `
      for (const place of places) expect(said, place).not.toContain(` ${place} `)
      expect(why).not.toMatch(comparing)
    }
  })
})

describe('the Then line', () => {
  it('joins one or two, and is empty with none', () => {
    expect(thenLine([])).toBeNull()
    expect(thenLine(['grow your cushion'])).toBe('Then: grow your cushion.')
    expect(thenLine(['a', 'b'])).toBe('Then: a, and b.')
  })
})
