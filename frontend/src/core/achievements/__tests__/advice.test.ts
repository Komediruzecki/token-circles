import { describe, expect, it } from 'vitest'
import { buildAdvice } from '../advice'
import { adviceInput, month, tx } from './fixtures'
import type { AdviceInput } from '../advice'

const make = (over: Record<string, unknown> = {}): AdviceInput =>
  adviceInput(over) as unknown as AdviceInput
const kinds = (cards: ReturnType<typeof buildAdvice>): string[] => cards.map((c) => c.kind)

/** September's Food budget; the fixtures' today is 2026-09-07. */
const MONTHLY = {
  category_id: 1,
  amount: 100,
  period: 'monthly' as const,
  start_date: '2026-09-01',
  end_date: null,
  created_at: '2026-09-01T00:00:00Z',
}

describe('buildAdvice', () => {
  it('says nothing about an empty profile', () => {
    expect(buildAdvice(make())).toEqual([])
  })

  it('flags a budgeted category already over budget, naming both figures', () => {
    const cards = buildAdvice(
      make({ budgets: [MONTHLY], transactions: month('2026-09', 3, { amount: 60 }) })
    )
    const drift = cards.find((c) => c.kind === 'budget-drift')
    expect(drift).toBeDefined()
    expect(drift!.tone).toBe('warn')
    expect(drift!.figure).toBe('180 of 100')
    expect(drift!.title).toContain('Food')
    expect(drift!.link?.page).toBe('budgets')
  })

  it('leaves a category comfortably inside its budget alone', () => {
    const cards = buildAdvice(
      make({ budgets: [MONTHLY], transactions: [tx('2026-09-02', { amount: 3 })] })
    )
    expect(kinds(cards)).not.toContain('budget-drift')
  })

  it('flags a goal that will miss its deadline at the pace so far', () => {
    const goals = [
      {
        name: 'New bike',
        target_amount: 1200,
        current_amount: 200,
        deadline: '2026-12-31',
        created_at: '2026-01-01T00:00:00Z',
      },
    ]
    const card = buildAdvice(make({ goals })).find((c) => c.kind === 'goal-pace')
    expect(card).toBeDefined()
    expect(card!.title).toContain('New bike')
    expect(card!.link?.page).toBe('goals')
  })

  it('says nothing about a goal already funded', () => {
    const goals = [
      {
        name: 'Done',
        target_amount: 500,
        current_amount: 500,
        deadline: '2026-12-31',
        created_at: '2026-01-01T00:00:00Z',
      },
    ]
    expect(kinds(buildAdvice(make({ goals })))).not.toContain('goal-pace')
  })

  it('flags the last finished month in the red, never the month in progress', () => {
    const cards = buildAdvice(
      make({
        transactions: [
          ...month('2026-08', 3, { amount: 900 }),
          tx('2026-08-25', { type: 'income', amount: 100 }),
          ...month('2026-09', 3, { amount: 900 }),
        ],
      })
    )
    const red = cards.find((c) => c.kind === 'in-the-red')
    expect(red!.title).toContain('August 2026')
  })

  it('counts uncategorised entries in the current month only', () => {
    const cards = buildAdvice(
      make({
        transactions: [
          ...month('2026-09', 3),
          tx('2026-09-20', { category_id: null }),
          tx('2026-05-04', { category_id: null }),
        ],
      })
    )
    expect(cards.find((c) => c.kind === 'uncategorised')!.figure).toBe('1')
  })

  it('warns a streak is at risk late in a month with too few entries', () => {
    const cards = buildAdvice(
      make({
        transactions: [...month('2026-07', 3), ...month('2026-08', 3), tx('2026-09-02')],
        today: '2026-09-26',
      }),
      2
    )
    const risk = cards.find((c) => c.kind === 'streak-at-risk')
    expect(risk!.figure).toBe('2 entries to go')
  })

  it('does not nag early in the month', () => {
    const cards = buildAdvice(
      make({ transactions: [...month('2026-08', 3), tx('2026-09-02')], today: '2026-09-04' }),
      2
    )
    expect(kinds(cards)).not.toContain('streak-at-risk')
  })

  it('names the biggest category with no budget behind it', () => {
    const cards = buildAdvice(
      make({ transactions: month('2026-09', 3, { amount: 40, category_id: 2 }) })
    )
    const card = cards.find((c) => c.kind === 'unbudgeted-subscription')
    expect(card!.title).toContain('Transport')
    expect(card!.figure).toBe('120')
  })

  it('ranks warnings first and drops what the user dismissed', () => {
    const args = {
      budgets: [MONTHLY],
      transactions: [
        ...month('2026-09', 3, { amount: 60 }),
        tx('2026-09-20', { category_id: null }),
      ],
    }
    const all = buildAdvice(make(args))
    expect(all[0].tone).toBe('warn')
    expect(all.length).toBeGreaterThan(1)
    const after = buildAdvice(make({ ...args, dismissed: [all[0].id] }))
    expect(after.map((c) => c.id)).not.toContain(all[0].id)
  })

  it('gives every card an id that is the same on a second run', () => {
    const args = {
      transactions: [...month('2026-09', 3), tx('2026-09-20', { category_id: null })],
    }
    expect(buildAdvice(make(args)).map((c) => c.id)).toEqual(
      buildAdvice(make(args)).map((c) => c.id)
    )
  })
})

