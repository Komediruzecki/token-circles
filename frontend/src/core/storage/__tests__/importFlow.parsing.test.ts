import { describe, expect, it } from 'vitest'
import { normalizeDate, parseAmount } from '../handlers/importFlow.js'

describe('import number parsing (audit I1)', () => {
  it('parses European-formatted amounts without truncating', () => {
    expect(parseAmount('1.234,56')).toBeCloseTo(1234.56, 2)
    expect(parseAmount('1234,56')).toBeCloseTo(1234.56, 2)
    expect(parseAmount('1.234.567,89')).toBeCloseTo(1234567.89, 2) // dot thousands + comma decimal
    // A lone dot is treated as the decimal separator (the common case: "12.50"), so an
    // ambiguous dot-thousands value like "1.000" resolves to 1 — bank amounts include cents,
    // so this ambiguity is rare in practice.
    expect(parseAmount('12.50')).toBeCloseTo(12.5, 2)
  })

  it('parses US-formatted amounts', () => {
    expect(parseAmount('1,234.56')).toBeCloseTo(1234.56, 2)
    expect(parseAmount('1234.56')).toBeCloseTo(1234.56, 2)
  })

  it('passes numeric cells through and rejects garbage', () => {
    expect(parseAmount(1234.56)).toBeCloseTo(1234.56, 2)
    expect(parseAmount('')).toBeNaN()
    expect(parseAmount('abc')).toBeNaN()
  })
})

describe('import date parsing (audit I2/I3)', () => {
  it('keeps ISO dates', () => {
    expect(normalizeDate('2026-05-12')).toBe('2026-05-12')
  })

  it('resolves an unambiguous US date (mm/dd) instead of dropping it', () => {
    // 04/13/2026 — 13 can only be the day, so this is April 13, not month 13 (which the
    // old code either dropped or rolled into 2027).
    expect(normalizeDate('04/13/2026')).toBe('2026-04-13')
  })

  it('resolves an unambiguous day-first date', () => {
    expect(normalizeDate('13/04/2026')).toBe('2026-04-13')
  })

  it('defaults ambiguous dates to day-first (EU-focused app)', () => {
    expect(normalizeDate('04/03/2026')).toBe('2026-03-04')
  })

  it('rejects an impossible date', () => {
    expect(normalizeDate('13/13/2026')).toBe('')
  })

  it('parses a gviz Date() value', () => {
    expect(normalizeDate('Date(2026,3,9)')).toBe('2026-04-09') // month is 0-indexed
  })

  it('parses an Excel serial as a stable calendar day', () => {
    // Serial 46154 = 2026-05-12 (calendar day, timezone-independent).
    expect(normalizeDate(46154)).toBe('2026-05-12')
  })
})
