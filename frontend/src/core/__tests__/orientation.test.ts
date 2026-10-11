/**
 * Getting started (shared/orientation.ts): the steps whose rule the person's own data meets, in a
 * fixed order, three at a time, each with its reason in their counts and months.
 */
import { describe, expect, it } from 'vitest'
import {
  lastFullMonth,
  NEXT_STEPS_SHOWN,
  nextSteps,
  ORIENTATION_RULES,
  orientationSteps,
} from '../../../../shared/orientation'
import type { OrientationFacts } from '../../../../shared/orientation'

/** Facts no rule applies to: a year on file, everything sorted, nothing spotted. */
const settled: OrientationFacts = {
  today: '2026-10-11',
  trackedMonthsInYear: 12,
  subscriptionsSpotted: 0,
  entries: 100,
  uncategorised: 0,
  topUnbudgeted: null,
  heavyMonth: null,
  loans: 0,
}

const facts = (over: Partial<OrientationFacts>): OrientationFacts => ({ ...settled, ...over })

/** Facts every rule applies to. */
const everything = facts({
  trackedMonthsInYear: 4,
  subscriptionsSpotted: 6,
  uncategorised: 38,
  topUnbudgeted: { categoryId: 7, name: 'Groceries' },
  heavyMonth: '2026-09',
  loans: 1,
})

const only = (over: Partial<OrientationFacts>) => {
  const steps = orientationSteps(facts(over))
  expect(steps).toHaveLength(1)
  return steps[0]
}

describe('with nothing to do', () => {
  it('there are no steps', () => {
    expect(orientationSteps(settled)).toEqual([])
    expect(nextSteps(settled)).toEqual([])
  })
})

describe('import-year', () => {
  it('applies until twelve months of the past year are tracked, and says how many are', () => {
    expect(only({ trackedMonthsInYear: 4 })).toEqual({
      id: 'import-year',
      title: 'Import the rest of your year',
      reason:
        'You have 4 tracked months from the past year. A month counts once it holds 3 entries.',
      link: { hash: '#import', label: 'Import' },
    })
    expect(only({ trackedMonthsInYear: 1 }).reason).toBe(
      'You have 1 tracked month from the past year. A month counts once it holds 3 entries.'
    )
    expect(only({ trackedMonthsInYear: 11 }).reason).toMatch(/^You have 11 tracked months/)
    expect(orientationSteps(facts({ trackedMonthsInYear: 12 }))).toEqual([])
  })

  it('asks for a year when nothing of the past year is tracked', () => {
    const step = only({ trackedMonthsInYear: 0 })
    expect(step.title).toBe('Import a year of statements')
    expect(step.reason).toBe(
      'No month from the past year is tracked yet. A month counts once it holds 3 entries.'
    )
  })
})

describe('review-subscriptions', () => {
  it('counts the subscriptions the scan spotted, and goes to the scan', () => {
    expect(only({ subscriptionsSpotted: 6 })).toEqual({
      id: 'review-subscriptions',
      title: 'Review the 6 subscriptions we spotted',
      reason: "They're in your statements but not on Bills yet.",
      link: { hash: '#bills?scan=1', label: 'Bills' },
    })
    expect(only({ subscriptionsSpotted: 1 })).toMatchObject({
      title: 'Review the subscription we spotted',
      reason: "It's in your statements but not on Bills yet.",
    })
  })
})

