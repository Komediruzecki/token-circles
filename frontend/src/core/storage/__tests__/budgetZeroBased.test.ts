/**
 * What the Budgets page reads for a month, in local-first: the twin of
 * worker/test/budget-zero-based.test.ts, through `routeApiRequest`, the router `apiFetch` calls.
 *
 * - A category without a budget was given its spending as its budget, 100% used, so the page
 *   called it near its limit in local-first only (`budget-zero-based-unbudgeted`). A budget of
 *   zero was read as none the same way.
 * - "Over budget by $0.00" was said at exactly 100% (`budget-allocation-alerts`).
 * - A month's trend and the forecast's history counted every expense of the month against its
 *   budgets, unbudgeted and uncategorised included (`budget-trend-spending`).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDB } from '../idb'

let routeApiRequest: (url: string, init?: RequestInit) => Promise<Response>

beforeAll(async () => {
  routeApiRequest = (await import('../localApiRouter')).routeApiRequest
}, 120_000)

const FOOD = 1
const FUN = 2
const RENT = 3
const BOOKS = 4

beforeEach(async () => {
  localStorage.clear()
  localStorage.setItem('currentProfileId', '1')
  const db = await getDB()
  for (const store of ['profiles', 'categories', 'budgets', 'transactions'] as const) {
    await db.clear(store)
  }
  await db.add('profiles', { id: 1, name: 'Me', created_at: '2026-01-01T00:00:00.000Z' })
  for (const [id, name] of [
    [FOOD, 'Food'],
    [FUN, 'Fun'],
    [RENT, 'Rent'],
    [BOOKS, 'Books'],
  ] as const) {
    await db.add('categories', {
      id,
      profile_id: 1,
      name,
      type: 'expense',
      color: '#F97316',
    } as never)
  }
  const budget = (category: number, amount: number) =>
    db.add('budgets', {
      profile_id: 1,
      category_id: category,
      amount,
      period: 'monthly',
      start_date: '2026-10-01',
      end_date: null,
      rollover_enabled: false,
      rollover_amount: 0,
      created_at: '2026-01-01T00:00:00.000Z',
    } as never)
  await budget(FOOD, 300)
  await budget(RENT, 900)
  await budget(BOOKS, 0)
  let id = 1
  const expense = (category: number | null, date: string, amount: number) =>
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
  await expense(FOOD, '2026-10-04', 200)
  await expense(RENT, '2026-10-01', 990)
  await expense(BOOKS, '2026-10-06', 12)
  // Spending no budget covers: a category without one, and none at all.
  await expense(FUN, '2026-10-09', 50)
  await expense(null, '2026-10-12', 20)
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 20, 12))
})

afterEach(() => {
  vi.useRealTimers()
})

async function get<T>(path: string): Promise<T> {
  const res = await routeApiRequest(path)
  expect(res.status, `GET ${path}`).toBe(200)
  return (await res.json()) as T
}

type Row = Record<string, unknown> & { category_id: number }

describe('GET /api/budgets/zero-based', () => {
  it('gives a category without a budget none, however much it spent', async () => {
    const { allocations } = await get<{ allocations: Row[] }>(
      '/api/budgets/zero-based?month=2026-10'
    )
    const of = (id: number) => allocations.find((a) => a.category_id === id)
    expect(of(FUN)).toMatchObject({
      amount: 0,
      spent: 50,
      remaining_budget: 0,
      percent_used: 0,
      is_budgeted: false,
    })
    // A budget of zero is a budget: what it spent is past it.
    expect(of(BOOKS)).toMatchObject({
      amount: 0,
      spent: 12,
      remaining_budget: -12,
      percent_used: 0,
      is_budgeted: true,
    })
    expect(of(FOOD)).toMatchObject({ amount: 300, spent: 200, percent_used: 67 })
  })
})

describe('GET /api/budgets/zero-based/summary', () => {
  it('says how far over budget, from past 100%', async () => {
    const { allocations } = await get<{ allocations: (Row & { alerts: string[] })[] }>(
      '/api/budgets/zero-based/summary?month=2026-10'
    )
    const alertsOf = (id: number) => allocations.find((a) => a.category_id === id)?.alerts
    expect(alertsOf(RENT)).toEqual(['Approaching limit: 110% used', 'Over budget by $90.00'])
    expect(alertsOf(FOOD)).toEqual([])
  })

  it('is not over budget at exactly 100%', async () => {
    const db = await getDB()
    const rent = (await db.getAll('budgets')).find((b) => b.category_id === RENT)!
    await db.put('budgets', { ...rent, amount: 990 })
    const { allocations } = await get<{ allocations: (Row & { alerts: string[] })[] }>(
      '/api/budgets/zero-based/summary?month=2026-10'
    )
    expect(allocations.find((a) => a.category_id === RENT)?.alerts).toEqual([
      'Approaching limit: 100% used',
    ])
  })
})

describe("a month's trend", () => {
  // One budget a month here, each with one expense: what the trend counts, not how a month of
  // several budgets is summed.
  beforeEach(async () => {
    const db = await getDB()
    for (const budget of await db.getAll('budgets')) {
      if (budget.category_id !== FOOD) await db.delete('budgets', budget.id!)
    }
  })

  it('measures the budgets against what their categories spent (/api/budgets/improvements)', async () => {
    const [october] = await get<
      { month: string; total_budget: number; total_spent: number; adherence_pct: number }[]
    >('/api/budgets/improvements?months=6')
    expect(october).toMatchObject({ month: '2026-10', total_budget: 300, total_spent: 200 })
  })

  it("and so does the forecast's history (/api/budgets/forecast)", async () => {
    const { history } = await get<{
      history: { month: string; total_budget: number; total_spent: number }[]
    }>('/api/budgets/forecast?month=2026-10')
    expect(history[0]).toMatchObject({ month: '2026-10', total_budget: 300, total_spent: 200 })
  })
})
