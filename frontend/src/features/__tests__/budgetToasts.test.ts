import { describe, expect, it } from 'vitest'
import { fromSpendingToast } from '../budgetToasts'

describe('fromSpendingToast', () => {
  const say = (answer: Parameters<typeof fromSpendingToast>[0]) =>
    fromSpendingToast(answer, 'March 2026', 'April 2026')

  it('says how many it set when the month had no budgets', () => {
    expect(say({ ok: true, count: 2, already_budgeted: 0 })).toEqual({
      text: 'Set 2 budgets for April 2026 from what you spent in March 2026.',
      kind: 'success',
    })
    expect(say({ ok: true, count: 1, already_budgeted: 0 }).text).toBe(
      'Set 1 budget for April 2026 from what you spent in March 2026.'
    )
  })

  it('says how many already had a budget and kept it', () => {
    expect(say({ ok: true, count: 1, already_budgeted: 1 })).toEqual({
      text: 'Set 1 budget for April 2026 from what you spent in March 2026. 1 category already had a budget and keeps it.',
      kind: 'success',
    })
    expect(say({ ok: true, count: 3, already_budgeted: 2 }).text).toBe(
      'Set 3 budgets for April 2026 from what you spent in March 2026. 2 categories already had budgets and keep them.'
    )
  })

  it('says nothing changed when every category already had a budget', () => {
    expect(say({ ok: true, count: 0, already_budgeted: 2 })).toEqual({
      text: 'Every category you spent on in March 2026 already has a budget for April 2026. Nothing changed.',
      kind: 'info',
    })
  })

  it('says there was nothing to set from when last month had no spending', () => {
    expect(say({ ok: false, message: 'No expenses found for previous month' })).toEqual({
      text: 'No spending in March 2026 to set budgets from.',
      kind: 'info',
    })
  })
})
