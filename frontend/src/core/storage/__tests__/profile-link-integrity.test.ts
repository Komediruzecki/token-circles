import { beforeEach, describe, expect, it } from 'vitest'
import { getDB, IndexedDBAdapter, ProfileOwnershipError } from '../idb.js'
import { routeApiRequest } from '../localApiRouter.js'
import {
  accountsUpdate,
  billsCreate,
  billsUpdate,
  budgetsCreate,
  categoryMappingsCreate,
  goalsCreate,
  loansDelete,
  recurringCreate,
  transactionsBulk,
  transactionsCreate,
  transactionsUpdate,
} from '../localHandlers.js'

async function seed() {
  const db = await getDB()
  for (const store of [
    'profiles',
    'transactions',
    'accounts',
    'categories',
    'bills',
    'budgets',
    'goals',
    'loans',
    'recurring',
    'categoryMappings',
  ]) {
    await db.clear(store)
  }
  await db.add('profiles', { id: 1, name: 'Current', created_at: '2026-01-01' })
  await db.add('profiles', { id: 2, name: 'Household', created_at: '2026-01-01' })
  await db.add('accounts', {
    id: 11,
    profile_id: 1,
    name: 'Current account',
    balance: 1000,
    starting_balance: 1000,
  })
  await db.add('accounts', {
    id: 22,
    profile_id: 2,
    name: 'Household account',
    balance: 500,
    starting_balance: 500,
  })
  await db.add('categories', {
    id: 111,
    profile_id: 1,
    name: 'Current category',
    type: 'expense',
  })
  await db.add('categories', {
    id: 222,
    profile_id: 2,
    name: 'Household category',
    type: 'expense',
  })
  await db.add('transactions', {
    id: 1001,
    profile_id: 1,
    description: 'Current row',
    type: 'expense',
    amount: 10,
    account_id: 11,
    category_id: 111,
    date: '2026-01-01',
  })
  await db.add('transactions', {
    id: 2002,
    profile_id: 2,
    description: 'Household row',
    type: 'expense',
    amount: 20,
    account_id: 22,
    category_id: 222,
    date: '2026-01-01',
  })
  await db.add('bills', { id: 202, profile_id: 2, name: 'Foreign bill', amount: 20 })
  await db.add('loans', { id: 302, profile_id: 2, name: 'Foreign loan' })
}

beforeEach(async () => {
  localStorage.clear()
  localStorage.setItem('currentProfileId', '1')
  localStorage.setItem('selectedProfileIds', '[1,2]')
  await seed()
})

describe('IndexedDB profile-link integrity', () => {
  it('rejects cross-profile transaction account and category links without moving balances', async () => {
    const accountResult = await transactionsCreate({
      description: 'Cross account',
      amount: 100,
      type: 'expense',
      account_id: 22,
      category_id: 111,
      date: '2026-01-02',
    })
    expect(accountResult.status).toBe(400)
    const categoryResult = await transactionsCreate({
      description: 'Cross category',
      amount: 100,
      type: 'expense',
      account_id: 11,
      category_id: 222,
      date: '2026-01-02',
    })
    expect(categoryResult.status).toBe(400)

    const db = await getDB()
    expect((await db.get('accounts', 11))?.balance).toBe(1000)
    expect((await db.get('accounts', 22))?.balance).toBe(500)
    expect(await db.getAllFromIndex('transactions', 'by_profile', 1)).toHaveLength(1)
  })

  it('enforces ownership inside the adapter even when a caller bypasses handlers', async () => {
    const adapter = new IndexedDBAdapter()
    await expect(
      adapter.createTransaction({
        profile_id: 1,
        description: 'Adapter bypass',
        amount: 50,
        type: 'expense',
        account_id: 22,
        category_id: 111,
        date: '2026-01-02',
      } as never)
    ).rejects.toBeInstanceOf(ProfileOwnershipError)
    expect((await (await getDB()).get('accounts', 22))?.balance).toBe(500)
  })

  it('rejects stale updates and bulk writes to another selected profile', async () => {
    expect((await accountsUpdate({ p1: '22' }, { name: 'Changed' })).status).toBe(404)
    expect((await billsUpdate({ p1: '202' }, { amount: 99 })).status).toBe(404)
    expect((await loansDelete({ p1: '302' })).status).toBe(404)
    expect(
      (
        await transactionsUpdate(
          { p1: '1001' },
          { account_id: 22, category_id: 222, description: 'Cross-linked' }
        )
      ).status
    ).toBe(400)

    const bulk = await transactionsBulk({
      ids: [1001, 2002],
      action: 'update',
      data: { description: 'Bulk changed' },
    })
    expect(bulk.status).toBe(200)
    const db = await getDB()
    expect((await db.get('transactions', 1001))?.description).toBe('Bulk changed')
    expect((await db.get('transactions', 2002))?.description).toBe('Household row')
  })

  it('keeps an in-flight write scoped to its request header across a profile switch', async () => {
    localStorage.setItem('currentProfileId', '2')
    const result = await routeApiRequest('http://localhost/api/transactions', {
      method: 'POST',
      headers: { 'X-Profile-Id': '1', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        description: 'Request-scoped',
        amount: 25,
        type: 'expense',
        account_id: 11,
        category_id: 111,
        date: '2026-01-02',
      }),
    })
    expect(result.status).toBe(201)
    const row = (await (await getDB()).getAll('transactions')).find(
      (transaction) => transaction.description === 'Request-scoped'
    )
    expect(row?.profile_id).toBe(1)
    expect(row?.account_id).toBe(11)
  })

  it('rejects foreign category/account links in dependent resources', async () => {
    expect(
      (
        await billsCreate({
          name: 'Bill',
          amount: 10,
          category_id: 222,
        })
      ).status
    ).toBe(400)
    expect(
      (
        await budgetsCreate({
          amount: 100,
          category_id: 222,
          period: 'monthly',
          start_date: '2026-01-01',
        })
      ).status
    ).toBe(400)
    expect(
      (
        await goalsCreate({
          name: 'Goal',
          target_amount: 100,
          category_id: 222,
        })
      ).status
    ).toBe(400)
    expect(
      (
        await recurringCreate({
          description: 'Recurring',
          amount: 10,
          type: 'expense',
          account_id: 22,
        })
      ).status
    ).toBe(400)
    expect(
      (
        await categoryMappingsCreate({
          pattern: 'merchant',
          category_id: 222,
        })
      ).status
    ).toBe(400)
  })
})
