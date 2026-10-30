/**
 * In local-first mode a write lands on a profile that exists, and the reads find it.
 *
 * WHY THIS TEST EXISTS. A browser that switched to local-only from the setup wizard has no profile
 * until the wizard's "Name your space" step makes one. Leave the wizard at its first step and
 * there never was one. The adapter's write profile was then 0 (`getCurrentProfileId`), so an import
 * said "Imported 48 transactions" and filed all 48 under profile 0, while every read asked for
 * profile 1 (`activeProfileId`'s default). Transactions listed nothing, Progress counted no month,
 * and a reload could not help: both answers were persisted.
 *
 * The rule now matches the Worker's `ensureProfile`: a workspace with no profile gets one, the
 * first time anything asks which profile is active. These cases write first, with each kind of
 * write the app makes from an empty workspace, and check two things: the row is found by the read
 * the page makes, and no row in any store points at a profile that does not exist.
 *
 * Everything goes through the real `apiFetch`, local router and handlers.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { api, apiPost } from '../../api'
import { getDB } from '../idb'

/** Every store that files its rows by profile: the ones whose rows a read can lose. */
async function rowsOnMissingProfiles(): Promise<string[]> {
  const db = await getDB()
  const profiles = new Set(
    ((await db.getAll('profiles')) as Array<{ id: number }>).map((p) => p.id)
  )
  const found: string[] = []
  for (const name of Array.from(db.objectStoreNames)) {
    const tx = db.transaction(name)
    if (!tx.store.indexNames.contains('by_profile')) continue
    for (const row of (await tx.store.getAll()) as Array<{ id: number; profile_id: unknown }>) {
      if (!profiles.has(row.profile_id as number)) {
        found.push(`${name}#${row.id} on profile ${String(row.profile_id)}`)
      }
    }
  }
  return found
}

/** A browser that chose local-only and left the setup wizard at its first step. */
async function emptyWorkspace() {
  localStorage.clear()
  localStorage.setItem('finance_storage_mode', 'serverless')
  // What "Use local-only" sets: no example data for this browser.
  localStorage.setItem('finance_had_profiles', '1')
  const db = await getDB()
  for (const name of Array.from(db.objectStoreNames)) await db.clear(name)
}

beforeEach(emptyWorkspace)

const STATEMENT = {
  rows: [
    ['2026-09-01', 'Salary', '3000.00', 'Salary'],
    ['2026-09-02', 'Flat rent', '-1000.00', 'Rent'],
    ['2026-09-10', 'Corner market', '-200.00', 'Groceries'],
  ],
  mapping: { date: 0, description: 1, amount: 2, category: 3 },
  dry_run: false,
}

describe('an import into a local workspace that has no profile yet', () => {
  it('shows every imported row in the transaction list', async () => {
    const result = await apiPost<{ imported: number }>('/api/import/execute', STATEMENT)
    expect(result.imported).toBe(3)

    const listed = await api.getTransactions()
    expect(listed.map((t) => t.description).sort()).toEqual([
      'Corner market',
      'Flat rent',
      'Salary',
    ])
  })

  it('files nothing on a profile that does not exist', async () => {
    await apiPost('/api/import/execute', STATEMENT)

    expect(await rowsOnMissingProfiles()).toEqual([])
  })
})

/** The first write each surface can make from an empty workspace, and the read that shows it. */
const FIRST_WRITES: Array<{ what: string; write: () => Promise<unknown>; read: string }> = [
  {
    what: 'a transaction added by hand, or with quick add',
    write: () =>
      api.createTransaction({
        type: 'expense',
        amount: 4.5,
        description: 'Coffee',
        date: '2026-09-03',
        currency: 'EUR',
      } as never),
    read: '/api/transactions',
  },
  {
    what: 'an account',
    write: () => apiPost('/api/accounts', { name: 'Cash', type: 'cash', currency: 'EUR' }),
    read: '/api/accounts',
  },
  {
    what: 'a category',
    write: () => apiPost('/api/categories', { name: 'Hobbies', type: 'expense' }),
    read: '/api/categories',
  },
  {
    what: 'the default categories',
    write: () => apiPost('/api/categories/seed', {}),
    read: '/api/categories',
  },
  {
    what: 'a goal',
    write: () => apiPost('/api/savings-goals', { name: 'Bike', target_amount: 500 }),
    read: '/api/savings-goals',
  },
  {
    what: 'a tag',
    write: () => apiPost('/api/tags', { name: 'trip' }),
    read: '/api/tags',
  },
]

describe('a local workspace with no profile', () => {
  it('gets one profile, however many requests ask for it at once', async () => {
    // The boot sends its reads together; each used to find no profile and would add its own.
    const { apiGet } = await import('../../api')
    await Promise.all(Array.from({ length: 8 }, () => apiGet('/api/profiles')))

    const profiles = await api.getProfiles()
    expect(profiles.map((p) => p.name)).toEqual(['Personal Profile'])
    expect(localStorage.getItem('currentProfileId')).toBe(String(profiles[0].id))
  })
})

describe('the first write into a local workspace that has no profile yet', () => {
  for (const { what, write, read } of FIRST_WRITES) {
    it(`${what}: is read back and filed on a real profile`, async () => {
      await write()

      const listed = await apiGetList(read)
      expect(listed.length).toBeGreaterThan(0)
      expect(await rowsOnMissingProfiles()).toEqual([])
    })
  }
})

async function apiGetList(path: string): Promise<unknown[]> {
  const { apiGet } = await import('../../api')
  const body = await apiGet(path)
  if (Array.isArray(body)) return body
  const rows = (body as { rows?: unknown[] }).rows
  return Array.isArray(rows) ? rows : []
}
