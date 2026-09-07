import { describe, expect, it } from 'vitest'
import { diffUnlocks, parseRecords, serializeRecords } from '../records'

describe('unlock records', () => {
  it('round-trips through the settings string and drops junk', () => {
    const records = [
      { id: 'a-year' as const, earnedOn: '2025-08-01', unlockedAt: '2026-09-07T10:00:00.000Z' },
    ]
    expect(parseRecords(serializeRecords(records))).toEqual(records)
    expect(parseRecords(undefined)).toEqual([])
    expect(parseRecords('not json')).toEqual([])
    expect(
      parseRecords(JSON.stringify({ v: 1, unlocks: [{ id: 'nope', earnedOn: 'x' }, 42] }))
    ).toEqual([])
  })
  it('diff keeps stored unlocks even when no longer earned, and adds new ones stamped now', () => {
    const stored = [
      { id: 'a-year' as const, earnedOn: '2025-08-01', unlockedAt: '2026-01-01T00:00:00.000Z' },
    ]
    const { newly, merged } = diffUnlocks(
      stored,
      [{ id: 'first-entry', earnedOn: '2024-09-01' }],
      '2026-09-07T12:00:00.000Z'
    )
    expect(newly).toEqual([
      { id: 'first-entry', earnedOn: '2024-09-01', unlockedAt: '2026-09-07T12:00:00.000Z' },
    ])
    expect(merged.map((r) => r.id)).toEqual(['first-entry', 'a-year'])
  })
  it('diff is empty when everything earned is already stored', () => {
    const stored = [
      {
        id: 'first-entry' as const,
        earnedOn: '2024-09-01',
        unlockedAt: '2026-01-01T00:00:00.000Z',
      },
    ]
    expect(
      diffUnlocks(
        stored,
        [{ id: 'first-entry', earnedOn: '2024-09-01' }],
        '2026-09-07T12:00:00.000Z'
      ).newly
    ).toEqual([])
  })
})
