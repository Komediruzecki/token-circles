import { describe, expect, it } from 'vitest'
import { DEMO_PROFILE_NAME, parseDemoTier, stripDemoParam } from '../demoMode'
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

describe('stripDemoParam', () => {
  const base = 'https://app.example.com'

  it('removes ?demo= from the query string', () => {
    expect(stripDemoParam(`${base}/?demo=high`)).toBe('/')
    expect(stripDemoParam(`${base}/?foo=1&demo=high`)).toBe('/?foo=1')
    expect(stripDemoParam(`${base}/?demo=high&foo=1`)).toBe('/?foo=1')
  })

  it('keeps the page + other hash state, only dropping demo (the reported case)', () => {
    expect(stripDemoParam(`${base}/?demo=high#transactions?period=ytd`)).toBe(
      '/#transactions?period=ytd'
    )
    expect(stripDemoParam(`${base}/?foo=1&demo=high#dashboard`)).toBe('/?foo=1#dashboard')
  })

  it('removes demo from the hash forms', () => {
    expect(stripDemoParam(`${base}/#demo=high`)).toBe('/')
    expect(stripDemoParam(`${base}/#dashboard?demo=high`)).toBe('/#dashboard')
    expect(stripDemoParam(`${base}/#analytics?period=2026-07&demo=mid`)).toBe(
      '/#analytics?period=2026-07'
    )
  })

  it('leaves URLs without a demo param untouched', () => {
    expect(stripDemoParam(`${base}/#transactions?period=ytd`)).toBe('/#transactions?period=ytd')
    expect(stripDemoParam(`${base}/?foo=1#dashboard`)).toBe('/?foo=1#dashboard')
    expect(stripDemoParam(`${base}/`)).toBe('/')
  })
})
