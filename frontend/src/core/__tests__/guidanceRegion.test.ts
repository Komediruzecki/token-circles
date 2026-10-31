/**
 * Which region's figures a profile is compared with (shared/guidance/region.ts): the answer, else
 * the bank formats of its imports, else the base currency, else the EU average.
 */
import { describe, expect, it } from 'vitest'
import { chooseRegion } from '../../../../shared/guidance/region'
import type { RegionImport } from '../../../../shared/guidance/region'

/** One import session per entry, a day apart, oldest first. */
const sessions = (...formats: (string | null)[]): RegionImport[] =>
  formats.map((bank_formats, i) => ({
    id: i + 1,
    bank_formats,
    created_at: `2026-03-${String(i + 1).padStart(2, '0')} 09:00:00`,
  }))

describe('the region a profile is compared with', () => {
  it.each([
    ['DE', { region: 'DE', reason: 'answer', via: null }],
    ['HR', { region: 'HR', reason: 'answer', via: null }],
    ['EU27', { region: 'EU27', reason: 'answer', via: null }],
    ['UK', { region: 'UK', reason: 'answer', via: null }],
    ['US', { region: 'US', reason: 'answer', via: null }],
    ['elsewhere', { region: 'EU27', reason: 'elsewhere', via: null }],
  ] as const)('is the answer %s, whatever the imports and the currency say', (answer, chosen) => {
    expect(chooseRegion({ answer, imports: sessions('dkb', 'dkb'), currency: 'GBP' })).toEqual(
      chosen
    )
  })

  it.each([
    ['DKB', ['dkb'], 'DE', 'dkb'],
    ['Sparkasse', ['sparkasse'], 'DE', 'sparkasse'],
    ['Erste', ['erste'], 'HR', 'erste'],
    ['PBZ', ['pbz'], 'HR', 'pbz'],
    ['ING, the Dutch export', ['ing'], 'EU27', 'ing'],
  ])('goes by %s statements when the question is unanswered', (_, formats, region, via) => {
    for (const answer of [undefined, 'skipped'] as const) {
      expect(chooseRegion({ answer, imports: sessions(...formats), currency: 'USD' })).toEqual({
        region,
        reason: 'bank',
        via,
      })
    }
  })

  it('takes no hint from a bank that uses one format in every country', () => {
    const imports = sessions('revolut', 'wise', 'ynab', 'n26', 'revolut,n26')
    expect(chooseRegion({ imports, currency: 'GBP' })).toEqual({
      region: 'UK',
      reason: 'currency',
      via: 'GBP',
    })
  })

  it('goes by the region most sessions point to', () => {
    const imports = sessions('erste', 'dkb', 'pbz', 'sparkasse,dkb', 'erste')
    expect(chooseRegion({ imports })).toEqual({ region: 'HR', reason: 'bank', via: 'erste' })
  })

  it('counts a session once for each region it points to', () => {
    // DKB and Sparkasse files in one session are one session for Germany, against Croatia's two.
    const imports = sessions('dkb,sparkasse', 'erste', 'pbz,erste')
    expect(chooseRegion({ imports })).toEqual({ region: 'HR', reason: 'bank', via: 'pbz' })
    expect(chooseRegion({ imports: sessions('erste', 'dkb,erste') })).toEqual({
      region: 'HR',
      reason: 'bank',
      via: 'erste',
    })
  })

  it('breaks a tie with the latest session, in whatever order the logs come', () => {
    const imports = sessions('dkb', 'erste')
    expect(chooseRegion({ imports })).toMatchObject({ region: 'HR' })
    expect(chooseRegion({ imports: [...imports].reverse() })).toMatchObject({ region: 'HR' })
    // The same time: the later id.
    const sameTime = imports.map((session) => ({ ...session, created_at: '2026-03-01 09:00:00' }))
    expect(chooseRegion({ imports: sameTime.reverse() })).toMatchObject({ region: 'HR' })
  })

  it('reads only the formats the import has', () => {
    const imports = sessions('dkb', 'Erste', 'erste,unknown', 'bpz', null)
    expect(chooseRegion({ imports })).toEqual({ region: 'HR', reason: 'bank', via: 'erste' })
    expect(chooseRegion({ imports: [{ bank_formats: 42 }, {}], currency: 'EUR' })).toEqual({
      region: 'EU27',
      reason: 'currency',
      via: 'EUR',
    })
  })

  it.each([
    ['EUR', 'EU27'],
    ['GBP', 'UK'],
    ['USD', 'US'],
    ['gbp', 'UK'],
  ])('goes by the base currency %s with no answer and no hint', (currency, region) => {
    expect(chooseRegion({ currency, imports: sessions('revolut') })).toEqual({
      region,
      reason: 'currency',
      via: currency.toUpperCase(),
    })
  })

  it('compares with the EU average when nothing says where', () => {
    for (const currency of ['JPY', 'CAD', '', null, undefined, 12]) {
      expect(chooseRegion({ currency })).toEqual({ region: 'EU27', reason: 'fallback', via: null })
    }
    expect(chooseRegion({})).toEqual({ region: 'EU27', reason: 'fallback', via: null })
  })
})
