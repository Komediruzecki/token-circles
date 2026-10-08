/**
 * What the local-first router refuses for a savings goal, and how it says it: the twin of
 * worker/test/goal-refusals.test.ts, by the same rules (shared/goalSchema.ts), through
 * `routeApiRequest`, the router `apiFetch` calls.
 *
 * Where local-first used to differ from the Worker:
 *
 * - A goal saved without a monthly amount or a tracking date stored null and nothing, where the
 *   Worker stores 0 and today (the contract's `goal-unsent-defaults`).
 * - It stored the body as it came: the form's `target_date` beside `deadline`, keys the app never
 *   reads, a category of another profile answered without a field.
 * - A contribution sent as text was added as text: 100 and "50" made "10050".
 * - An edit checked every field the form sent, so a goal stored under older rules could not be
 *   renamed.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { GOAL_MESSAGES as M } from '../../../../../shared/goalSchema'
import { getDB } from '../idb'

let routeApiRequest: (url: string, init?: RequestInit) => Promise<Response>

beforeAll(async () => {
  routeApiRequest = (await import('../localApiRouter')).routeApiRequest
}, 120_000)

const OTHER_PROFILE = 2
const SAVINGS = 11
const ELSEWHERE = 13 // another profile's
const PLAIN = 41
const OLD = 42 // a target of zero and a name over 100 characters
const FORM_DATED = 43 // its date as the Goals page stored it, under target_date

const LONG_NAME = 'Round the world, '.repeat(7).trim()

beforeEach(async () => {
  localStorage.clear()
  localStorage.setItem('currentProfileId', '1')
  const db = await getDB()
  for (const store of ['profiles', 'categories', 'goals', 'transactions'] as const) {
    await db.clear(store)
  }
  await db.add('profiles', { id: 1, name: 'Me', created_at: '2026-01-01T00:00:00.000Z' })
  await db.add('profiles', { id: OTHER_PROFILE, name: 'Else', created_at: '2026-01-01' })
  await db.add('categories', {
    id: SAVINGS,
    profile_id: 1,
    name: 'Savings',
    type: 'expense',
    color: '#22C55E',
  } as never)
  await db.add('categories', {
    id: ELSEWHERE,
    profile_id: OTHER_PROFILE,
    name: 'Elsewhere',
    type: 'expense',
    color: '#22C55E',
  } as never)
  const goal = (id: number, values: Record<string, unknown>) =>
    db.add('goals', {
      id,
      profile_id: 1,
      name: 'Car',
      target_amount: 5000,
      current_amount: 1000,
      deadline: '2030-06-30',
      notes: '',
      category_id: null,
      monthly_contribution: 0,
      created_at: '2026-01-01T00:00:00.000Z',
      ...values,
    } as never)
  await goal(PLAIN, {})
  await goal(OLD, { name: LONG_NAME, target_amount: 0, deadline: null })
  await goal(FORM_DATED, { name: 'House', deadline: '2031-01-15', target_date: '2031-01-15' })
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
  return (await getDB()).get('goals', id)
}

describe('POST /api/savings-goals', () => {
  it('refuses a goal without a name or a target, at each field', async () => {
    expect(await refusal(await call('POST', '/api/savings-goals', { name: ' ' }))).toEqual({
      status: 400,
      body: { error: `${M.name} ${M.target}`, fields: { name: M.name, target_amount: M.target } },
    })
  })

  it('refuses a target of zero, of text, or past the cent', async () => {
    for (const [target_amount, message] of [
      [0, M.targetPositive],
      ['lots', M.targetNumber],
      [99.999, M.cents],
    ] as const) {
      const res = await call('POST', '/api/savings-goals', { name: 'Car', target_amount })
      expect(await refusal(res)).toEqual({
        status: 400,
        body: { error: message, fields: { target_amount: message } },
      })
    }
  })

  it("refuses another profile's category at its field", async () => {
    const res = await call('POST', '/api/savings-goals', {
      name: 'Car',
      target_amount: 100,
      category_id: ELSEWHERE,
    })
    expect(await refusal(res)).toEqual({
      status: 400,
      body: { error: M.category, fields: { category_id: M.category } },
    })
  })

  it('stores what the Goals form sends, with the defaults for what it leaves out', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 8, 12))
    const res = await call('POST', '/api/savings-goals', {
      name: 'Holiday',
      target_amount: 1200.5,
      target_date: '2027-06-30',
      monthly_contribution: null,
      category_id: null,
    })
    expect(res.status).toBe(201)
    const { id } = (await res.json()) as { id: number }
    const row = await stored(id)
    expect(row).toMatchObject({
      name: 'Holiday',
      target_amount: 1200.5,
      current_amount: 0,
      deadline: '2027-06-30',
      notes: '',
      category_id: null,
      monthly_contribution: 0,
      tracking_start_date: '2026-10-08',
    })
    expect(row).not.toHaveProperty('target_date')
  })
})

describe('PUT /api/savings-goals/:id', () => {
  it('changes only what it sends', async () => {
    expect((await call('PUT', `/api/savings-goals/${PLAIN}`, { name: 'New car' })).status).toBe(200)
    expect(await stored(PLAIN)).toMatchObject({
      name: 'New car',
      target_amount: 5000,
      current_amount: 1000,
      deadline: '2030-06-30',
    })
  })

  it('saves a goal an older version stored, when its values come back unchanged', async () => {
    const res = await call('PUT', `/api/savings-goals/${OLD}`, {
      name: LONG_NAME,
      target_amount: 0,
      target_date: '2031-01-01',
      monthly_contribution: null,
      category_id: null,
    })
    expect(res.status).toBe(200)
    expect(await stored(OLD)).toMatchObject({
      name: LONG_NAME,
      target_amount: 0,
      deadline: '2031-01-01',
    })
  })

  it('clears a date the Goals page stored as target_date', async () => {
    expect(
      (await call('PUT', `/api/savings-goals/${FORM_DATED}`, { target_date: '' })).status
    ).toBe(200)
    const row = await stored(FORM_DATED)
    expect(row?.deadline ?? null).toBeNull()
    expect(row?.target_date ?? null).toBeNull()
  })

  it('refuses what an edit changes to a value the rules do not take', async () => {
    const res = await call('PUT', `/api/savings-goals/${OLD}`, { target_amount: -1, name: '' })
    expect(await refusal(res)).toEqual({
      status: 400,
      body: {
        error: `${M.name} ${M.targetPositive}`,
        fields: { name: M.name, target_amount: M.targetPositive },
      },
    })
    expect(await stored(OLD)).toMatchObject({ name: LONG_NAME, target_amount: 0 })
  })

  it("refuses another profile's category at its field", async () => {
    const res = await call('PUT', `/api/savings-goals/${PLAIN}`, { category_id: ELSEWHERE })
    expect(await refusal(res)).toEqual({
      status: 400,
      body: { error: M.category, fields: { category_id: M.category } },
    })
  })

  it('answers 404 for a goal the profile does not have', async () => {
    expect((await call('PUT', '/api/savings-goals/999', { name: 'x' })).status).toBe(404)
  })
})

describe('POST /api/savings-goals/:id/contribute', () => {
  it('refuses an amount that is not more than zero, at its field, and adds nothing', async () => {
    for (const [amount, message] of [
      [undefined, M.contribution],
      ['fifty', M.contributionNumber],
      [0, M.contributionPositive],
      [-5, M.contributionPositive],
      [1.005, M.cents],
    ] as const) {
      const res = await call('POST', `/api/savings-goals/${PLAIN}/contribute`, { amount })
      expect(await refusal(res)).toEqual({
        status: 400,
        body: { error: message, fields: { amount: message } },
      })
    }
    expect(await stored(PLAIN)).toMatchObject({ current_amount: 1000 })
  })

  it('adds an amount sent as text as a number', async () => {
    const res = await call('POST', `/api/savings-goals/${PLAIN}/contribute`, { amount: '50' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, current_amount: 1050 })
    expect(await stored(PLAIN)).toMatchObject({ current_amount: 1050 })
  })

  it('adds to what is saved, to the cent', async () => {
    const db = await getDB()
    await db.put('goals', { ...(await stored(PLAIN)), current_amount: 0.1 } as never)
    const res = await call('POST', `/api/savings-goals/${PLAIN}/contribute`, { amount: 0.2 })
    const answer = (await res.json()) as { current_amount: number }
    expect(String(answer.current_amount)).toBe('0.3')
  })

  it('answers 404 for a goal the profile does not have', async () => {
    expect((await call('POST', '/api/savings-goals/999/contribute', { amount: 5 })).status).toBe(
      404
    )
  })
})
