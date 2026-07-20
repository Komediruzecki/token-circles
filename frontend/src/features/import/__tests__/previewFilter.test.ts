import { describe, expect, it } from 'vitest'
import { isTransferToVoid, visibleRowIndices, voidTransferDestinations } from '../previewFilter'
import type { VoidTransferContext } from '../previewFilter'

// Columns: [date, type, from, category, amount]
const TYPE = 1
const CATEGORY = 3

const ctx = (over: Partial<VoidTransferContext> = {}): VoidTransferContext => ({
  typeIdx: TYPE,
  categoryIdx: CATEGORY,
  categoryTypes: {},
  accountNames: [],
  ...over,
})

// Handful of rows exercising each branch. Indices matter for the filter assertions.
const rows: string[][] = [
  ['2026-01-01', 'expense', 'Erste Current', 'Groceries', '12.50'], // 0 not a transfer
  ['2026-01-02', 'transfer', 'Erste Current', 'Other', '100'], //       1 void (Other not an account)
  ['2026-01-03', 'transfer', 'Erste Current', 'Revolut', '50'], //      2 real account (existing)
  ['2026-01-04', 'transfer', 'Erste Current', 'Savings', '75'], //      3 real account (type=account)
  ['2026-01-05', 'transfer', 'Erste Current', 'Other', '25'], //        4 void (same dest as row 1)
  ['2026-01-06', 'transfer', 'Erste Current', 'Gifts', '30'], //        5 void (different dest)
  ['2026-01-07', 'income', 'Kaufland', 'Salary', '2000'], //            6 not a transfer
]

const fullCtx = ctx({
  categoryTypes: { Savings: 'account', Salary: 'income' },
  accountNames: ['Erste Current', 'Revolut'],
})

describe('isTransferToVoid', () => {
  it('flags a transfer whose destination is neither an existing nor a to-be-created account', () => {
    expect(isTransferToVoid(rows[1], fullCtx)).toBe(true)
  })

  it('does not flag a transfer to an existing account (case-insensitive)', () => {
    expect(isTransferToVoid(rows[2], fullCtx)).toBe(false)
    expect(isTransferToVoid(['x', 'transfer', 'y', 'REVOLUT', '1'], fullCtx)).toBe(false)
  })

  it('does not flag a transfer to a value typed as an account', () => {
    expect(isTransferToVoid(rows[3], fullCtx)).toBe(false)
  })

  it('does not flag non-transfer rows', () => {
    expect(isTransferToVoid(rows[0], fullCtx)).toBe(false)
    expect(isTransferToVoid(rows[6], fullCtx)).toBe(false)
  })

  it('does not flag a transfer with an empty destination', () => {
    expect(isTransferToVoid(['x', 'transfer', 'y', '  ', '1'], fullCtx)).toBe(false)
  })

  it('returns false when the type or category column is unmapped', () => {
    expect(isTransferToVoid(rows[1], ctx({ typeIdx: undefined }))).toBe(false)
    expect(isTransferToVoid(rows[1], ctx({ categoryIdx: undefined }))).toBe(false)
  })
})

describe('voidTransferDestinations', () => {
  it('groups offending destinations by name with a total row count', () => {
    const { names, count } = voidTransferDestinations(rows, fullCtx)
    expect(count).toBe(3) // rows 1, 4, 5
    expect(new Set(names)).toEqual(new Set(['Other', 'Gifts']))
    expect(names).toHaveLength(2) // 'Other' appears twice but is listed once
  })

  it('returns empty when the category column is unmapped', () => {
    expect(voidTransferDestinations(rows, ctx({ categoryIdx: undefined }))).toEqual({
      names: [],
      count: 0,
    })
  })

  it('returns empty when every transfer lands on a real account', () => {
    const allReal = ctx({ accountNames: ['Erste Current', 'Revolut', 'Other', 'Gifts', 'Savings'] })
    expect(voidTransferDestinations(rows, allReal).count).toBe(0)
  })
})

describe('visibleRowIndices', () => {
  it("'all' returns every row index in order", () => {
    expect(visibleRowIndices('all', rows, [2, 4], fullCtx)).toEqual([0, 1, 2, 3, 4, 5, 6])
  })

  it("'duplicates' returns the duplicate indices, ascending", () => {
    expect(visibleRowIndices('duplicates', rows, [4, 2], fullCtx)).toEqual([2, 4])
  })

  it("'duplicates' returns nothing when there are none", () => {
    expect(visibleRowIndices('duplicates', rows, [], fullCtx)).toEqual([])
  })

  it("'no-account-transfer' returns only the void-transfer rows, in original order", () => {
    expect(visibleRowIndices('no-account-transfer', rows, [], fullCtx)).toEqual([1, 4, 5])
  })

  it('produces ascending indices so pagination slicing preserves row order', () => {
    const idx = visibleRowIndices('no-account-transfer', rows, [], fullCtx)
    expect([...idx].sort((a, b) => a - b)).toEqual(idx)
  })
})
