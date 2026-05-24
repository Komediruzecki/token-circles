import { describe, expect, it } from 'vitest'

/**
 * Profile selection and dedup logic tests.
 *
 * These functions are defined inside the App component closure and depend on
 * SolidJS signals/store. We test the pure logic by reproducing the core
 * algorithms (dedup, selection, toggle behavior) outside of SolidJS.
 */

// ── Helpers matching App.tsx logic ──

function deduplicateById(profiles: Array<{ id: number; name: string }>) {
  const seen = new Set<number>()
  return profiles.filter((p) => {
    if (seen.has(p.id)) return false
    seen.add(p.id)
    return true
  })
}

function getSelectedProfileIds(
  profiles: Array<{ id: number; name: string }>,
  localStorageIds: string | null,
  localStorageCurrent: string | null
): number[] {
  const stored = localStorageIds
  if (stored) {
    try {
      const ids = JSON.parse(stored) as number[]
      if (Array.isArray(ids) && ids.length > 0) {
        const existingIds = new Set(profiles.map((p) => p.id))
        const valid = [...new Set(ids)].filter((id) => existingIds.has(id))
        if (valid.length > 0) return valid
      }
    } catch {
      /* ignore */
    }
  }
  if (profiles.length === 0) return []
  const currentId = parseInt(localStorageCurrent || '1', 10)
  const exists = profiles.some((p) => p.id === currentId)
  return exists ? [currentId] : [profiles[0].id]
}

function toggleSelection(prev: number[], profileId: number): number[] {
  const unique = [...new Set(prev)]
  const idx = unique.indexOf(profileId)
  if (idx !== -1) {
    if (unique.length <= 1) return unique
    return unique.filter((id) => id !== profileId)
  }
  return [...unique, profileId]
}

// ── Tests ──

describe('profile deduplication', () => {
  it('removes duplicate IDs', () => {
    const input = [
      { id: 1, name: 'Demo' },
      { id: 2, name: 'Personal' },
      { id: 1, name: 'Demo (dup)' },
    ]
    const result = deduplicateById(input)
    expect(result).toHaveLength(2)
    expect(result.map((p) => p.id)).toEqual([1, 2])
    expect(result[0].name).toBe('Demo')
  })

  it('keeps all unique entries', () => {
    const input = [
      { id: 1, name: 'Demo' },
      { id: 2, name: 'Personal' },
      { id: 3, name: 'Work' },
    ]
    const result = deduplicateById(input)
    expect(result).toHaveLength(3)
  })

  it('handles empty array', () => {
    expect(deduplicateById([])).toEqual([])
  })

  it('handles all duplicates', () => {
    const input = [
      { id: 1, name: 'A' },
      { id: 1, name: 'B' },
      { id: 1, name: 'C' },
    ]
    const result = deduplicateById(input)
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('A')
  })

  it('handles single item', () => {
    const input = [{ id: 42, name: 'Only' }]
    const result = deduplicateById(input)
    expect(result).toHaveLength(1)
  })
})

describe('getSelectedProfileIds', () => {
  const profiles = [
    { id: 1, name: 'Demo' },
    { id: 2, name: 'Personal' },
    { id: 3, name: 'Work' },
  ]

  it('returns parsed localStorage IDs when valid', () => {
    const result = getSelectedProfileIds(profiles, '[2,3]', '1')
    expect(result).toEqual([2, 3])
  })

  it('deduplicates localStorage IDs', () => {
    const result = getSelectedProfileIds(profiles, '[1,1,2,2]', '1')
    expect(result).toEqual([1, 2])
  })

  it('filters out IDs not in profiles', () => {
    const result = getSelectedProfileIds(profiles, '[1, 99, 2]', '1')
    expect(result).toEqual([1, 2])
  })

  it('falls back to currentProfileId when stored is empty', () => {
    const result = getSelectedProfileIds(profiles, null, '2')
    expect(result).toEqual([2])
  })

  it('falls back to first profile when current does not exist', () => {
    const result = getSelectedProfileIds(profiles, null, '99')
    expect(result).toEqual([1])
  })

  it('returns empty for empty profiles', () => {
    const result = getSelectedProfileIds([], '[1,2]', '1')
    expect(result).toEqual([])
  })

  it('filters all invalid IDs and falls back', () => {
    // stored IDs are all invalid, profiles exist → should fall back
    const result = getSelectedProfileIds(profiles, '[99, 100]', '99')
    expect(result).toEqual([1])
  })

  it('returns first profile when currentProfileId is "1" but missing', () => {
    const result = getSelectedProfileIds(
      [
        { id: 5, name: 'First' },
        { id: 10, name: 'Second' },
      ],
      null,
      '1'
    )
    expect(result).toEqual([5])
  })

  it('handles malformed JSON gracefully', () => {
    const result = getSelectedProfileIds(profiles, '{bad json', '2')
    expect(result).toEqual([2])
  })
})

describe('toggleProfileSelection', () => {
  it('adds a profile when not in list', () => {
    expect(toggleSelection([1], 2)).toEqual([1, 2])
  })

  it('removes a profile when in list and more than 1', () => {
    expect(toggleSelection([1, 2, 3], 2)).toEqual([1, 3])
  })

  it('does not remove the last profile', () => {
    expect(toggleSelection([1], 1)).toEqual([1])
  })

  it('deduplicates before toggling', () => {
    // If prev has duplicates (stale/corrupted state), dedup first
    expect(toggleSelection([1, 1, 2], 1)).toEqual([2])
  })

  it('adds to deduplicated list', () => {
    expect(toggleSelection([1, 1, 2], 3)).toEqual([1, 2, 3])
  })

  it('deduplicates but keeps last entry if last one is toggled', () => {
    expect(toggleSelection([2, 2], 2)).toEqual([2])
  })
})
