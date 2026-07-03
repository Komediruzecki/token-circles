import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hasForeignOriginal, originalAmountLabel, txBaseValue } from '../currency'

// The app reports every transaction in the user's base currency (localStorage
// `localCurrency`, default EUR). amount_local holds the base-currency value; amount is
// the original in `currency`. These helpers drive the transactions display + totals.

const store: Record<string, string> = {}
beforeEach(() => {
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => {
      store[k] = v
    },
  })
})
afterEach(() => {
  for (const k of Object.keys(store)) delete store[k]
  vi.unstubAllGlobals()
})

describe('txBaseValue', () => {
  it('uses amount_local when present (foreign-currency row)', () => {
    expect(txBaseValue({ amount: 19, amount_local: 2.47, currency: 'HRK' })).toBeCloseTo(2.47, 2)
  })

  it('falls back to amount when amount_local is null/undefined', () => {
    expect(txBaseValue({ amount: 42, amount_local: null, currency: 'EUR' })).toBe(42)
    expect(txBaseValue({ amount: 42 })).toBe(42)
  })

  it('treats amount_local: 0 as a real value, not missing', () => {
    expect(txBaseValue({ amount: 100, amount_local: 0, currency: 'HRK' })).toBe(0)
  })
})

describe('hasForeignOriginal / originalAmountLabel', () => {
  it('flags a converted foreign-currency row (base EUR)', () => {
    store.localCurrency = 'EUR'
    const tx = { amount: 19, amount_local: 2.47, currency: 'HRK' }
    expect(hasForeignOriginal(tx)).toBe(true)
    expect(originalAmountLabel(tx)).toBe('19.00 HRK')
  })

  it('shows nothing when the row is already in the base currency', () => {
    store.localCurrency = 'EUR'
    const tx = { amount: 42, amount_local: 42, currency: 'EUR' }
    expect(hasForeignOriginal(tx)).toBe(false)
    expect(originalAmountLabel(tx)).toBe('')
  })

  it('shows nothing when there is no amount_local (nothing was converted)', () => {
    store.localCurrency = 'EUR'
    expect(hasForeignOriginal({ amount: 19, amount_local: null, currency: 'HRK' })).toBe(false)
  })

  it('follows the base-currency setting (HRK original is native when base is HRK)', () => {
    store.localCurrency = 'HRK'
    expect(hasForeignOriginal({ amount: 19, amount_local: 19, currency: 'HRK' })).toBe(false)
  })

  it('uses the absolute value in the original label (negatives)', () => {
    store.localCurrency = 'EUR'
    expect(originalAmountLabel({ amount: -19, amount_local: -2.47, currency: 'HRK' })).toBe(
      '19.00 HRK'
    )
  })
})
