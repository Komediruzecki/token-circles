/**
 * Profile names are unique without regard to case, and a backup can hold two that differ only in
 * case: the Worker took such names before the rule. A backup must restore, so the later one comes
 * back as "Name (2)", as it does on the Worker (shared/profileSchema.ts).
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { getDB, IndexedDBAdapter } from '../idb'
import type { ExportData } from '../../../types/storage'

const adapter = new IndexedDBAdapter()

beforeEach(async () => {
  localStorage.clear()
  const db = await getDB()
  for (const store of Array.from(db.objectStoreNames)) await db.clear(store)
})

function file(names: string[]): ExportData {
  return {
    version: '3.0.0',
    export_date: '2026-03-01T00:00:00.000Z',
    storage_mode: 'self-hosted',
    profiles: names.map((name, index) => ({
      id: index + 1,
      name,
      created_at: '2026-01-01T00:00:00.000Z',
    })),
    categories: [],
    transactions: [],
    accounts: [{ id: 5, profile_id: 2, name: 'Joint', type: 'checking', balance: 0 }],
    budgets: [],
    goals: [],
    loans: [],
    settings: {},
  } as unknown as ExportData
}

describe('restoring profiles whose names differ only in case', () => {
  it('restores the later one as "Name (2)", with its own data', async () => {
    await adapter.importData(file(['Household', 'HOUSEHOLD', 'Household (2)']))
    const db = await getDB()
    const profiles = (await db.getAll('profiles')) as { id: number; name: string }[]
    expect(profiles.map((p) => p.name)).toEqual(['Household', 'HOUSEHOLD (3)', 'Household (2)'])
    const accounts = (await db.getAll('accounts')) as { name: string; profile_id: number }[]
    expect(accounts).toEqual([
      expect.objectContaining({ name: 'Joint', profile_id: profiles[1]!.id }),
    ])
  })

  it('still refuses a profile with no name', async () => {
    await expect(adapter.importData(file(['Household', '  ']))).rejects.toThrow(
      'Backup profiles[1].name is required'
    )
  })
})
