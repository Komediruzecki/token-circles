import { beforeEach, describe, expect, it } from 'vitest'
import { getDB } from '../idb.js'
import { routeApiRequest } from '../localApiRouter.js'

// Danger Zone actions can target a NON-active profile via the X-Profile-Id header.
// These prove (1) each bulk destructive op deletes the TARGET profile's data and leaves
// the OTHER profile's data untouched, and (2) a concurrent request can no longer clobber
// the target — the re-entrancy bug that let a targeted delete hit the active profile.
//
// Setup: Alice (id 1) is the ACTIVE profile (localStorage currentProfileId=1); Bob (id 2)
// is a second, non-active profile. Danger Zone acts on Bob via the header.

const STORES = ['profiles', 'transactions', 'categories', 'accounts']

async function seed() {
  const db = await getDB()
  for (const s of STORES) if (db.objectStoreNames.contains(s)) await db.clear(s)
  await db.add('profiles', { id: 1, name: 'Alice', created_at: '2026-01-01' })
  await db.add('profiles', { id: 2, name: 'Bob', created_at: '2026-01-01' })
  // starting_balance 1000/500, balance moved by a transaction
  await db.add('accounts', {
    id: 1,
    profile_id: 1,
    name: 'A-Checking',
    balance: 900,
    starting_balance: 1000,
  })
  await db.add('accounts', {
    id: 2,
    profile_id: 2,
    name: 'B-Checking',
    balance: 400,
    starting_balance: 500,
  })
  await db.add('categories', {
    id: 1,
    profile_id: 1,
    name: 'A-Food',
    type: 'expense',
    color: '#f00',
  })
  await db.add('categories', {
    id: 2,
    profile_id: 2,
    name: 'B-Food',
    type: 'expense',
    color: '#0f0',
  })
  await db.add('transactions', {
    id: 1,
    profile_id: 1,
    type: 'expense',
    amount: 100,
    description: 'A-tx',
    date: '2026-05-01',
    category_id: 1,
    account_id: 1,
  })
  await db.add('transactions', {
    id: 2,
    profile_id: 2,
    type: 'expense',
    amount: 100,
    description: 'B-tx',
    date: '2026-05-01',
    category_id: 2,
    account_id: 2,
  })
}

const countFor = async (store: string, pid: number): Promise<number> =>
  (await (await getDB()).getAllFromIndex(store, 'by_profile', pid)).length

const balanceOf = async (id: number): Promise<number> =>
  ((await (await getDB()).get('accounts', id)) as { balance: number }).balance

const del = (path: string, pid: number): Promise<Response> =>
  routeApiRequest(`http://localhost/api${path}`, {
    method: 'DELETE',
    headers: { 'X-Profile-Id': String(pid) },
  })

beforeEach(async () => {
  localStorage.clear()
  localStorage.setItem('currentProfileId', '1') // Alice active
  localStorage.setItem('selectedProfileIds', '[1]')
  await seed()
})

describe('Danger Zone — targeted delete hits the right profile, spares the others', () => {
  it('delete all transactions: clears Bob, keeps Alice, resets only Bob’s balance', async () => {
    await del('/transactions', 2)
    expect(await countFor('transactions', 2)).toBe(0) // target cleared
    expect(await countFor('transactions', 1)).toBe(1) // Alice untouched
    expect(await balanceOf(2)).toBe(500) // Bob reset to starting_balance
    expect(await balanceOf(1)).toBe(900) // Alice's balance untouched
  })

  it('reset categories: reseeds Bob to defaults, keeps Alice’s category', async () => {
    await del('/categories', 2)
    const bobCats = await (await getDB()).getAllFromIndex('categories', 'by_profile', 2)
    const aliceCats = await (await getDB()).getAllFromIndex('categories', 'by_profile', 1)
    expect(bobCats.some((c) => c.name === 'B-Food')).toBe(false) // Bob's custom cat gone
    expect(bobCats.length).toBeGreaterThan(0) // defaults reseeded for Bob
    expect(aliceCats.map((c) => c.name)).toEqual(['A-Food']) // Alice untouched
  })

  it('clear profile data: wipes Bob’s tx/categories/accounts, keeps Alice’s', async () => {
    await del('/profile/data', 2)
    expect(await countFor('transactions', 2)).toBe(0)
    expect(await countFor('categories', 2)).toBe(0)
    expect(await countFor('accounts', 2)).toBe(0)
    expect(await countFor('transactions', 1)).toBe(1) // Alice fully intact
    expect(await countFor('categories', 1)).toBe(1)
    expect(await countFor('accounts', 1)).toBe(1)
  })
})

describe('Danger Zone — re-entrancy regression', () => {
  it('a concurrent request for the ACTIVE profile does not divert a targeted delete', async () => {
    // Fire the targeted delete (Bob) and a concurrent read for the active profile (Alice)
    // together. On the old shared-override code the concurrent request cleared the override
    // mid-flight, so the delete fell back to Alice and wiped HER transactions. It must not.
    await Promise.all([
      del('/transactions', 2),
      routeApiRequest('http://localhost/api/transactions', {
        method: 'GET',
        headers: { 'X-Profile-Id': '1' },
      }),
      routeApiRequest('http://localhost/api/transactions', {
        method: 'GET',
        headers: { 'X-Profile-Id': '1' },
      }),
    ])
    expect(await countFor('transactions', 2)).toBe(0) // Bob (the target) cleared
    expect(await countFor('transactions', 1)).toBe(1) // Alice SURVIVES (was wiped by the bug)
  })
})

describe('Household export — respects the requested profile(s)', () => {
  const descriptionsFrom = async (res: Response): Promise<string[]> => {
    const data = (await res.json()) as { transactions: Array<{ description: string }> }
    return data.transactions.map((t) => t.description).sort()
  }

  it('X-Profile-Ids (JSON array) exports every profile in the household', async () => {
    const res = await routeApiRequest('http://localhost/api/export', {
      method: 'GET',
      headers: { 'X-Profile-Ids': '[1,2]' },
    })
    expect(await descriptionsFrom(res)).toEqual(['A-tx', 'B-tx'])
  })

  it('a single X-Profile-Id exports only that profile', async () => {
    const res = await routeApiRequest('http://localhost/api/export', {
      method: 'GET',
      headers: { 'X-Profile-Id': '2' },
    })
    expect(await descriptionsFrom(res)).toEqual(['B-tx'])
  })
})
