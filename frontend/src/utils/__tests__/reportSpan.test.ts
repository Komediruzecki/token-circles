/**
 * How much of a year an annual report covers: a past year whole, the current year from January to
 * the end of the current month. A report for the current year that ran to December drew months
 * that have not happened yet.
 */
import { describe, expect, it } from 'vitest'
import { annualSpan, spanMonths } from '../reportSpan'

describe('the span of an annual report', () => {
  it('is the whole of a past year', () => {
    expect(annualSpan(2025, new Date(2026, 10, 19))).toEqual({
      from: '2025-01-01',
      to: '2025-12-31',
      months: 12,
      soFar: false,
    })
  })

  it('runs to the end of the current month in the current year', () => {
    expect(annualSpan(2026, new Date(2026, 10, 19))).toEqual({
      from: '2026-01-01',
      to: '2026-11-30',
      months: 11,
      soFar: true,
    })
  })

  it('is January alone in January', () => {
    const span = annualSpan(2026, new Date(2026, 0, 2))
    expect(span).toMatchObject({ to: '2026-01-31', months: 1, soFar: true })
    expect(spanMonths(span)).toBe('January')
  })

  it('ends on the 29th in a leap February', () => {
    expect(annualSpan(2028, new Date(2028, 1, 10)).to).toBe('2028-02-29')
  })

  it('still says so far in December, which has not ended', () => {
    expect(annualSpan(2026, new Date(2026, 11, 3))).toMatchObject({
      to: '2026-12-31',
      months: 12,
      soFar: true,
    })
  })

  it('is whole for a later year, which only future-dated entries can reach', () => {
    expect(annualSpan(2027, new Date(2026, 10, 19))).toMatchObject({
      to: '2027-12-31',
      months: 12,
      soFar: false,
    })
  })

  it('names its months in words', () => {
    expect(spanMonths(annualSpan(2026, new Date(2026, 10, 19)))).toBe('January to November')
  })
})
