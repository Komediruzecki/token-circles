/**
 * What local-first's retirement goal routes refuse, and how they say it: the same 400
 * `{ error, fields }` as the Worker, by the same rules (shared/retirementGoalSchema.ts).
 *
 * Before, local-first checked only that a name and a target were sent, saved a 0 % return as 7 %,
 * stored a goal sent without ages as a 30-year-old retiring at 65, and stored anything else as
 * sent. The Worker twin: worker/test/retirement-goal-refusals.test.ts.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { RETIREMENT_GOAL_MESSAGES as M } from '../../../../../shared/retirementGoalSchema'
import { getDB } from '../idb'
import { routeApiRequest } from '../localApiRouter'

const OLD = 1 // stored under no rules at all
const THEIRS = 2 // the other profile's

const PAGE = {
  name: 'Retire at 60',
  target_amount: 750000,
  current_amount: 42000.5,
  target_date: '2050-01-01',
  monthly_contribution: 1200,
  expected_return_rate: 6.5,
  current_age: 38,
  retirement_age: 60,
}

const LONG_NAME = 'Retire by the sea, '.repeat(7).trim()

const OLD_ROW = {
  name: LONG_NAME,
  target_amount: 0,
  current_amount: 15000.555,
  deadline: null,
  notes: '',
  current_age: 0,
  retirement_age: 400,
  monthly_contribution: 0,
  expected_return_rate: 35,
}
const OLD_SENT_BACK = {
  name: LONG_NAME,
  target_amount: 0,
  current_amount: 15000.555,
  target_date: '',
  monthly_contribution: 0,
  expected_return_rate: 35,
  current_age: 0,
  retirement_age: 400,
}

async function call(method: string, path: string, body?: unknown): Promise<Response> {
  return routeApiRequest(`http://localhost/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

type Row = Record<string, unknown>

async function stored(id: number): Promise<Row | undefined> {
  const row = (await (await getDB()).get('retirement_goals', id)) as Row | undefined
  if (!row) return undefined
  const { id: _id, created_at: _created, ...rest } = row
  return rest
}

async function count(): Promise<number> {
  return (await (await getDB()).getAll('retirement_goals')).length
}

async function refusal(res: Response, fields: Record<string, string>): Promise<void> {
  expect(res.status).toBe(400)
  const body = (await res.json()) as { error: string; fields: Record<string, string> }
  expect(body.fields).toEqual(fields)
  expect(body.error).toBe(Object.values(fields).join(' '))
}

beforeEach(async () => {
  localStorage.clear()
  localStorage.setItem('finance_storage_mode', 'serverless')
  localStorage.setItem('currentProfileId', '1')
  const db = await getDB()
  for (const store of Array.from(db.objectStoreNames)) await db.clear(store)
  await db.add('profiles', { id: 1, name: 'Me', created_at: '2026-01-01T00:00:00.000Z' })
  await db.add('profiles', { id: 2, name: 'Partner', created_at: '2026-01-01T00:00:00.000Z' })
  const created_at = '2026-01-01T00:00:00.000Z'
  await db.add('retirement_goals', { id: OLD, profile_id: 1, ...OLD_ROW, created_at } as never)
  await db.add('retirement_goals', { id: THEIRS, profile_id: 2, ...OLD_ROW, created_at } as never)
})

describe('POST /retirement-goals', () => {
  it('stores the goal the page sends, and answers what it stored', async () => {
    const res = await call('POST', '/retirement-goals', { ...PAGE, name: ' Retire at 60 ' })
    expect(res.status).toBe(200)
    const answer = (await res.json()) as { id: number }
    expect(answer).toEqual({
      id: expect.any(Number),
      name: 'Retire at 60',
      target_amount: 750000,
      current_amount: 42000.5,
      deadline: '2050-01-01',
      notes: '',
      profile_id: 1,
    })
    expect(await stored(answer.id)).toEqual({
      name: 'Retire at 60',
      target_amount: 750000,
      current_amount: 42000.5,
      deadline: '2050-01-01',
      notes: '',
      current_age: 38,
      retirement_age: 60,
      monthly_contribution: 1200,
      expected_return_rate: 6.5,
      profile_id: 1,
    })
  })

  it('keeps a 0 % return at 0 %', async () => {
    const res = await call('POST', '/retirement-goals', { ...PAGE, expected_return_rate: 0 })
    expect(res.status).toBe(200)
    const { id } = (await res.json()) as { id: number }
    expect((await stored(id))?.expected_return_rate).toBe(0)
  })

  it('refuses a goal without the ages and the return, where it used to store guesses', async () => {
    await refusal(
      await call('POST', '/retirement-goals', {
        ...PAGE,
        current_age: null,
        retirement_age: null,
        expected_return_rate: null,
      }),
      {
        current_age: M.currentAge,
        retirement_age: M.retirementAge,
        expected_return_rate: M.returnRate,
      }
    )
    expect(await count()).toBe(2)
  })

  it('says what is wrong at each field, and stores nothing', async () => {
    await refusal(
      await call('POST', '/retirement-goals', {
        ...PAGE,
        name: '',
        target_amount: 'lots',
        current_amount: -1,
        target_date: '2050-02-30',
        current_age: 400,
        expected_return_rate: 25,
      }),
      {
        name: M.name,
        target_amount: M.targetNumber,
        current_amount: M.current,
        deadline: M.deadline,
        current_age: M.currentAge,
        expected_return_rate: M.returnRange,
      }
    )
    expect(await count()).toBe(2)
  })
})

describe('PUT /retirement-goals/:id', () => {
  it('renames a goal stored under no rules, and changes nothing it sends back as it was', async () => {
    const res = await call('PUT', `/retirement-goals/${OLD}`, {
      ...OLD_SENT_BACK,
      name: 'By the sea',
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(await stored(OLD)).toEqual({ ...OLD_ROW, name: 'By the sea', profile_id: 1 })
  })

  it('changes only what it is sent', async () => {
    expect((await call('PUT', `/retirement-goals/${OLD}`, { name: 'By the sea' })).status).toBe(200)
    expect(await stored(OLD)).toEqual({ ...OLD_ROW, name: 'By the sea', profile_id: 1 })
  })

  it('saves a change to 0 % as 0 %', async () => {
    const res = await call('PUT', `/retirement-goals/${OLD}`, {
      ...OLD_SENT_BACK,
      expected_return_rate: 0,
    })
    expect(res.status).toBe(200)
    expect((await stored(OLD))?.expected_return_rate).toBe(0)
  })

  it('refuses what a change gets wrong, at its field, and writes nothing', async () => {
    await refusal(
      await call('PUT', `/retirement-goals/${OLD}`, {
        ...OLD_SENT_BACK,
        name: 'By the sea',
        retirement_age: 140,
        monthly_contribution: 'some',
      }),
      { retirement_age: M.retirementAge, monthly_contribution: M.monthly }
    )
    expect(await stored(OLD)).toEqual({ ...OLD_ROW, profile_id: 1 })
  })

  it("answers 404 for a goal the profile does not have, another profile's included", async () => {
    for (const id of [THEIRS, 999999]) {
      const res = await call('PUT', `/retirement-goals/${id}`, PAGE)
      expect(res.status).toBe(404)
      expect(await res.json()).toEqual({ error: 'Retirement goal not found' })
    }
    expect((await stored(THEIRS))?.name).toBe(LONG_NAME)
  })
})

describe('DELETE /retirement-goals/:id', () => {
  it("answers 404 for a goal the profile does not have, another profile's included", async () => {
    for (const id of [THEIRS, 999999]) {
      const res = await call('DELETE', `/retirement-goals/${id}`)
      expect(res.status).toBe(404)
      expect(await res.json()).toEqual({ error: 'Retirement goal not found' })
    }
    expect(await stored(THEIRS)).toBeDefined()
  })
})
