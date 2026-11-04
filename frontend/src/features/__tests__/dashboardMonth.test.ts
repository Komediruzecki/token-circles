/**
 * Review M6: people who imported August to October on 3 November met a Dashboard of November:
 * "INCOME €0.00", "↓2350.00 vs last month" beside "€2,350.00", "No flows for November 2026 yet".
 * While Getting started shows, the Dashboard opens on the latest month with entries and says so,
 * and a month's change names its currency and the month it is against.
 */
import { describe, expect, it } from 'vitest'
import { emptyMonthNote, latestMonthWithEntries, monthChange } from '../dashboardMonth'

const months = (...keys: string[]) => keys.map((month) => ({ month, income: 0, expense: 1 }))

describe('the month the Dashboard opens on in week one', () => {
  it('is the latest month before this one with entries, when this one has none', () => {
    expect(latestMonthWithEntries(months('2026-08', '2026-09', '2026-10'), '2026-11')).toBe(
      '2026-10'
    )
    expect(latestMonthWithEntries(months('2026-04', '2026-07', '2026-05'), '2026-11')).toBe(
      '2026-07'
    )
  })

  it('is none when this month has entries, or no month before it has', () => {
    expect(latestMonthWithEntries(months('2026-10', '2026-11'), '2026-11')).toBeNull()
    expect(latestMonthWithEntries([], '2026-11')).toBeNull()
    // A month still to come is not one before this one.
    expect(latestMonthWithEntries(months('2026-12'), '2026-11')).toBeNull()
  })

  it('says which month has nothing, and which it shows', () => {
    expect(emptyMonthNote('2026-11', '2026-10')).toBe(
      'November has no entries yet. Showing October.'
    )
    // Across a year, the year that is not this one is named.
    expect(emptyMonthNote('2027-01', '2026-10')).toBe(
      'January has no entries yet. Showing October 2026.'
    )
  })
})

describe("a month's change against the month before", () => {
  it('names the currency and the month', () => {
    expect(monthChange(-2350, '2026-11', 'EUR')).toEqual({
      arrow: '↓',
      direction: 'down',
      amount: '€2,350.00',
      against: 'vs October',
    })
    expect(monthChange(120.5, '2026-01', 'USD')).toEqual({
      arrow: '↑',
      direction: 'up',
      amount: '$120.50',
      against: 'vs December',
    })
  })

  it('is level, at €0.00, when it rounds to nothing', () => {
    expect(monthChange(-0.001, '2026-11', 'EUR')).toEqual({
      arrow: '→',
      direction: 'level',
      amount: '€0.00',
      against: 'vs October',
    })
  })
})
