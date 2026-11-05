/**
 * "Reset to defaults" matches each default by name and type (shared/defaultCategories.ts
 * `planCategoryReset`). Matched by name alone, an expense Gifts an import made beside the default
 * income Gifts had its expenses moved into the income one.
 */
import { describe, expect, it } from 'vitest'
import { planCategoryReset } from '../../../../shared/defaultCategories'

const DEFAULTS = [
  { name: 'Gifts', type: 'income' },
  { name: 'Salary', type: 'income' },
  { name: 'Groceries', type: 'expense' },
]

describe('planCategoryReset', () => {
  it("keeps the default's own type over a lower id of another type", () => {
    const plan = planCategoryReset(
      [
        { id: 1, name: 'Gifts', type: 'expense' },
        { id: 2, name: 'Gifts', type: 'income' },
      ],
      DEFAULTS
    )
    expect(plan.kept.get('gifts')).toBe(2)
    // The expense Gifts is no default: it goes, its entries with no category.
    expect(plan.removed.get(1)).toBeNull()
  })

  it('sets back a default whose type was changed, when none has its own type', () => {
    const plan = planCategoryReset([{ id: 4, name: 'Salary', type: 'expense' }], DEFAULTS)
    expect(plan.kept.get('salary')).toBe(4)
    expect(plan.removed.size).toBe(0)
  })

  it('folds a category of the same name and type into the one kept, Food into Groceries too', () => {
    const plan = planCategoryReset(
      [
        { id: 5, name: 'Food', type: 'expense' },
        { id: 6, name: 'Groceries', type: 'expense' },
        { id: 7, name: 'Coffee', type: 'expense' },
      ],
      DEFAULTS
    )
    expect(plan.kept.get('groceries')).toBe(5)
    expect(plan.removed.get(6)).toBe(5)
    expect(plan.removed.get(7)).toBeNull()
  })
})
