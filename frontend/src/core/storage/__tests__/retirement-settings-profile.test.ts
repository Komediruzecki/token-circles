import { beforeEach, describe, expect, it } from 'vitest'
import { getDB } from '../idb.js'
import { routeApiRequest } from '../localApiRouter.js'

/**
 * The retirement assumptions are per profile in browser mode.
 *
 * The settings store is keyed by `key` alone — it has no profile column — and these were
 * saved under a bare 'retirement_settings'. So every profile in the same browser shared
 * one plan: opening a second profile showed the first one's assumptions, and saving there
 * overwrote them. Both server runtimes have always scoped these by profile through the
 * settings table's (key, profile_id) primary key; this is browser mode catching up.
 *
 * Real `idb` on fake-indexeddb (see src/test-setup.ts).
 */
async function seed() {
  const db = await getDB()
  for (const s of ['profiles', 'transactions', 'accounts', 'settings']) {
    if (db.objectStoreNames.contains(s)) await db.clear(s)
  }
  await db.add('profiles', { id: 1, name: 'Me', created_at: '2026-01-01' })
  await db.add('profiles', { id: 2, name: 'Partner', created_at: '2026-01-01' })
}

const selectProfile = (id: number) => {
  localStorage.setItem('currentProfileId', String(id))
  localStorage.setItem('selectedProfileIds', `[${id}]`)
}

beforeEach(async () => {
  localStorage.clear()
  selectProfile(1)
  await seed()
})

const save = (settings: Record<string, unknown>) =>
  routeApiRequest('http://localhost/api/retirement/settings', {
    method: 'PUT',
    body: JSON.stringify(settings),
  })

const load = async (): Promise<Record<string, any>> => {
  const res = await routeApiRequest('http://localhost/api/retirement/settings', { method: 'GET' })
  return (await res.json()) as Record<string, any>
}

const settingsKeys = async (): Promise<string[]> => {
  const rows = (await (await getDB()).getAll('settings')) as { key: string }[]
  return rows.map((r) => r.key).sort()
}

describe('retirement assumptions are stored per profile', () => {
  it('does not hand one profile another profile’s plan', async () => {
    await save({ netWorth: 111, monthlyContribution: 500 })

    selectProfile(2)
    const other = await load()
    expect(other.settings.netWorth).toBe(0)
    expect(other.settings.monthlyContribution).toBe(500) // the default, not profile 1's 500

    selectProfile(1)
    expect((await load()).settings.netWorth).toBe(111)
  })

  it('keeps both plans when the second profile saves its own', async () => {
    await save({ netWorth: 111 })
    selectProfile(2)
    await save({ netWorth: 222 })

    expect((await load()).settings.netWorth).toBe(222)
    selectProfile(1)
    expect((await load()).settings.netWorth).toBe(111)
  })

  it('writes a row per profile rather than overwriting one', async () => {
    await save({ netWorth: 111 })
    selectProfile(2)
    await save({ netWorth: 222 })
    expect(await settingsKeys()).toEqual(['retirement_settings:1', 'retirement_settings:2'])
  })

  it('round-trips a saved default, which is the whole point of storing what was sent', async () => {
    await save({ netWorth: 0, monthlyContribution: 500 })
    const body = await load()
    expect(body.settings.netWorth).toBe(0)
    expect(body.settings.monthlyContribution).toBe(500)
    expect(body.filled).toEqual([])
  })

  it('adopts a plan saved before the key carried a profile, and removes the old row', async () => {
    // Written the way the previous version stored it: one bare key for everyone.
    const db = await getDB()
    await db.put('settings', {
      key: 'retirement_settings',
      value: { netWorth: 999, monthlyContribution: 700 },
    })

    const body = await load()
    expect(body.settings.netWorth).toBe(999)
    expect(body.settings.monthlyContribution).toBe(700)
    // Moved, not copied: leaving it would hand the same plan to every other profile.
    expect(await settingsKeys()).toEqual(['retirement_settings:1'])

    selectProfile(2)
    expect((await load()).settings.netWorth).toBe(0)
  })

  it('reads a plan stored as JSON text, as a server backup restores it', async () => {
    const db = await getDB()
    await db.put('settings', {
      key: 'retirement_settings:1',
      value: JSON.stringify({ netWorth: 4242 }),
    })
    expect((await load()).settings.netWorth).toBe(4242)
  })

  it('falls back to defaults for a stored blob it cannot parse', async () => {
    const db = await getDB()
    await db.put('settings', { key: 'retirement_settings:1', value: '{"netWorth": 1' })
    const body = await load()
    expect(body.settings.netWorth).toBe(0)
    expect(body.settings.mode).toBe('simple')
  })

  it('scopes the projection endpoint by profile too', async () => {
    await save({ netWorth: 111, monthlyContribution: 0, annualReturnPct: 0 })
    const mine = (await (
      await routeApiRequest('http://localhost/api/retirement/projection', { method: 'GET' })
    ).json()) as Record<string, any>
    expect(mine.projection.rows[0].netWorth).toBe(111)

    selectProfile(2)
    const theirs = (await (
      await routeApiRequest('http://localhost/api/retirement/projection', { method: 'GET' })
    ).json()) as Record<string, any>
    expect(theirs.projection.rows[0].netWorth).toBe(0)
  })
})
