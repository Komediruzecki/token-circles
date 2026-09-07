import { describe, expect, it } from 'vitest'
import { buildAdvice } from '../advice'
import { adviceInput, month, tx } from './fixtures'
import type {AdviceInput} from '../advice';

const make = (over: Record<string, unknown> = {}): AdviceInput =>
  adviceInput(over) as unknown as AdviceInput
const kinds = (cards: ReturnType<typeof buildAdvice>): string[] => cards.map((c) => c.kind)

const MONTHLY = {
  category_id: 1,
  amount: 100,
  period: 'monthly' as const,
  start_date: '2026-01-01',
  end_date: null,
  created_at: '2026-01-01T00:00:00Z',
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
