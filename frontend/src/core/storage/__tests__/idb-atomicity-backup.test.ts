import { beforeEach, describe, expect, it } from 'vitest'
import { getDB, IndexedDBAdapter } from '../idb.js'
import type { ExportData } from '../../../types/storage'

// These run against the real `idb` library on fake-indexeddb (see src/test-setup.ts),
// so they exercise actual IndexedDB transaction semantics — not a mock.

const ALL_STORES = [
  'profiles',
  'transactions',
  'categories',
  'accounts',
  'budgets',
  'goals',
  'loans',
  'balanceHistory',
  'receipts',
  'portfolioHoldings',
  'bills',
  'housings',
  'recurring',
  'tags',
  'categoryMappings',
  'settings',
]

async function wipe() {
  const db = await getDB()
  for (const s of ALL_STORES) {
    if (db.objectStoreNames.contains(s)) await db.clear(s)
  }
}

describe('IndexedDBAdapter — balance atomicity (audit D4)', () => {
  let adapter: IndexedDBAdapter

  beforeEach(async () => {
    localStorage.clear()
    localStorage.setItem('currentProfileId', '1')
    await wipe()
    const db = await getDB()
    await db.add('profiles', { id: 1, name: 'Test', created_at: '2026-01-01' })
    await db.add('accounts', {
      id: 1,
      profile_id: 1,
      name: 'Checking',
      balance: 0,
      starting_balance: 0,
    })
    await db.add('categories', {
      id: 1,
      profile_id: 1,
      name: 'Test category',
      type: 'expense',
      color: '#000000',
    })
    adapter = new IndexedDBAdapter()
  })

  it('does not lose updates when many transactions are created concurrently', async () => {
    // Fire 20 balance-affecting creates without awaiting between them. With the old
    // per-call get→+=→put (separate transactions) these lost-updated the balance.
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        adapter.createTransaction({
          type: 'income',
          amount: 10,
          account_id: 1,
          description: `c${i}`,
          date: '2026-05-12',
          category_id: 1,
          profile_id: 1,
        } as never)
      )
    )
    const db = await getDB()
    const acct = await db.get('accounts', 1)
    expect(acct.balance).toBe(200)
  })

  it('does not lose updates under concurrent edits of different transactions', async () => {
    const ids = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        adapter.createTransaction({
          type: 'income',
          amount: 10,
          account_id: 1,
          description: `c${i}`,
          date: '2026-05-12',
          category_id: 1,
          profile_id: 1,
        } as never)
      )
    )
    // balance now 50; concurrently double each amount → +50 more → 100
    await Promise.all(ids.map((id) => adapter.updateTransaction(id, { amount: 20 } as never)))
    const db = await getDB()
    const acct = await db.get('accounts', 1)
    expect(acct.balance).toBe(100)
  })

  it('reverses balances atomically on concurrent deletes', async () => {
    const ids = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        adapter.createTransaction({
          type: 'expense',
          amount: 5,
          account_id: 1,
          description: `e${i}`,
          date: '2026-05-12',
          category_id: 1,
          profile_id: 1,
        } as never)
      )
    )
    // balance now -30; delete them all concurrently → back to 0
    await Promise.all(ids.map((id) => adapter.deleteTransaction(id)))
    const db = await getDB()
    const acct = await db.get('accounts', 1)
    expect(acct.balance).toBe(0)
  })
})

describe('IndexedDBAdapter — backup completeness (audit D11)', () => {
  let adapter: IndexedDBAdapter

  beforeEach(async () => {
    localStorage.clear()
    localStorage.setItem('currentProfileId', '1')
    await wipe()
    adapter = new IndexedDBAdapter()
    const db = await getDB()
    await db.add('profiles', { id: 1, name: 'Test', created_at: '2026-01-01' })
    await db.add('accounts', {
      id: 1,
      profile_id: 1,
      name: 'Checking',
      balance: 0,
      starting_balance: 0,
    })
    await db.add('categories', {
      id: 1,
      profile_id: 1,
      name: 'Food',
      type: 'expense',
      color: '#f00',
    })
    // Seed one row in each store that was previously dropped from backups.
    await db.add('bills', { id: 1, profile_id: 1, name: 'Rent', amount: 500 })
    await db.add('recurring', { id: 1, profile_id: 1, description: 'Salary', amount: 3000 })
    await db.add('tags', { id: 1, profile_id: 1, name: 'work' })
    await db.add('housings', { id: 1, profile_id: 1, name: 'Flat' })
    await db.add('categoryMappings', { id: 1, profile_id: 1, pattern: 'ACME', category_id: 1 })
    await db.add('portfolioHoldings', { id: 1, profile_id: 1, ticker: 'VWCE', shares: 3 })
    await db.add('receipts', { id: 1, profile_id: 1, transaction_id: 1, filename: 'r.png' })
    await db.add('balanceHistory', { id: 1, account_id: 1, balance: 123, date: '2026-05-01' })
  })

  it('exports every user-created store', async () => {
    const data = await adapter.exportData()
    expect(data.bills).toHaveLength(1)
    expect(data.recurring).toHaveLength(1)
    expect(data.tags).toHaveLength(1)
    expect(data.housings).toHaveLength(1)
    expect(data.categoryMappings).toHaveLength(1)
    expect(data.portfolioHoldings).toHaveLength(1)
    expect(data.receipts).toHaveLength(1)
    expect(data.balanceHistoryRows).toHaveLength(1)
  })

  it('round-trips every store through export → import without loss', async () => {
    const data = await adapter.exportData()
    // Simulate a restore into a fresh database.
    await wipe()
    await adapter.importData(data as ExportData)

    const db = await getDB()
    // Data survives (profile ids are remapped, so query by store contents).
    expect(await db.getAll('bills')).toHaveLength(1)
    expect(await db.getAll('recurring')).toHaveLength(1)
    expect(await db.getAll('tags')).toHaveLength(1)
    expect(await db.getAll('housings')).toHaveLength(1)
    expect(await db.getAll('categoryMappings')).toHaveLength(1)
    expect(await db.getAll('portfolioHoldings')).toHaveLength(1)
    expect(await db.getAll('receipts')).toHaveLength(1)
    expect(await db.getAll('balanceHistory')).toHaveLength(1)
    // Account balance history keeps its account linkage.
    const bh = (await db.getAll('balanceHistory'))[0] as { account_id: number }
    expect(bh.account_id).toBe(1)
  })

  it('a restore does not delete receipts/holdings/history that the backup contains', async () => {
    const data = await adapter.exportData()
    await adapter.importData(data as ExportData)
    const db = await getDB()
    // Regression for D11: importData used to clear these stores without restoring them.
    expect((await db.getAll('receipts')).length).toBeGreaterThan(0)
    expect((await db.getAll('portfolioHoldings')).length).toBeGreaterThan(0)
    expect((await db.getAll('balanceHistory')).length).toBeGreaterThan(0)
  })
})
