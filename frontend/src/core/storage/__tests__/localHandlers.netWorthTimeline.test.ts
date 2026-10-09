/**
 * The net-worth timeline groups balance snapshots by the day they were taken on the person's
 * calendar.
 *
 * A snapshot recorded through the app carries an instant (toISOString()), and the timeline cut
 * its date out with .slice(0, 10), the UTC date: a balance noted at 08:30 on the 8th in Tokyo was
 * filed under the 7th. A snapshot an import made carries a bare date, which is already a calendar
 * date and stays as it is.
 *
 * A day's figure is each account's latest balance on or before it (shared/netWorthTimeline.ts).
 * It used to add up only the balances recorded that day, so on the 8th in Tokyo, when only
 * account 1 had a new one, the net worth was account 1's alone.
 */
import { afterEach, beforeEach, expect, it } from 'vitest'
import { getDB } from '../idb.js'
import { accountsTimeline } from '../localHandlers.js'

const hostZone = process.env.TZ

beforeEach(async () => {
  localStorage.clear()
  localStorage.setItem('currentProfileId', '1')
  const db = await getDB()
  for (const store of ['profiles', 'accounts', 'balanceHistory']) await db.clear(store)
  await db.add('profiles', { id: 1, name: 'Test', created_at: '2026-01-01' })
  for (const id of [1, 2]) {
    await db.add('accounts', { id, profile_id: 1, name: `Account ${id}`, type: 'giro', balance: 0 })
  }
  // 23:30 UTC on the 7th is 08:30 on the 8th in Tokyo.
  await db.add('balanceHistory', {
    account_id: 1,
    balance: 100,
    recorded_at: '2026-10-07T23:30:00.000Z',
  })
  await db.add('balanceHistory', { account_id: 2, balance: 50, recorded_at: '2026-10-07' })
})

afterEach(() => {
  if (hostZone === undefined) delete process.env.TZ
  else process.env.TZ = hostZone
})

it('files a snapshot under the local day it was taken, and a dated one under its date', async () => {
  process.env.TZ = 'Asia/Tokyo'
  const timeline = await (await accountsTimeline()).json()
  expect(timeline).toEqual([
    { date: '2026-10-07', net_worth: 50 },
    { date: '2026-10-08', net_worth: 150 },
  ])
})
