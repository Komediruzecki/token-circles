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
  start_date: '2026-09-01',
  end_date: null,
  created_at: '2026-09-01T00:00:00Z',
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
    // A deduction lowers what came in; it is not spending (shared/guidance/flows.ts).
    const list = [
      tx('2026-08-01', { type: 'income', amount: 100 }),
      tx('2026-08-02', { amount: -80 }),
      tx('2026-08-03', { type: 'deduction', amount: 30 }),
    ]
    expect(monthInTheRed(list)).toEqual({ income: 70, out: 80 })
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
    expect(biggestUnbudgeted(list, '2026-09', [budget(1)], [{ category_id: 2 }], [])).toEqual({
      categoryId: 3,
      spent: 220,
    })
  })

  it('names nothing when every category spent on has a budget or a bill', () => {
    const list = [tx('2026-09-01', { category_id: 1 }), tx('2026-09-02', { category_id: 2 })]
    expect(biggestUnbudgeted(list, '2026-09', [budget(1)], [{ category_id: 2 }], [])).toBeNull()
    expect(biggestUnbudgeted([], '2026-09', [], [], [])).toBeNull()
  })

  it("counts only the budgets of the month it is given: an earlier month's has lapsed", () => {
    const list = [tx('2026-09-01', { category_id: 1, amount: 500 })]
    const june = { ...budget(1), start_date: '2026-06-01', created_at: '2026-06-01T00:00:00Z' }
    expect(biggestUnbudgeted(list, '2026-09', [june], [], [])).toEqual({
      categoryId: 1,
      spent: 500,
    })
    expect(biggestUnbudgeted(list, '2026-06', [june], [], [])).toBeNull()
  })

  describe('a catch-all', () => {
    const categories = [
      { id: 1, name: 'Other' },
      { id: 2, name: 'Groceries' },
      { id: 3, name: 'Misc' },
      { id: 4, name: 'Pets' },
    ]

    it('is never the one, and is named when it spent more', () => {
      // Other is where an import files what no rule matched: 900 of it, then Misc at 600.
      const list = [
        tx('2026-09-01', { category_id: 1, amount: 900 }),
        tx('2026-09-02', { category_id: 3, amount: 600 }),
        tx('2026-09-03', { category_id: 2, amount: 300 }),
      ]
      expect(biggestUnbudgeted(list, '2026-09', [], [], categories)).toEqual({
        categoryId: 2,
        spent: 300,
        notCounting: 1,
      })
    })

    it('is not named when it spent less', () => {
      const list = [
        tx('2026-09-01', { category_id: 1, amount: 100 }),
        tx('2026-09-02', { category_id: 2, amount: 300 }),
      ]
      expect(biggestUnbudgeted(list, '2026-09', [], [], categories)).toEqual({
        categoryId: 2,
        spent: 300,
      })
    })

    it('leaves nothing to name when only catch-alls were spent on', () => {
      const list = [
        tx('2026-09-01', { category_id: 1, amount: 900 }),
        tx('2026-09-02', { category_id: 3, amount: 50 }),
      ]
      expect(biggestUnbudgeted(list, '2026-09', [], [], categories)).toBeNull()
    })

    // One rule with the circles (shared/guidance/kinds.ts `isCatchAllCategory`): Other given a
    // kind of its own, or under a parent with one, is that kind's, and worth a budget.
    it('is no catch-all once something gives it a kind, as the circles read it', () => {
      const kinded = [
        { id: 5, name: 'Other', type: 'expense', kind: 'groceries' },
        { id: 6, name: 'Car', type: 'expense', kind: 'transport' },
        { id: 7, name: 'Other', type: 'expense', kind: null, parent_id: 6 },
        { id: 8, name: 'Other', type: 'expense', kind: 'other' },
      ]
      const list = [
        tx('2026-09-01', { category_id: 8, amount: 900 }),
        tx('2026-09-02', { category_id: 5, amount: 400 }),
        tx('2026-09-03', { category_id: 7, amount: 200 }),
      ]
      expect(biggestUnbudgeted(list, '2026-09', [], [], kinded)).toEqual({
        categoryId: 5,
        spent: 400,
        notCounting: 8,
      })
      const underCar = [tx('2026-09-01', { category_id: 7, amount: 200 })]
      expect(biggestUnbudgeted(underCar, '2026-09', [], [], kinded)).toEqual({
        categoryId: 7,
        spent: 200,
      })
    })

    it('is known by its name: a category of its own name is counted', () => {
      const list = [tx('2026-09-01', { category_id: 4, amount: 80 })]
      expect(biggestUnbudgeted(list, '2026-09', [], [], categories)).toEqual({
        categoryId: 4,
        spent: 80,
      })
    })
  })
})
