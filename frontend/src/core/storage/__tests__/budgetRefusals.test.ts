/**
 * What the local-first router refuses for a budget, and how it says it: the twin of
 * worker/test/budget-refusals.test.ts, by the same rules (shared/budgetSchema.ts), through
 * `routeApiRequest`, the router `apiFetch` calls.
 *
 * Where local-first used to differ from the Worker:
 *
 * - It required a period and a start date, and answered zod's words without a field the form
 *   could place.
 * - It stored the body as it came, keys the app never reads included.
 * - Allocating took any amount, any month and another profile's category; a rollover change took
 *   any value.
 * - An edit checked every field the form sent, so a row an import stored under older rules could
 *   not be edited at all.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { BUDGET_MESSAGES as M } from '../../../../../shared/budgetSchema'
import { getDB } from '../idb'

let routeApiRequest: (url: string, init?: RequestInit) => Promise<Response>

beforeAll(async () => {
  routeApiRequest = (await import('../localApiRouter')).routeApiRequest
}, 120_000)

const OTHER_PROFILE = 2
const FOOD = 11
const RENT = 12
const ELSEWHERE = 13 // another profile's
const PLAIN = 41
const OLD = 42 // three decimals, a start date in another format, a period no screen offers

beforeEach(async () => {
  localStorage.clear()
  localStorage.setItem('currentProfileId', '1')
  const db = await getDB()
  for (const store of ['profiles', 'categories', 'budgets'] as const) await db.clear(store)
  await db.add('profiles', { id: 1, name: 'Me', created_at: '2026-01-01T00:00:00.000Z' })
  await db.add('profiles', { id: OTHER_PROFILE, name: 'Else', created_at: '2026-01-01' })
  const category = (id: number, profile: number, name: string) =>
    db.add('categories', {
      id,
      profile_id: profile,
      name,
      type: 'expense',
      color: '#F97316',
    } as never)
  await category(FOOD, 1, 'Food')
  await category(RENT, 1, 'Rent')
  await category(ELSEWHERE, OTHER_PROFILE, 'Elsewhere')
  const budget = (id: number, values: Record<string, unknown>) =>
    db.add('budgets', {
      id,
      profile_id: 1,
      category_id: FOOD,
      amount: 250,
      period: 'monthly',
      start_date: '2026-10-01',
      end_date: null,
      rollover_enabled: false,
      rollover_amount: 0,
      created_at: '2026-10-01T00:00:00.000Z',
      ...values,
    } as never)
  await budget(PLAIN, {})
  await budget(OLD, {
    category_id: RENT,
    amount: 10.555,
    start_date: '01.10.2026',
    period: 'quarterly',
  })
})

afterEach(() => {
  vi.useRealTimers()
})

async function call(method: string, path: string, body?: unknown): Promise<Response> {
  return routeApiRequest(path, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

async function refusal(res: Response): Promise<{ status: number; body: unknown }> {
  return { status: res.status, body: await res.json() }
}

async function stored(id: number): Promise<Record<string, unknown> | undefined> {
  return (await getDB()).get('budgets', id)
}

async function count(): Promise<number> {
  return (await (await getDB()).getAllFromIndex('budgets', 'by_profile', 1)).length
}

describe('POST /api/budgets', () => {
  it('refuses a body without a category or an amount, at each field', async () => {
    expect(await refusal(await call('POST', '/api/budgets', {}))).toEqual({
      status: 400,
      body: {
        error: `${M.category} ${M.amount}`,
        fields: { category_id: M.category, amount: M.amount },
      },
    })
    expect(await count()).toBe(2)
  })

  it('refuses an amount that is text, below zero or past the cent', async () => {
    for (const [amount, message] of [
      ['12abc', M.amountNumber],
      [-5, M.amountNegative],
      [12.345, M.amountCents],
    ] as const) {
      const res = await call('POST', '/api/budgets', { category_id: FOOD, amount })
      expect(await refusal(res)).toEqual({
        status: 400,
        body: { error: message, fields: { amount: message } },
      })
    }
    expect(await count()).toBe(2)
  })

  it("refuses another profile's category at its field", async () => {
    const res = await call('POST', '/api/budgets', { category_id: ELSEWHERE, amount: 10 })
    expect(await refusal(res)).toEqual({
      status: 400,
      body: { error: M.category, fields: { category_id: M.category } },
    })
  })

  it('starts a budget sent without a start date on the first of this month, and stores only its fields', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 15, 12))
    const res = await call('POST', '/api/budgets', {
      category_id: RENT,
      amount: '900',
      spent: 12,
    })
    expect(res.status).toBe(201)
    const { id } = (await res.json()) as { id: number }
    const row = await stored(id)
    expect(row).toMatchObject({
      category_id: RENT,
      amount: 900,
      period: 'monthly',
      start_date: '2026-10-01',
      end_date: null,
      rollover_enabled: false,
    })
    expect(row).not.toHaveProperty('spent')
  })

  it('refuses an end date before the start date', async () => {
    const res = await call('POST', '/api/budgets', {
      category_id: FOOD,
      amount: 10,
      start_date: '2026-10-01',
      end_date: '2026-09-30',
    })
    expect(await refusal(res)).toEqual({
      status: 400,
      body: { error: M.endDate, fields: { end_date: M.endDate } },
    })
  })
})

describe('PUT /api/budgets/:id', () => {
  it('changes only what it sends', async () => {
    expect((await call('PUT', `/api/budgets/${PLAIN}`, { rollover_enabled: true })).status).toBe(
      200
    )
    expect(await stored(PLAIN)).toMatchObject({
      amount: 250,
      start_date: '2026-10-01',
      rollover_enabled: true,
    })
  })

  it('saves a row an older version stored, when its values come back unchanged', async () => {
    const res = await call('PUT', `/api/budgets/${OLD}`, {
      category_id: RENT,
      amount: 10.555,
      period: 'quarterly',
      start_date: '01.10.2026',
      rollover_enabled: true,
    })
    expect(res.status).toBe(200)
    expect(await stored(OLD)).toMatchObject({
      amount: 10.555,
      start_date: '01.10.2026',
      period: 'quarterly',
      rollover_enabled: true,
    })
  })

  it('refuses what an edit changes to a value the rules do not take', async () => {
    const res = await call('PUT', `/api/budgets/${OLD}`, { amount: 10.556, start_date: '' })
    expect(await refusal(res)).toEqual({
      status: 400,
      body: {
        error: `${M.amountCents} ${M.startDate}`,
        fields: { amount: M.amountCents, start_date: M.startDate },
      },
    })
    expect(await stored(OLD)).toMatchObject({ amount: 10.555, start_date: '01.10.2026' })
  })

  it("refuses another profile's category at its field", async () => {
    const res = await call('PUT', `/api/budgets/${PLAIN}`, { category_id: ELSEWHERE })
    expect(await refusal(res)).toEqual({
      status: 400,
      body: { error: M.category, fields: { category_id: M.category } },
    })
  })

  it('answers 404 for a budget the profile does not have', async () => {
    expect((await call('PUT', '/api/budgets/999', { amount: 1 })).status).toBe(404)
  })
})

describe('POST /api/budgets/allocate', () => {
  it('refuses a body without a category or with a bad amount, at each field', async () => {
    const res = await call('POST', '/api/budgets/allocate?month=2026-10', { amount: -1 })
    expect(await refusal(res)).toEqual({
      status: 400,
      body: {
        error: `${M.category} ${M.amountNegative}`,
        fields: { category_id: M.category, amount: M.amountNegative },
      },
    })
  })

  it('refuses a month it cannot read', async () => {
    const res = await call('POST', '/api/budgets/allocate?month=March', {
      category_id: FOOD,
      amount: 10,
    })
    expect(await refusal(res)).toEqual({
      status: 400,
      body: { error: M.month, fields: { month: M.month } },
    })
  })

  it("refuses another profile's category at its field", async () => {
    const res = await call('POST', '/api/budgets/allocate?month=2026-10', {
      category_id: ELSEWHERE,
      amount: 10,
    })
    expect(await refusal(res)).toEqual({
      status: 400,
      body: { error: M.category, fields: { category_id: M.category } },
    })
  })

  it("sets the month's budget, and changes it when allocated again", async () => {
    const first = await call('POST', '/api/budgets/allocate?month=2026-11', {
      category_id: FOOD,
      amount: '120.50',
    })
    expect(first.status).toBe(200)
    const { id } = (await first.json()) as { id: number }
    await call('POST', '/api/budgets/allocate?month=2026-11', { category_id: FOOD, amount: 99 })
    expect(await stored(id)).toMatchObject({ amount: 99, start_date: '2026-11-01' })
    expect(await count()).toBe(3)
  })

  // A budget can start mid-month: one an API client or an import set. Allocate found the month's
  // budget by its first day only, so it added a second budget for the category that month.
  it('changes the budget the month has when it starts mid-month, instead of adding one', async () => {
    const mid = (await (
      await getDB()
    ).add('budgets', {
      profile_id: 1,
      category_id: RENT,
      amount: 200,
      period: 'monthly',
      start_date: '2026-11-15',
      end_date: null,
      rollover_enabled: false,
      rollover_amount: 0,
      created_at: '2026-11-15T00:00:00.000Z',
    } as never)) as number

    const res = await call('POST', '/api/budgets/allocate?month=2026-11', {
      category_id: RENT,
      amount: 300,
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      id: mid,
      amount: 300,
      start_date: '2026-11-15',
      message: 'Budget updated successfully',
    })
    expect(await stored(mid)).toMatchObject({ amount: 300, start_date: '2026-11-15' })
    expect(await count()).toBe(3)
  })
})

describe('PUT /api/budgets/:id/rollover', () => {
  it('refuses values it cannot store, at each field', async () => {
    const res = await call('PUT', `/api/budgets/${PLAIN}/rollover`, {
      rollover_enabled: 'maybe',
      rollover_used: -1,
    })
    expect(await refusal(res)).toEqual({
      status: 400,
      body: {
        error: `${M.rollover} ${M.rolloverUsed}`,
        fields: { rollover_enabled: M.rollover, rollover_used: M.rolloverUsed },
      },
    })
  })

  it('refuses a body that changes nothing', async () => {
    const res = await call('PUT', `/api/budgets/${PLAIN}/rollover`, {})
    expect(await refusal(res)).toEqual({
      status: 400,
      body: { error: M.rolloverNothing, fields: { rollover_enabled: M.rolloverNothing } },
    })
  })

  it('turns rollover on', async () => {
    const res = await call('PUT', `/api/budgets/${PLAIN}/rollover`, { rollover_enabled: true })
    expect(res.status).toBe(200)
    expect(await stored(PLAIN)).toMatchObject({ rollover_enabled: true })
  })
})
