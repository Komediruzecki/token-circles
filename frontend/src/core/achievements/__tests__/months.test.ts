import { describe, expect, it } from 'vitest'
import { addMonths, currentStreak, monthOf, monthReaching, runs } from '../months'

describe('month arithmetic', () => {
  it('monthOf takes the YYYY-MM of an ISO date', () => {
    expect(monthOf('2026-09-07')).toBe('2026-09')
    expect(monthOf('2025-12-31T23:59:00Z')).toBe('2025-12')
  })
  it('addMonths crosses year boundaries both ways', () => {
    expect(addMonths('2026-01', -1)).toBe('2025-12')
    expect(addMonths('2025-11', 3)).toBe('2026-02')
    expect(addMonths('2026-09', 0)).toBe('2026-09')
  })
  it('runs groups consecutive months, unsorted and with duplicates', () => {
    expect(runs(['2026-03', '2026-01', '2026-02', '2026-02', '2026-06'])).toEqual([
      { start: '2026-01', length: 3 },
      { start: '2026-06', length: 1 },
    ])
    expect(runs([])).toEqual([])
  })
  it('monthReaching is the month a run first reaches n, earliest run wins', () => {
    const months = ['2024-01', '2024-02', '2024-03', '2025-01', '2025-02', '2025-03', '2025-04']
    expect(monthReaching(months, 3)).toBe('2024-03')
    expect(monthReaching(months, 4)).toBe('2025-04')
    expect(monthReaching(months, 5)).toBeNull()
  })
  it('currentStreak counts back from this month, or last month when this one is not tracked yet', () => {
    const tracked = new Set(['2026-06', '2026-07', '2026-08'])
    expect(currentStreak(tracked, '2026-08')).toBe(3)
    expect(currentStreak(tracked, '2026-09')).toBe(3)
    expect(currentStreak(tracked, '2026-10')).toBe(0)
    expect(currentStreak(new Set(), '2026-09')).toBe(0)
  })
})
