/**
 * The official figures a person's numbers are set beside (shared/guidance/benchmarks.ts and the
 * research's benchmarks.json): every metric has bands or a stated gap in every region, the bands
 * leave no hole and never overlap, every figure names an https source and a year, the file follows
 * its own band rule, and each region `chooseRegion` can pick gets what the table below says.
 */
import { describe, expect, it } from 'vitest'
import {
  BAND_RULE,
  bandFor,
  bandsFor,
  BENCHMARKS,
  BORROWED_BANDS_USED,
  derivationFor,
  gapFor,
  inBand,
  METRIC_IDS,
  referencesFor,
  sourceFor,
} from '../../../../shared/guidance/benchmarks'
import { chooseRegion, REGIONS } from '../../../../shared/guidance/region'
import type {
  BandEntry,
  BandFacts,
  MetricId,
  RegionId,
} from '../../../../shared/guidance/benchmarks'
import type { RegionInput } from '../../../../shared/guidance/region'

/** A band as an interval: `[2, 6)`, `(-∞, 9.3)`, `[0, 0]`. */
function interval(entry: BandEntry): string {
  const lo = entry.min === null ? '(-∞' : `${entry.minExclusive ? '(' : '['}${entry.min}`
  const hi = entry.max === null ? '∞)' : `${entry.max}${entry.maxInclusive ? ']' : ')'}`
  return `${lo}, ${hi}`
}

/** What a region gets for a metric: its bands, whose they are when borrowed, or "gap". */
function gets(metric: MetricId, region: RegionId, facts: BandFacts = {}): string {
  const bands = bandsFor(metric, region, facts)
  if (bands.length === 0) return 'gap'
  const text = bands.map((entry) => `${entry.band} ${interval(entry)}`).join(' · ')
  const lender = bands[0].borrowedFrom
  return lender ? `${text}, ${lender}'s` : text
}

const SHARE = (lo: number, hi: number) =>
  `low [0, ${lo}) · typical [${lo}, ${hi}) · high [${hi}, ∞)`
const RATE = (lo: number, hi: number) =>
  `low (-∞, ${lo}) · typical [${lo}, ${hi}) · high [${hi}, ∞)`
const COUNT_UK = 'low [0, 2) · typical [2, 6) · high [6, ∞)'
const CUSHION = 'low [0, 1) · typical [1, 6) · high [6, ∞)'
const SHOCK = 'low [0, 1) · typical [1, ∞)'
const DEBT_RATE = 'low [0, 4) · typical [4, 10) · high [10, ∞)'
const SERVICE = (line: number) => `low [0, 0] · typical (0, ${line}) · high [${line}, ∞)`

