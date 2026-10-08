/**
 * GET /api/budgets/alerts in local-first: the twin of worker/test/budget-alerts.test.ts, through
 * `routeApiRequest`, the router `apiFetch` calls.
 *
 * The alerts took every budget row without an end date, so each earlier month's budget for a
 * category, and each later one, was measured against this month's spending: one category raised
 * an alert per month, at amounts it no longer had.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDB } from '../idb'

let routeApiRequest: (url: string, init?: RequestInit) => Promise<Response>

beforeAll(async () => {
  routeApiRequest = (await import('../localApiRouter')).routeApiRequest
}, 120_000)

const FOOD = 1
const RENT = 2

beforeEach(async () => {
  localStorage.clear()
  localStorage.setItem('currentProfileId', '1')
  const db = await getDB()
  for (const store of ['profiles', 'categories', 'budgets', 'transactions'] as const) {
    await db.clear(store)
  }
  await db.add('profiles', { id: 1, name: 'Me', created_at: '2026-01-01T00:00:00.000Z' })
  await db.add('categories', {
    id: FOOD,
    profile_id: 1,
    name: 'Food',
    type: 'expense',
    color: '#F97316',
  } as never)
  await db.add('categories', {
    id: RENT,
    profile_id: 1,
    name: 'Rent',
    type: 'expense',
    color: '#3B82F6',
  } as never)
  const budget = (category: number, start: string, amount: number) =>
    db.add('budgets', {
      profile_id: 1,
      category_id: category,
      amount,
      period: 'monthly',
      start_date: start,
      end_date: null,
      rollover_enabled: false,
      rollover_amount: 0,
      created_at: '2026-01-01T00:00:00.000Z',
    } as never)
  await budget(FOOD, '2026-08-01', 100)
  await budget(FOOD, '2026-09-01', 200)
  await budget(FOOD, '2026-10-01', 300)
  await budget(FOOD, '2026-11-01', 50)
  await budget(RENT, '2026-09-01', 900)
  let id = 1
  const expense = (category: number, date: string, amount: number) =>
    db.add('transactions', {
      id: id++,
      profile_id: 1,
      description: 'spent',
      amount,
      amount_local: amount,
      currency: 'EUR',
      exchange_rate: 1,
      type: 'expense',
      date,
      category_id: category,
      account_id: null,
      transfer_account_id: null,
      notes: '',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    } as never)
  await expense(FOOD, '2026-10-03', 120)
  await expense(FOOD, '2026-10-12', 150)
  await expense(RENT, '2026-10-01', 900)
})

afterEach(() => {
  vi.useRealTimers()
})

type Alert = { categoryName: string; budgetAmount: number; spent: number; percentage: number }

async function alerts(query: string): Promise<Alert[]> {
  const res = await routeApiRequest(`/api/budgets/alerts?${query}`)
  expect(res.status).toBe(200)
  return ((await res.json()) as { alerts: Alert[] }).alerts.map((a) => ({
    categoryName: a.categoryName,
    budgetAmount: a.budgetAmount,
    spent: a.spent,
    percentage: a.percentage,
  }))
}

describe('GET /api/budgets/alerts', () => {
  it("measures the month's spending against the month's own budget, once per category", async () => {
    expect(await alerts('threshold=80&year=2026&month=10')).toEqual([
      { categoryName: 'Food', budgetAmount: 300, spent: 270, percentage: 90 },
    ])
  })

  it('raises none for a category without a budget that month', async () => {
    // Rent has September's budget only: October's 900 is spent against no October budget.
    expect((await alerts('threshold=1&year=2026&month=10')).map((a) => a.categoryName)).toEqual([
      'Food',
    ])
  })

  it('reads this month when none is given', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 20, 12))
    expect(await alerts('threshold=80')).toEqual([
      { categoryName: 'Food', budgetAmount: 300, spent: 270, percentage: 90 },
    ])
  })
})
