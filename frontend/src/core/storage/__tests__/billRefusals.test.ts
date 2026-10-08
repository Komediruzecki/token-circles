/**
 * What the local-first router refuses for a bill, and how it says it: the twin of
 * worker/test/bill-refusals.test.ts, by the same rules (shared/billSchema.ts), through
 * `routeApiRequest`, the router `apiFetch` calls.
 *
 * Where local-first used to differ from the Worker:
 *
 * - A bill without a due date was stored with an empty one, which no screen can draw.
 * - A bill saved without a day of the month stored 1, where the Worker stores none (the contract's
 *   `day-of-month-default`), so the same bill fell due on different days.
 * - The account a bill is paid from was dropped on create and on edit.
 * - An edit stored what it was sent: a blank name, an amount of text as NaN, any frequency.
 * - Its refusals said one sentence and named no field.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { BILL_MESSAGES as M } from '../../../../../shared/billSchema'
import { getDB } from '../idb'

let routeApiRequest: (url: string, init?: RequestInit) => Promise<Response>

beforeAll(async () => {
  routeApiRequest = (await import('../localApiRouter')).routeApiRequest
}, 120_000)

const OTHER_PROFILE = 2
const UTILITIES = 11
const ELSEWHERE_CATEGORY = 13 // another profile's
const GIRO = 21
const ELSEWHERE_ACCOUNT = 23 // another profile's
const PLAIN = 41
const OLD = 42 // an amount of 0, a frequency no screen offers, the day of the month an import kept
const ELSEWHERE_BILL = 43

beforeEach(async () => {
  localStorage.clear()
  localStorage.setItem('currentProfileId', '1')
  const db = await getDB()
  for (const store of ['profiles', 'categories', 'accounts', 'bills'] as const) {
    await db.clear(store)
  }
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
  await category(UTILITIES, 1, 'Utilities')
  await category(ELSEWHERE_CATEGORY, OTHER_PROFILE, 'Elsewhere')
  const account = (id: number, profile: number, name: string) =>
    db.add('accounts', {
      id,
      profile_id: profile,
      name,
      balance: 1000,
      starting_balance: 1000,
    } as never)
  await account(GIRO, 1, 'Giro')
  await account(ELSEWHERE_ACCOUNT, OTHER_PROFILE, 'Elsewhere')
  const bill = (id: number, values: Record<string, unknown>) =>
    db.add('bills', {
      id,
      profile_id: 1,
      name: 'Power',
      amount: 60,
      frequency: 'monthly',
      due_date: '2026-10-15',
      day_of_month: null,
      category_id: UTILITIES,
      account_id: null,
      last_paid_date: null,
      next_due_date: null,
      recurring: 1,
      autopay: 0,
      is_active: 1,
      notes: '',
      type: 'bill',
      created_at: '2026-10-01T00:00:00.000Z',
      ...values,
    } as never)
  await bill(PLAIN, {})
  await bill(OLD, { name: 'Old water', amount: 0, frequency: 'daily', day_of_month: 1 })
  await bill(ELSEWHERE_BILL, { profile_id: OTHER_PROFILE, category_id: ELSEWHERE_CATEGORY })
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
  return (await getDB()).get('bills', id)
}

const BILL = { name: 'Internet', amount: 39.99, dueDate: '2026-10-20' }

describe('POST /api/bills', () => {
  it('refuses a bill without a name, an amount or a due date, at each field', async () => {
    expect(await refusal(await call('POST', '/api/bills', {}))).toEqual({
      status: 400,
      body: {
        error: `${M.name} ${M.amount} ${M.dueDate}`,
        fields: { name: M.name, amount: M.amount, due_date: M.dueDate },
      },
    })
  })

  it('refuses an amount of zero or past the cent, a date that does not exist, and a frequency no screen offers', async () => {
    const res = await call('POST', '/api/bills', {
      ...BILL,
      amount: 0,
      dueDate: '2026-02-30',
      frequency: 'daily',
    })
    expect(await refusal(res)).toEqual({
      status: 400,
      body: {
        error: `${M.amountPositive} ${M.dueDateReal} ${M.frequency}`,
        fields: { amount: M.amountPositive, due_date: M.dueDateReal, frequency: M.frequency },
      },
    })
    const cents = await call('POST', '/api/bills', { ...BILL, amount: 9.999 })
    expect(await refusal(cents)).toEqual({
      status: 400,
      body: { error: M.amountCents, fields: { amount: M.amountCents } },
    })
  })

  it("refuses another profile's category or account at its field", async () => {
    const category = await call('POST', '/api/bills', {
      ...BILL,
      category_id: ELSEWHERE_CATEGORY,
    })
    expect(await refusal(category)).toEqual({
      status: 400,
      body: { error: M.category, fields: { category_id: M.category } },
    })
    const account = await call('POST', '/api/bills', { ...BILL, account_id: ELSEWHERE_ACCOUNT })
    expect(await refusal(account)).toEqual({
      status: 400,
      body: { error: M.account, fields: { account_id: M.account } },
    })
  })

  it('stores what the Bills form sends, its account included, and no day of the month it did not send', async () => {
    const res = await call('POST', '/api/bills', {
      ...BILL,
      category_id: UTILITIES,
      account_id: GIRO,
      frequency: 'monthly',
      autopay: true,
      type: 'subscription',
    })
    expect(res.status).toBe(201)
    const { id } = (await res.json()) as { id: number }
    expect(await stored(id)).toMatchObject({
      name: 'Internet',
      amount: 39.99,
      due_date: '2026-10-20',
      frequency: 'monthly',
      day_of_month: null,
      category_id: UTILITIES,
      account_id: GIRO,
      type: 'subscription',
      autopay: 1,
      is_active: 1,
    })
  })
})

describe('PUT /api/bills/:id', () => {
  it('changes only what it sends', async () => {
    expect((await call('PUT', `/api/bills/${PLAIN}`, { amount: '65.50' })).status).toBe(200)
    expect(await stored(PLAIN)).toMatchObject({
      name: 'Power',
      amount: 65.5,
      due_date: '2026-10-15',
      category_id: UTILITIES,
    })
  })

  it('saves a bill an older version stored, when its values come back unchanged', async () => {
    const res = await call('PUT', `/api/bills/${OLD}`, {
      name: 'Water',
      amount: 0,
      dueDate: '2026-10-15',
      category_id: UTILITIES,
      frequency: 'daily',
      autopay: false,
      type: 'bill',
    })
    expect(res.status).toBe(200)
    expect(await stored(OLD)).toMatchObject({ name: 'Water', amount: 0, frequency: 'daily' })
  })

  it('refuses what an edit changes to a value the rules do not take', async () => {
    const res = await call('PUT', `/api/bills/${OLD}`, { name: ' ', amount: -1 })
    expect(await refusal(res)).toEqual({
      status: 400,
      body: {
        error: `${M.name} ${M.amountPositive}`,
        fields: { name: M.name, amount: M.amountPositive },
      },
    })
    expect(await stored(OLD)).toMatchObject({ name: 'Old water', amount: 0 })
  })

  it("refuses another profile's category or account at its field", async () => {
    const res = await call('PUT', `/api/bills/${PLAIN}`, { account_id: ELSEWHERE_ACCOUNT })
    expect(await refusal(res)).toEqual({
      status: 400,
      body: { error: M.account, fields: { account_id: M.account } },
    })
  })

  it('moves a bill to an account of the profile', async () => {
    expect((await call('PUT', `/api/bills/${PLAIN}`, { account_id: GIRO })).status).toBe(200)
    expect(await stored(PLAIN)).toMatchObject({ account_id: GIRO })
  })

  it('pauses a bill', async () => {
    expect((await call('PUT', `/api/bills/${PLAIN}`, { is_active: false })).status).toBe(200)
    expect(await stored(PLAIN)).toMatchObject({ is_active: 0 })
  })

  it("answers 404 for a bill the profile does not have, another profile's included", async () => {
    expect((await call('PUT', '/api/bills/999', { name: 'x' })).status).toBe(404)
    expect((await call('PUT', `/api/bills/${ELSEWHERE_BILL}`, { name: 'x' })).status).toBe(404)
  })
})

describe('DELETE /api/bills/:id', () => {
  it("answers 404 for a bill the profile does not have, another profile's included, and deletes nothing", async () => {
    expect((await call('DELETE', '/api/bills/999')).status).toBe(404)
    expect((await call('DELETE', `/api/bills/${ELSEWHERE_BILL}`)).status).toBe(404)
    expect(await stored(ELSEWHERE_BILL)).toBeDefined()
  })

  it('deletes a bill the profile has', async () => {
    expect((await call('DELETE', `/api/bills/${PLAIN}`)).status).toBe(200)
    expect(await stored(PLAIN)).toBeUndefined()
  })
})
