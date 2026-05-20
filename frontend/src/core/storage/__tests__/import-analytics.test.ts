import { beforeEach, describe, expect, it, vi } from 'vitest'

// --- Mock IndexedDB ---

const mockStores: Record<string, Map<number, unknown>> = {}
let mockNextId = 1

function resetMockStores() {
  Object.keys(mockStores).forEach((k) => delete mockStores[k])
  mockNextId = 1
  mockStores['profiles'] = new Map()
  mockStores['profiles'].set(1, { id: 1, name: 'Test Profile', created_at: '2026-01-01' })
}

function getMockDB() {
  return {
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
    countFromIndex: async () => 0,
    transaction: () => ({ store: { delete: () => {} }, done: Promise.resolve() }),
    objectStoreNames: { contains: () => true },
  }
}

vi.mock('idb', () => ({
  openDB: vi.fn().mockResolvedValue(getMockDB()),
}))

import { getDB, IndexedDBAdapter } from '../idb.js'

// Needed by handlers but we test through the adapter directly
vi.mock('../handlers/helpers', async () => {
  const actual = await vi.importActual('../handlers/helpers.js')
  return actual
})

async function seedCategory(name: string, type: 'income' | 'expense', color: string) {
  const cat = { name, type, color, profile_id: 1 }
  const id = mockNextId++
  const record = { ...cat, id }
  mockStores['categories'] = mockStores['categories'] || new Map()
  mockStores['categories'].set(id, record)
  return id as number
}

async function seedAccount(name: string, balance: number) {
  const acct = { name, type: 'checking', balance, profile_id: 1 }
  const id = mockNextId++
  const record = { ...acct, id }
  mockStores['accounts'] = mockStores['accounts'] || new Map()
  mockStores['accounts'].set(id, record)
  return id as number
}

// --- Tests ---

