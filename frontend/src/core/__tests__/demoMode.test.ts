import { describe, expect, it } from 'vitest'
import { DEMO_PROFILE_NAME, parseDemoTier } from '../demoMode'
import type { DemoTier } from '../demoMode'

// parseDemoTier is the pure seam: it turns a URL (?demo= or #demo=) into a tier.
const loc = (search = '', hash = '') => ({ search, hash })

describe('parseDemoTier', () => {
  it('returns null when there is no demo param', () => {
    expect(parseDemoTier(loc('', ''))).toBeNull()
    expect(parseDemoTier(loc('?foo=bar', '#dashboard'))).toBeNull()
    expect(parseDemoTier(loc('', '#analytics?period=2026-07'))).toBeNull()
  })

  it('reads the tier from the query string', () => {
    expect(parseDemoTier(loc('?demo=low'))).toBe('low')
    expect(parseDemoTier(loc('?demo=mid'))).toBe('mid')
    expect(parseDemoTier(loc('?demo=high'))).toBe('high')
  })

  it('reads the tier from the hash (bare, with page, with other params)', () => {
    expect(parseDemoTier(loc('', '#demo=high'))).toBe('high')
    expect(parseDemoTier(loc('', '#dashboard?demo=low'))).toBe('low')
    expect(parseDemoTier(loc('', '#analytics?period=2026-07&demo=mid'))).toBe('mid')
  })

  it('prefers the query string over the hash', () => {
    expect(parseDemoTier(loc('?demo=high', '#demo=low'))).toBe('high')
  })

  it('accepts short and numeric aliases, case-insensitively', () => {
    const cases: [string, DemoTier][] = [
      ['l', 'low'],
      ['1', 'low'],
      ['m', 'mid'],
      ['2', 'mid'],
      ['medium', 'mid'],
      ['h', 'high'],
      ['3', 'high'],
      ['HIGH', 'high'],
      ['  Mid  ', 'mid'],
    ]
    for (const [raw, tier] of cases) {
      expect(parseDemoTier(loc(`?demo=${encodeURIComponent(raw)}`))).toBe(tier)
    }
  })

  it('falls back to the default tier when demo is present but empty or unknown', () => {
    expect(parseDemoTier(loc('?demo='))).toBe('mid')
    expect(parseDemoTier(loc('?demo'))).toBe('mid')
    expect(parseDemoTier(loc('?demo=platinum'))).toBe('mid')
    expect(parseDemoTier(loc('', '#demo'))).toBe('mid')
  })
})

describe('DEMO_PROFILE_NAME', () => {
  it('maps each tier to its seeded profile name', () => {
    expect(DEMO_PROFILE_NAME.low).toBe('Example Low Income')
    expect(DEMO_PROFILE_NAME.mid).toBe('Example Mid Income')
    expect(DEMO_PROFILE_NAME.high).toBe('Example High Income')
  })
})
