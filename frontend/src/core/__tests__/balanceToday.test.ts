/**
 * An account's balance today, and setting it to what the bank shows (review M2). Both runtimes
 * store an account's balance as its opening balance and every entry, those dated after today
 * included, so a figure typed as "what your bank shows now" moves the opening balance: the
 * entries up to today are worked back from it, and those after today go on top.
 */
import { describe, expect, it } from 'vitest'
import { balancesForToday, movedAfterToday } from '../../../../shared/balanceToday'
import type { FactsEntry } from '../../../../shared/guidance/facts'

const TODAY = '2026-11-03'
const entry = (date: string, over: Partial<FactsEntry>): FactsEntry => ({
  date,
  type: 'expense',
  amount: 0,
  account_id: 1,
  ...over,
})

describe('what is dated after today', () => {
  it("moves the account's stored balance, and nothing up to today counts", () => {
    const entries = [
      entry('2026-11-03', { type: 'income', amount: 500 }),
      entry('2026-11-04', { amount: 40 }),
      entry('2026-12-01', { type: 'income', amount: 100 }),
      // Another account's, and a transfer into this one.
      entry('2026-11-10', { amount: 70, account_id: 2 }),
      entry('2026-11-12', { type: 'transfer', amount: 25, account_id: 2, transfer_account_id: 1 }),
    ]
    expect(movedAfterToday(1, entries, TODAY)).toBeCloseTo(-40 + 100 + 25, 6)
    expect(movedAfterToday(2, entries, TODAY)).toBeCloseTo(-70 - 25, 6)
    expect(movedAfterToday(3, entries, TODAY)).toBe(0)
  })
})

describe("setting the balance today to the bank's figure", () => {
  it('works the entries up to today back from it (cara, review M2)', () => {
    // 1,240.50 typed in setup, then a statement netting +1,865.87: the stored balance read
    // 3,106.37, as the typed figure had become the balance before the statement.
    expect(balancesForToday({ balance: 3106.37, starting_balance: 1240.5 }, 0, 1240.5)).toEqual({
      starting_balance: -625.37,
      balance: 1240.5,
    })
  })

  it('keeps what is dated after today on top, as it will be once its day comes', () => {
    expect(balancesForToday({ balance: 1100, starting_balance: 1000 }, -40, 900)).toEqual({
      starting_balance: 760,
      balance: 860,
    })
  })

  it('reads a missing opening balance as 0, and works in cents', () => {
    expect(balancesForToday({ balance: 10.1, starting_balance: null }, 0, 0.3)).toEqual({
      starting_balance: -9.8,
      balance: 0.3,
    })
  })
})
