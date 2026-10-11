/**
 * The counts behind the Progress page's advice, computed in one place so another feature that
 * tells a person what to look at next reads the same numbers (monthFacts.ts).
 */
import { describe, expect, it } from 'vitest'
import { biggestUnbudgeted, monthInTheRed, uncategorisedIn } from '../monthFacts'
import { tx } from './fixtures'

const budget = (category_id: number) => ({
  category_id,
  amount: 100,
  period: 'monthly' as const,
  start_date: '2026-01-01',
  end_date: null,
  created_at: '2026-01-01T00:00:00Z',
})

describe('uncategorisedIn', () => {
  it('counts the entries with no category, transfers aside', () => {
    const list = [
      tx('2026-09-01', { category_id: null }),
      tx('2026-09-02', { category_id: null, type: 'income' }),
      tx('2026-09-03', { category_id: null, type: 'transfer' }),
      tx('2026-09-04', { category_id: 4 }),
    ]
    expect(uncategorisedIn(list)).toBe(2)
    expect(uncategorisedIn([])).toBe(0)
  })
})

describe('monthInTheRed', () => {
  it('says how much a month spent and earned when spending was more', () => {
    const list = [
      tx('2026-08-01', { type: 'income', amount: 100 }),
      tx('2026-08-02', { amount: -80 }),
      tx('2026-08-03', { type: 'deduction', amount: 30 }),
    ]
    expect(monthInTheRed(list)).toEqual({ income: 100, out: 110 })
  })

  it('says nothing for a month that earned as much as it spent, or more', () => {
    const list = [
      tx('2026-08-01', { type: 'income', amount: 100 }),
      tx('2026-08-02', { amount: 60 }),
      tx('2026-08-03', { amount: 40 }),
    ]
    expect(monthInTheRed(list)).toBeNull()
  })

  it('says nothing for a month of fewer than three entries, or none', () => {
    expect(monthInTheRed([tx('2026-08-02', { amount: 500 }), tx('2026-08-03')])).toBeNull()
    expect(monthInTheRed(undefined)).toBeNull()
  })
})

describe('biggestUnbudgeted', () => {
  it('names the category spent on most with no budget and no bill behind it', () => {
    const list = [
      tx('2026-09-01', { category_id: 1, amount: 500 }),
      tx('2026-09-02', { category_id: 2, amount: 300 }),
      tx('2026-09-03', { category_id: 3, amount: -120 }),
      tx('2026-09-04', { category_id: 3, amount: -100 }),
      tx('2026-09-05', { category_id: 4, amount: 900, type: 'income' }),
      tx('2026-09-06', { category_id: null, amount: 999 }),
    ]
    // 1 has a budget and 2 a bill; 4 is income, and the last has no category.
    expect(biggestUnbudgeted(list, [budget(1)], [{ category_id: 2 }])).toEqual({
      categoryId: 3,
      spent: 220,
    })
  })

  it('names nothing when every category spent on has a budget or a bill', () => {
    const list = [tx('2026-09-01', { category_id: 1 }), tx('2026-09-02', { category_id: 2 })]
    expect(biggestUnbudgeted(list, [budget(1)], [{ category_id: 2 }])).toBeNull()
    expect(biggestUnbudgeted([], [], [])).toBeNull()
  })
})
