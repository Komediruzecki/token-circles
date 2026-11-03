/**
 * In local-first mode a profile starts with the default categories (DEFAULT_CATEGORIES in
 * idb.ts), as on the Worker: the twin of worker/test/new-profile-categories.test.ts. Before, a new
 * local space had none, so quick add "coffee 4.50" and the setup's first steps had nowhere to file.
 *
 * The paths: a new profile (the profile menu, setup's "Name your space", and "Run setup again" in
 * the demo, which all make one through POST /api/profiles), and the profile a workspace without
 * any is given (a browser that chose local-only). What stays as it was: the example profiles' own
 * set, a restore's categories, and an import that names a default in another case.
 *
 * Everything goes through the real `apiFetch`, local router and handlers.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { apiGet, apiPost } from '../../api'
import { DEFAULT_CATEGORIES, getDB } from '../idb'

const DEFAULT_NAMES = DEFAULT_CATEGORIES.map((c) => c.name).sort()

interface Row {
  name: string
  type: string
  kind: string | null
  icon: string
  profile_id: number
  created_at?: string
  parent_id?: number | null
}

async function categoriesOf(profileId: number): Promise<Row[]> {
  const db = await getDB()
  const rows = (await db.getAllFromIndex('categories', 'by_profile', profileId)) as Row[]
  return rows.sort((a, b) => a.name.localeCompare(b.name))
}

async function profiles(): Promise<Array<{ id: number; name: string }>> {
  return (await (await getDB()).getAll('profiles')) as Array<{ id: number; name: string }>
}

async function emptyStores(): Promise<void> {
  const db = await getDB()
  for (const name of Array.from(db.objectStoreNames)) await db.clear(name)
}

/** A browser that chose local-only: no example data, and no profile yet. */
async function localOnlyWorkspace(): Promise<void> {
  localStorage.clear()
  localStorage.setItem('finance_storage_mode', 'serverless')
  localStorage.setItem('finance_had_profiles', '1')
  await emptyStores()
}

beforeEach(localOnlyWorkspace)

describe('a new local profile starts with the default categories', () => {
  it('the one a workspace without any is given, once, however many requests ask', async () => {
    await Promise.all([
      apiGet('/api/profiles'),
      apiGet('/api/categories'),
      apiGet('/api/transactions'),
      apiGet('/api/profiles'),
    ])
    const [only, ...more] = await profiles()
    expect(more).toEqual([])
    const rows = await categoriesOf(only.id)
    expect(rows.map((r) => r.name)).toEqual(DEFAULT_NAMES)
    // Complete rows, as the category list reads them back.
    for (const row of rows) {
      expect(row).toMatchObject({ parent_id: null, profile_id: only.id })
      expect(typeof row.created_at).toBe('string')
    }
    const listed = await apiGet<Array<{ name: string }>>('/api/categories')
    expect(listed.map((c) => c.name).sort()).toEqual(DEFAULT_NAMES)
  })

  it('one made from the profile menu or setup, with its kinds, and the others keep theirs', async () => {
    const [first] = await (async () => {
      await apiGet('/api/profiles')
      return profiles()
    })()
    const db = await getDB()
    await db.add('categories', {
      name: 'Pets',
      type: 'expense',
      color: '#888888',
      icon: '',
      parent_id: null,
      created_at: '2026-11-01T09:00:00.000Z',
      profile_id: first.id,
    })

    const created = await apiPost<{ id: number }>('/api/profiles', { name: 'Household' })
    const rows = await categoriesOf(created.id)
    expect(rows.map((r) => r.name)).toEqual(DEFAULT_NAMES)
    expect(rows.find((r) => r.name === 'Eating out')).toMatchObject({
      type: 'expense',
      kind: 'eating_out',
      icon: 'utensils',
    })
    expect(rows.find((r) => r.name === 'Salary')).toMatchObject({ type: 'income', kind: null })
    expect((await categoriesOf(first.id)).map((r) => r.name)).toEqual(
      [...DEFAULT_NAMES, 'Pets'].sort()
    )
  })

  it('and an import that names a default in another case reuses it', async () => {
    const created = await apiPost<{ id: number }>('/api/profiles', { name: 'Household' })
    localStorage.setItem('currentProfileId', String(created.id))
    localStorage.setItem('selectedProfileIds', JSON.stringify([created.id]))
    const result = await apiPost<{ imported: number }>('/api/import/execute', {
      rows: [
        ['2026-07-01', 'Market', '-10', 'groceries'],
        ['2026-07-02', 'Noodle bar', '-15', 'EATING OUT'],
        ['2026-07-03', 'Vet', '-40', 'Pets'],
      ],
      mapping: { date: 0, description: 1, amount: 2, category: 3 },
      dry_run: false,
    })
    expect(result.imported).toBe(3)
    const names = (await categoriesOf(created.id)).map((r) => r.name.toLowerCase())
    expect(names.filter((n) => n === 'groceries')).toHaveLength(1)
    expect(names.filter((n) => n === 'eating out')).toHaveLength(1)
    expect(names).toHaveLength(DEFAULT_NAMES.length + 1)
  })
})

describe('what keeps its own categories', () => {
  it('a restore brings the backup categories and no defaults beside them', async () => {
    await apiGet('/api/profiles')
    await apiPost('/api/import', {
      version: '3.0.0',
      export_date: '2026-07-23T00:00:00.000Z',
      storage_mode: 'serverless',
      profiles: [{ id: 1, name: 'Browser', created_at: '2026-01-01T00:00:00.000Z' }],
      categories: [
        { id: 1, profile_id: 1, name: 'Food', type: 'expense', color: '#ff0000' },
        { id: 2, profile_id: 1, name: 'Groceries', type: 'expense', color: '#00ff00' },
      ],
      accounts: [],
      transactions: [],
      budgets: [],
      goals: [],
      loans: [],
      tags: [],
      settings: {},
    })
    const [restored, ...more] = await profiles()
    expect(more).toEqual([])
    expect(restored.name).toBe('Browser')
    expect((await categoriesOf(restored.id)).map((r) => r.name)).toEqual(['Food', 'Groceries'])
  })

  it('the example profiles keep their own set, with no name twice', async () => {
    localStorage.removeItem('finance_had_profiles')
    await apiGet('/api/profiles')
    const examples = await profiles()
    expect(examples.map((p) => p.name)).toEqual([
      'Example Low Income',
      'Example Mid Income',
      'Example High Income',
    ])
    for (const profile of examples) {
      const names = (await categoriesOf(profile.id)).map((r) => r.name.toLowerCase())
      expect(new Set(names).size).toBe(names.length)
      expect(names).toContain('eating out')
    }
  })
})
