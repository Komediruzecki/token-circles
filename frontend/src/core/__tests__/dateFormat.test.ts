import { describe, expect, it } from 'vitest'
import {
  calendarDay,
  formatMoment,
  monthName,
  MONTHS_LONG,
  MONTHS_SHORT,
  parseMoment,
} from '../../../../shared/dateFormat'
import { formatDate } from '../api'

// West of Greenwich, where `new Date('2026-11-04')`, midnight UTC, is still 3 November: a date
// formatted from it there read a day early. Node re-reads TZ on assignment, and each test file
// runs in its own worker.
process.env.TZ = 'America/Los_Angeles'

describe('formatDate, the one way the app writes a date', () => {
  it('writes a stored day as the day it is, west of UTC too', () => {
    expect(new Date('2026-11-04').getDate(), 'the trap: midnight UTC is the 3rd here').toBe(3)
    expect(formatDate('2026-11-04')).toBe('4 Nov 2026')
    expect(formatDate('2026-01-01')).toBe('1 Jan 2026')
    expect(formatDate('2026-12-31')).toBe('31 Dec 2026')
  })

  it.each([
    ['day', '4 Nov 2026'],
    ['dayLong', '4 November 2026'],
    ['dayMonth', '4 Nov'],
    ['month', 'Nov 2026'],
    ['monthLong', 'November 2026'],
  ] as const)('in the %s style reads %s', (style, shown) => {
    expect(formatDate('2026-11-04', style)).toBe(shown)
  })

  it('names a month on its own, as a YYYY-MM', () => {
    expect(formatDate('2026-11', 'month')).toBe('Nov 2026')
    expect(formatDate('2026-02', 'monthLong')).toBe('February 2026')
  })

  it('writes September as Sep, as the period bar and the charts do (en-GB writes Sept)', () => {
    expect(formatDate('2026-09-04')).toBe('4 Sep 2026')
    expect(MONTHS_SHORT[8]).toBe('Sep')
    expect(MONTHS_LONG[8]).toBe('September')
  })

  it("names a month alone, its own month west of UTC too ('2026-11' is not 31 October)", () => {
    expect(new Date('2026-11').getMonth(), 'the trap').toBe(9)
    expect(monthName('2026-11')).toBe('Nov')
    expect(monthName('2026-11-04', 'long')).toBe('November')
    expect(monthName('soon')).toBe('soon')
  })

  it('reads a legacy full ISO stamp as the date it was written with', () => {
    expect(formatDate('2026-11-04T23:30:00.000Z')).toBe('4 Nov 2026')
  })

  it('writes a Date as its own day in this zone', () => {
    expect(formatDate(new Date(2026, 10, 4, 23, 30))).toBe('4 Nov 2026')
  })

  it('leaves what is not a stored date as it was', () => {
    // Imports store YYYY-MM-DD; a numeric order is a guess, and Sheets' form never reaches a page.
    for (const value of ['someday', '04/11/2026', 'Date(2026,10,4)', '2026-02-30', '2026-13-01']) {
      expect(formatDate(value), value).toBe(value)
    }
    expect(formatDate(null)).toBe('')
    expect(formatDate(undefined)).toBe('')
    expect(calendarDay('2026-11-04x')).toEqual({ year: 2026, month: 11, day: 4 })
    expect(calendarDay('2026-11-4')).toBeNull()
  })
})

describe('formatMoment, for when something happened', () => {
  it('reads a stamp without a zone as UTC, as D1 writes it, and shows it on this clock', () => {
    // 23:30 UTC on the 4th is 15:30 on the 4th in Los Angeles (UTC-8 in November).
    expect(formatMoment('2026-11-04 23:30:00')).toBe('4 Nov 2026, 15:30')
    expect(formatMoment('2026-11-04T23:30:00Z')).toBe('4 Nov 2026, 15:30')
    // 02:00 UTC on the 5th is still the 4th here.
    expect(formatMoment('2026-11-05 02:00:00')).toBe('4 Nov 2026, 18:00')
    expect(formatMoment('2026-11-05 02:00:00', { time: false })).toBe('4 Nov 2026')
  })

  it('writes a day without a clock as that day, not as midnight UTC', () => {
    expect(formatMoment('2026-11-04')).toBe('4 Nov 2026')
  })

  it('leaves what is not a moment as it was', () => {
    expect(formatMoment('soon')).toBe('soon')
    expect(formatMoment(null)).toBe('')
    expect(Number.isNaN(parseMoment('').getTime())).toBe(true)
  })
})
