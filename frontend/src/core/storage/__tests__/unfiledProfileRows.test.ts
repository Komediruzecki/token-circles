/**
 * Rows an older build filed on profile 0 are on a real profile once the app loads.
 *
 * WHY THIS TEST EXISTS. A local workspace with no profile used to write on profile 0, which no
 * read asks for (writesLandOnARealProfile.test.ts has the cause). People have been importing into
 * such workspaces since July, so their browsers hold rows on profile 0 that the fix alone would
 * never show. Opening the database files them (unfiledProfileRows.ts). These cases seed what such
 * a browser holds, load the app's database module afresh, and read back through the real
 * `apiFetch` and local router, the way a page does.
 */
import { openDB } from 'idb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IDBPDatabase } from 'idb'
import type * as UnfiledRows from '../unfiledProfileRows'

const CREATED_AT = '2026-07-30T00:00:00.000Z'

/** A raw connection, outside the app's module, so seeding runs no repair. */
async function raw(): Promise<IDBPDatabase> {
  // Opening at the current version: the app module created the schema in beforeEach.
  return openDB('finance-manager')
}

/** A page load: the app's database module, fresh, opening its connection. */
async function load() {
  vi.resetModules()
  const idb = await import('../idb')
  await idb.getDB()
  const api = await import('../../api')
  return { ...api, idb }
}

/** Every row of every store, keyed by store, for before/after comparisons. */
async function snapshot(): Promise<Record<string, unknown[]>> {
  const db = await raw()
  const out: Record<string, unknown[]> = {}
  for (const name of Array.from(db.objectStoreNames)) out[name] = await db.getAll(name)
  db.close()
  return out
}

/** What the old build left after "Skip" at the welcome step and one import. */
async function seedUnfiledImport(db: IDBPDatabase) {
  const account = await db.add('accounts', {
    profile_id: 0,
    name: 'Imported account',
    type: 'checking',
    currency: 'EUR',
    balance: 1800,
  })
  const groceries = await db.add('categories', {
    profile_id: 0,
    name: 'Groceries',
    type: 'expense',
  })
  for (const [description, amount, type] of [
    ['Salary', 3000, 'income'],
    ['Flat rent', 1000, 'expense'],
    ['Corner market', 200, 'expense'],
  ] as const) {
    await db.add('transactions', {
      profile_id: 0,
      description,
      amount,
      type,
      date: '2026-09-01',
      currency: 'EUR',
      account_id: account,
      category_id: type === 'expense' ? groceries : null,
    })
  }
  await db.add('import_logs', { profile_id: 0, filename: 'statement.csv', imported: 3 })
  await db.put('settings', { key: 'achievements:0', value: { first_import: '2026-09' } })
}

beforeEach(async () => {
  localStorage.clear()
  localStorage.setItem('finance_storage_mode', 'serverless')
  localStorage.setItem('finance_had_profiles', '1')
  const { idb } = await load()
  const db = await idb.getDB()
  for (const name of Array.from(db.objectStoreNames)) await db.clear(name)
  db.close()
})

afterEach(() => {
  vi.doUnmock('../unfiledProfileRows')
})

describe('a workspace with rows on profile 0 and no profile', () => {
  beforeEach(async () => {
    const db = await raw()
    await seedUnfiledImport(db)
    db.close()
  })

  it('shows them on a profile made for them, which is the one in use', async () => {
    const { api, apiGet } = await load()

    const profiles = await api.getProfiles()
    expect(profiles.map((p) => p.name)).toEqual(['Personal Profile'])
    const [profile] = profiles
    expect(localStorage.getItem('currentProfileId')).toBe(String(profile.id))

    const transactions = await api.getTransactions()
    expect(transactions.map((t) => t.description).sort()).toEqual([
      'Corner market',
      'Flat rent',
      'Salary',
    ])
    expect((await apiGet<Array<{ name: string }>>('/api/accounts')).map((a) => a.name)).toEqual([
      'Imported account',
    ])
    expect((await apiGet<Array<{ name: string }>>('/api/categories')).map((c) => c.name)).toContain(
      'Groceries'
    )
  })

  it('leaves nothing on profile 0, settings included', async () => {
    await load()

    const after = await snapshot()
    for (const [store, rows] of Object.entries(after)) {
      for (const row of rows as Array<{ profile_id?: unknown }>) {
        expect(row.profile_id, `${store} row`).not.toBe(0)
      }
    }
    const keys = (after.settings as Array<{ key: string }>).map((s) => s.key)
    expect(keys).not.toContain('achievements:0')
    const profileId = (after.profiles as Array<{ id: number }>)[0].id
    expect(keys).toContain(`achievements:${profileId}`)
  })

  it('keeps every row and every link between them', async () => {
    const before = await snapshot()
    await load()
    const after = await snapshot()

    const profileId = (after.profiles as Array<{ id: number }>)[0].id
    for (const store of ['accounts', 'categories', 'transactions', 'import_logs']) {
      const moved = (before[store] as Array<Record<string, unknown>>).map((row) => ({
        ...row,
        profile_id: profileId,
      }))
      expect(after[store], store).toEqual(moved)
    }
  })

  it('changes nothing the second time', async () => {
    await load()
    const once = await snapshot()
    const current = localStorage.getItem('currentProfileId')

    await load()

    expect(await snapshot()).toEqual(once)
    expect(localStorage.getItem('currentProfileId')).toBe(current)
  })
})