/**
 * Budgets are stored one row per month: Set Budget, Allocate and Copy last month each write a row
 * whose start_date is the month's first day and whose end_date is empty, in both runtimes. The
 * Budgets page reads a month's rows by start_date (GET /api/budgets/summary, budgetsSummary).
 */
describe('buildAdvice: which budget a month is judged against', () => {
  const row = (start: string, amount: number, created = `${start}T08:00:00Z`) => ({
    category_id: 3,
    amount,
    period: 'monthly' as const,
    start_date: start,
    end_date: null,
    created_at: created,
  })
  // The five rows behind the five "Apartment is over budget" cards seen on dev: one per month,
  // June to October, each with an empty end_date, against 918.81 spent in October.
  const HISTORY = [
    row('2026-06-01', 94.9),
    row('2026-07-01', 156),
    row('2026-08-01', 156),
    row('2026-09-01', 220),
    row('2026-10-01', 310),
  ]
  const apartment = (over: Record<string, unknown> = {}) =>
    make({
      today: '2026-10-28',
      categories: [{ id: 3, name: 'Apartment' }],
      budgets: HISTORY,
      transactions: [
        tx('2026-10-01', { amount: 700, category_id: 3 }),
        tx('2026-10-15', { amount: 218.81, category_id: 3 }),
      ],
      ...over,
    })

  it('raises one over-budget card per category, against the row for this month', () => {
    const drift = buildAdvice(apartment()).filter((c) => c.kind === 'budget-drift')
    expect(drift.map((c) => c.figure)).toEqual(['918.81 of 310'])
  })

  it('does not judge this month against a budget set only for an earlier month', () => {
    const cards = buildAdvice(apartment({ budgets: HISTORY.slice(0, 4) }))
    expect(kinds(cards)).not.toContain('budget-drift')
  })

  it('ignores a row already written for next month', () => {
    const drift = buildAdvice(
      apartment({ budgets: [row('2026-10-01', 310), row('2026-11-01', 200)] })
    ).filter((c) => c.kind === 'budget-drift')
    expect(drift.map((c) => c.figure)).toEqual(['918.81 of 310'])
  })

  it('takes the latest of two rows saved for the same month', () => {
    const drift = buildAdvice(
      apartment({
        budgets: [
          row('2026-10-01', 400, '2026-10-02T08:00:00Z'),
          row('2026-10-01', 310, '2026-10-09T08:00:00Z'),
        ],
      })
    ).filter((c) => c.kind === 'budget-drift')
    expect(drift.map((c) => c.figure)).toEqual(['918.81 of 310'])
  })
})

describe('buildAdvice: one card per thing to say', () => {
  it('collapses two cards that say the same thing into one', () => {
    const goal = {
      name: 'New bike',
      target_amount: 1200,
      current_amount: 100,
      deadline: '2026-12-31',
      created_at: '2026-01-01T00:00:00Z',
    }
    const cards = buildAdvice(make({ goals: [goal, { ...goal, current_amount: 50 }] }))
    expect(cards.filter((c) => c.kind === 'goal-pace')).toHaveLength(1)
  })

  it('says only the last finished month was in the red, however many before it were', () => {
    const red = (m: string) => [
      ...month(m, 3, { amount: 900 }),
      tx(`${m}-25`, { type: 'income', amount: 100 }),
    ]
    const cards = buildAdvice(
      make({
        today: '2026-10-28',
        transactions: ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09'].flatMap(red),
      })
    )
    const reds = cards.filter((c) => c.kind === 'in-the-red')
    expect(reds.map((c) => c.title)).toEqual(['September 2026 spent more than it earned'])
  })

  it('puts a warning about this month before one about a finished month', () => {
    const cards = buildAdvice(
      make({
        today: '2026-09-20',
        budgets: [MONTHLY],
        transactions: [
          // August: 2,700 out, 100 in, so 2,600 in the red.
          ...month('2026-08', 3, { amount: 900 }),
          tx('2026-08-25', { type: 'income', amount: 100 }),
          // September: Food 120 against a budget of 100, so 20 over.
          ...month('2026-09', 3, { amount: 40 }),
        ],
      })
    )
    expect(kinds(cards).slice(0, 2)).toEqual(['budget-drift', 'in-the-red'])
  })

  it('formats money with the formatter it is given, and counts as counts', () => {
    const cards = buildAdvice(
      make({
        money: (n: number) => `EUR ${n.toFixed(2)}`,
        budgets: [MONTHLY],
        transactions: [
          ...month('2026-09', 3, { amount: 60 }),
          tx('2026-09-20', { category_id: null }),
        ],
      })
    )
    expect(cards.find((c) => c.kind === 'budget-drift')!.figure).toBe('EUR 180.00 of EUR 100.00')
    expect(cards.find((c) => c.kind === 'uncategorised')!.figure).toBe('1')
  })
})
