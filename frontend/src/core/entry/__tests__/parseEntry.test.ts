import { describe, expect, it } from 'vitest'
import { normalizeAmount, parseEntry } from '../parseEntry'
import type { ParseCategory } from '../parseEntry'

const CATS: ParseCategory[] = [
  { id: 1, name: 'Food', type: 'expense' },
  { id: 2, name: 'Transport', type: 'expense' },
  { id: 3, name: 'Housing', type: 'expense' },
  { id: 4, name: 'Subscriptions', type: 'expense' },
  { id: 5, name: 'Salary', type: 'income' },
  { id: 6, name: 'Health', type: 'expense' },
]
const ctx = { categories: CATS, today: '2026-07-13' }

describe('normalizeAmount', () => {
  it('reads plain decimals', () => {
    expect(normalizeAmount('4.50')).toBeCloseTo(4.5)
    expect(normalizeAmount('15.99')).toBeCloseTo(15.99)
    expect(normalizeAmount('3000')).toBe(3000)
  })
  it('reads european comma decimals', () => {
    expect(normalizeAmount('4,50')).toBeCloseTo(4.5)
    expect(normalizeAmount('1,5')).toBeCloseTo(1.5)
  })
  it('handles thousands separators', () => {
    expect(normalizeAmount('1,234.56')).toBeCloseTo(1234.56)
    expect(normalizeAmount('1.234,56')).toBeCloseTo(1234.56)
    expect(normalizeAmount('1,234')).toBe(1234)
  })
  it('strips currency symbols and returns null for junk', () => {
    expect(normalizeAmount('€12')).toBe(12)
    expect(normalizeAmount('abc')).toBeNull()
  })
})

describe('parseEntry — amount', () => {
  it('extracts the first number and returns it absolute', () => {
    expect(parseEntry('coffee 4.50 food', ctx).amount).toBeCloseTo(4.5)
    expect(parseEntry('-20 groceries', ctx).amount).toBe(20)
  })
  it('is null when no number present', () => {
    expect(parseEntry('coffee food', ctx).amount).toBeNull()
  })
})

describe('parseEntry — type', () => {
  it('defaults to expense', () => {
    expect(parseEntry('coffee 4.50', ctx).type).toBe('expense')
  })
  it('detects income from a leading + or a keyword', () => {
    expect(parseEntry('+3000 salary', ctx).type).toBe('income')
    expect(parseEntry('salary 3000', ctx).type).toBe('income')
    expect(parseEntry('refund 12', ctx).type).toBe('income')
  })
  it('treats a leading minus as expense', () => {
    expect(parseEntry('-20 groceries', ctx).type).toBe('expense')
  })
})

describe('parseEntry — category', () => {
  it('matches a category by exact name token', () => {
    const r = parseEntry('12 food', ctx)
    expect(r.categoryId).toBe(1)
    expect(r.categoryGuess).toBe('Food')
  })
  it('matches via a merchant hint keyword', () => {
    expect(parseEntry('coffee 4.50', ctx).categoryId).toBe(1) // coffee -> food -> Food
    expect(parseEntry('uber 18', ctx).categoryId).toBe(2) // uber -> transport -> Transport
    expect(parseEntry('netflix 15.99', ctx).categoryId).toBe(4) // -> Subscriptions
  })
  it('constrains matches to the resolved type', () => {
    // "salary" is income; expense-only categories must not match it
    const r = parseEntry('salary 3000', ctx)
    expect(r.type).toBe('income')
    expect(r.categoryId).toBe(5)
  })
  it('returns null when nothing matches', () => {
    const r = parseEntry('12 zzz', ctx)
    expect(r.categoryId).toBeNull()
    expect(r.categoryGuess).toBeNull()
  })
})

describe('parseEntry — date', () => {
  it('defaults to today', () => {
    expect(parseEntry('coffee 4.50', ctx).date).toBe('2026-07-13')
  })
  it('handles yesterday / tomorrow', () => {
    expect(parseEntry('coffee 4.50 yesterday', ctx).date).toBe('2026-07-12')
    expect(parseEntry('coffee 4.50 tomorrow', ctx).date).toBe('2026-07-14')
  })
})

describe('parseEntry — description', () => {
  it('keeps merchant words, drops amount, filler and date words', () => {
    expect(parseEntry('coffee 4.50 at Rocket Beans yesterday', ctx).description).toBe(
      'coffee Rocket Beans'
    )
  })
  it('drops a bare category word from the description', () => {
    expect(parseEntry('12 food', ctx).description).toBe('')
  })
  it('strips recurrence words but records the hint', () => {
    const r = parseEntry('netflix 15.99 monthly', ctx)
    expect(r.recurring).toBe('monthly')
    expect(r.description.toLowerCase()).toBe('netflix')
  })
})
