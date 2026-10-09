/**
 * Local-first keeps one settings row per key for the whole browser, so the settings that belong
 * to one profile carry it in the key: a retirement plan is `retirement_settings:<profile id>`, a
 * badge record `achievements:<profile id>`.
 *
 * The export put every such row in every file: one profile's export carried every other
 * profile's retirement plan and badges, and in a whole backup each profile's settings rows held
 * every profile's plan. Now a file carries the per-profile rows of the profiles it exports, each
 * under its own profile.
 *
 * A restore gives every profile a new id, so each of these follows its profile to it, and one of
 * a profile the file does not carry is left out. The Worker keeps the same settings per row under
 * the plain key (`retirement_settings`), so a cloud backup's rows are filed the same way.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { belongsToOneProfile } from '../../../../../shared/profileSettings'
import { getDB, IndexedDBAdapter } from '../idb'
import type { ExportData } from '../../../types/storage'

const adapter = new IndexedDBAdapter()
const PLAN_1 = { birthMonth: '1986-04', retirementAge: 67 }
const PLAN_2 = { birthMonth: '1990-11', retirementAge: 63 }
const BADGES_1 = '{"v":1,"unlocks":[],"held":"Me"}'
const BADGES_2 = '{"v":1,"unlocks":[],"held":"Partner"}'

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
  await db.put('settings', { key: 'achievements:1', value: BADGES_1 })
  await db.put('settings', { key: 'achievements:2', value: BADGES_2 })
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
      'achievements:1': BADGES_1,
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

  it('still restores each plan and badge record to its profile', async () => {
    // The store numbers the restored profiles on from the last id it gave, so Me comes back as
    // the id Partner has in the file.
    const last = await lastProfileId()
    const file = await adapter.exportData()
    await adapter.importData(renumbered(file, { 1: last, 2: last + 1 }))

    const id = await restoredIds()
    expect(id.Me).toBe(last + 1)
    const settings = await adapter.getSettings()
    expect(settings[`retirement_settings:${id.Me}`]).toEqual(PLAN_1)
    expect(settings[`retirement_settings:${id.Partner}`]).toEqual(PLAN_2)
    expect(settings[`achievements:${id.Me}`]).toEqual(BADGES_1)
    expect(settings[`achievements:${id.Partner}`]).toEqual(BADGES_2)
    expect(profileKeys(settings)).toEqual(
      [
        `achievements:${id.Me}`,
        `achievements:${id.Partner}`,
        `retirement_settings:${id.Me}`,
        `retirement_settings:${id.Partner}`,
      ].sort()
    )
  })

  it('leaves out the plan and badges of a profile the file does not carry', async () => {
    const file = await adapter.exportData([1])
    file.settings = {
      ...file.settings,
      'retirement_settings:9': PLAN_2,
      'achievements:9': BADGES_2,
    }
    await adapter.importData(file)

    const id = await restoredIds()
    const settings = await adapter.getSettings()
    expect(profileKeys(settings)).toEqual([`achievements:${id.Me}`, `retirement_settings:${id.Me}`])
  })

  it("deletes a profile's plan and badges with the profile", async () => {
    await adapter.clearProfileData([2], { deleteProfiles: true })
    const settings = await adapter.getSettings()
    expect(profileKeys(settings)).toEqual(['achievements:1', 'retirement_settings:1'])
  })
})

describe('a backup moved between cloud and local-first', () => {
  it("files a cloud backup's plans and badges under each profile", async () => {
    await adapter.importData(cloudFile())

    const id = await restoredIds()
    const settings = await adapter.getSettings()
    expect(settings[`retirement_settings:${id.Me}`]).toEqual(JSON.stringify(PLAN_1))
    expect(settings[`retirement_settings:${id.Partner}`]).toEqual(JSON.stringify(PLAN_2))
    expect(settings[`achievements:${id.Me}`]).toEqual(BADGES_1)
    expect(settings[`achievements:${id.Partner}`]).toEqual(BADGES_2)
    // Under the plain key, a badge record is one the first profile to open would take over.
    expect(profileKeys(settings)).toEqual(
      [
        `achievements:${id.Me}`,
        `achievements:${id.Partner}`,
        `retirement_settings:${id.Me}`,
        `retirement_settings:${id.Partner}`,
      ].sort()
    )
    expect(settings.currency).toBe('EUR')
  })

  it('carries the plan as it is now after a cloud backup was restored', async () => {
    await adapter.importData(cloudFile())
    const id = await restoredIds()
    const db = await getDB()
    const changed = { ...PLAN_2, retirementAge: 60 }
    await db.put('settings', { key: `retirement_settings:${id.Partner}`, value: changed })

    const file = await adapter.exportData()
    const partnerRows = (file.settingsRows ?? []).filter((row) => row.profile_id === id.Partner)
    const plans = partnerRows.filter((row) => String(row.key).startsWith('retirement_settings'))
    expect(plans).toEqual([
      {
        key: `retirement_settings:${id.Partner}`,
        value: JSON.stringify(changed),
        profile_id: id.Partner,
      },
    ])
    // A setting the Worker keeps per profile and local-first does not still rides along.
    expect(partnerRows).toContainEqual({
      key: 'week_start',
      value: 'monday',
      profile_id: id.Partner,
    })
  })
})

const profileKeys = (settings: Record<string, unknown>) =>
  Object.keys(settings)
    .filter((key) => belongsToOneProfile(key))
    .sort()

async function restoredIds(): Promise<Record<string, number>> {
  const profiles = (await (await getDB()).getAll('profiles')) as { id: number; name: string }[]
  return Object.fromEntries(profiles.map((p) => [p.name, p.id]))
}

/** The id the store gave its last profile, from a profile added and taken away again. */
async function lastProfileId(): Promise<number> {
  const db = await getDB()
  const probe = (await db.add('profiles', { name: 'Probe', created_at: '' })) as number
  await db.delete('profiles', probe)
  return probe
}

