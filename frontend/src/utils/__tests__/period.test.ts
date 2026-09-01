import { describe, expect, it } from 'vitest'
import {
  defaultPeriod,
  fromPill,
  isoDate,
  label,
  monthPeriod,
  parseLocalDate,
  parsePeriod,
  periodPills,
  periodsEqual,
  serializePeriod,
  shift,
  toRange,
  toYYYYMM,
  yearPeriod,
} from '../period'
import type { Period } from '../period'

// Fixed reference point for deterministic "now"-relative math.
const NOW = new Date(2026, 6, 13) // 13 Jul 2026 (month index 6)

describe('isoDate', () => {
  it('formats in local time without UTC drift', () => {
    expect(isoDate(new Date(2026, 0, 5))).toBe('2026-01-05')
    expect(isoDate(new Date(2026, 11, 31))).toBe('2026-12-31')
  })
})

describe('construction', () => {
  it('defaultPeriod is the current month', () => {
    expect(defaultPeriod(NOW)).toEqual({ mode: 'month', year: 2026, month: 6 })
  })

  it('monthPeriod normalizes overflow/underflow', () => {
    expect(monthPeriod(2026, 12)).toEqual({ mode: 'month', year: 2027, month: 0 })
    expect(monthPeriod(2026, -1)).toEqual({ mode: 'month', year: 2025, month: 11 })
  })

  it('yearPeriod', () => {
    expect(yearPeriod(2026)).toEqual({ mode: 'year', year: 2026 })
  })
})

describe('fromPill', () => {
  it('thisMonth / lastMonth are month mode with preset', () => {
    expect(fromPill('thisMonth', NOW)).toEqual({
      mode: 'month',
      year: 2026,
      month: 6,
      preset: 'thisMonth',
    })
    expect(fromPill('lastMonth', NOW)).toEqual({
      mode: 'month',
      year: 2026,
      month: 5,
      preset: 'lastMonth',
    })
  })

  it('lastMonth wraps the year in January', () => {
    const jan = new Date(2026, 0, 10)
    expect(fromPill('lastMonth', jan)).toEqual({
      mode: 'month',
      year: 2025,
      month: 11,
      preset: 'lastMonth',
    })
  })

  it('ytd runs Jan 1 → today', () => {
    expect(fromPill('ytd', NOW)).toMatchObject({ from: '2026-01-01', to: '2026-07-13' })
  })

  it('last30 / last90 are inclusive windows ending today', () => {
    expect(fromPill('last30', NOW)).toMatchObject({ from: '2026-06-14', to: '2026-07-13' })
    expect(fromPill('last90', NOW)).toMatchObject({ from: '2026-04-15', to: '2026-07-13' })
  })

  it('all starts at the epoch floor', () => {
    expect(fromPill('all', NOW)).toMatchObject({ from: '1970-01-01', to: '2026-07-13' })
  })
})

describe('toRange', () => {
  it('month mode → first..last of month', () => {
    expect(toRange({ mode: 'month', year: 2026, month: 1 })).toEqual({
      from: '2026-02-01',
      to: '2026-02-28',
    })
  })

  it('month mode handles leap February', () => {
    expect(toRange({ mode: 'month', year: 2024, month: 1 })).toEqual({
      from: '2024-02-01',
      to: '2024-02-29',
    })
  })

  it('year mode → Jan 1..Dec 31', () => {
    expect(toRange({ mode: 'year', year: 2026 })).toEqual({ from: '2026-01-01', to: '2026-12-31' })
  })

  it('range mode passes through', () => {
    expect(toRange({ mode: 'range', year: 2026, from: '2026-03-01', to: '2026-03-15' })).toEqual({
      from: '2026-03-01',
      to: '2026-03-15',
    })
  })
})