/** What each region gets, for a household that gave no tenure and has no housing loan. */
const GETS: Record<RegionId, Record<MetricId, string>> = {
  DE: {
    'subscriptions.count': `${COUNT_UK}, UK's`,
    'subscriptions.monthlySpend': 'gap',
    'savings.rate': RATE(13.9, 23.9),
    'cushion.months': CUSHION,
    'shock.cover': SHOCK,
    'housing.share': SHARE(24.1, 40),
    'spending.foodAtHome': SHARE(8.8, 18.4),
    'spending.eatingOut': SHARE(2.7, 7.1),
    'spending.transport': SHARE(6.4, 25.6),
    'debt.rate': DEBT_RATE,
    'debt.serviceShare': `${SERVICE(40)}, HR's`,
  },
  HR: {
    'subscriptions.count': `${COUNT_UK}, UK's`,
    'subscriptions.monthlySpend': 'gap',
    'savings.rate': RATE(4, 14),
    'cushion.months': CUSHION,
    'shock.cover': SHOCK,
    'housing.share': SHARE(11.5, 40),
    'spending.foodAtHome': SHARE(16.7, 47.6),
    'spending.eatingOut': SHARE(0.8, 4.3),
    'spending.transport': SHARE(4.4, 24.9),
    'debt.rate': DEBT_RATE,
    'debt.serviceShare': SERVICE(40),
  },
  EU27: {
    'subscriptions.count': `${COUNT_UK}, UK's`,
    'subscriptions.monthlySpend': 'gap',
    'savings.rate': RATE(9.3, 19.3),
    'cushion.months': CUSHION,
    'shock.cover': 'gap',
    'housing.share': SHARE(18.9, 40),
    'spending.foodAtHome': SHARE(12.2, 25.8),
    'spending.eatingOut': SHARE(2.4, 7),
    'spending.transport': SHARE(6, 18.8),
    'debt.rate': DEBT_RATE,
    'debt.serviceShare': `${SERVICE(40)}, HR's`,
  },
  UK: {
    'subscriptions.count': COUNT_UK,
    'subscriptions.monthlySpend': SHARE(26, 71),
    'savings.rate': RATE(4.7, 14.7),
    'cushion.months': CUSHION,
    'shock.cover': SHOCK,
    // Mortgagors and a tenure not given share a row.
    'housing.share': SHARE(19, 40),
    'spending.foodAtHome': SHARE(6.8, 17.5),
    'spending.eatingOut': SHARE(2.6, 7.5),
    'spending.transport': SHARE(6.8, 20),
    'debt.rate': DEBT_RATE,
    'debt.serviceShare': 'gap',
  },
  US: {
    'subscriptions.count': 'low [0, 2) · typical [2, 7) · high [7, ∞)',
    'subscriptions.monthlySpend': SHARE(26, 139),
    'savings.rate': RATE(0.4, 10.4),
    'cushion.months': CUSHION,
    'shock.cover': SHOCK,
    'housing.share': SHARE(30, 50),
    'spending.foodAtHome': SHARE(5.7, 14),
    'spending.eatingOut': SHARE(3.6, 7.8),
    'spending.transport': SHARE(11.2, 25.8),
    'debt.rate': DEBT_RATE,
    'debt.serviceShare': SERVICE(36),
  },
}

/** The households a metric's rows can be for: one per tenure row and housing-loan answer. */
function households(metric: MetricId, region: RegionId): BandFacts[] {
  const rows = BENCHMARKS.entries.filter((e) => e.metric === metric && e.region === region)
  const tenures = [...new Set(rows.map((e) => e.when?.tenure).filter((t) => t !== undefined))]
  const loans = [...new Set(rows.map((e) => e.when?.hasHousingLoan).filter((t) => t !== undefined))]
  if (tenures.length > 0) return tenures.map((tenure) => ({ tenure }))
  if (loans.length > 0) return loans.map((hasHousingLoan) => ({ hasHousingLoan }))
  return [{}]
}

const CASES = METRIC_IDS.flatMap((metric) => REGIONS.map((region) => [metric, region] as const))

