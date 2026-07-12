import { beforeEach, describe, expect, it } from 'vitest'
import { getDB, IndexedDBAdapter } from '../idb.js'
import { routeApiRequest } from '../localApiRouter.js'
import { importExecute } from '../localHandlers.js'

// Client-side coverage for the account audit fixes:
//   A6 — account deletion blocked while referenced by transactions (own history cascades)
//   A1/D3 — recomputeBalances repair routine
//   A5/D7 — account starting-date field unified to `starting_date`
// Runs against the real `idb` on fake-indexeddb (see src/test-setup.ts).

const STORES = ['profiles', 'transactions', 'categories', 'accounts', 'balanceHistory']

async function seed() {
  const db = await getDB()
  for (const s of STORES) if (db.objectStoreNames.contains(s)) await db.clear(s)
  await db.add('profiles', { id: 1, name: 'Test', created_at: '2026-01-01' })
  await db.add('accounts', {
    id: 1,
    profile_id: 1,
    name: 'Checking',
    balance: 1000,
    starting_balance: 1000,
  })
  await db.add('accounts', {
    id: 2,
    profile_id: 1,
    name: 'Savings',
    balance: 500,
    starting_balance: 500,
  })
  await db.add('categories', { id: 1, profile_id: 1, name: 'Food', type: 'expense', color: '#f00' })
}

const acct = async (id: number): Promise<Record<string, unknown> | undefined> =>
  (await getDB()).get('accounts', id) as Promise<Record<string, unknown> | undefined>
const balanceOf = async (id: number): Promise<number> =>
  ((await acct(id)) as { balance: number }).balance

beforeEach(async () => {
  localStorage.clear()
  localStorage.setItem('currentProfileId', '1')
  await seed()
})

describe('accounts — deletion blocked while referenced (audit A6)', () => {
  it('rejects deleting an account referenced by a transaction and keeps it', async () => {
    const adapter = new IndexedDBAdapter()
    await adapter.createTransaction({
      type: 'expense',
      amount: 100,
      account_id: 1,
      description: 'lunch',
      date: '2026-05-01',
      category_id: 1,
      profile_id: 1,
    } as never)

    const res = await routeApiRequest('http://localhost/api/accounts/1', { method: 'DELETE' })
    expect(res.status).toBe(409)
    const body = (await res.json()) as { error: string }
    expect(body.error).toMatch(/reassign or delete/i)
    expect(await acct(1)).toBeTruthy() // still exists
  })

  it('rejects deleting an account referenced as a transfer destination', async () => {
    const adapter = new IndexedDBAdapter()
    await adapter.createTransaction({
      type: 'transfer',
      amount: 50,
      account_id: 1,
      transfer_account_id: 2,
      description: 'move',
      date: '2026-05-01',
      category_id: null,
      profile_id: 1,
    } as never)

    const res = await routeApiRequest('http://localhost/api/accounts/2', { method: 'DELETE' })
    expect(res.status).toBe(409)
    expect(await acct(2)).toBeTruthy()
  })

  it('deletes an account with only balance-history rows, cascading the snapshots', async () => {
    const adapter = new IndexedDBAdapter()
    await adapter.recordBalance(2, 600)

    const res = await routeApiRequest('http://localhost/api/accounts/2', { method: 'DELETE' })
    expect(res.status).toBe(200)
    expect(await acct(2)).toBeUndefined()
    const db = await getDB()
    const history = await db.getAllFromIndex('balanceHistory', 'by_account', 2)
    expect(history).toHaveLength(0)
  })

  it('deletes an unreferenced account', async () => {
    const res = await routeApiRequest('http://localhost/api/accounts/2', { method: 'DELETE' })
    expect(res.status).toBe(200)
    expect(await acct(2)).toBeUndefined()
  })
})

describe('accounts — recompute balances repair routine (audit A1/D3)', () => {
  it('repairs corrupted balances to starting_balance + ledger', async () => {
    const adapter = new IndexedDBAdapter()
    await adapter.createTransaction({
      type: 'expense',
      amount: 100,
      account_id: 1,
      description: 'e',
      date: '2026-05-01',
      category_id: 1,
      profile_id: 1,
    } as never)
    await adapter.createTransaction({
      type: 'income',
      amount: 200,
      account_id: 2,
      description: 'i',
      date: '2026-05-02',
      category_id: null,
      profile_id: 1,
    } as never)
    await adapter.createTransaction({
      type: 'transfer',
      amount: 75,
      account_id: 1,
      transfer_account_id: 2,
      description: 't',
      date: '2026-05-03',
      category_id: null,
      profile_id: 1,
    } as never)
    // acc1 = 1000 - 100 - 75 = 825 ; acc2 = 500 + 200 + 75 = 775
    expect(await balanceOf(1)).toBe(825)
    expect(await balanceOf(2)).toBe(775)

    // Corrupt both stored balances.
    const db = await getDB()
    const a1 = (await db.get('accounts', 1)) as Record<string, unknown>
    a1.balance = 999999
    await db.put('accounts', a1)
    const a2 = (await db.get('accounts', 2)) as Record<string, unknown>
    a2.balance = -42
    await db.put('accounts', a2)

    const res = await routeApiRequest('http://localhost/api/accounts/recompute-balances', {
      method: 'POST',
    })
    expect(res.status).toBe(200)
    expect(await balanceOf(1)).toBe(825)
    expect(await balanceOf(2)).toBe(775)
  })
})

describe('accounts — starting-date field unified (audit A5/D7)', () => {
  it('an imported account exposes starting_date (not balance_date)', async () => {
    const res = await importExecute({
      rows: [],
      mapping: { category: 0 },
      categoryTypes: { MyBank: 'account' },
      accountTypes: { MyBank: 'savings' },
      accountBalances: { MyBank: '1000' },
      accountBalanceDates: { MyBank: '2021-03-15' },
    })
    expect(res.status).toBe(200)

    const db = await getDB()
    const accts = (await db.getAllFromIndex('accounts', 'by_profile', 1)) as Record<
      string,
      unknown
    >[]
    const created = accts.find((a) => String(a.name).toLowerCase() === 'mybank')
    expect(created).toBeTruthy()
    expect(created!.starting_date).toBe('2021-03-15')
    expect(created!.balance_date).toBeUndefined()
  })
})
