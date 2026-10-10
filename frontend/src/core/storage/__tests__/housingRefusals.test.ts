/**
 * What the local-first router refuses for a housing expense, and how it says it: the twin of
 * worker/test/housing-refusals.test.ts, by the same rules (shared/housingSchema.ts), through
 * `routeApiRequest`, the router `apiFetch` calls.
 *
 * Where local-first used to differ from the Worker:
 *
 * - Its body check was registered under /api/housings, which nothing calls, so the handler's
 *   "Property name and a valid monthly amount are required" was all it ever said, at no field.
 * - An edit stored an amount of text as NaN, a blank name, and any type or due day.
 * - It kept the form's own fields (property_name, due_day, due_month) beside the columns, and
 *   listed them (the contract's `housing-answer-shape`).
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { HOUSING_MESSAGES as M } from '../../../../../shared/housingSchema'
import { localMonth } from '../../../utils/period'
import { getDB } from '../idb'

let routeApiRequest: (url: string, init?: RequestInit) => Promise<Response>

beforeAll(async () => {
  routeApiRequest = (await import('../localApiRouter')).routeApiRequest
}, 120_000)

const OTHER_PROFILE = 2
const FLAT = 41
const OLD = 42 // a name over 100 characters, an amount past the cent, and the form's own fields
const ELSEWHERE = 43
const LONG = 'The flat above the bakery on the corner of the square '.repeat(3).trim()

beforeEach(async () => {
  localStorage.clear()
  localStorage.setItem('currentProfileId', '1')
  const db = await getDB()
  for (const store of ['profiles', 'housings'] as const) await db.clear(store)
  await db.add('profiles', { id: 1, name: 'Me', created_at: '2026-01-01T00:00:00.000Z' })
  await db.add('profiles', { id: OTHER_PROFILE, name: 'Else', created_at: '2026-01-01' })
  const housing = (id: number, profile: number, values: Record<string, unknown>) =>
    db.add('housings', {
      id,
      profile_id: profile,
      name: 'Flat',
      type: 'rent',
      monthly_amount: 850.5,
      due_date: '04-05',
      autopay: 1,
      notes: 'To the landlord',
      created_at: '2026-01-01T00:00:00.000Z',
      ...values,
    } as never)
  await housing(FLAT, 1, {})
  await housing(OLD, 1, {
    name: LONG,
    monthly_amount: 10.555,
    autopay: 0,
    notes: '',
    property_name: LONG,
    due_day: 5,
    due_month: 4,
  })
  await housing(ELSEWHERE, OTHER_PROFILE, { name: 'Theirs' })
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
  return (await getDB()).get('housings', id)
}

async function count(): Promise<number> {
  return (await (await getDB()).getAllFromIndex('housings', 'by_profile', 1)).length
}

/** What the Housing form posts. */
const FORM = {
  type: 'mortgage',
  property_name: 'House by the river',
  monthly_amount: 1200.5,
  due_day: 20,
  due_month: 11,
  autopay: true,
  notes: 'Bank transfer',
}

describe('POST /api/housing', () => {
  it('refuses a body without a name or an amount, at each field', async () => {
    expect(await refusal(await call('POST', '/api/housing', {}))).toEqual({
      status: 400,
      body: {
        error: `${M.name} ${M.amount}`,
        fields: { property_name: M.name, monthly_amount: M.amount },
      },
    })
    expect(await count()).toBe(2)
  })

  it('refuses a type, an amount, a due month and a due day it cannot store', async () => {
    const res = await call('POST', '/api/housing', {
      ...FORM,
      type: 'castle',
      monthly_amount: 9.999,
      due_month: 13,
      due_day: 0,
    })
    expect(await refusal(res)).toEqual({
      status: 400,
      body: {
        error: `${M.type} ${M.amountCents} ${M.dueMonth} ${M.dueDay}`,
        fields: {
          type: M.type,
          monthly_amount: M.amountCents,
          due_month: M.dueMonth,
          due_day: M.dueDay,
        },
      },
    })
    expect(await count()).toBe(2)
  })

  it("stores what the Housing form sends as the Worker's columns, and answers 201 with its id", async () => {
    const res = await call('POST', '/api/housing', FORM)
    expect(res.status).toBe(201)
    const { id } = (await res.json()) as { id: number }
    expect(await stored(id)).toEqual({
      id,
      profile_id: 1,
      name: 'House by the river',
      type: 'mortgage',
      monthly_amount: 1200.5,
      due_date: '11-20',
      autopay: 1,
      notes: 'Bank transfer',
      created_at: expect.any(String),
    })
  })

  it("falls due in this month on the device's calendar when sent without a due month", async () => {
    const res = await call('POST', '/api/housing', { ...FORM, due_month: undefined, due_day: 15 })
    const { id } = (await res.json()) as { id: number }
    expect((await stored(id))?.due_date).toBe(`${localMonth().slice(5, 7)}-15`)
  })
})

