import { beforeEach, describe, expect, it } from 'vitest'
import { getDB } from '../idb.js'
import {
  categoriesCreate,
  categoriesList,
  clearAll,
  deleteAllCategories,
  deleteAllTransactions,
  exportAll,
  exportByType,
  importData,
  transactionsCreate,
  transactionsList,
} from '../localHandlers.js'

describe('localHandlers - export/import', () => {
  beforeEach(async () => {
    localStorage.clear()
    localStorage.setItem('currentProfileId', '1')
    const db = await getDB()
    await db.clear('profiles')
    await db.clear('transactions')
    await db.clear('categories')
    await db.clear('accounts')
    await db.clear('budgets')
    await db.clear('goals')
    await db.clear('loans')
    await db.clear('settings')
    await db.add('profiles', { id: 1, name: 'Test', created_at: '2026-01-01' })
  })

  it('exports all data', async () => {
    await categoriesCreate({ name: 'Food', type: 'expense', color: '#ff0000' })
    await transactionsCreate({
      amount: 50,
      type: 'expense',
      date: '2026-05-20',
      description: 'Lunch',
    })

    const res = await exportAll()
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.version).toBeDefined()
    expect(data.export_date).toBeDefined()
    expect(data.transactions).toBeInstanceOf(Array)
    expect(data.categories).toBeInstanceOf(Array)
    expect(data.transactions.length).toBeGreaterThanOrEqual(1)
  })

  it('exports by type as JSON', async () => {
    await transactionsCreate({
      amount: 100,
      type: 'income',
      date: '2026-05-01',
      description: 'Salary',
    })

    const res = await exportByType({ p1: 'transactions' }, new URLSearchParams({ format: 'json' }))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.transactions).toBeInstanceOf(Array)
  })

  it('exports transactions as CSV', async () => {
    await transactionsCreate({
      amount: 42,
      type: 'expense',
      date: '2026-05-15',
      description: 'Coffee',
    })

    const res = await exportByType({ p1: 'transactions' }, new URLSearchParams({ format: 'csv' }))
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).toContain('date,type,description,amount')
  })

  it('imports data', async () => {
    const importPayload = {
      version: '2.0.0',
      export_date: '2026-01-01',
      storage_mode: 'serverless',
      profiles: [{ id: 1, name: 'Imported', created_at: '2026-01-01' }],
      categories: [{ id: 1, name: 'Imported Cat', type: 'expense', color: '#aaa', profile_id: 1 }],
      transactions: [],
      accounts: [],
      budgets: [],
      goals: [],
      loans: [],
      settings: { currency: 'USD' },
    }
    const res = await importData(importPayload)
    expect(res.status).toBe(200)
    const result = await res.json()
    expect(result.message).toContain('imported')
  })

  it('rejects invalid import body', async () => {
    const res = await importData(null)
    expect(res.status).toBe(400)
  })
})

describe('localHandlers - data management', () => {
  beforeEach(async () => {
    localStorage.clear()
    localStorage.setItem('currentProfileId', '1')
    const db = await getDB()
    await db.clear('profiles')
    await db.clear('transactions')
    await db.clear('categories')
    await db.clear('accounts')
    await db.add('profiles', { id: 1, name: 'Test', created_at: '2026-01-01' })
  })

  it('deletes all transactions', async () => {
    await transactionsCreate({
      amount: 100,
      type: 'expense',
      date: '2026-05-20',
      description: 'Test',
    })

    const res = await deleteAllTransactions()
    expect(res.status).toBe(200)

    const listRes = await transactionsList(new URLSearchParams())
    const list = await listRes.json()
    expect(list).toHaveLength(0)
  })

  it('resets categories to defaults', async () => {
    await categoriesCreate({ name: 'Custom', type: 'expense', color: '#000' })

    const res = await deleteAllCategories()
    expect(res.status).toBe(200)

    const listRes = await categoriesList(new URLSearchParams())
    const list = await listRes.json()
    // Should have default categories, not the custom one
    const names = list.map((c: any) => c.name)
    expect(names).not.toContain('Custom')
    expect(names).toContain('Housing')
    expect(names).toContain('Food')
  })

  it('clears all data', async () => {
    await transactionsCreate({
      amount: 100,
      type: 'expense',
      date: '2026-05-20',
      description: 'Test',
    })
    await categoriesCreate({ name: 'Custom', type: 'expense', color: '#000' })

    const res = await clearAll()
    expect(res.status).toBe(200)

    const db = await getDB()
    const txns = await db.getAll('transactions')
    expect(txns).toHaveLength(0)
  })
})