describe('toYYYYMM', () => {
  it('month mode', () => {
    expect(toYYYYMM({ mode: 'month', year: 2026, month: 6 })).toBe('2026-07')
  })
  it('range mode uses the start month', () => {
    expect(toYYYYMM({ mode: 'range', year: 2026, from: '2026-05-04', to: '2026-06-01' })).toBe(
      '2026-05'
    )
  })
})

describe('label', () => {
  it('month / year', () => {
    expect(label({ mode: 'month', year: 2026, month: 6 })).toBe('July 2026')
    expect(label({ mode: 'year', year: 2026 })).toBe('2026')
  })
  it('range presets read as words', () => {
    expect(label(fromPill('ytd', NOW))).toBe('Year to date')
    expect(label(fromPill('last30', NOW))).toBe('Last 30 days')
    expect(label(fromPill('all', NOW))).toBe('All time')
  })
  it('custom range shows a compact span', () => {
    expect(
      label({ mode: 'range', year: 2026, from: '2026-06-12', to: '2026-07-05', preset: 'custom' })
    ).toBe('12 Jun – 5 Jul 2026')
  })
})

describe('shift', () => {
  it('month steps and wraps years, dropping the pill', () => {
    expect(shift({ mode: 'month', year: 2026, month: 11, preset: 'thisMonth' }, 1)).toEqual({
      mode: 'month',
      year: 2027,
      month: 0,
      preset: undefined,
    })
    expect(shift({ mode: 'month', year: 2026, month: 0 }, -1)).toEqual({
      mode: 'month',
      year: 2025,
      month: 11,
      preset: undefined,
    })
  })

  it('year steps', () => {
    expect(shift({ mode: 'year', year: 2026 }, 1)).toMatchObject({ mode: 'year', year: 2027 })
  })

  it('range steps by its own length', () => {
    const r: Period = { mode: 'range', year: 2026, from: '2026-06-01', to: '2026-06-30' }
    expect(shift(r, -1)).toMatchObject({ from: '2026-05-02', to: '2026-05-31' })
  })

  it('"all" does not step', () => {
    const all = fromPill('all', NOW)
    expect(shift(all, 1)).toBe(all)
  })
})

describe('periodsEqual', () => {
  it('compares by mode-relevant fields', () => {
    expect(
      periodsEqual({ mode: 'month', year: 2026, month: 6 }, { mode: 'month', year: 2026, month: 6 })
    ).toBe(true)
    expect(
      periodsEqual({ mode: 'month', year: 2026, month: 6 }, { mode: 'month', year: 2026, month: 5 })
    ).toBe(false)
    expect(
      periodsEqual({ mode: 'year', year: 2026 }, { mode: 'month', year: 2026, month: 6 })
    ).toBe(false)
  })
})

describe('serialize / parse round-trips', () => {
  const cases: Period[] = [
    { mode: 'month', year: 2026, month: 6 },
    { mode: 'year', year: 2026 },
    fromPill('ytd', NOW),
    fromPill('last30', NOW),
    fromPill('all', NOW),
    { mode: 'range', year: 2026, from: '2026-06-12', to: '2026-07-05', preset: 'custom' },
  ]

  it('every mode survives a hash round-trip', () => {
    for (const p of cases) {
      const parsed = parsePeriod(serializePeriod(p), NOW)
      expect(parsed).not.toBeNull()
      expect(periodsEqual(parsed as Period, p)).toBe(true)
    }
  })

  it('month serializes to YYYY-MM', () => {
    expect(serializePeriod({ mode: 'month', year: 2026, month: 6 })).toEqual({ period: '2026-07' })
  })

  it('presets serialize by name', () => {
    expect(serializePeriod(fromPill('ytd', NOW))).toEqual({ period: 'ytd' })
  })

  it('custom range serializes to from/to', () => {
    expect(
      serializePeriod({ mode: 'range', year: 2026, from: '2026-06-12', to: '2026-07-05' })
    ).toEqual({ from: '2026-06-12', to: '2026-07-05' })
  })

  it('parse returns null for empty params', () => {
    expect(parsePeriod({}, NOW)).toBeNull()
  })
})

