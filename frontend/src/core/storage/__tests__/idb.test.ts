import { beforeEach, describe, expect, it, vi } from 'vitest'

// Shared state for the mock
const mockStores: Record<string, Map<number, unknown>> = {}
let mockNextId = 1

function resetMockStores() {
  Object.keys(mockStores).forEach((k) => delete mockStores[k])
  mockNextId = 1
  // Pre-populate a profile so getCurrentProfileId doesn't trigger seedDemoProfiles
  mockStores['profiles'] = new Map()
  mockStores['profiles'].set(1, { id: 1, name: 'Test Profile', created_at: '2026-01-01' })
}

function getMockDB() {
  return {
    createObjectStore: (name: string) => {
      mockStores[name] = new Map()
      return { createIndex: () => {} }
    },
    add: async (storeName: string, value: unknown) => {
      if (!mockStores[storeName]) mockStores[storeName] = new Map()
      const id = mockNextId++
      const record = { ...(value as object), id }
      mockStores[storeName].set(id, record)
      return id
    },
    put: async (storeName: string, value: unknown) => {
      const record = value as { id: number }
      if (!mockStores[storeName]) mockStores[storeName] = new Map()
      mockStores[storeName].set(record.id, value)
    },
    get: async (storeName: string, id: number) => {
      return mockStores[storeName]?.get(id) ?? undefined
    },
    getAll: async (storeName: string) => {
      return Array.from(mockStores[storeName]?.values() ?? [])
    },
    getAllFromIndex: async (storeName: string) => {
      return Array.from(mockStores[storeName]?.values() ?? [])
    },
    delete: async (storeName: string, id: number) => {
      mockStores[storeName]?.delete(id)
    },
    clear: async (storeName: string) => {
      mockStores[storeName]?.clear()
    },
  }
}

vi.mock('idb', () => ({
  openDB: vi.fn().mockResolvedValue(getMockDB()),
}))

import { getDB,IndexedDBAdapter } from '../idb.js'

describe('IndexedDBAdapter', () => {
  beforeEach(async () => {
    localStorage.clear()
    localStorage.setItem('currentProfileId', '1')
    resetMockStores()
    // Reset the cached db promise so each test gets a fresh mock
    // We re-import to ensure the module-level dbPromise is reset
  })

  it('getDB returns a cached promise', async () => {
    const { openDB } = await import('idb')
    const db1 = await getDB()
    const db2 = await getDB()
    expect(db1).toBe(db2)
    expect(openDB).toHaveBeenCalledTimes(1)
  })

  it('createProfile returns a numeric id', async () => {
    const adapter = new IndexedDBAdapter()
    const id = await adapter.createProfile('Test Profile')
    expect(typeof id).toBe('number')
    expect(id).toBeGreaterThan(0)
  })

  it('listTransactions returns empty array for new profile', async () => {
    const adapter = new IndexedDBAdapter()
    const txns = await adapter.listTransactions()
    expect(Array.isArray(txns)).toBe(true)
    expect(txns.length).toBe(0)
  })

  it('createTransaction adds and lists a transaction', async () => {
    const adapter = new IndexedDBAdapter()
    await adapter.createTransaction({
      type: 'expense',
      amount: 100,
      description: 'Test',
      date: '2026-05-12',
      category_id: 1,
      profile_id: 1,
    } as any)

    const txns = await adapter.listTransactions()
    expect(txns.length).toBe(1)
    expect(txns[0].description).toBe('Test')
    expect(txns[0].amount).toBe(100)
  })

  it('listCategories returns empty for new profile', async () => {
    const adapter = new IndexedDBAdapter()
    const cats = await adapter.listCategories()
    expect(Array.isArray(cats)).toBe(true)
    expect(cats.length).toBe(0)
  })

  it('createCategory adds and lists a category', async () => {
    const adapter = new IndexedDBAdapter()
    await adapter.createCategory({
      name: 'Food',
      type: 'expense',
      color: '#FF0000',
      profile_id: 1,
    } as any)

    const cats = await adapter.listCategories()
    expect(cats.length).toBe(1)
    expect(cats[0].name).toBe('Food')
  })

  it('deleteTransaction removes a transaction', async () => {
    const adapter = new IndexedDBAdapter()
    const id = await adapter.createTransaction({
      type: 'expense',
      amount: 50,
      description: 'To delete',
      date: '2026-05-12',
      category_id: 1,
      profile_id: 1,
    } as any)

    await adapter.deleteTransaction(id)
    const txns = await adapter.listTransactions()
    expect(txns.length).toBe(0)
  })

  it('updateTransaction modifies a transaction', async () => {
    const adapter = new IndexedDBAdapter()
    const id = await adapter.createTransaction({
      type: 'expense',
      amount: 100,
      description: 'Original',
      date: '2026-05-12',
      category_id: 1,
      profile_id: 1,
    } as any)

    await adapter.updateTransaction(id, { description: 'Updated', amount: 200 })
    const txns = await adapter.listTransactions()
    expect(txns[0].description).toBe('Updated')
    expect(txns[0].amount).toBe(200)
  })

  it('deleteAllTransactions clears all transactions', async () => {
    const adapter = new IndexedDBAdapter()
    await adapter.createTransaction({
      type: 'expense', amount: 10, description: 'T1',
      date: '2026-05-12', category_id: 1, profile_id: 1,
    } as any)
    await adapter.createTransaction({
      type: 'expense', amount: 20, description: 'T2',
      date: '2026-05-12', category_id: 1, profile_id: 1,
    } as any)

    await adapter.deleteAllTransactions()
    const txns = await adapter.listTransactions()
    expect(txns.length).toBe(0)
  })

  it('deleteAllCategories clears all categories', async () => {
    const adapter = new IndexedDBAdapter()
    await adapter.createCategory({ name: 'Food', type: 'expense', color: '#F00', profile_id: 1 } as any)
    await adapter.deleteAllCategories()
    const cats = await adapter.listCategories()
    expect(cats.length).toBe(0)
  })
})
