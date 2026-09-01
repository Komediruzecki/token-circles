/**
 * Marking a bill paid must make it read as paid — in every timezone, on every day.
 *
 * The serverless handlers disagreed with themselves about which calendar a stored date is in.
 * `billsPayOrMarkPaid` wrote `new Date().toISOString().substring(0, 10)`, a UTC date, while
 * `isBillPaidForCurrentPeriod` compared it back with `.getMonth()`, which is LOCAL. `new Date()`
 * on a bare `YYYY-MM-DD` parses as UTC midnight, so its local month can be the previous one.
 *
 * The result: on the 1st of a month a bill marked paid was reported unpaid the instant it was
 * saved — the button stayed clickable and the bill never left the unpaid list.
 *
 * The failure needs the UTC date and the local date to fall in different MONTHS, which is why an
 * ordinary mid-month run never caught it, and why CI never did either: its runners are UTC, where
 * the two calendars are the same one. So both timezone and instant are pinned here.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDB } from '../idb.js'
import { billsCreate, billsList, billsPayOrMarkPaid } from '../localHandlers.js'

/**
 * Pin the zone for the assertions that follow. Node re-reads `process.env.TZ` on assignment, and
 * each test file runs in its own worker, so this does not leak across files. The returned offset
 * lets a test prove the pin actually took effect rather than silently testing the host's zone.
 */
function pinTimezone(tz: string): number {
  process.env.TZ = tz
  return new Date().getTimezoneOffset()
}

async function seedProfile() {
  localStorage.clear()
  localStorage.setItem('currentProfileId', '1')
  const db = await getDB()
  await db.clear('profiles')
  await db.clear('bills')
  await db.add('profiles', { id: 1, name: 'Test', created_at: '2026-01-01' })
}

/** Only Date is faked — fake-indexeddb needs real timers to settle its requests. */
function freezeAt(iso: string) {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(iso))
}

afterEach(() => {
  vi.useRealTimers()
})

async function markPaidAndRead() {
  const createRes = await billsCreate({
    name: 'Water',
    amount: 40,
    due_date: '2026-09-10',
    frequency: 'monthly',
    autopay: false,
  })
  const created = await createRes.json()

  const payRes = await billsPayOrMarkPaid({ p1: created.id.toString() })
  expect(payRes.status).toBe(200)

  const paidRes = await billsList(new URLSearchParams({ paid: 'true' }))
  const stored = await (await billsList()).json()
  return { paid: await paidRes.json(), storedDate: stored[0].last_paid_date as string }
}

describe('marking a bill paid, west of UTC', () => {
  beforeEach(async () => {
    // 12:00 UTC on the 1st is 08:00 local — the UTC calendar says September, the local one does
    // too, but a date STRING of '2026-09-01' read back as UTC midnight lands on 31 August local.
    const offset = pinTimezone('America/New_York')
    expect(offset, 'timezone pin must take effect or this tests nothing').toBe(240)
    freezeAt('2026-09-01T12:00:00Z')
    await seedProfile()
  })

  it('reads as paid immediately after being marked paid', async () => {
    const { paid } = await markPaidAndRead()
    expect(paid, 'a bill marked paid must not report itself unpaid').toHaveLength(1)
  })

  it('stores the local wall-clock date, not the UTC one', async () => {
    const { storedDate } = await markPaidAndRead()
    expect(storedDate).toBe('2026-09-01')
  })
})

describe('marking a bill paid, east of UTC after local midnight', () => {
  beforeEach(async () => {
    // 23:50 UTC on 31 August is 01:50 on 1 September in Zagreb. toISOString() still says August.
    // This is the window the bug was originally caught in.
    const offset = pinTimezone('Europe/Zagreb')
    expect(offset, 'timezone pin must take effect or this tests nothing').toBe(-120)
    freezeAt('2026-08-31T23:50:00Z')
    await seedProfile()
  })

  it('reads as paid immediately after being marked paid', async () => {
    const { paid } = await markPaidAndRead()
    expect(paid).toHaveLength(1)
  })

  it('stores the local wall-clock date, not the UTC one', async () => {
    const { storedDate } = await markPaidAndRead()
    expect(storedDate).toBe('2026-09-01')
  })
})
