import { describe, expect, it } from 'vitest'
import { normalizedTransactionAmount } from '../transactionAmount'

describe('normalizedTransactionAmount', () => {
  it('prefers a finite base-currency value', () => {
    expect(normalizedTransactionAmount({ amount: 19, amount_local: 2.47 })).toBeCloseTo(2.47, 2)
  })

  it('falls back to the finite original value, then zero', () => {
    expect(normalizedTransactionAmount({ amount: 19, amount_local: Number.NaN })).toBe(19)
    expect(normalizedTransactionAmount({ amount: Number.POSITIVE_INFINITY })).toBe(0)
    expect(normalizedTransactionAmount({ amount: '19', amount_local: '2.47' })).toBe(0)
  })
})
