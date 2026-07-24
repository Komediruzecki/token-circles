import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_CATEGORIES, getDB } from '../idb.js'
import { routeApiRequest } from '../localApiRouter.js'

const PROFILE_STORES = [
  'transactions',
  'categories',
  'accounts',
  'budgets',
  'goals',
  'loans',
  'receipts',
  'portfolioHoldings',
  'bills',
  'housings',
  'recurring',
  'tags',
  'categoryMappings',
  'import_logs',
] as const

const ALL_STORES = ['profiles', ...PROFILE_STORES, 'balanceHistory', 'settings', 'logs'] as const

async function clearStores() {
  const db = await getDB()
  for (const store of ALL_STORES) {
    if (db.objectStoreNames.contains(store)) await db.clear(store)
  }
}

async function seedProfile(profileId: number) {
  const db = await getDB()
  const base = profileId * 100
  await db.add('profiles', {
    id: profileId,
    name: `Profile ${profileId}`,
    created_at: '2026-01-01',
  })
  await db.add('categories', {
    id: base + 1,
    profile_id: profileId,
    name: `Category ${profileId}`,
    type: 'expense',
    color: '#123456',
  })
  await db.add('accounts', {
    id: base + 2,
    profile_id: profileId,
    name: `Account ${profileId}`,
    balance: 100,
    starting_balance: 100,
  })
  await db.add('transactions', {
    id: base + 3,
    profile_id: profileId,
    description: `Transaction ${profileId}`,
    type: 'expense',
    amount: 10,
    date: '2026-07-01',
    account_id: base + 2,
    category_id: base + 1,
  })
  await db.add('balanceHistory', {
    id: base + 4,
    account_id: base + 2,
    balance: 100,
    date: '2026-07-01',
  })
  for (const [offset, store] of PROFILE_STORES.entries()) {
    if (['categories', 'accounts', 'transactions'].includes(store)) continue
    await db.add(store, {
      id: base + 10 + offset,
      profile_id: profileId,
      category_id: base + 1,
      account_id: base + 2,
      name: `${store} ${profileId}`,
      created_at: '2026-07-01',
    })
  }
}

async function countProfileRows(store: string, profileId: number): Promise<number> {
  const db = await getDB()
  const rows = (await db.getAll(store)) as Array<Record<string, unknown>>
  return rows.filter((row) => row.profile_id === profileId).length
}

async function request(path: string, method: 'DELETE' | 'POST', profileId?: number) {
  return routeApiRequest(`http://localhost/api${path}`, {
    method,
    headers: profileId === undefined ? undefined : { 'X-Profile-Id': String(profileId) },
  })
}

beforeEach(async () => {
  localStorage.clear()
  localStorage.setItem('currentProfileId', '1')
  localStorage.setItem('selectedProfileIds', '[1,2]')
  await clearStores()
})

