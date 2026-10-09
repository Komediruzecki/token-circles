/**
 * Local-first's backup carries the profiles' saved import sources, and a restore puts them back:
 * the twin of worker/test/backup-import-sources.test.ts. Before, the file had none, and a restore
 * emptied the store, so every connected sheet was lost.
 *
 * A file from the Worker holds the same rows, its JSON columns as objects; one written by hand or
 * by an older Worker may hold them as text, which the restore reads too. Local-first runs every
 * schedule itself, so a daily source stays daily here.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { getDB, IndexedDBAdapter } from '../idb'
import type { ExportData } from '../../../types/storage'

const SHEET = 'https://docs.google.com/spreadsheets/d/e/2PACX-local-backup/pub?output=csv'
const adapter = new IndexedDBAdapter()

beforeEach(async () => {
  localStorage.clear()
  localStorage.setItem('currentProfileId', '1')
  const db = await getDB()
  for (const store of Array.from(db.objectStoreNames)) await db.clear(store)
  await db.add('profiles', { id: 1, name: 'Me', created_at: '2026-01-01T00:00:00.000Z' })
  await db.add('profiles', { id: 2, name: 'Partner', created_at: '2026-01-01T00:00:00.000Z' })
  const source = (id: number, profile: number, label: string) =>
    db.add('import_sources', {
      id,
      profile_id: profile,
      kind: 'google_sheet',
      label,
      config: { url: SHEET },
      mapping: { date: 'Date', amount: 'Amount' },
      category_types: null,
      default_account_id: null,
      schedule: 'daily',
      last_synced_at: null,
      last_cursor: null,
      created_at: '2026-01-02T00:00:00.000Z',
      updated_at: '2026-01-02T00:00:00.000Z',
    } as never)
  await source(5, 1, 'Mine')
  await source(6, 2, 'Theirs')
})

async function sources(): Promise<Record<string, unknown>[]> {
  return (await (await getDB()).getAll('import_sources')) as Record<string, unknown>[]
}

describe('a local-first backup and its import sources', () => {
  it("carries every profile's sources, or only the exported profiles'", async () => {
    expect((await adapter.exportData()).importSources?.map((s) => s.label)).toEqual([
      'Mine',
      'Theirs',
    ])
    expect((await adapter.exportData([2])).importSources?.map((s) => s.label)).toEqual(['Theirs'])
  })

  it('puts them back under the restored profiles, schedule and mapping kept', async () => {
    const file = await adapter.exportData()
    await adapter.importData(file)

    const profiles = (await (await getDB()).getAll('profiles')) as { id: number; name: string }[]
    const idOf = (name: string) => profiles.find((p) => p.name === name)!.id
    expect((await sources()).map((s) => [s.label, s.profile_id, s.schedule, s.mapping])).toEqual([
      ['Mine', idOf('Me'), 'daily', { date: 'Date', amount: 'Amount' }],
      ['Theirs', idOf('Partner'), 'daily', { date: 'Date', amount: 'Amount' }],
    ])
  })

  it('reads JSON columns kept as text, as objects', async () => {
    const file: ExportData = {
      ...(await adapter.exportData()),
      importSources: [
        {
          id: 9,
          profile_id: 1,
          kind: 'google_sheet',
          label: 'From the cloud',
          config: JSON.stringify({ url: SHEET, sheetName: 'Sheet1' }),
          mapping: JSON.stringify({ date: 'Date' }),
          category_types: null,
          schedule: 'manual',
        },
      ],
    }
    await adapter.importData(file)
    expect(await sources()).toEqual([
      expect.objectContaining({
        label: 'From the cloud',
        config: { url: SHEET, sheetName: 'Sheet1' },
        mapping: { date: 'Date' },
        category_types: null,
      }),
    ])
  })

  it('refuses a source of a profile the file does not carry, and keeps what was there', async () => {
    const file: ExportData = {
      ...(await adapter.exportData()),
      importSources: [{ id: 9, profile_id: 7, kind: 'google_sheet', label: 'Stray' }],
    }
    await expect(adapter.importData(file)).rejects.toThrow(
      'importSources[0].profile_id references missing profile 7'
    )
    expect((await sources()).map((s) => s.label)).toEqual(['Mine', 'Theirs'])
  })
})
