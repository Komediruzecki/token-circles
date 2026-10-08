/**
 * Money that budgets and goals move, to the cent, in local-first: the twin of
 * worker/test/money-parity.test.ts, with the same rows made the same way (every one POSTed, as the
 * app makes them) and the same figures expected, through `routeApiRequest`, the router `apiFetch`
 * calls.
 *
 * Adding to a goal, allocating, rolling a budget over, copying a month and setting a month from
 * last month's spending each answer an amount that a person reads as money: 739.65, not
 * 739.6500000000001.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDB } from '../idb'

let routeApiRequest: (url: string, init?: RequestInit) => Promise<Response>

beforeAll(async () => {
  routeApiRequest = (await import('../localApiRouter')).routeApiRequest
}, 120_000)

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 6, 15, 12))
  localStorage.clear()
  localStorage.setItem('currentProfileId', '1')
  localStorage.setItem('localCurrency', 'EUR')
  const db = await getDB()
  for (const store of Array.from(db.objectStoreNames)) await db.clear(store)
  await db.add('profiles', { id: 1, name: 'Me', created_at: '2026-01-01T00:00:00.000Z' })
  await db.put('settings', { key: 'currency', value: 'EUR' })
})

afterEach(() => {
  vi.useRealTimers()
})

async function send<T = Record<string, unknown>>(
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const res = await routeApiRequest(path, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  expect(res.status, `${method} ${path}: ${await res.clone().text()}`).toBeLessThan(300)
  return (await res.json()) as T
}

const post = <T = Record<string, unknown>>(path: string, body: unknown) =>
  send<T>('POST', path, body)
const get = <T = Record<string, unknown>>(path: string) => send<T>('GET', path)

async function category(name: string): Promise<number> {
  return (
    await post<{ id: number }>('/api/categories', { name, type: 'expense', color: '#F97316' })
  ).id
}

async function spend(categoryId: number, date: string, amount: number): Promise<void> {
  await post('/api/transactions', {
    description: 'spent',
    amount,
    type: 'expense',
    date,
    category_id: categoryId,
  })
}

describe('adding to a goal', () => {
  it('adds to the cent', async () => {
    const goal = (
      await post<{ id: number }>('/api/savings-goals', { name: 'Bike', target_amount: 500 })
    ).id

    await post(`/api/savings-goals/${goal}/contribute`, { amount: 0.1 })
    const answer = await post<{ current_amount: number }>(`/api/savings-goals/${goal}/contribute`, {
      amount: 0.2,
    })

    expect(answer).toMatchObject({ current_amount: 0.3 })
    const goals = await get<{ id: number; current_amount: number }[]>('/api/savings-goals')
    expect(goals.find((g) => g.id === goal)).toMatchObject({ current_amount: 0.3 })
  })
})

describe('allocating', () => {
  it("leaves the month's income less what is allocated, to the cent", async () => {
    const food = await category('Food')
    await post('/api/transactions', {
      description: 'pay',
      amount: 1000.1,
      type: 'income',
      date: '2026-07-01',
    })

    await post('/api/budgets/allocate?month=2026-07', { category_id: food, amount: 250.55 })
    await post('/api/budgets/allocate?month=2026-07', { category_id: food, amount: 260.45 })

    const summary = await get('/api/budgets/zero-based/summary?month=2026-07')
    expect(summary).toMatchObject({
      income: 1000.1,
      total_budget: 260.45,
      zero_based_remaining: 739.65,
      unassigned_budget: 739.65,
    })
    const budgets =
      await get<{ category_id: number; amount: number; start_date: string }[]>('/api/budgets')
    expect(budgets.map((b) => [b.category_id, b.amount, b.start_date])).toEqual([
      [food, 260.45, '2026-07-01'],
    ])
  })
})

describe('rolling a budget over', () => {
  it("adds what last month left unspent to this month's budget, to the cent", async () => {
    const food = await category('Food')
    const june = await post<{ id: number }>('/api/budgets/allocate?month=2026-06', {
      category_id: food,
      amount: 10.3,
    })
    const july = await post<{ id: number }>('/api/budgets/allocate?month=2026-07', {
      category_id: food,
      amount: 10.3,
    })
    await send('PUT', `/api/budgets/${june.id}/rollover`, { rollover_enabled: true })
    await send('PUT', `/api/budgets/${july.id}/rollover`, { rollover_enabled: true })
    await spend(food, '2026-06-10', 0.1)
    await spend(food, '2026-07-02', 0.2)

    const summary = await get<
      {
        category_id: number
        auto_rollover: number
        rollover_contribution: number
        effective_budget: number
        effective_remaining: number
        spent: number
        remaining: number
      }[]
    >('/api/budgets/summary?year=2026&month=7')

    expect(summary.find((b) => b.category_id === food)).toMatchObject({
      auto_rollover: 10.2,
      rollover_contribution: 10.2,
      effective_budget: 20.5,
      effective_remaining: 20.3,
      spent: 0.2,
      remaining: 10.1,
    })
  })
})

describe('copying last month', () => {
  it('copies each budget to the cent', async () => {
    const food = await category('Food')
    const rent = await category('Rent')
    await post('/api/budgets/allocate?month=2026-06', { category_id: food, amount: 100.1 })
    await post('/api/budgets/allocate?month=2026-06', { category_id: rent, amount: 900.55 })

    await post('/api/budgets/duplicate-last', { year: 2026, month: 7 })

    const budgets =
      await get<{ category_id: number; amount: number; start_date: string }[]>('/api/budgets')
    expect(
      budgets
        .filter((b) => b.start_date === '2026-07-01')
        .map((b) => [b.category_id, b.amount])
        .sort((a, b) => a[0]! - b[0]!)
    ).toEqual([
      [food, 100.1],
      [rent, 900.55],
    ])
  })
})

describe("setting a month from last month's spending", () => {
  it('sets what was spent, to the cent', async () => {
    const food = await category('Food')
    await spend(food, '2026-06-03', 0.1)
    await spend(food, '2026-06-10', 0.2)
    await spend(food, '2026-06-20', 0.3)

    await post('/api/budgets/from-expenses', { year: 2026, month: 7 })

    const budgets =
      await get<{ category_id: number; amount: number; start_date: string }[]>('/api/budgets')
    expect(budgets.map((b) => [b.category_id, b.amount, b.start_date])).toEqual([
      [food, 0.6, '2026-07-01'],
    ])
  })
})
