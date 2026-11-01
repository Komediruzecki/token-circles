/**
 * Removing the example profiles leaves nothing of them behind.
 *
 * Local setup over the demo offers to remove the three example profiles (OnboardingWizard.tsx).
 * It removes each one through `DELETE /api/profiles/:id`, the path Settings' Danger Zone uses, so
 * that path has to take every row the example seed wrote: the profile, every row filed on it,
 * its accounts' balance history, and its settings, including the emergency fund plan the seed
 * keeps under a key of its own (`emergency_fund_config_<id>`). That key used to stay behind,
 * in every settings read and every backup, naming a profile that no longer existed.
 *
 * Run against the real seed and the real local router on fake-indexeddb.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { EXAMPLE_PROFILE_NAMES, isExampleProfileName } from '../../demoMode'
import { getDB, seedDemoProfiles } from '../idb'
import { routeApiRequest } from '../localApiRouter'
import { fileUnfiledRows } from '../unfiledProfileRows'
import type { IDBPDatabase } from 'idb'

beforeEach(async () => {
  localStorage.clear()
  localStorage.setItem('finance_storage_mode', 'serverless')
  const db = await getDB()
  for (const store of Array.from(db.objectStoreNames)) await db.clear(store)
})

/** Every row in the database that still names one of `ids`, as `store: what`. */
async function rowsNaming(ids: Set<number>): Promise<string[]> {
  const db = await getDB()
  const found: string[] = []
  const accountIds = new Set<number>()
  for (const account of (await db.getAll('accounts')) as Array<Record<string, unknown>>) {
    if (typeof account.id === 'number') accountIds.add(account.id)
  }
  for (const store of Array.from(db.objectStoreNames)) {
    for (const row of (await db.getAll(store)) as Array<Record<string, unknown>>) {
      if (ids.has(row.profile_id as number))
        found.push(`${store}: profile_id ${String(row.profile_id)}`)
      if (store === 'profiles' && ids.has(row.id as number))
        found.push(`profiles: ${String(row.name)}`)
      if (store === 'balanceHistory' && !accountIds.has(row.account_id as number)) {
        found.push(`balanceHistory: account ${String(row.account_id)}`)
      }
      if (store === 'settings') {
        const key = String(row.key)
        const keyed = /[_:](\d+)$/.exec(key)
        if (keyed && ids.has(Number(keyed[1]))) found.push(`settings: ${key}`)
        const value = typeof row.value === 'string' ? row.value : JSON.stringify(row.value ?? null)
        for (const id of ids) {
          if (value.includes(`"profile_id":${String(id)}`)) found.push(`settings value: ${key}`)
        }
      }
    }
  }
  return found
}

describe('removing the example profiles', () => {
  it('the seed makes the three profiles the examples are known by', async () => {
    await seedDemoProfiles()
    const names = ((await (await getDB()).getAll('profiles')) as Array<{ name: string }>).map(
      (p) => p.name
    )
    expect(names).toEqual([...EXAMPLE_PROFILE_NAMES])
    expect(names.every(isExampleProfileName)).toBe(true)
    expect(isExampleProfileName('Our flat')).toBe(false)
    expect(isExampleProfileName('Personal Profile')).toBe(false)
  }, 60_000)

  it('deletes each one and every row and setting it held, and keeps the space beside them', async () => {
    await seedDemoProfiles()
    const db = await getDB()
    // The seed writes about 8,700 transactions, and fake-indexeddb deletes them one at a time for
    // close to a minute. A dozen per profile, as the seed wrote them, prove the same thing.
    const transactions = (await db.getAll('transactions')) as Array<{ profile_id: number }>
    await db.clear('transactions')
    const kept = new Map<number, number>()
    for (const row of transactions) {
      const n = kept.get(row.profile_id) ?? 0
      if (n >= 12) continue
      kept.set(row.profile_id, n + 1)
      await db.put('transactions', row)
    }
    const examples = (await db.getAll('profiles')) as Array<{ id: number; name: string }>
    const exampleIds = new Set(examples.map((p) => p.id))
    // Something real of each kind, so the check below is not passing over empty stores.
    const held = await rowsNaming(exampleIds)
    for (const store of ['accounts', 'transactions', 'categories', 'bills', 'budgets']) {
      expect(
        held.some((line) => line.startsWith(`${store}:`)),
        store
      ).toBe(true)
    }
    expect(held.some((line) => line.startsWith('settings: emergency_fund_config_'))).toBe(true)

    const own = await routeApiRequest('http://localhost/api/profiles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Our flat' }),
    })
    expect(own.status).toBe(201)
    const ownId = ((await own.json()) as { id: number }).id
    await db.add('accounts', { profile_id: ownId, name: 'Main', balance: 10 })

    for (const example of examples) {
      const res = await routeApiRequest(`http://localhost/api/profiles/${String(example.id)}`, {
        method: 'DELETE',
      })
      expect(res.status, example.name).toBe(200)
    }

    expect(await rowsNaming(exampleIds)).toEqual([])
    expect(((await db.getAll('profiles')) as Array<{ name: string }>).map((p) => p.name)).toEqual([
      'Our flat',
    ])
    expect(await db.getAllFromIndex('accounts', 'by_profile', ownId)).toHaveLength(1)
    // Nothing is left for the load-time repair to file under "Recovered entries".
    expect(await fileUnfiledRows(db as unknown as IDBPDatabase)).toMatchObject({ moved: 0 })
  }, 60_000)
})
