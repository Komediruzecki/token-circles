import { describe, expect, it } from 'vitest'
import {
  addCalendarMonths,
  addDays,
  daysInMonth,
  nextMonthlyDate,
  nextOccurrence,
} from '../../../../shared/calendarMonths'

describe('daysInMonth', () => {
  it('knows February in leap years and the four 30-day months', () => {
    expect([2024, 2025, 2000, 1900].map((y) => daysInMonth(y, 2))).toEqual([29, 28, 29, 28])
    expect([4, 6, 9, 11].map((m) => daysInMonth(2026, m))).toEqual([30, 30, 30, 30])
    expect([1, 3, 5, 7, 8, 10, 12].every((m) => daysInMonth(2026, m) === 31)).toBe(true)
  })
})

describe('addCalendarMonths', () => {
  it('lands on the last day of a shorter month instead of overflowing into the next', () => {
    expect(addCalendarMonths('2027-01-31', 1)).toBe('2027-02-28')
    expect(addCalendarMonths('2028-01-31', 1)).toBe('2028-02-29')
    expect(addCalendarMonths('2026-10-31', -11)).toBe('2025-11-30')
    expect(addCalendarMonths('2026-03-31', 1)).toBe('2026-04-30')
  })

  it('crosses years in both directions', () => {
    expect(addCalendarMonths('2026-12-15', 1)).toBe('2027-01-15')
    expect(addCalendarMonths('2026-01-15', -1)).toBe('2025-12-15')
    expect(addCalendarMonths('2028-02-29', 12)).toBe('2029-02-28')
    expect(addCalendarMonths('2026-05-10', 0)).toBe('2026-05-10')
  })

  it('takes the day it is given, clamped the same way', () => {
    expect(addCalendarMonths('2027-02-28', 1, 31)).toBe('2027-03-31')
    expect(addCalendarMonths('2027-01-31', 1, 30)).toBe('2027-02-28')
    expect(addCalendarMonths('2027-01-10', 1, 0)).toBe('2027-02-10')
  })

  it('answers nothing for a date it cannot read', () => {
    for (const bad of ['', '2026-1-5', '2026-13-01', '2026-02-32', '2026-10-08T00:00:00Z']) {
      expect(addCalendarMonths(bad, 1), bad).toBe('')
    }
    expect(addCalendarMonths('2026-10-08', 1.5)).toBe('')
  })
})

describe('nextMonthlyDate', () => {
  it('keeps a rule on its own day', () => {
    expect(nextMonthlyDate('2026-10-08')).toBe('2026-11-08')
    expect(nextMonthlyDate('2026-12-08', 8)).toBe('2027-01-08')
  })

  it('moves a rule on the 31st to the end of February, and back to the 31st after', () => {
    expect(nextMonthlyDate('2027-01-31', 31)).toBe('2027-02-28')
    expect(nextMonthlyDate('2027-02-28', 31)).toBe('2027-03-31')
    expect(nextMonthlyDate('2027-03-31', 31)).toBe('2027-04-30')
    expect(nextMonthlyDate('2027-04-30', 31)).toBe('2027-05-31')
  })

  it('without a day of the month, stays where a short month moved it', () => {
    expect(nextMonthlyDate('2027-01-31')).toBe('2027-02-28')
    expect(nextMonthlyDate('2027-02-28')).toBe('2027-03-28')
  })

  it('never moves a date the rule did not clamp', () => {
    // local-first stored day_of_month 1 for a rule saved without a day: the dates stay theirs.
    expect(nextMonthlyDate('2027-01-15', 1)).toBe('2027-02-15')
    expect(nextMonthlyDate('2027-02-28', 1)).toBe('2027-03-28')
    expect(nextMonthlyDate('2027-01-10', 15)).toBe('2027-02-10')
  })
})

describe('nextOccurrence', () => {
  it('steps days and weeks across month and year ends', () => {
    expect(nextOccurrence('2026-12-31', 'daily')).toBe('2027-01-01')
    expect(nextOccurrence('2026-02-25', 'weekly')).toBe('2026-03-04')
    expect(nextOccurrence('2028-02-22', 'biweekly')).toBe('2028-03-07')
  })

  it('steps a year on the calendar, a month as nextMonthlyDate does, and monthly by default', () => {
    expect(nextOccurrence('2028-02-29', 'yearly')).toBe('2029-02-28')
    expect(nextOccurrence('2027-02-28', 'monthly', 31)).toBe('2027-03-31')
    expect(nextOccurrence('2027-01-31', 'quarterly')).toBe('2027-02-28')
    expect(nextOccurrence('2027-01-31', 'constructor')).toBe('2027-02-28')
  })

  it('answers nothing for a date it cannot read', () => {
    expect(nextOccurrence('2026-1-5', 'daily')).toBe('')
    expect(nextOccurrence('', 'monthly')).toBe('')
    expect(addDays('2026-10-08', 0.5)).toBe('')
  })
})
