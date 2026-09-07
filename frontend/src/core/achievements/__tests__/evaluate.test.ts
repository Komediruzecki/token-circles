import { describe, expect, it } from 'vitest'
import { evaluateAchievements } from '../evaluate'
import { input, month, trackedRun, tx } from './fixtures'

type Result = ReturnType<typeof evaluateAchievements>
const ids = (r: Result): string[] => r.earned.map((e) => e.id)
const on = (r: Result, id: string): string | undefined =>
  r.earned.find((e) => e.id === id)?.earnedOn

describe('evaluateAchievements', () => {
  it('earns nothing from nothing', () => {
    const r = evaluateAchievements(input())
    expect(r.earned).toEqual([])
    expect(r.streak).toBe(0)
  })

  it('first entry is dated to the month of the earliest transaction', () => {
    const r = evaluateAchievements(input({ transactions: [tx('2026-08-20'), tx('2025-03-02')] }))
    expect(ids(r)).toEqual(['first-entry'])
    expect(on(r, 'first-entry')).toBe('2025-03-01')
  })

  it('a month needs three transactions to be tracked', () => {
    expect(ids(evaluateAchievements(input({ transactions: month('2026-09', 2) })))).toEqual([
      'first-entry',
    ])
    const r = evaluateAchievements(input({ transactions: month('2026-09', 3) }))
    expect(ids(r)).toContain('one-month')
    expect(r.streak).toBe(1)
    expect(r.trackedMonths).toEqual(['2026-09'])
  })

  it('two years of history unlocks the whole ladder, each dated to the month reached', () => {
    const r = evaluateAchievements(input({ transactions: trackedRun('2026-08', 24) }))
    expect(ids(r)).toEqual(
      expect.arrayContaining(['one-month', 'a-quarter', 'half-a-year', 'a-year', 'two-years'])
    )
    expect(on(r, 'one-month')).toBe('2024-09-01')
    expect(on(r, 'a-quarter')).toBe('2024-11-01')
    expect(on(r, 'half-a-year')).toBe('2025-02-01')
    expect(on(r, 'a-year')).toBe('2025-08-01')
    expect(on(r, 'two-years')).toBe('2026-08-01')
    expect(r.streak).toBe(24)
  })

  it('a gap ends the streak but keeps what an earlier run earned', () => {
    const r = evaluateAchievements(
      input({ transactions: [...trackedRun('2025-06', 6), ...trackedRun('2026-08', 2)] })
    )
    expect(ids(r)).toContain('half-a-year')
    expect(ids(r)).not.toContain('a-year')
    expect(r.streak).toBe(2)
  })

  it('a profile that only imports still tracks months, and first import is dated to the log', () => {
    const r = evaluateAchievements(
      input({
        transactions: trackedRun('2026-08', 3),
        importLogs: [{ created_at: '2026-09-01T10:00:00Z' }],
      })
    )
    expect(ids(r)).toEqual(expect.arrayContaining(['first-import', 'a-quarter']))
    expect(on(r, 'first-import')).toBe('2026-09-01')
  })

  it('saver runs need income above spending in consecutive tracked months', () => {
    const saving = (m: string) => [
      ...month(m, 3, { type: 'expense', amount: 100 }),
      tx(`${m}-25`, { type: 'income', amount: 1000 }),
    ]
    const r = evaluateAchievements(
      input({ transactions: [...saving('2026-05'), ...saving('2026-06'), ...saving('2026-07')] })
    )
    expect(ids(r)).toContain('saver-x3')
    expect(on(r, 'saver-x3')).toBe('2026-07-01')
    expect(ids(r)).not.toContain('saver-x6')
    const broken = evaluateAchievements(
      input({
        transactions: [
          ...saving('2026-05'),
          ...month('2026-06', 3, { amount: 5000 }),
          ...saving('2026-07'),
        ],
      })
    )
    expect(ids(broken)).not.toContain('saver-x3')
  })

  it('named everything needs a tracked month with every non-transfer transaction categorised', () => {
    const r = evaluateAchievements(
      input({
        transactions: [
          ...month('2026-07', 3),
          tx('2026-07-20', { type: 'transfer', category_id: null }),
        ],
      })
    )
    expect(ids(r)).toContain('named-everything')
    const messy = evaluateAchievements(
      input({ transactions: [...month('2026-07', 3), tx('2026-07-21', { category_id: null })] })
    )
    expect(ids(messy)).not.toContain('named-everything')
  })

  it('held the line needs a finished month with every monthly budget held', () => {
    const budgets = [
      {
        category_id: 1,
        amount: 100,
        period: 'monthly' as const,
        start_date: '2026-01-01',
        end_date: null,
        created_at: '2026-01-01T00:00:00Z',
      },
    ]
    const held = evaluateAchievements(
      input({ budgets, transactions: month('2026-07', 3, { amount: 20 }) })
    )
    expect(ids(held)).toContain('held-the-line')
    expect(on(held, 'held-the-line')).toBe('2026-07-01')
    expect(on(held, 'first-budget')).toBe('2026-01-01')
    const blown = evaluateAchievements(
      input({ budgets, transactions: month('2026-07', 3, { amount: 40 }) })
    )
    expect(ids(blown)).not.toContain('held-the-line')
    const current = evaluateAchievements(
      input({ budgets, transactions: month('2026-09', 3, { amount: 20 }) })
    )
    expect(ids(current)).not.toContain('held-the-line')
  })

  it('goals: created is dated to creation, reached to today', () => {
    const goals = [
      {
        name: 'Trip',
        target_amount: 500,
        current_amount: 500,
        deadline: null,
        created_at: '2026-02-10T00:00:00Z',
      },
    ]
    const r = evaluateAchievements(input({ goals }))
    expect(on(r, 'goal-in-sight')).toBe('2026-02-01')
    expect(on(r, 'goal-reached')).toBe('2026-09-01')
    expect(
      ids(evaluateAchievements(input({ goals: [{ ...goals[0], current_amount: 10 }] })))
    ).not.toContain('goal-reached')
  })

  it('own the stack follows the storage mode, dated today', () => {
    expect(on(evaluateAchievements(input({ selfHosted: true })), 'own-the-stack')).toBe(
      '2026-09-01'
    )
    expect(ids(evaluateAchievements(input({ selfHosted: false })))).not.toContain('own-the-stack')
  })

  it('returns earned in definition order and ignores unparseable dates', () => {
    const r = evaluateAchievements(
      input({ transactions: [tx('nonsense'), ...month('2026-09', 3)] })
    )
    expect(ids(r)).toEqual(['first-entry', 'named-everything', 'one-month'])
  })
})
