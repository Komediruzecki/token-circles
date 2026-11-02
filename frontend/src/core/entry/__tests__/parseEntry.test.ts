import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_CATEGORIES } from '../../storage/idb'
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

/** The words the hints know for eating out and for groceries, as a person types them. */
const EATING_OUT = [
  'coffee',
  'latte',
  'cafe',
  'lunch',
  'dinner',
  'breakfast',
  'restaurant',
  'snack',
  'meal',
]
const GROCERIES = ['grocery', 'groceries', 'food']

/** The local-first defaults, as the Command Bar hands categories to the parser. */
const DEFAULTS: ParseCategory[] = DEFAULT_CATEGORIES.map((c, i) => ({
  id: i + 1,
  name: c.name,
  type: c.type,
  kind: c.kind,
  parent_id: null,
}))

const guess = (text: string, categories: ParseCategory[]) =>
  parseEntry(text, { categories, today: '2026-07-13' }).categoryGuess

describe('parseEntry — category, by kind', () => {
  it('on the default categories, guesses Eating out and Groceries for the words that mean them', () => {
    for (const word of EATING_OUT) expect(guess(`${word} 4.50`, DEFAULTS), word).toBe('Eating out')
    for (const word of GROCERIES) expect(guess(`${word} 32`, DEFAULTS), word).toBe('Groceries')
    // The other hints find their default by kind as well.
    expect(guess('uber 18', DEFAULTS)).toBe('Transportation')
    expect(guess('netflix 15.99', DEFAULTS)).toBe('Subscriptions')
    expect(guess('pharmacy 9', DEFAULTS)).toBe('Healthcare')
    expect(guess('concert 40', DEFAULTS)).toBe('Entertainment')
    expect(guess('salary 3000', DEFAULTS)).toBe('Salary')
  })

  it('goes by a kind stored under any name, or taken from a parent', () => {
    const categories: ParseCategory[] = [
      { id: 1, name: 'Kafići', type: 'expense', kind: 'eating_out' },
      { id: 2, name: 'Namirnice', type: 'expense', kind: 'groceries' },
    ]
    expect(guess('latte 3.40', categories)).toBe('Kafići')
    expect(guess('groceries 20', categories)).toBe('Namirnice')
    // Listed first, a child with no kind of its own goes by its parent's.
    const market: ParseCategory = { id: 3, name: 'Wochenmarkt', type: 'expense', parent_id: 2 }
    expect(guess('grocery 20', [market, ...categories])).toBe('Wochenmarkt')
  })

  it('on a profile that still has Food, guesses Food for all of them', () => {
    for (const word of [...EATING_OUT, ...GROCERIES]) {
      expect(guess(`${word} 4.50`, CATS), word).toBe('Food')
    }
  })

  it('once Eating out sits beside Food, sends the eating-out words there', () => {
    const split: ParseCategory[] = [...CATS, { id: 9, name: 'Eating out', type: 'expense' }]
    for (const word of EATING_OUT) expect(guess(`${word} 4.50`, split), word).toBe('Eating out')
    expect(guess('grocery 32', split)).toBe('Food')
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

describe('parseEntry without a today', () => {
  const hostZone = process.env.TZ
  afterEach(() => {
    vi.useRealTimers()
    if (hostZone === undefined) delete process.env.TZ
    else process.env.TZ = hostZone
  })

  const at = (zone: string, instant: string) => {
    process.env.TZ = zone
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(instant))
  }

  it('dates an entry with the person’s today east of UTC after midnight', () => {
    at('Europe/Zagreb', '2026-10-07T22:30:00Z')
    expect(parseEntry('coffee 4.50 food', { categories: CATS }).date).toBe('2026-10-08')
    expect(parseEntry('coffee 4.50 yesterday', { categories: CATS }).date).toBe('2026-10-07')
  })

  it('and west of UTC in the evening', () => {
    at('America/Los_Angeles', '2026-10-08T03:30:00Z')
    expect(parseEntry('coffee 4.50 food', { categories: CATS }).date).toBe('2026-10-07')
  })
})