/** `file` with its profiles' ids changed, everywhere the file names them. */
function renumbered(file: ExportData, ids: Record<number, number>): ExportData {
  const id = (old: unknown) => ids[Number(old)] ?? Number(old)
  const key = (old: string) =>
    old.replace(/^(retirement_settings|achievements):(\d+)$/, (_, name, n) => `${name}:${id(n)}`)
  return {
    ...file,
    profiles: file.profiles.map((p) => ({ ...p, id: id(p.id) })),
    settings: Object.fromEntries(Object.entries(file.settings).map(([k, v]) => [key(k), v])),
    settingsRows: (file.settingsRows ?? []).map((row) => ({
      ...row,
      key: key(String(row.key)),
      profile_id: id(row.profile_id),
    })),
  } as unknown as ExportData
}

/** A whole backup as the Worker writes it: its settings are rows, each under its profile. */
function cloudFile(): ExportData {
  const row = (profile: number, key: string, value: string) => ({ key, value, profile_id: profile })
  return {
    version: '3.0.0',
    export_date: '2026-03-01T00:00:00.000Z',
    storage_mode: 'self-hosted',
    profiles: [
      { id: 41, name: 'Me', created_at: '2026-01-01T00:00:00.000Z' },
      { id: 42, name: 'Partner', created_at: '2026-01-01T00:00:00.000Z' },
    ],
    categories: [],
    transactions: [],
    accounts: [],
    budgets: [],
    goals: [],
    loans: [],
    settingsRows: [
      row(41, 'currency', 'EUR'),
      row(41, 'retirement_settings', JSON.stringify(PLAN_1)),
      row(41, 'achievements', BADGES_1),
      row(42, 'currency', 'EUR'),
      row(42, 'retirement_settings', JSON.stringify(PLAN_2)),
      row(42, 'achievements', BADGES_2),
      row(42, 'week_start', 'monday'),
    ],
    // The first profile's settings, as the Worker writes them for an older reader.
    settings: {
      currency: 'EUR',
      retirement_settings: JSON.stringify(PLAN_1),
      achievements: BADGES_1,
    },
  } as unknown as ExportData
}
