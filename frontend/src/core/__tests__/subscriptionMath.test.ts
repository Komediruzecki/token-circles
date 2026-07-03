/**
 * Subscription frequency normalization (Bills → Subscriptions summary).
 *
 * Regression: the "Monthly Total" card summed raw bill amounts, so a yearly plan's
 * full annual price was counted as a monthly cost, and every card suffix was
 * effectively "/mo" regardless of frequency.
 */
import { describe, expect, it } from 'vitest'
import { frequencySuffix, monthlyEquivalent } from '../subscriptionMath'

describe('monthlyEquivalent', () => {
  it('keeps monthly amounts as-is', () => {
    expect(monthlyEquivalent(15.99, 'monthly')).toBeCloseTo(15.99, 10)
  })

  it('divides yearly amounts by 12', () => {
    expect(monthlyEquivalent(120, 'yearly')).toBeCloseTo(10, 10)
    expect(monthlyEquivalent(89.9, 'yearly')).toBeCloseTo(89.9 / 12, 10)
  })

  it('treats "annual" like yearly', () => {
    expect(monthlyEquivalent(120, 'annual')).toBeCloseTo(10, 10)
  })

  it('multiplies weekly amounts by 52/12', () => {
    expect(monthlyEquivalent(12, 'weekly')).toBeCloseTo((12 * 52) / 12, 10)
  })

  it('multiplies biweekly amounts by 26/12', () => {
    expect(monthlyEquivalent(12, 'biweekly')).toBeCloseTo((12 * 26) / 12, 10)
  })

  it('multiplies daily amounts by 365/12', () => {
    expect(monthlyEquivalent(1, 'daily')).toBeCloseTo(365 / 12, 10)
  })

  it('is case-insensitive', () => {
    expect(monthlyEquivalent(120, 'Yearly')).toBeCloseTo(10, 10)
  })

  it('falls back to monthly for unknown or missing frequencies (never under-counts)', () => {
    expect(monthlyEquivalent(9.99, 'fortnightly-ish')).toBeCloseTo(9.99, 10)
    expect(monthlyEquivalent(9.99, undefined)).toBeCloseTo(9.99, 10)
    expect(monthlyEquivalent(9.99, null)).toBeCloseTo(9.99, 10)
    expect(monthlyEquivalent(9.99, '')).toBeCloseTo(9.99, 10)
  })

  it('normalizes a mixed basket the way the summary card does', () => {
    const subs = [
      { amount: 15.99, frequency: 'monthly' },
      { amount: 120, frequency: 'yearly' }, // 10/mo
      { amount: 3, frequency: 'weekly' }, // 13/mo
    ]
    const total = subs.reduce((s, b) => s + monthlyEquivalent(b.amount, b.frequency), 0)
    expect(total).toBeCloseTo(15.99 + 10 + 13, 10)
  })
})

describe('frequencySuffix', () => {
  it.each([
    ['monthly', 'mo'],
    ['yearly', 'yr'],
    ['annual', 'yr'],
    ['weekly', 'wk'],
    ['biweekly', 'biwk'],
    ['daily', 'day'],
  ])('%s -> /%s', (frequency, suffix) => {
    expect(frequencySuffix(frequency)).toBe(suffix)
  })

  it('falls back to /mo for unknown or missing frequencies', () => {
    expect(frequencySuffix('whatever')).toBe('mo')
    expect(frequencySuffix(undefined)).toBe('mo')
    expect(frequencySuffix(null)).toBe('mo')
  })
})
