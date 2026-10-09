/**
 * Local-first keeps one settings row per key for the whole browser, so the settings that belong
 * to one profile carry it in the key: a retirement plan is `retirement_settings:<profile id>`, a
 * badge record `achievements:<profile id>`.
 *
 * The export put every such row in every file: one profile's export carried every other
 * profile's retirement plan and badges, and in a whole backup each profile's settings rows held
 * every profile's plan. Now a file carries the per-profile rows of the profiles it exports, each
 * under its own profile.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { getDB, IndexedDBAdapter } from '../idb'

const adapter = new IndexedDBAdapter()
const PLAN_1 = { birthMonth: '1986-04', retirementAge: 67 }
const PLAN_2 = { birthMonth: '1990-11', retirementAge: 63 }

beforeEach(async () => {
  localStorage.clear()
  localStorage.setItem('currentProfileId', '1')
  const db = await getDB()
  for (const store of Array.from(db.objectStoreNames)) await db.clear(store)
  await db.add('profiles', { id: 1, name: 'Me', created_at: '2026-01-01T00:00:00.000Z' })
  await db.add('profiles', { id: 2, name: 'Partner', created_at: '2026-01-01T00:00:00.000Z' })
  await db.put('settings', { key: 'currency', value: 'EUR' })
  await db.put('settings', { key: 'retirement_settings:1', value: PLAN_1 })
  await db.put('settings', { key: 'retirement_settings:2', value: PLAN_2 })
  await db.put('settings', { key: 'achievements:1', value: '{"v":1,"unlocks":[]}' })
  await db.put('settings', { key: 'achievements:2', value: '{"v":1,"unlocks":[]}' })
})

const keysOf = (rows: Record<string, unknown>[] | undefined, profile: number) =>
  (rows ?? [])
    .filter((row) => row.profile_id === profile)
    .map((row) => row.key)
    .sort()

describe('an export and the settings that belong to one profile', () => {
  it("leaves another profile's plan and badges out of one profile's file", async () => {
    const file = await adapter.exportData([1])
    expect(file.settings).toMatchObject({
      currency: 'EUR',
      'retirement_settings:1': PLAN_1,
      'achievements:1': '{"v":1,"unlocks":[]}',
    })
    expect(file.settings).not.toHaveProperty('retirement_settings:2')
    expect(file.settings).not.toHaveProperty('achievements:2')
    expect(keysOf(file.settingsRows, 1)).not.toContain('retirement_settings:2')
    expect(keysOf(file.settingsRows, 1)).not.toContain('achievements:2')
  })

  it("files each profile's plan and badges under that profile in a whole backup", async () => {
    const file = await adapter.exportData()
    expect(file.settings).toMatchObject({
      'retirement_settings:1': PLAN_1,
      'retirement_settings:2': PLAN_2,
    })
    const mine = keysOf(file.settingsRows, 1)
    const theirs = keysOf(file.settingsRows, 2)
    expect(mine).toContain('retirement_settings:1')
    expect(mine).toContain('achievements:1')
    expect(mine).not.toContain('retirement_settings:2')
    expect(mine).not.toContain('achievements:2')
    expect(theirs).toContain('retirement_settings:2')
    expect(theirs).not.toContain('retirement_settings:1')
    // The settings of the whole browser are every profile's.
    expect(mine).toContain('currency')
    expect(theirs).toContain('currency')
  })

  it('still restores each plan to its profile', async () => {
    await adapter.importData(await adapter.exportData())
    const profiles = (await (await getDB()).getAll('profiles')) as { id: number; name: string }[]
    const idOf = (name: string) => profiles.find((p) => p.name === name)!.id
    const settings = await adapter.getSettings()
    expect(settings[`retirement_settings:${idOf('Me')}`]).toEqual(PLAN_1)
    expect(settings[`retirement_settings:${idOf('Partner')}`]).toEqual(PLAN_2)
  })
})
