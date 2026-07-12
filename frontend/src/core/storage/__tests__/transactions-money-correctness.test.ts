import { beforeEach, describe, expect, it } from 'vitest'
import { getDB, IndexedDBAdapter } from '../idb.js'
import { routeApiRequest } from '../localApiRouter.js'

// Real `idb` on fake-indexeddb (see src/test-setup.ts). Covers the client half of the audit
// money-correctness batch: D2 (transfer needs a destination) and D8 (foreign-currency amount edit).

const STORES = ['profiles', 'transactions', 'categories', 'accounts']

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

const balanceOf = async (id: number): Promise<number> =>
  ((await (await getDB()).get('accounts', id)) as { balance: number }).balance

beforeEach(async () => {
  localStorage.clear()
  localStorage.setItem('currentProfileId', '1')
  await seed()
})

describe('client transactions — transfer needs a destination (audit D2)', () => {
  it('rejects a transfer created without transfer_account_id', async () => {
    const res = await routeApiRequest('http://localhost/api/transactions', {
      method: 'POST',
      body: JSON.stringify({
        type: 'transfer',
        amount: 200,
        description: 'To nowhere',
        date: '2026-05-12',
        category_id: null,
        account_id: 1,
      }),
    })
    expect(res.status).toBe(400)
    expect(await balanceOf(1)).toBe(1000)
  })

  it('accepts a transfer with a destination and moves both balances', async () => {
    const res = await routeApiRequest('http://localhost/api/transactions', {
      method: 'POST',
      body: JSON.stringify({
        type: 'transfer',
        amount: 200,
        description: 'Move',
        date: '2026-05-12',
        category_id: null,
        account_id: 1,
        transfer_account_id: 2,
      }),
    })
    expect(res.status).toBe(201)
    expect(await balanceOf(1)).toBe(800)
    expect(await balanceOf(2)).toBe(700)
  })

  it('rejects an update that drops a transfer destination', async () => {
    const adapter = new IndexedDBAdapter()
    const id = await adapter.createTransaction({
      type: 'transfer',
      amount: 100,
      account_id: 1,
      transfer_account_id: 2,
      description: 'Move',
      date: '2026-05-12',
      category_id: null,
      profile_id: 1,
    } as never)
    const res = await routeApiRequest(`http://localhost/api/transactions/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ transfer_account_id: null }),
    })
    expect(res.status).toBe(400)
    // Unchanged from the valid transfer's state.
    expect(await balanceOf(1)).toBe(900)
    expect(await balanceOf(2)).toBe(600)
  })
})

describe('client transactions — foreign-currency amount edit (audit D8)', () => {
  it('recomputes amount_local and moves the balance when amount changes', async () => {
    const adapter = new IndexedDBAdapter()
    // Foreign expense: 1000 units @ rate 0.1 → 100 in base currency.
    const id = await adapter.createTransaction({
      type: 'expense',
      amount: 1000,
      amount_local: 100,
      exchange_rate: 0.1,
      currency: 'HRK',
      account_id: 1,
      description: 'FX',
      date: '2026-05-12',
      category_id: 1,
      profile_id: 1,
    } as never)
    expect(await balanceOf(1)).toBe(900) // 1000 - 100

    // Edit only the foreign amount (no amount_local sent). Base value must follow: 2000 * 0.1 = 200.
    await adapter.updateTransaction(id, { amount: 2000 } as never)
    const row = (await (await getDB()).get('transactions', id)) as { amount_local: number }
    expect(row.amount_local).toBe(200)
    // Old -100 reversed, new -200 applied → 1000 - 200 = 800 (previously stayed at 900).
    expect(await balanceOf(1)).toBe(800)
  })
})
