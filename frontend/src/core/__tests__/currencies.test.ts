import { beforeEach, describe, expect, it } from 'vitest'
import { formatWholeCurrency, getLocalCurrency } from '../api'
import { CURRENCY_OPTIONS, normalizeCurrencyCode } from '../currencies'

beforeEach(() => {
  localStorage.clear()
})

describe('currency defaults', () => {
  it('normalizes a configured ISO currency code', () => {
    expect(normalizeCurrencyCode(' chf ')).toBe('CHF')
  })

  it('falls back to EUR for missing or malformed values', () => {
    expect(normalizeCurrencyCode(undefined)).toBe('EUR')
    expect(normalizeCurrencyCode('US dollars')).toBe('EUR')
  })

  it('reads the configured local currency and defaults to EUR', () => {
    expect(getLocalCurrency()).toBe('EUR')
    localStorage.setItem('localCurrency', ' chf ')
    expect(getLocalCurrency()).toBe('CHF')
  })

  it('keeps the settings and account selector list free of duplicate codes', () => {
    const codes = CURRENCY_OPTIONS.map((currency) => currency.code)
    expect(new Set(codes).size).toBe(codes.length)
    expect(codes).toContain('EUR')
    expect(codes).toContain('CHF')
  })
})

describe('whole money, as the circles write it', () => {
  it('never prints "-€0": what rounds to nothing is €0', () => {
    expect(formatWholeCurrency(-0.4, 'EUR')).toBe('€0')
    expect(formatWholeCurrency(-0, 'EUR')).toBe('€0')
    expect(formatWholeCurrency(0.4, 'EUR')).toBe('€0')
    // Half and more still rounds away from zero, sign and all.
    expect(formatWholeCurrency(-0.5, 'EUR')).toBe('-€1')
    expect(formatWholeCurrency(-1234.5, 'EUR')).toBe('-€1,235')
    expect(formatWholeCurrency(1234.5, 'USD')).toBe('$1,235')
  })
})