describe('sort-uncategorised', () => {
  it('applies when more than one entry in ten has no category', () => {
    expect(only({ uncategorised: 38, entries: 120 })).toEqual({
      id: 'sort-uncategorised',
      title: 'Sort the 38 entries without a category',
      reason: "That's 32% of your entries. Budgets and Analytics group spending by category.",
      link: { hash: '#transactions?uncategorised=1', label: 'Transactions' },
    })
    expect(only({ uncategorised: 11, entries: 100 }).reason).toMatch(/^That's 11% of/)
    expect(only({ uncategorised: 1, entries: 1 })).toMatchObject({
      title: 'Sort the entry without a category',
      reason: "That's 100% of your entries. Budgets and Analytics group spending by category.",
    })
  })

  it('does not apply at one in ten or fewer, or with no entries', () => {
    expect(orientationSteps(facts({ uncategorised: 10, entries: 100 }))).toEqual([])
    expect(orientationSteps(facts({ uncategorised: 0, entries: 0 }))).toEqual([])
    // Counts that cannot both be true still give no share of nothing.
    expect(orientationSteps(facts({ uncategorised: 3, entries: 0 }))).toEqual([])
  })
})

describe('budget-top-category', () => {
  it('names the category and the month it was the biggest with no budget', () => {
    expect(only({ topUnbudgeted: { categoryId: 7, name: 'Groceries' } })).toEqual({
      id: 'budget-top-category',
      title: 'Set a budget for Groceries',
      reason:
        'You spent more on it in September than on any other category with no budget or bill.',
      link: { hash: '#budgets', label: 'Budgets' },
    })
  })
})

describe('heavy-month', () => {
  it('names the month that spent more than it earned, and opens it on Transactions', () => {
    expect(only({ heavyMonth: '2026-09' })).toEqual({
      id: 'heavy-month',
      title: 'See what put September in the red',
      reason: 'September spent more than it earned.',
      link: { hash: '#transactions?period=2026-09', label: 'Transactions' },
    })
  })

  it('names December in January', () => {
    expect(lastFullMonth('2027-01-05')).toBe('2026-12')
    const step = only({ today: '2027-01-05', heavyMonth: '2026-12' })
    expect(step.title).toBe('See what put December in the red')
    expect(step.link.hash).toBe('#transactions?period=2026-12')
  })
})

describe('loan-payoff', () => {
  it('applies with a loan on file, and counts several', () => {
    expect(only({ loans: 1 })).toEqual({
      id: 'loan-payoff',
      title: 'Compare paying your loan off faster',
      reason: 'You have a loan on file. Loans sets its plan beside a what-if with extra payments.',
      link: { hash: '#loans', label: 'Loans' },
    })
    expect(only({ loans: 2 })).toMatchObject({
      title: 'Compare paying your loans off faster',
      reason:
        'You have 2 loans on file. Loans sets each plan beside a what-if with extra payments.',
    })
  })
})

describe('the order and the cap', () => {
  it('lists every step that applies, in rule order', () => {
    expect(orientationSteps(everything).map((s) => s.id)).toEqual([
      'import-year',
      'review-subscriptions',
      'sort-uncategorised',
      'budget-top-category',
      'heavy-month',
      'loan-payoff',
    ])
    expect(ORIENTATION_RULES).toEqual(orientationSteps(everything).map((s) => s.id))
  })

  it('shows the first three', () => {
    expect(NEXT_STEPS_SHOWN).toBe(3)
    expect(nextSteps(everything).map((s) => s.id)).toEqual([
      'import-year',
      'review-subscriptions',
      'sort-uncategorised',
    ])
  })

  it('moves the next one up when an earlier step is done', () => {
    const imported = { ...everything, trackedMonthsInYear: 12, subscriptionsSpotted: 0 }
    expect(nextSteps(imported).map((s) => s.id)).toEqual([
      'sort-uncategorised',
      'budget-top-category',
      'heavy-month',
    ])
  })
})

describe('the copy', () => {
  it('names no amount, uses no em dash, and every step links to a page', () => {
    for (const step of orientationSteps(everything)) {
      const text = `${step.title} ${step.reason}`
      expect(text).not.toMatch(/—/)
      expect(text).not.toMatch(/\d[.,]\d/)
      expect(step.link.hash).toMatch(/^#[a-z]+/)
      expect(step.link.label).not.toBe('')
    }
  })
})