describe('a workspace with rows on profile 0 beside a profile in use', () => {
  beforeEach(async () => {
    const db = await raw()
    await db.put('profiles', { id: 1, name: 'Home', created_at: CREATED_AT })
    const own = await db.add('categories', { profile_id: 1, name: 'Groceries', type: 'expense' })
    await db.add('transactions', {
      profile_id: 1,
      description: 'Corner market',
      amount: 200,
      type: 'expense',
      date: '2026-09-01',
      currency: 'EUR',
      account_id: null,
      category_id: own,
    })
    await db.put('settings', { key: 'achievements:1', value: { first_entry: '2026-08' } })
    await seedUnfiledImport(db)
    db.close()
    localStorage.setItem('currentProfileId', '1')
    localStorage.setItem('selectedProfileIds', JSON.stringify([1]))
  })

  it('files them on a profile of their own, and leaves the one in use alone', async () => {
    const before = await snapshot()
    const { api } = await load()

    const profiles = await api.getProfiles()
    expect(profiles.map((p) => p.name)).toEqual(['Home', 'Recovered entries'])
    const recovered = profiles[1]

    const after = await snapshot()
    const ownRows = (rows: unknown[]) =>
      (rows as Array<{ profile_id?: number }>).filter((row) => row.profile_id === 1)
    for (const store of Object.keys(before)) {
      expect(ownRows(after[store]), store).toEqual(ownRows(before[store]))
    }
    const settings = after.settings as Array<{ key: string; value: unknown }>
    expect(settings.find((s) => s.key === 'achievements:1')?.value).toEqual({
      first_entry: '2026-08',
    })
    expect(settings.find((s) => s.key === `achievements:${recovered.id}`)?.value).toEqual({
      first_import: '2026-09',
    })

    // The profile in use stays the one in use; the old rows are there to pick.
    expect(localStorage.getItem('currentProfileId')).toBe('1')
    expect((await api.getTransactions()).map((t) => t.description)).toEqual(['Corner market'])
    localStorage.setItem('currentProfileId', String(recovered.id))
    localStorage.setItem('selectedProfileIds', JSON.stringify([recovered.id]))
    expect((await api.getTransactions()).map((t) => t.description).sort()).toEqual([
      'Corner market',
      'Flat rent',
      'Salary',
    ])
  })

  it('loses no row', async () => {
    const before = await snapshot()
    await load()
    const after = await snapshot()

    for (const store of Object.keys(before)) {
      if (store === 'profiles') continue
      expect(after[store].length, store).toBe(before[store].length)
    }
    expect(after.profiles.length).toBe(before.profiles.length + 1)
  })

  it('picks a name no profile has', async () => {
    const db = await raw()
    await db.put('profiles', { id: 2, name: 'Recovered entries', created_at: CREATED_AT })
    db.close()

    const { api } = await load()

    expect((await api.getProfiles()).map((p) => p.name)).toEqual([
      'Home',
      'Recovered entries',
      'Recovered entries 2',
    ])
  })

  it('changes nothing the second time', async () => {
    await load()
    const once = await snapshot()

    await load()

    expect(await snapshot()).toEqual(once)
  })
})

describe('a workspace with rows on profile 0 beside an empty profile', () => {
  it('files them on that profile and makes none', async () => {
    const db = await raw()
    await db.put('profiles', { id: 1, name: 'Home', created_at: CREATED_AT })
    await seedUnfiledImport(db)
    db.close()
    localStorage.setItem('currentProfileId', '1')

    const { api } = await load()

    expect((await api.getProfiles()).map((p) => p.name)).toEqual(['Home'])
    expect((await api.getTransactions()).map((t) => t.description).sort()).toEqual([
      'Corner market',
      'Flat rent',
      'Salary',
    ])
  })
})

describe('a profile setting on profile 0', () => {
  it('never replaces the one the receiving profile already has', async () => {
    const db = await raw()
    await db.put('profiles', { id: 1, name: 'Home', created_at: CREATED_AT })
    await db.put('settings', { key: 'achievements:1', value: { first_entry: '2026-08' } })
    await seedUnfiledImport(db)
    db.close()

    await load()

    const settings = (await snapshot()).settings as Array<{ key: string; value: unknown }>
    expect(settings.find((s) => s.key === 'achievements:1')?.value).toEqual({
      first_entry: '2026-08',
    })
    // Not lost either: it stays under its old key.
    expect(settings.find((s) => s.key === 'achievements:0')?.value).toEqual({
      first_import: '2026-09',
    })
  })
})

describe('when filing them fails', () => {
  it('the database still opens, and the rows stay where they were', async () => {
    const db = await raw()
    await seedUnfiledImport(db)
    db.close()
    const before = await snapshot()
    vi.doMock('../unfiledProfileRows', async (original) => ({
      ...(await original<typeof UnfiledRows>()),
      fileUnfiledRows: async () => {
        throw new Error('disk full')
      },
    }))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const { idb } = await load()

    expect(await (await idb.getDB()).count('transactions')).toBe(3)
    expect(warn).toHaveBeenCalled()
    expect((await snapshot()).transactions).toEqual(before.transactions)
    warn.mockRestore()
  })
})
