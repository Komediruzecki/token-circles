/**
 * "Set from last month's spending" in local-first: the twin of
 * worker/test/budgets-from-expenses.test.ts, through `routeApiRequest`, the router `apiFetch`
 * calls.
 *
 * It fills the categories the month has no budget for, each with what it cost the month before,
 * and leaves the budgets the month already has alone. It used to delete every budget of the month
 * and write last month's spending in their place, without asking.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { getDB } from '../idb'

let routeApiRequest: (url: string, init?: RequestInit) => Promise<Response>

beforeAll(async () => {
  routeApiRequest = (await import('../localApiRouter')).routeApiRequest
}, 120_000)

const FOOD = 1
const CAR = 2
const GYM = 3

let nextTransaction = 1

async function expense(date: string, amount: number, categoryId: number | null): Promise<void> {
  const db = await getDB()
  await db.add('transactions', {
    id: nextTransaction++,
    profile_id: 1,
    description: 'spent',
    amount,
    amount_local: amount,
    currency: 'EUR',
    exchange_rate: 1,
    type: 'expense',
    date,
    category_id: categoryId,
    account_id: null,
    transfer_account_id: null,
    notes: '',
    beneficiary: '',
    payor: '',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  } as never)
}

async function budget(categoryId: number, amount: number, startDate: string): Promise<void> {
  const db = await getDB()
  await db.add('budgets', {
    profile_id: 1,
    category_id: categoryId,
    amount,
    period: 'monthly',
    start_date: startDate,
    end_date: null,
    rollover_enabled: false,
    rollover_amount: 0,
    created_at: '2026-01-01T00:00:00.000Z',
  } as never)
}

/** Every budget of the profile, as "YYYY-MM:category" -> amount. */
async function budgets(): Promise<Record<string, number>> {
  const db = await getDB()
  const rows = (await db.getAllFromIndex('budgets', 'by_profile', 1)) as Array<
    Record<string, unknown>
  >
  const out: Record<string, number> = {}
  for (const row of rows) {
    out[`${String(row.start_date).slice(0, 7)}:${String(row.category_id)}`] = Number(row.amount)
  }
  return out
}

async function fromExpenses(body: unknown): Promise<Response> {
  return routeApiRequest('/api/budgets/from-expenses', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

beforeEach(async () => {
  localStorage.clear()
  localStorage.setItem('currentProfileId', '1')
  localStorage.setItem('localCurrency', 'EUR')
  const db = await getDB()
  for (const store of ['profiles', 'categories', 'transactions', 'budgets'] as const) {
    await db.clear(store)
  }
  await db.add('profiles', { id: 1, name: 'Main', created_at: '2026-01-01T00:00:00.000Z' })
  for (const [id, name] of [
    [FOOD, 'Food'],
    [CAR, 'Car'],
    [GYM, 'Gym'],
  ] as const) {
    await db.add('categories', {
      id,
      profile_id: 1,
      name,
      type: 'expense',
      color: '#F97316',
    } as never)
  }
  nextTransaction = 1
  // March: Food 120.55 (100 + 20.55), Car 50. Nothing on Gym; one expense without a category.
  await expense('2026-03-05', 100, FOOD)
  await expense('2026-03-20', 20.55, FOOD)
  await expense('2026-03-10', 50, CAR)
  await expense('2026-03-12', 9, null)
  // April's own spending is not what April's budgets are set from.
  await expense('2026-04-02', 75, CAR)
})

describe('POST /api/budgets/from-expenses (local-first)', () => {
  it('sets every category last month spent on, when the month has no budgets', async () => {
    const res = await fromExpenses({ year: 2026, month: 4 })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, count: 2, already_budgeted: 0 })
    expect(await budgets()).toEqual({ [`2026-04:${FOOD}`]: 120.55, [`2026-04:${CAR}`]: 50 })
  })

  it('keeps a budget the month already has, and sets only the categories without one', async () => {
    await budget(FOOD, 450, '2026-04-01')
    await budget(GYM, 30, '2026-04-01')

    const res = await fromExpenses({ year: 2026, month: 4 })
    expect(res.status).toBe(200)
    const answer = await res.json()
    expect(await budgets()).toEqual({
      [`2026-04:${FOOD}`]: 450,
      [`2026-04:${GYM}`]: 30,
      [`2026-04:${CAR}`]: 50,
    })
    expect(answer).toEqual({ ok: true, count: 1, already_budgeted: 1 })
  })

  it('sets nothing a second time, and says every category was already there', async () => {
    await fromExpenses({ year: 2026, month: 4 })
    const db = await getDB()
    const food = (
      (await db.getAllFromIndex('budgets', 'by_profile', 1)) as Array<Record<string, unknown>>
    ).find((row) => row.category_id === FOOD)!
    await db.put('budgets', { ...food, amount: 400 } as never)

    const res = await fromExpenses({ year: 2026, month: 4 })
    const answer = await res.json()
    expect(await budgets()).toEqual({ [`2026-04:${FOOD}`]: 400, [`2026-04:${CAR}`]: 50 })
    expect(answer).toEqual({ ok: true, count: 0, already_budgeted: 2 })
  })

  it('leaves the budgets of other months alone', async () => {
    await budget(FOOD, 300, '2026-03-01')
    await budget(FOOD, 500, '2026-05-01')
    await fromExpenses({ year: 2026, month: 4 })
    const after = await budgets()
    expect(after[`2026-03:${FOOD}`]).toBe(300)
    expect(after[`2026-05:${FOOD}`]).toBe(500)
  })

  it('reads December for January', async () => {
    await expense('2025-12-24', 80, FOOD)
    const res = await fromExpenses({ year: 2026, month: 1 })
    expect(await res.json()).toEqual({ ok: true, count: 1, already_budgeted: 0 })
    expect(await budgets()).toEqual({ [`2026-01:${FOOD}`]: 80 })
  })

  it('sets a budget to the cent', async () => {
    await expense('2026-03-15', 0.1, GYM)
    await expense('2026-03-16', 0.2, GYM)
    await fromExpenses({ year: 2026, month: 4 })
    // The stored number as it is written: 0.1 + 0.2 is 0.30000000000000004.
    expect(String((await budgets())[`2026-04:${GYM}`])).toBe('0.3')
  })

  it('answers ok: false when last month has no spending, and writes nothing', async () => {
    await budget(FOOD, 450, '2026-06-01')
    const res = await fromExpenses({ year: 2026, month: 6 })
    expect(res.status).toBe(200)
    const answer = (await res.json()) as { ok: boolean; message?: string }
    expect(answer.ok).toBe(false)
    expect(await budgets()).toEqual({ [`2026-06:${FOOD}`]: 450 })
  })
})