describe('GET /api/housing', () => {
  it("answers the Worker's columns, with autopay as true or false, whatever an older row kept", async () => {
    const body = (await (await call('GET', '/api/housing')).json()) as {
      housings: Record<string, unknown>[]
    }
    const expected = {
      id: FLAT,
      profile_id: 1,
      name: 'Flat',
      type: 'rent',
      monthly_amount: 850.5,
      due_date: '04-05',
      autopay: true,
      notes: 'To the landlord',
      created_at: '2026-01-01T00:00:00.000Z',
    }
    expect(body.housings.find((h) => h.id === FLAT)).toEqual(expected)
    expect(Object.keys(body.housings.find((h) => h.id === OLD)!).sort()).toEqual(
      Object.keys(expected).sort()
    )
  })
})

describe('PUT /api/housing/:id', () => {
  it('changes only what it sends, the type too', async () => {
    expect((await call('PUT', `/api/housing/${FLAT}`, { notes: 'New lease' })).status).toBe(200)
    expect((await call('PUT', `/api/housing/${FLAT}`, { type: 'hoa' })).status).toBe(200)
    expect(await stored(FLAT)).toMatchObject({
      name: 'Flat',
      type: 'hoa',
      monthly_amount: 850.5,
      due_date: '04-05',
      autopay: 1,
      notes: 'New lease',
    })
  })

  it('moves the due date with the day it sends, keeping the month', async () => {
    expect((await call('PUT', `/api/housing/${FLAT}`, { due_day: 28 })).status).toBe(200)
    expect((await stored(FLAT))?.due_date).toBe('04-28')
  })

  it('refuses a blank name and an amount of zero at their fields, and stores nothing', async () => {
    const res = await call('PUT', `/api/housing/${FLAT}`, { property_name: ' ', monthly_amount: 0 })
    expect(await refusal(res)).toEqual({
      status: 400,
      body: {
        error: `${M.name} ${M.amountPositive}`,
        fields: { property_name: M.name, monthly_amount: M.amountPositive },
      },
    })
    expect((await stored(FLAT))?.name).toBe('Flat')
  })

  it("takes back what an older version stored, and drops the form's fields it kept", async () => {
    const res = await call('PUT', `/api/housing/${OLD}`, {
      type: 'rent',
      property_name: LONG,
      monthly_amount: 10.555,
      due_day: 5,
      due_month: 4,
      autopay: false,
      notes: 'Still here',
    })
    expect(res.status).toBe(200)
    const row = await stored(OLD)
    expect(row).toMatchObject({
      name: LONG,
      monthly_amount: 10.555,
      due_date: '04-05',
      autopay: 0,
      notes: 'Still here',
    })
    expect(row).not.toHaveProperty('property_name')
    expect(row).not.toHaveProperty('due_day')
    expect(row).not.toHaveProperty('due_month')
  })

  it("answers 404 for another profile's row, and changes nothing", async () => {
    const res = await call('PUT', `/api/housing/${ELSEWHERE}`, { notes: 'Mine now' })
    expect(await refusal(res)).toEqual({ status: 404, body: { error: M.notFound } })
    expect((await stored(ELSEWHERE))?.notes).toBe('To the landlord')
    expect(await refusal(await call('DELETE', `/api/housing/${ELSEWHERE}`))).toEqual({
      status: 404,
      body: { error: M.notFound },
    })
  })
})