/**
 * The first two pills used to read "This month" and "Last month", shortened to "This mo." and
 * "Last mo." on a phone — four syllables of grammar to say what the month's own name says in one,
 * and still wide enough to run out through the side of its pill on a narrow screen.
 *
 * They are named for the months they land on now. That is shorter, and it answers the question
 * the phrase left open: someone looking at March who taps "This month" has to already know what
 * month it is now.
 */
describe('the quick-period pills', () => {
  it('names the first two for the months they select', () => {
    const pills = periodPills(new Date(2026, 7, 24)) // August
    expect(pills[0]!.label).toBe('August')
    expect(pills[0]!.short).toBe('Aug')
    expect(pills[1]!.label).toBe('July')
    expect(pills[1]!.short).toBe('Jul')
  })

  it('crosses the year boundary backwards', () => {
    // The one arithmetic that can go wrong: January's "last month" is in the previous year.
    const pills = periodPills(new Date(2026, 0, 15))
    expect(pills[0]!.label).toBe('January')
    expect(pills[1]!.label).toBe('December')
  })

  it('keeps saying what each pill means, for the tooltip', () => {
    // The label is now only a month, so the wording it replaced has to live somewhere.
    const pills = periodPills(new Date(2026, 7, 24))
    expect(pills[0]!.title).toBe('This month (August)')
    expect(pills[1]!.title).toBe('Last month (July)')
    expect(pills[2]!.title).toBe('Year to date')
  })

  it('leaves the ids alone', () => {
    // The label is cosmetic; the id is what `fromPill` dispatches on.
    expect(periodPills(new Date(2026, 7, 24)).map((p) => p.id)).toEqual([
      'thisMonth',
      'lastMonth',
      'ytd',
      'last30',
      'last90',
      'all',
    ])
  })

  it('gives every pill a short form no longer than the full one', () => {
    for (const pill of periodPills(new Date(2026, 7, 24))) {
      expect(pill.short.length, `${pill.id} short form`).toBeLessThanOrEqual(pill.label.length)
      expect(pill.short.length, `${pill.id} short form`).toBeLessThanOrEqual(4)
    }
  })

  it('is computed per call, not frozen at import', () => {
    // A tab open across midnight on the 1st would otherwise keep naming the month it opened in.
    expect(periodPills(new Date(2026, 2, 1))[0]!.label).toBe('March')
    expect(periodPills(new Date(2026, 9, 1))[0]!.label).toBe('October')
  })
})

describe('parseLocalDate', () => {
  it('round-trips isoDate on the local calendar', () => {
    const d = new Date(2026, 8, 1) // 1 Sep 2026, local
    expect(parseLocalDate(isoDate(d)).getTime()).toBe(d.getTime())
  })

  it('reads a stored date as the day it says, not the day before', () => {
    // `new Date('2026-09-01')` is UTC midnight, so west of UTC it reports 31 August.
    const parsed = parseLocalDate('2026-09-01')
    expect([parsed.getFullYear(), parsed.getMonth(), parsed.getDate()]).toEqual([2026, 8, 1])
  })

  it('truncates a full ISO timestamp to its date part', () => {
    const parsed = parseLocalDate('2026-09-01T23:50:00.000Z')
    expect([parsed.getMonth(), parsed.getDate()]).toEqual([8, 1])
  })

  it('yields an Invalid Date for anything that is not a full date', () => {
    // Callers guard with isNaN(getTime()); an empty string must not quietly become the year 1900,
    // and a non-string row out of IndexedDB must not throw and hide every other row with it.
    for (const junk of ['', 'garbage', '2026-09', '2026']) {
      expect(Number.isNaN(parseLocalDate(junk).getTime()), JSON.stringify(junk)).toBe(true)
    }
    expect(Number.isNaN(parseLocalDate(12345).getTime())).toBe(true)
  })
})
