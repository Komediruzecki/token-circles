import { describe, expect, it } from 'vitest'
import { groupByMonth } from '../BadgeTimeline'
import type { UnlockRecord } from '../../core/achievements/records'

const rec = (id: string, earnedOn: string): UnlockRecord =>
  ({ id, earnedOn, unlockedAt: '2026-09-07T10:00:00.000Z' }) as UnlockRecord

describe('groupByMonth', () => {
  it('groups by the month the rule was met, oldest first', () => {
    const stops = groupByMonth([
      rec('a-year', '2026-03-01'),
      rec('first-entry', '2024-10-01'),
      rec('one-month', '2024-10-01'),
    ])
    expect(stops.map((s) => s.month)).toEqual(['2024-10', '2026-03'])
    expect(stops[0].records.map((r) => r.id)).toEqual(['first-entry', 'one-month'])
  })

  it('a backfilled history spreads over its own months, not over the day it was noticed', () => {
    // Every record shares one unlockedAt: the import afternoon. The timeline must not collapse.
    const stops = groupByMonth([
      rec('first-entry', '2021-01-01'),
      rec('a-year', '2022-01-01'),
      rec('two-years', '2023-01-01'),
    ])
    expect(stops).toHaveLength(3)
  })

  it('is empty for a profile with nothing earned', () => {
    expect(groupByMonth([])).toEqual([])
  })
})
