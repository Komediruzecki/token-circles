import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  convertToBase,
  hasForeignOriginal,
  isEstimatedBaseValue,
  originalAmountLabel,
  txBaseValue,
} from '../currency'

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

  it('estimates via the FX table for a foreign row with no amount_local', () => {
    store.localCurrency = 'EUR'
    // 19 HRK * 0.1328 EUR/HRK ≈ 2.52 EUR (approximate static rate)
    expect(txBaseValue({ amount: 19, currency: 'HRK' })).toBeCloseTo(2.52, 1)
  })

  it('keeps the raw amount when the currency is unknown to the FX table', () => {
    store.localCurrency = 'EUR'
    expect(txBaseValue({ amount: 100, currency: 'XYZ' })).toBe(100)
  })
})

describe('convertToBase', () => {
  it('converts through the static EUR pivot', () => {
    expect(convertToBase(100, 'EUR', 'EUR')).toBeCloseTo(100, 5)
    expect(convertToBase(1, 'USD', 'EUR')).toBeCloseTo(0.92, 2)
  })

  it('returns null for an unknown currency', () => {
    expect(convertToBase(100, 'XYZ', 'EUR')).toBeNull()
    expect(convertToBase(100, 'EUR', 'ABC')).toBeNull()
  })
})

describe('isEstimatedBaseValue', () => {
  it('flags a foreign row lacking amount_local', () => {
    store.localCurrency = 'EUR'
    expect(isEstimatedBaseValue({ amount: 19, currency: 'HRK' })).toBe(true)
  })

  it('does not flag a row with amount_local', () => {
    store.localCurrency = 'EUR'
    expect(isEstimatedBaseValue({ amount: 19, amount_local: 2.47, currency: 'HRK' })).toBe(false)
  })

  it('does not flag a base-currency row', () => {
    store.localCurrency = 'EUR'
    expect(isEstimatedBaseValue({ amount: 19, currency: 'EUR' })).toBe(false)
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