describe('Danger Zone profile-data completeness', () => {
  it('clears every target-profile store and account history while preserving another profile', async () => {
    await seedProfile(1)
    await seedProfile(2)
    await (await getDB()).put('settings', { key: 'currency', value: 'EUR' })

    const response = await request('/profile/data', 'DELETE', 2)
    expect(response.status).toBe(200)

    for (const store of PROFILE_STORES) {
      expect(await countProfileRows(store, 2), `${store} target rows`).toBe(0)
      expect(await countProfileRows(store, 1), `${store} other-profile rows`).toBeGreaterThan(0)
    }
    expect(await (await getDB()).getAllFromIndex('balanceHistory', 'by_account', 202)).toHaveLength(
      0
    )
    expect(await (await getDB()).getAllFromIndex('balanceHistory', 'by_account', 102)).toHaveLength(
      1
    )
    expect(await (await getDB()).get('profiles', 2)).toBeDefined()
    expect(await (await getDB()).get('settings', 'currency')).toBeDefined()
  })

  it('deleting a profile removes the profile and every dependent row', async () => {
    await seedProfile(1)
    await seedProfile(2)

    const response = await request('/profiles/2', 'DELETE')
    expect(response.status).toBe(200)
    expect(await (await getDB()).get('profiles', 2)).toBeUndefined()
    for (const store of PROFILE_STORES) expect(await countProfileRows(store, 2)).toBe(0)
    expect(await (await getDB()).getAllFromIndex('balanceHistory', 'by_account', 202)).toHaveLength(
      0
    )
    expect(await (await getDB()).get('profiles', 1)).toBeDefined()
  })

  it('Reset All clears all profile-owned data and settings but preserves profiles', async () => {
    await seedProfile(1)
    await seedProfile(2)
    await (await getDB()).put('settings', { key: 'currency', value: 'EUR' })

    const response = await request('/clear-all', 'DELETE')
    expect(response.status).toBe(200)

    expect(await (await getDB()).getAll('profiles')).toHaveLength(2)
    for (const store of PROFILE_STORES) expect(await (await getDB()).getAll(store)).toHaveLength(0)
    expect(await (await getDB()).getAll('balanceHistory')).toHaveLength(0)
    expect(await (await getDB()).getAll('settings')).toHaveLength(0)
  })

  it('client-only demo reseed replaces existing profiles and data', async () => {
    await seedProfile(1)
    await seedProfile(2)

    const response = await request('/profiles/reseed-demo', 'POST', 1)
    expect(response.status).toBe(200)

    const profiles = await (await getDB()).getAll('profiles')
    expect(profiles.map((profile) => profile.name).sort()).toEqual([
      'Example High Income',
      'Example Low Income',
      'Example Mid Income',
    ])
    expect(profiles.some((profile) => profile.name === 'Profile 1')).toBe(false)
  })
})

describe('Danger Zone category reset referential integrity', () => {
  it('keeps canonical defaults, detaches custom references, and preserves another profile', async () => {
    const db = await getDB()
    await db.add('profiles', { id: 1, name: 'One', created_at: '2026-01-01' })
    await db.add('profiles', { id: 2, name: 'Two', created_at: '2026-01-01' })
    await db.add('categories', {
      id: 10,
      profile_id: 1,
      name: 'Salary',
      type: 'expense',
      color: '#000000',
    })
    await db.add('categories', {
      id: 11,
      profile_id: 1,
      name: 'Custom',
      type: 'expense',
      color: '#111111',
    })
    await db.add('categories', {
      id: 20,
      profile_id: 2,
      name: 'Other profile',
      type: 'expense',
      color: '#222222',
    })
    await db.add('transactions', { id: 1, profile_id: 1, category_id: 11 })
    await db.add('transactions', { id: 2, profile_id: 1, category_id: 10 })
    await db.add('budgets', { id: 1, profile_id: 1, category_id: 11 })
    await db.add('budgets', { id: 2, profile_id: 1, category_id: 10 })
    await db.add('goals', { id: 1, profile_id: 1, category_id: 11 })
    await db.add('bills', { id: 1, profile_id: 1, category_id: 11 })
    await db.add('recurring', { id: 1, profile_id: 1, category_id: 11 })
    await db.add('categoryMappings', { id: 1, profile_id: 1, category_id: 11 })
    await db.add('categoryMappings', { id: 2, profile_id: 1, category_id: 10 })

    const response = await request('/categories', 'DELETE', 1)
    expect(response.status).toBe(200)

    const categories = await db.getAllFromIndex('categories', 'by_profile', 1)
    expect(categories).toHaveLength(DEFAULT_CATEGORIES.length)
    expect(categories.find((category) => category.name === 'Salary')).toMatchObject({
      id: 10,
      type: 'income',
      color: '#22C55E',
    })
    expect(await db.get('categories', 11)).toBeUndefined()
    expect(await db.get('categories', 20)).toBeDefined()
    expect(await db.get('transactions', 1)).toMatchObject({ category_id: null })
    expect(await db.get('transactions', 2)).toMatchObject({ category_id: 10 })
    expect(await db.get('budgets', 1)).toBeUndefined()
    expect(await db.get('budgets', 2)).toMatchObject({ category_id: 10 })
    expect(await db.get('goals', 1)).toMatchObject({ category_id: null })
    expect(await db.get('bills', 1)).toMatchObject({ category_id: null })
    expect(await db.get('recurring', 1)).toMatchObject({ category_id: null })
    expect(await db.get('categoryMappings', 1)).toBeUndefined()
    expect(await db.get('categoryMappings', 2)).toMatchObject({ category_id: 10 })
  })
})
