import { describe, expect, it } from 'vitest'
import { daysInMonth } from '../../../../shared/calendarMonths'
import {
  daysOfWeek,
  weekLabel,
  weeksCovering,
  weeksOfMonth,
  weeksOfYear,
} from '../../../../shared/calendarWeeks'

const labels = (year: number, month: number) => weeksOfMonth(year, month).map(weekLabel)

describe('weeksOfMonth', () => {
  it('runs Sunday to Saturday, the first week starting in the month before', () => {
    expect(labels(2026, 10)).toEqual([
      'Week 1 (2026-09-27 - 2026-10-03)',
      'Week 2 (2026-10-04 - 2026-10-10)',
      'Week 3 (2026-10-11 - 2026-10-17)',
      'Week 4 (2026-10-18 - 2026-10-24)',
      'Week 5 (2026-10-25 - 2026-10-31)',
    ])
  })

  it('gives a month that starts on a Saturday its sixth week', () => {
    // 1 March 2025 is a Saturday, so Sunday the 30th and Monday the 31st start a sixth week. The
    // old list stepped a week at a time from the 1st and stopped at the week of the 29th.
    expect(labels(2025, 3)).toEqual([
      'Week 1 (2025-02-23 - 2025-03-01)',
      'Week 2 (2025-03-02 - 2025-03-08)',
      'Week 3 (2025-03-09 - 2025-03-15)',
      'Week 4 (2025-03-16 - 2025-03-22)',
      'Week 5 (2025-03-23 - 2025-03-29)',
      'Week 6 (2025-03-30 - 2025-04-05)',
    ])
    // A Sunday the 31st is a week on its own, into the next year.
    expect(labels(2028, 12).at(-1)).toBe('Week 6 (2028-12-31 - 2029-01-06)')
  })

  it('fits a February that starts on a Sunday into four weeks', () => {
    expect(labels(2026, 2)).toEqual([
      'Week 1 (2026-02-01 - 2026-02-07)',
      'Week 2 (2026-02-08 - 2026-02-14)',
      'Week 3 (2026-02-15 - 2026-02-21)',
      'Week 4 (2026-02-22 - 2026-02-28)',
    ])
  })

  it('puts every day of every month in exactly one of its weeks', () => {
    for (let year = 2024; year <= 2030; year++) {
      for (let month = 1; month <= 12; month++) {
        const weeks = weeksOfMonth(year, month)
        const prefix = `${year}-${String(month).padStart(2, '0')}`
        for (let day = 1; day <= daysInMonth(year, month); day++) {
          const date = `${prefix}-${String(day).padStart(2, '0')}`
          const holding = weeks.filter((w) => w.start <= date && date <= w.end)
          expect(holding, date).toHaveLength(1)
        }
      }
    }
  })

  it('has no weeks for a month that is not one', () => {
    expect(weeksOfMonth(2025, 0)).toEqual([])
    expect(weeksOfMonth(2025, 13)).toEqual([])
    expect(weeksOfMonth(2025, Number.NaN)).toEqual([])
    expect(weeksOfMonth(Number.NaN, 3)).toEqual([])
  })
})

describe('weeksOfYear', () => {
  it('covers the year from the Sunday before 1 January to the week of 31 December', () => {
    const weeks = weeksOfYear(2025)
    expect(weeks).toHaveLength(53)
    expect(weeks[0]).toEqual({ week: 1, start: '2024-12-29', end: '2025-01-04' })
    expect(weeks.at(-1)).toEqual({ week: 53, start: '2025-12-28', end: '2026-01-03' })
  })
})

describe('weeksCovering', () => {
  it('has none for dates it cannot read or a range that runs backwards', () => {
    expect(weeksCovering('2025-03-31', '2025-03-01')).toEqual([])
    expect(weeksCovering('not a date', '2025-03-01')).toEqual([])
  })
})

describe('daysOfWeek', () => {
  it('lists the seven days a week names, across the end of the month', () => {
    const sixth = weeksOfMonth(2025, 3)[5]
    expect(daysOfWeek(sixth)).toEqual([
      '2025-03-30',
      '2025-03-31',
      '2025-04-01',
      '2025-04-02',
      '2025-04-03',
      '2025-04-04',
      '2025-04-05',
    ])
  })
})
