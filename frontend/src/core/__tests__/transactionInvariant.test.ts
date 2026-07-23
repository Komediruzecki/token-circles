import { describe, expect, it } from 'vitest'
import { transactionInvariantError } from '../../../../shared/transactionInvariant'

describe('transactionInvariantError', () => {
  it('accepts valid income, expense, deduction, and two-legged transfer rows', () => {
    expect(transactionInvariantError({ type: 'income', amount: 10, account_id: 1 })).toBeNull()
    expect(transactionInvariantError({ type: 'expense', amount: '10.25' })).toBeNull()
    expect(transactionInvariantError({ type: 'deduction', amount: 10 })).toBeNull()
    expect(
      transactionInvariantError({
        type: 'transfer',
        amount: 10,
        amount_local: 9,
        account_id: 1,
        transfer_account_id: 2,
      })
    ).toBeNull()
  })

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, '', null, undefined])(
    'rejects a non-positive or non-finite amount: %s',
    (amount) => {
      expect(transactionInvariantError({ type: 'expense', amount })).toContain('positive number')
    }
  )

  it('rejects malformed, one-legged, and self transfers', () => {
    expect(transactionInvariantError({ type: 'transfer', amount: 10, account_id: 1 })).toContain(
      'both source and destination'
    )
    expect(
      transactionInvariantError({ type: 'transfer', amount: 10, transfer_account_id: 2 })
    ).toContain('both source and destination')
    expect(
      transactionInvariantError({
        type: 'transfer',
        amount: 10,
        account_id: 1,
        transfer_account_id: 1,
      })
    ).toContain('must be different')
  })
})