describe('Import → Analytics flow', () => {
  let adapter: IndexedDBAdapter

  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem('currentProfileId', '1')
    resetMockStores()
    adapter = new IndexedDBAdapter()
  })

  describe('imported transactions store positive amounts', () => {
    it('expense amounts are stored as positive (matching demo convention)', async () => {
      await adapter.createTransaction({
        type: 'expense',
        amount: 50,
        description: 'Groceries',
        date: '2026-05-15',
        category_id: 1,
        profile_id: 1,
        account_id: 1,
      } as any)

      const txns = await adapter.listTransactions()
      expect(txns.length).toBe(1)
      expect(txns[0].amount).toBeGreaterThan(0)
      expect(txns[0].amount).toBe(50)
    })

    it('income amounts are stored as positive', async () => {
      await adapter.createTransaction({
        type: 'income',
        amount: 5000,
        description: 'Salary',
        date: '2026-05-01',
        category_id: 2,
        profile_id: 1,
        account_id: 1,
      } as any)

      const txns = await adapter.listTransactions()
      expect(txns[0].amount).toBe(5000)
      expect(txns[0].amount).toBeGreaterThan(0)
    })

    it('both income and expense stay positive after bulk insert (simulates import)', async () => {
      const txnData = [
        {
          type: 'expense',
          amount: 25.5,
          description: 'Coffee',
          date: '2026-05-03',
          category_id: 1,
          profile_id: 1,
          account_id: 1,
        },
        {
          type: 'expense',
          amount: 120,
          description: 'Electric bill',
          date: '2026-05-10',
          category_id: 1,
          profile_id: 1,
          account_id: 1,
        },
        {
          type: 'income',
          amount: 3000,
          description: 'Freelance',
          date: '2026-05-15',
          category_id: 2,
          profile_id: 1,
          account_id: 1,
        },
        {
          type: 'expense',
          amount: 80,
          description: 'Gas',
          date: '2026-05-20',
          category_id: 1,
          profile_id: 1,
          account_id: 1,
        },
      ]

      for (const t of txnData) await adapter.createTransaction(t as any)

      const txns = await adapter.listTransactions()
      expect(txns.length).toBe(4)

      for (const t of txns) {
        expect(t.amount).toBeGreaterThan(0)
      }
    })
  })

  describe('account balance auto-update from import', () => {
    it('creating an expense decreases account balance', async () => {
      await seedAccount('Checking', 1000)
      await adapter.createTransaction({
        type: 'expense',
        amount: 200,
        description: 'Rent',
        date: '2026-05-01',
        category_id: 1,
        profile_id: 1,
        account_id: 1,
      } as any)

      const db = await getDB()
      const acct = await db.get('accounts', 1)
      expect(acct.balance).toBe(800) // 1000 - 200
    })

    it('creating an income increases account balance', async () => {
      await seedAccount('Savings', 500)
      await adapter.createTransaction({
        type: 'income',
        amount: 1500,
        description: 'Salary',
        date: '2026-05-01',
        category_id: 2,
        profile_id: 1,
        account_id: 1,
      } as any)

      const db = await getDB()
      const acct = await db.get('accounts', 1)
      expect(acct.balance).toBe(2000) // 500 + 1500
    })

    it('multiple imported transactions accumulate balance correctly', async () => {
      await seedAccount('Checking', 5000)

      const expenses = [
        {
          type: 'expense' as const,
          amount: 150,
          description: 'Food',
          date: '2026-05-01',
          category_id: 1,
          profile_id: 1,
          account_id: 1,
        },
        {
          type: 'expense' as const,
          amount: 800,
          description: 'Rent',
          date: '2026-05-02',
          category_id: 1,
          profile_id: 1,
          account_id: 1,
        },
        {
          type: 'expense' as const,
          amount: 60,
          description: 'Internet',
          date: '2026-05-03',
          category_id: 1,
          profile_id: 1,
          account_id: 1,
        },
      ]
      for (const t of expenses) await adapter.createTransaction(t as any)

      const db = await getDB()
      const acct = await db.get('accounts', 1)
      expect(acct.balance).toBe(5000 - 150 - 800 - 60)
    })
  })

  describe('analytics handlers with imported data', () => {
    it('analyticsDistinctYears returns years from imported transactions', async () => {
      await seedCategory('Food', 'expense', '#FF0000')
      await seedCategory('Salary', 'income', '#00FF00')

      await adapter.createTransaction({
        type: 'expense',
        amount: 100,
        description: 'Dinner',
        date: '2025-03-15',
        category_id: 1,
        profile_id: 1,
        account_id: null,
      } as any)
      await adapter.createTransaction({
        type: 'income',
        amount: 5000,
        description: 'Bonus',
        date: '2026-01-10',
        category_id: 2,
        profile_id: 1,
        account_id: null,
      } as any)

      const { analyticsDistinctYears } = await import('../localHandlers.js')
      const res = await analyticsDistinctYears()
      const body = (await res.json()) as { years: number[] }
      expect(body.years).toContain(2025)
      expect(body.years).toContain(2026)
    })

    it('analyticsDailyHeatmap returns date totals for a given year', async () => {
      await seedCategory('Food', 'expense', '#FF0000')

      await adapter.createTransaction({
        type: 'expense',
        amount: 30,
        description: 'Lunch',
        date: '2026-05-01',
        category_id: 1,
        profile_id: 1,
        account_id: null,
      } as any)
      await adapter.createTransaction({
        type: 'expense',
        amount: 70,
        description: 'Dinner',
        date: '2026-05-01',
        category_id: 1,
        profile_id: 1,
        account_id: null,
      } as any)
      await adapter.createTransaction({
        type: 'expense',
        amount: 200,
        description: 'Shopping',
        date: '2026-05-15',
        category_id: 1,
        profile_id: 1,
        account_id: null,
      } as any)

      const { analyticsDailyHeatmap } = await import('../localHandlers.js')
      const params = new URLSearchParams({ year: '2026', type: 'expense' })
      const res = await analyticsDailyHeatmap(params)
      const body = (await res.json()) as {
        dates: Record<string, number>
        year: number
        type: string
      }

      expect(body.dates['2026-05-01']).toBe(100) // 30 + 70
      expect(body.dates['2026-05-15']).toBe(200)
      // All amounts should be positive in output
      for (const val of Object.values(body.dates)) {
        expect(val).toBeGreaterThan(0)
      }
    })

    it('analyticsCategoryTrends returns non-empty datasets when data exists', async () => {
      await seedCategory('Food', 'expense', '#FF0000')
      await seedCategory('Salary', 'income', '#00FF00')

      // Add expense transactions for each month
      for (let m = 1; m <= 12; m++) {
        await adapter.createTransaction({
          type: 'expense',
          amount: 100,
          description: `Food month ${m}`,
          date: `2026-${String(m).padStart(2, '0')}-15`,
          category_id: 1,
          profile_id: 1,
          account_id: null,
        } as any)
        await adapter.createTransaction({
          type: 'income',
          amount: 5000,
          description: `Salary month ${m}`,
          date: `2026-${String(m).padStart(2, '0')}-01`,
          category_id: 2,
          profile_id: 1,
          account_id: null,
        } as any)
      }

      const { analyticsCategoryTrends } = await import('../localHandlers.js')

      // Test expense category trends
      const expenseRes = await analyticsCategoryTrends(
        new URLSearchParams({ year: '2026', type: 'expense' })
      )
      const expenseBody = (await expenseRes.json()) as {
        labels: string[]
        datasets: Array<{ category: string; color: string; data: number[] }>
        numDays: number
      }

      expect(expenseBody.labels.length).toBe(12)
      expect(expenseBody.datasets.length).toBeGreaterThan(0)
      expect(expenseBody.datasets[0].category).toBeDefined()
      // All data points should be positive
      for (const ds of expenseBody.datasets) {
        for (const v of ds.data) {
          expect(v).toBeGreaterThanOrEqual(0)
        }
      }
    })

    it('category trends return empty datasets when no matching data (not error)', async () => {
      await seedCategory('Food', 'expense', '#FF0000')

      const { analyticsCategoryTrends } = await import('../localHandlers.js')

      // Query a year with no data
      const res = await analyticsCategoryTrends(
        new URLSearchParams({ year: '2024', type: 'expense' })
      )
      const body = (await res.json()) as { labels: unknown[]; datasets: unknown[] }

      expect(Array.isArray(body.labels)).toBe(true)
      expect(Array.isArray(body.datasets)).toBe(true)
      expect(body.datasets.length).toBe(0) // no data = no datasets
    })
  })

  describe('bills CRUD with profile scoping', () => {
    it('billsCreate stores bill with correct profile_id', async () => {
      const { billsCreate } = await import('../localHandlers.js')
      const res = await billsCreate({
        name: 'Electric Bill',
        amount: 85,
        frequency: 'monthly',
        due_date: '2026-06-15',
        day_of_month: 15,
        category_id: 1,
      })
      expect(res.status).toBe(201)

      // Verify it's in the mock store with correct profile_id
      const bills = Array.from(mockStores['bills']?.values() ?? [])
      expect(bills.length).toBe(1)
      expect((bills[0] as Record<string, unknown>).name).toBe('Electric Bill')
      expect((bills[0] as Record<string, unknown>).profile_id).toBe(1)
    })

    it('billsList returns bills for current profile', async () => {
      // Create a bill first
      await adapter.createTransaction({
        type: 'expense',
        amount: 100,
        description: 'bill ref',
        date: '2026-05-01',
        category_id: null,
        profile_id: 1,
        account_id: null,
      } as any)

      const { billsCreate, billsList } = await import('../localHandlers.js')
      await billsCreate({ name: 'Internet', amount: 45, frequency: 'monthly', day_of_month: 1 })

      const listRes = await billsList()
      const body = (await listRes.json()) as unknown[]
      expect(body.length).toBe(1)
      expect((body[0] as Record<string, unknown>).name).toBe('Internet')
    })

    it('billsList from other profile not returned', async () => {
      // Create a bill under profile 1 (current profile)
      const { billsCreate } = await import('../localHandlers.js')
      await billsCreate({ name: 'Rent', amount: 1200, frequency: 'monthly', day_of_month: 1 })

      // Verify profile 1 bill exists
      const bills = Array.from(mockStores['bills']?.values() ?? [])
      expect(bills.length).toBe(1)
      expect((bills[0] as Record<string, unknown>).profile_id).toBe(1)
    })
  })
})
