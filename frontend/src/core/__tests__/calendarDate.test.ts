import { describe, expect, it } from 'vitest'
import { calendarDateIn, isTimeZone, wallClockIn } from '../../../../shared/calendarDate'

// The helpers take the zone as an argument and must never read the host's. Pinning the host far
// from every zone below makes a leak show up as a wrong date. Node re-reads TZ on assignment, and
// each test file runs in its own worker.
process.env.TZ = 'Pacific/Kiritimati'

describe('isTimeZone', () => {
  it('accepts IANA names, however many parts they have', () => {
    for (const zone of [
      'UTC',
      'Europe/Zagreb',
      'Asia/Kolkata',
      'America/Argentina/Buenos_Aires',
      'America/Port-au-Prince',
      'Etc/GMT+5',
    ]) {
      expect(isTimeZone(zone), zone).toBe(true)
    }
  })

  it('refuses an offset: it has no daylight saving, so it is the wrong date half the year', () => {
    for (const offset of ['+02:00', '-05:00', '+0900', 'GMT+9']) {
      expect(isTimeZone(offset), offset).toBe(false)
    }
  })

  it('refuses names the runtime does not know, and anything that is not a name', () => {
    for (const value of [
      'Mars/Olympus_Mons',
      'Etc/Unknown',
      'Asia/Tokyo; x',
      '../Asia/Tokyo',
      'Asia//Tokyo',
      '',
      ' ',
      `Europe/${'Z'.repeat(64)}`,
      undefined,
      null,
      9,
      {},
    ]) {
      expect(isTimeZone(value), JSON.stringify(value)).toBe(false)
    }
  })
})

describe('calendarDateIn', () => {
  it('is the date where the person is, not the UTC one', () => {
    const lateOnThe7th = new Date('2026-10-07T23:30:00Z')
    expect(calendarDateIn('UTC', lateOnThe7th)).toBe('2026-10-07')
    expect(calendarDateIn('Europe/Zagreb', lateOnThe7th)).toBe('2026-10-08')
    expect(calendarDateIn('Asia/Tokyo', lateOnThe7th)).toBe('2026-10-08')
    expect(calendarDateIn('America/Los_Angeles', lateOnThe7th)).toBe('2026-10-07')

    const earlyOnThe8th = new Date('2026-10-08T03:30:00Z')
    expect(calendarDateIn('UTC', earlyOnThe8th)).toBe('2026-10-08')
    expect(calendarDateIn('America/Los_Angeles', earlyOnThe8th)).toBe('2026-10-07')
  })

  it('covers the zones furthest from UTC, a whole day apart', () => {
    const midday = new Date('2026-10-07T12:00:00Z')
    expect(calendarDateIn('Pacific/Kiritimati', midday)).toBe('2026-10-08')
    expect(calendarDateIn('Pacific/Pago_Pago', midday)).toBe('2026-10-07')
    expect(calendarDateIn('Pacific/Pago_Pago', new Date('2026-10-07T10:59:00Z'))).toBe('2026-10-06')
  })

  it('turns over at local midnight in a half-hour zone', () => {
    expect(calendarDateIn('Asia/Kolkata', new Date('2026-10-07T18:29:59Z'))).toBe('2026-10-07')
    expect(calendarDateIn('Asia/Kolkata', new Date('2026-10-07T18:30:00Z'))).toBe('2026-10-08')
  })

  it('follows daylight saving: midnight moves by an hour in UTC', () => {
    // Zagreb is UTC+1 in winter and UTC+2 in summer; the clocks change on 29 March and 25 October.
    expect(calendarDateIn('Europe/Zagreb', new Date('2026-03-27T22:59:00Z'))).toBe('2026-03-27')
    expect(calendarDateIn('Europe/Zagreb', new Date('2026-03-27T23:00:00Z'))).toBe('2026-03-28')
    expect(calendarDateIn('Europe/Zagreb', new Date('2026-06-14T21:59:00Z'))).toBe('2026-06-14')
    expect(calendarDateIn('Europe/Zagreb', new Date('2026-06-14T22:00:00Z'))).toBe('2026-06-15')
  })

  it('crosses months, years and leap days', () => {
    expect(calendarDateIn('Asia/Tokyo', new Date('2026-10-31T15:00:00Z'))).toBe('2026-11-01')
    expect(calendarDateIn('Asia/Tokyo', new Date('2026-12-31T15:00:00Z'))).toBe('2027-01-01')
    expect(calendarDateIn('Asia/Tokyo', new Date('2028-02-28T15:00:00Z'))).toBe('2028-02-29')
    expect(calendarDateIn('America/Los_Angeles', new Date('2027-01-01T07:59:00Z'))).toBe(
      '2026-12-31'
    )
  })
})

describe('wallClockIn', () => {
  it('holds the wall clock in its UTC fields, to the millisecond', () => {
    const wall = wallClockIn('Asia/Tokyo', new Date('2026-10-07T23:30:15.250Z'))
    expect(wall.toISOString()).toBe('2026-10-08T08:30:15.250Z')
    expect([wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate()]).toEqual([2026, 9, 8])
  })

  it('reads midnight as hour 0, never 24', () => {
    expect(wallClockIn('Europe/Zagreb', new Date('2026-10-07T22:00:00Z')).toISOString()).toBe(
      '2026-10-08T00:00:00.000Z'
    )
  })

  it('does calendar arithmetic on the person calendar', () => {
    // Twelve months before 08:30 on 8 October in Tokyo, while UTC is still on the 7th.
    const since = wallClockIn('Asia/Tokyo', new Date('2026-10-07T23:30:00Z'))
    since.setUTCMonth(since.getUTCMonth() - 12)
    expect(since.toISOString().slice(0, 10)).toBe('2025-10-08')
  })

  it('reads a four-digit year as written, early years included', () => {
    expect(calendarDateIn('UTC', new Date('0099-06-01T12:00:00Z'))).toBe('0099-06-01')
  })

  it('throws for a zone the runtime does not know, so callers check isTimeZone first', () => {
    expect(() => wallClockIn('Mars/Olympus_Mons')).toThrow(RangeError)
  })
})