describe('the file', () => {
  it('ships whole: every section, the metrics this module names and the regions it compares', () => {
    for (const section of [
      'about',
      'bandRule',
      'regions',
      'regionChoice',
      'metrics',
      'entries',
      'derivations',
      'references',
      'gaps',
      'sources',
    ] as const) {
      expect(BENCHMARKS[section], section).toBeTruthy()
    }
    expect(BENCHMARKS.schemaVersion).toBe(1)
    expect(BENCHMARKS.entries).toHaveLength(164)
    expect(BENCHMARKS.metrics.map((m) => m.id)).toEqual([...METRIC_IDS])
    expect(BENCHMARKS.regions.map((r) => r.id).sort()).toEqual([...REGIONS].sort())
  })

  it('gives every figure an https source and a year', () => {
    const year = (n: unknown) =>
      Number.isInteger(n) && (n as number) >= 2000 && (n as number) <= 2030
    for (const entry of BENCHMARKS.entries) {
      const at = `${entry.metric} ${entry.region} ${entry.band}`
      expect(entry.sourceUrl, at).toMatch(/^https:\/\/\S+$/)
      expect(year(entry.year), at).toBe(true)
      expect(entry.sourceIds.length, at).toBeGreaterThan(0)
    }
    for (const ref of BENCHMARKS.references) {
      expect(ref.sourceUrl, ref.label).toMatch(/^https:\/\/\S+$/)
      expect(year(ref.year), ref.label).toBe(true)
    }
    for (const source of BENCHMARKS.sources) {
      expect(source.url, source.id).toMatch(/^https:\/\/\S+$/)
      expect(year(source.dataYear), source.id).toBe(true)
      // A table updated in place has a data year but no one publication date.
      if (source.published !== null)
        expect(source.published, source.id).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })

  it('cites only sources it lists, at the URL it lists them under', () => {
    const cited = [
      ...BENCHMARKS.entries.flatMap((e) => e.sourceIds),
      ...BENCHMARKS.references.map((r) => r.sourceId),
      ...BENCHMARKS.derivations.flatMap((d) => d.sourceIds),
    ]
    for (const id of cited) expect(sourceFor(id), id).not.toBeNull()
    for (const entry of BENCHMARKS.entries) {
      expect(entry.sourceIds.map((id) => sourceFor(id)?.url)).toContain(entry.sourceUrl)
    }
    for (const ref of BENCHMARKS.references) {
      expect(sourceFor(ref.sourceId)?.url, ref.label).toBe(ref.sourceUrl)
    }
  })

  it('holds no path on anyone’s machine', () => {
    const text = JSON.stringify(BENCHMARKS)
    expect(text).not.toMatch(/file:\/\//)
    expect(text).not.toMatch(/\/home\/|\/Users\/|[A-Z]:\\/)
  })
})

describe('bands or a stated gap', () => {
  it.each(CASES)('%s in %s has one or the other, not both', (metric, region) => {
    const bands = bandsFor(metric, region)
    const gap = gapFor(metric, region)
    expect(bands.length > 0 || gap !== null).toBe(true)
    expect(bands.length > 0 && gap !== null).toBe(false)
    if (bands.length > 0) expect(derivationFor(metric, region)).not.toBeNull()
  })

  it('states the gaps the research found', () => {
    for (const region of ['DE', 'HR', 'EU27'] as const) {
      expect(gapFor('subscriptions.monthlySpend', region)).toMatch(/No official or representative/)
    }
    expect(gapFor('shock.cover', 'EU27')).toMatch(/differs by country/)
    expect(gapFor('debt.serviceShare', 'UK')).toMatch(/No official debt-to-income line/)
  })
})

describe('no overlaps or holes', () => {
  it.each(CASES)('%s in %s covers every value once, for every household', (metric, region) => {
    for (const facts of households(metric, region)) {
      const bands = bandsFor(metric, region, facts)
      if (bands.length === 0) continue
      const at = `${metric} ${region} ${JSON.stringify(facts)}`
      // From the lowest value the metric can take to no upper edge, low first.
      expect(bands[0].band, at).toBe('low')
      expect([null, 0], at).toContain(bands[0].min)
      expect(bands[bands.length - 1].max, at).toBeNull()
      expect(
        bands.map((b) => b.band),
        at
      ).toEqual(bands.length === 2 ? ['low', 'typical'] : ['low', 'typical', 'high'])
      for (const [i, band] of bands.entries()) {
        // No band is empty.
        if (band.min !== null && band.max !== null) {
          const single = band.min === band.max && band.maxInclusive && !band.minExclusive
          expect(band.min < band.max || single, at).toBe(true)
        }
        const next = bands[i + 1]
        if (!next) continue
        // Each band ends where the next begins, and the edge belongs to exactly one of them.
        expect(next.min, at).toBe(band.max)
        expect(Boolean(band.maxInclusive), at).toBe(Boolean(next.minExclusive))
      }
      // Probe every edge, either side of it and far out: each value is in exactly one band.
      const edges = bands.flatMap((b) => [b.min, b.max]).filter((e): e is number => e !== null)
      const probes = edges.flatMap((e) => [e - 1e-9, e, e + 1e-9]).concat([1e9])
      for (const value of probes) {
        if (bands[0].min !== null && value < bands[0].min) {
          expect(bandFor(metric, region, value, facts), `${at} at ${value}`).toBeNull()
          continue
        }
        const holding = bands.filter((band) => inBand(band, value))
        expect(holding, `${at} at ${value}`).toHaveLength(1)
        expect(bandFor(metric, region, value, facts)).toBe(holding[0])
      }
    }
  })
})

describe('what each region gets', () => {
  const ways: Array<[string, RegionInput, RegionId]> = [
    ['the answer Germany', { answer: 'DE' }, 'DE'],
    ['the answer Croatia', { answer: 'HR' }, 'HR'],
    ['another EU country', { answer: 'EU27' }, 'EU27'],
    ['somewhere else', { answer: 'elsewhere' }, 'EU27'],
    ['the answer United Kingdom', { answer: 'UK' }, 'UK'],
    ['the answer United States', { answer: 'US' }, 'US'],
    ['DKB statements', { answer: 'skipped', imports: [{ bank_formats: 'dkb' }] }, 'DE'],
    ['Erste statements', { imports: [{ bank_formats: 'erste' }] }, 'HR'],
    ['ING statements', { imports: [{ bank_formats: 'ing' }] }, 'EU27'],
    ['a base currency of euros', { currency: 'EUR' }, 'EU27'],
    ['a base currency of pounds', { currency: 'GBP' }, 'UK'],
    ['a base currency of dollars', { currency: 'USD' }, 'US'],
    ['nothing at all', {}, 'EU27'],
  ]

  it.each(ways)('%s compares with %s, and its bands are the table’s', (_, input, region) => {
    const chosen = chooseRegion(input).region
    expect(chosen).toBe(region)
    const got = Object.fromEntries(METRIC_IDS.map((metric) => [metric, gets(metric, chosen)]))
    expect(got).toEqual(GETS[region])
  })

  it('gives the UK the housing row for its tenure, and the mortgage row to one not given', () => {
    expect(gets('housing.share', 'UK', { tenure: 'rentPrivate' })).toBe(SHARE(34, 40))
    expect(gets('housing.share', 'UK', { tenure: 'rentSocial' })).toBe(SHARE(28, 40))
    for (const tenure of ['mortgage', 'unknown', 'outright', 'family', 'skipped', null]) {
      expect(gets('housing.share', 'UK', { tenure })).toBe(SHARE(19, 40))
    }
    // Elsewhere tenure picks nothing: there is one row for everyone.
    expect(gets('housing.share', 'DE', { tenure: 'rentPrivate' })).toBe(SHARE(24.1, 40))
  })

  it('moves the debt-payment line to 45% with a housing loan, where the line is Croatia’s', () => {
    expect(gets('debt.serviceShare', 'HR', { hasHousingLoan: true })).toBe(SERVICE(45))
    expect(gets('debt.serviceShare', 'DE', { hasHousingLoan: true })).toBe(`${SERVICE(45)}, HR's`)
    expect(gets('debt.serviceShare', 'EU27', { hasHousingLoan: true })).toBe(`${SERVICE(45)}, HR's`)
    expect(gets('debt.serviceShare', 'US', { hasHousingLoan: true })).toBe(SERVICE(36))
  })
})

describe('D4 and D9: borrowed figures', () => {
  it('lists every metric the file borrows for, so a new borrowing is decided, not inherited', () => {
    const borrowing = new Set(BENCHMARKS.entries.filter((e) => e.borrowedFrom).map((e) => e.metric))
    expect([...borrowing].sort()).toEqual(Object.keys(BORROWED_BANDS_USED).sort())
  })

  it('names the lender on every band it lends', () => {
    expect(bandFor('debt.serviceShare', 'DE', 45)).toMatchObject({
      band: 'high',
      borrowedFrom: 'HR',
    })
    expect(bandFor('subscriptions.count', 'HR', 4)).toMatchObject({
      band: 'typical',
      borrowedFrom: 'UK',
    })
    expect(bandFor('debt.serviceShare', 'HR', 45)?.borrowedFrom).toBeUndefined()
  })

  it('leaves a borrowing region without a band, and says why, when the answer is no', () => {
    const notBorrowed = { 'subscriptions.count': true, 'debt.serviceShare': false } as const
    for (const region of ['DE', 'EU27'] as const) {
      expect(bandsFor('debt.serviceShare', region, {}, notBorrowed)).toEqual([])
      expect(gapFor('debt.serviceShare', region, notBorrowed)).toBe(
        "No figures of its own, and the app does not borrow HR's."
      )
      expect(bandsFor('subscriptions.count', region, {}, notBorrowed)).toHaveLength(3)
    }
    expect(bandsFor('debt.serviceShare', 'HR', {}, notBorrowed)).toHaveLength(3)
    expect(gapFor('debt.serviceShare', 'HR', notBorrowed)).toBeNull()
    expect(gapFor('debt.serviceShare', 'UK', notBorrowed)).toMatch(/No official debt-to-income/)
  })
})

describe('D5: the band rule', () => {
  it('is 0.75 and 1.25 for group averages, and 5 points for the savings rate', () => {
    expect(BAND_RULE).toMatchObject({ widenLow: 0.75, widenHigh: 1.25, savingsPoints: 5 })
    expect(BAND_RULE.text).toMatch(/0\.75 x the lowest to 1\.25 x the highest/)
  })

  it.each(['spending.foodAtHome', 'spending.eatingOut', 'spending.transport'] as const)(
    'draws %s from the group averages by the rule, in every region',
    (metric) => {
      for (const region of REGIONS) {
        const range = referencesFor(metric, region).find((ref) => ref.kind === 'groupRange')
        const typical = bandsFor(metric, region).find((b) => b.band === 'typical')
        expect(range && typical, `${metric} ${region}`).toBeTruthy()
        // The averages are published rounded, so the edges agree to the rounding.
        expect(Math.abs(typical!.min! - BAND_RULE.widenLow * range!.min!)).toBeLessThanOrEqual(0.1)
        expect(Math.abs(typical!.max! - BAND_RULE.widenHigh * range!.max!)).toBeLessThanOrEqual(0.1)
      }
    }
  )

  it('draws the savings rate as the official rate plus or minus the points, in every region', () => {
    for (const region of REGIONS) {
      const official = referencesFor('savings.rate', region).find(
        (ref) => ref.unit === 'percent of disposable income'
      )
      const typical = bandsFor('savings.rate', region).find((b) => b.band === 'typical')
      expect(Math.abs(typical!.min! - (official!.value! - BAND_RULE.savingsPoints))).toBeLessThan(
        0.06
      )
      expect(Math.abs(typical!.max! - (official!.value! + BAND_RULE.savingsPoints))).toBeLessThan(
        0.06
      )
    }
  })
})

describe('bandFor', () => {
  it('puts an edge in the band that starts there', () => {
    expect(bandFor('savings.rate', 'DE', 13.9)?.band).toBe('typical')
    expect(bandFor('savings.rate', 'DE', 13.89)?.band).toBe('low')
    expect(bandFor('savings.rate', 'DE', 23.9)?.band).toBe('high')
    expect(bandFor('debt.rate', 'US', 10)?.band).toBe('high')
    expect(bandFor('cushion.months', 'HR', 1)?.band).toBe('typical')
  })

  it('reads no debt payments as low and any at all as typical', () => {
    expect(bandFor('debt.serviceShare', 'US', 0)?.band).toBe('low')
    expect(bandFor('debt.serviceShare', 'US', 0.01)?.band).toBe('typical')
    expect(bandFor('debt.serviceShare', 'US', 36)?.band).toBe('high')
  })

  it('has no band for a value that is no number, or one below what the metric can be', () => {
    expect(bandFor('savings.rate', 'DE', Number.NaN)).toBeNull()
    expect(bandFor('housing.share', 'DE', -1)).toBeNull()
    expect(bandFor('housing.share', 'DE', Number.NEGATIVE_INFINITY)).toBeNull()
    // Below zero is a savings rate like any other.
    expect(bandFor('savings.rate', 'US', -3.6)?.band).toBe('low')
  })

  it('puts Infinity above every edge: a cushion with nothing needed reads high', () => {
    for (const region of REGIONS) {
      expect(bandFor('cushion.months', region, Number.POSITIVE_INFINITY)?.band, region).toBe('high')
    }
    for (const [metric, region] of CASES) {
      if (bandsFor(metric, region).length === 0) continue
      const top = bandFor(metric, region, Number.POSITIVE_INFINITY)
      expect(top, `${metric} ${region}`).not.toBeNull()
      expect(top!.max, `${metric} ${region}`).toBeNull()
    }
  })

  it('has none where the region has a gap', () => {
    expect(bandFor('subscriptions.monthlySpend', 'DE', 50)).toBeNull()
    expect(bandFor('shock.cover', 'EU27', 2)).toBeNull()
    expect(bandFor('debt.serviceShare', 'UK', 20)).toBeNull()
  })

  it('carries the source and year a card cites', () => {
    expect(bandFor('shock.cover', 'HR', 0.85)).toMatchObject({
      band: 'low',
      year: 2025,
      strength: 'strong',
      sourceUrl: expect.stringMatching(/^https:\/\/podaci\.dzs\.hr\//),
    })
  })
})

describe('referencesFor', () => {
  it('lists the figures the copy quotes, in the file’s order', () => {
    expect(referencesFor('shock.cover', 'DE')).toEqual([
      expect.objectContaining({ value: 1300, unit: 'EUR', shareUnable: 31.9, year: 2025 }),
    ])
    expect(referencesFor('spending.foodAtHome', 'DE').map((r) => r.kind ?? r.value)).toEqual([
      'groupRange',
      14,
    ])
    expect(referencesFor('savings.rate', 'DE')[0]).toMatchObject({ value: 18.86, year: 2025 })
    expect(referencesFor('subscriptions.monthlySpend', 'HR')).toEqual([])
  })
})

describe('the people in examples.md', () => {
  // The values and bands examples_calc.py printed for the research (work/examples_calc.out).
  it.each([
    ['US, 30 subscriptions', 'subscriptions.count', 'US', 30, 'high'],
    ['US, 1 subscription', 'subscriptions.count', 'US', 1, 'low'],
    ['US, 2 subscriptions', 'subscriptions.count', 'US', 2, 'typical'],
    ['US, $350 a month', 'subscriptions.monthlySpend', 'US', 350, 'high'],
    ['US, $9.99 a month', 'subscriptions.monthlySpend', 'US', 9.99, 'low'],
    ['A, savings rate', 'savings.rate', 'HR', 3.68, 'low'],
    ['A, cushion', 'cushion.months', 'HR', 0.94, 'low'],
    ['A, unexpected bill', 'shock.cover', 'HR', 0.85, 'low'],
    ['A, subscriptions', 'subscriptions.count', 'HR', 4, 'typical'],
    ['A, housing', 'housing.share', 'HR', 34.56, 'typical'],
    ['A, groceries', 'spending.foodAtHome', 'HR', 25.95, 'typical'],
    ['A, eating out', 'spending.eatingOut', 'HR', 7.33, 'high'],
    ['A, transport', 'spending.transport', 'HR', 3.82, 'low'],
    ['B, savings rate, cash', 'savings.rate', 'DE', 12.71, 'low'],
    ['B, savings rate, principal back', 'savings.rate', 'DE', 16.87, 'typical'],
    ['B, cushion', 'cushion.months', 'DE', 2.92, 'typical'],
    ['B, unexpected bill', 'shock.cover', 'DE', 8.23, 'typical'],
    ['B, subscriptions per adult', 'subscriptions.count', 'DE', 4.5, 'typical'],
    ['B, housing', 'housing.share', 'DE', 30, 'typical'],
    ['B, groceries', 'spending.foodAtHome', 'DE', 15.15, 'typical'],
    ['B, eating out', 'spending.eatingOut', 'DE', 4.66, 'typical'],
    ['B, transport', 'spending.transport', 'DE', 12.39, 'typical'],
    ['B, car loan', 'debt.rate', 'DE', 6.9, 'typical'],
    ['B, debt payments', 'debt.serviceShare', 'DE', 5.25, 'typical'],
    ['C, savings rate, cash', 'savings.rate', 'US', -3.64, 'low'],
    ['C, savings rate, principal back', 'savings.rate', 'US', 6.76, 'typical'],
    ['C, cushion', 'cushion.months', 'US', 0.24, 'low'],
    ['C, unexpected bill', 'shock.cover', 'US', 1.88, 'typical'],
    ['C, subscriptions', 'subscriptions.count', 'US', 11, 'high'],
    ['C, subscription spend', 'subscriptions.monthlySpend', 'US', 164, 'high'],
    ['C, housing', 'housing.share', 'US', 41.82, 'typical'],
    ['C, groceries', 'spending.foodAtHome', 'US', 10.53, 'typical'],
    ['C, eating out', 'spending.eatingOut', 'US', 10.28, 'high'],
    ['C, transport', 'spending.transport', 'US', 15.66, 'typical'],
    ['C, credit card', 'debt.rate', 'US', 24.9, 'high'],
    ['C, personal loan', 'debt.rate', 'US', 13.5, 'high'],
    ['C, car loan', 'debt.rate', 'US', 7.2, 'typical'],
    ['C, debt payments', 'debt.serviceShare', 'US', 16.62, 'typical'],
  ] as const)('%s lands where the research put it', (_, metric, region, value, band) => {
    expect(bandFor(metric, region, value)?.band).toBe(band)
  })
})

describe('who reads the file', () => {
  // Through a variable: vite rewrites `new URL('<literal>', import.meta.url)` as an asset's URL.
  const here = import.meta.url
  const ROOT = new URL('../../../../', here).pathname
  const read = (sources: Record<string, unknown>) =>
    Object.entries(sources).map(
      ([key, text]) => [new URL(key, here).pathname.slice(ROOT.length), text as string] as const
    )
  const code = [
    ...read(
      import.meta.glob(['../../**/*.ts', '../../**/*.tsx'], {
        query: '?raw',
        import: 'default',
        eager: true,
      })
    ),
    ...read(
      import.meta.glob('../../../../shared/**/*.ts', {
        query: '?raw',
        import: 'default',
        eager: true,
      })
    ),
    ...read(
      import.meta.glob('../../../../worker/src/**/*.ts', {
        query: '?raw',
        import: 'default',
        eager: true,
      })
    ),
  ]

  /** The modules a file imports, read from its code with the comments taken out. */
  function imports(text: string): string[] {
    const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
    const patterns = [
      /^\s*(?:import|export)\b[^'";]*?\bfrom\s*['"]([^'"]+)['"]/gm,
      /^\s*import\s*['"]([^'"]+)['"]/gm,
      /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
      /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    ]
    return patterns.flatMap((pattern) => [...code.matchAll(pattern)].map((m) => m[1]))
  }

  it('is benchmarks.ts, and nothing else imports the JSON', () => {
    expect(code.length, 'the sources were read').toBeGreaterThan(500)
    const readers = code
      .filter(([, text]) => imports(text).some((spec) => spec.endsWith('benchmarks.json')))
      .map(([path]) => path)
    expect(readers).toEqual(['shared/guidance/benchmarks.ts'])
  })

  it('imports nothing from outside shared/ into shared/guidance/', () => {
    const guidance = code.filter(([path]) => path.startsWith('shared/guidance/'))
    expect(guidance.map(([path]) => path)).toContain('shared/guidance/benchmarks.ts')
    for (const [path, text] of guidance) {
      for (const spec of imports(text)) {
        expect(spec, `${path} imports ${spec}`).toMatch(/^\.\.?\//)
        const target = new URL(spec, `file://${ROOT}${path}`).pathname.slice(ROOT.length)
        expect(target, `${path} imports ${spec}`).toMatch(/^shared\//)
      }
    }
  })
})
