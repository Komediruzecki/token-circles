/**
 * What the local-first router refuses for a recurring rule, and how it says it: the twin of
 * worker/test/recurring-refusals.test.ts, by the same rules (shared/recurringSchema.ts), through
 * `routeApiRequest`, the router `apiFetch` calls.
 *
 * Where local-first used to differ from the Worker:
 *
 * - Its zod schema said what was wrong in zod's terms, and ran on an edit too, where a type or a
 *   frequency an older version stored was refused for an edit that only changed the notes.
 * - Another profile's category or account was refused at no field.
 * - A rule saved without a day of the month stored 1 (the contract's `day-of-month-default`).
 * - Its pause switch was `is_active`, and its list kept a paused rule (`recurring-pause`).
 * - Populating a rule answered `{ ok }` alone (`recurring-populate-answer`), and the upcoming
 *   list answered the rules themselves (`recurring-upcoming`).
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { RECURRING_MESSAGES as M } from '../../../../../shared/recurringSchema'
import { localToday } from '../../../utils/period'
import { getDB } from '../idb'

let routeApiRequest: (url: string, init?: RequestInit) => Promise<Response>

beforeAll(async () => {
  routeApiRequest = (await import('../localApiRouter')).routeApiRequest
}, 120_000)

const OTHER_PROFILE = 2
const HOME = 31
const GIRO = 32
const SAVINGS = 33
const ELSEWHERE_CATEGORY = 34
const ELSEWHERE_ACCOUNT = 35
const RENT = 41
const OLD = 42 // no description, a type and a frequency no screen offers, another profile's account
const PAUSED = 43 // paused by an older version, with is_active
const ELSEWHERE_RULE = 44

const RENT_ROW = {
  description: 'Rent',
  amount: 850.5,
  type: 'expense',
  frequency: 'monthly',
  day_of_month: 1,
  next_date: '2026-03-01',
  category_id: HOME,
  account_id: GIRO,
  transfer_account_id: null,
  notes: 'Flat 4',
}

beforeEach(async () => {
  localStorage.clear()
  localStorage.setItem('currentProfileId', '1')
  const db = await getDB()
  for (const store of [
    'profiles',
    'categories',
    'accounts',
    'recurring',
    'transactions',
  ] as const) {
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
      color: '#f97316',
    } as never)
  const account = (id: number, profile: number, name: string) =>
    db.add('accounts', {
      id,
      profile_id: profile,
      name,
      type: 'giro',
      currency: 'EUR',
      balance: 1000,
      starting_balance: 1000,
    } as never)
  await category(HOME, 1, 'Home')
  await category(ELSEWHERE_CATEGORY, OTHER_PROFILE, 'Elsewhere')
  await account(GIRO, 1, 'Giro')
  await account(SAVINGS, 1, 'Savings')
  await account(ELSEWHERE_ACCOUNT, OTHER_PROFILE, 'Elsewhere')
  const rule = (id: number, profile: number, values: Record<string, unknown>) =>
    db.add('recurring', {
      id,
      profile_id: profile,
      ...RENT_ROW,
      created_at: '2026-01-01T00:00:00.000Z',
      ...values,
    } as never)
  await rule(RENT, 1, { active: 1 })
  await rule(OLD, 1, {
    description: '',
    type: 'deduction',
    frequency: 'biweekly',
    account_id: ELSEWHERE_ACCOUNT,
    notes: '',
    active: 1,
  })
  // Paused by an older version, which kept the switch in is_active and had no active.
  await rule(PAUSED, 1, { description: 'Paper', is_active: 0 })
  await rule(ELSEWHERE_RULE, OTHER_PROFILE, {
    category_id: ELSEWHERE_CATEGORY,
    account_id: ELSEWHERE_ACCOUNT,
    active: 1,
  })
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

/** The rule's stored fields, as the Worker test reads its columns. */
async function stored(id: number): Promise<Record<string, unknown> | undefined> {
  const row = (await (await getDB()).get('recurring', id)) as Record<string, unknown> | undefined
  if (!row) return undefined
  const picked: Record<string, unknown> = {}
  for (const key of [...Object.keys(RENT_ROW), 'active', 'is_active']) {
    if (key in row) picked[key] = row[key]
  }
  return picked
}

async function count(): Promise<number> {
  return (await (await getDB()).getAllFromIndex('recurring', 'by_profile', 1)).length
}

/** What the Recurring form posts. */
const FORM = {
  description: 'Gym',
  amount: 30,
  type: 'expense',
  frequency: 'monthly',
  day_of_month: null,
  next_date: '2026-03-05',
  account_id: GIRO,
  transfer_account_id: null,
  category_id: HOME,
  notes: null,
}

describe('POST /api/recurring', () => {
  it('refuses a rule without a description, an amount or a next date, at each field', async () => {
    expect(await refusal(await call('POST', '/api/recurring', {}))).toEqual({
      status: 400,
      body: {
        error: `${M.description} ${M.amount} ${M.nextDate}`,
        fields: { description: M.description, amount: M.amount, next_date: M.nextDate },
      },
    })
    expect(await count()).toBe(3)
  })

  it('refuses a type, a frequency, a day of the month and a next date it cannot use', async () => {
    const res = await call('POST', '/api/recurring', {
      ...FORM,
      type: 'deduction',
      frequency: 'fortnightly',
      day_of_month: 32,
      next_date: 'soon',
    })
    expect(await refusal(res)).toEqual({
      status: 400,
      body: {
        error: `${M.type} ${M.frequency} ${M.dayOfMonth} ${M.nextDateReal}`,
        fields: {
          type: M.type,
          frequency: M.frequency,
          day_of_month: M.dayOfMonth,
          next_date: M.nextDateReal,
        },
      },
    })
    expect(await count()).toBe(3)
  })

  it("refuses another profile's category and accounts at their fields", async () => {
    const res = await call('POST', '/api/recurring', {
      ...FORM,
      account_id: ELSEWHERE_ACCOUNT,
      category_id: ELSEWHERE_CATEGORY,
    })
    expect(await refusal(res)).toEqual({
      status: 400,
      body: {
        error: `${M.account} ${M.category}`,
        fields: { account_id: M.account, category_id: M.category },
      },
    })
    const transfer = await call('POST', '/api/recurring', {
      ...FORM,
      type: 'transfer',
      transfer_account_id: ELSEWHERE_ACCOUNT,
    })
    expect(await refusal(transfer)).toEqual({
      status: 400,
      body: { error: M.transferAccount, fields: { transfer_account_id: M.transferAccount } },
    })
    expect(await count()).toBe(3)
  })

  it('stores what the Recurring form sends, with no day of the month when it has none', async () => {
    const res = await call('POST', '/api/recurring', FORM)
    expect(res.status).toBe(201)
    const { id } = (await res.json()) as { id: number }
    expect(await stored(id)).toEqual({
      description: 'Gym',
      amount: 30,
      type: 'expense',
      frequency: 'monthly',
      day_of_month: null,
      next_date: '2026-03-05',
      category_id: HOME,
      account_id: GIRO,
      transfer_account_id: null,
      notes: '',
      active: 1,
    })
  })
})

describe('PUT /api/recurring/:id', () => {
  it('changes only what it sends', async () => {
    expect((await call('PUT', `/api/recurring/${RENT}`, { notes: 'Flat 5' })).status).toBe(200)
    expect((await call('PUT', `/api/recurring/${RENT}`, { amount: 900 })).status).toBe(200)
    expect(await stored(RENT)).toEqual({ ...RENT_ROW, amount: 900, notes: 'Flat 5', active: 1 })
  })

  it('refuses a blank description and an amount of zero at their fields, and stores nothing', async () => {
    const res = await call('PUT', `/api/recurring/${RENT}`, { description: ' ', amount: 0 })
    expect(await refusal(res)).toEqual({
      status: 400,
      body: {
        error: `${M.description} ${M.amountPositive}`,
        fields: { description: M.description, amount: M.amountPositive },
      },
    })
    expect(await stored(RENT)).toEqual({ ...RENT_ROW, active: 1 })
  })

  it("refuses another profile's account when the edit sets it, at its field", async () => {
    const res = await call('PUT', `/api/recurring/${RENT}`, { account_id: ELSEWHERE_ACCOUNT })
    expect(await refusal(res)).toEqual({
      status: 400,
      body: { error: M.account, fields: { account_id: M.account } },
    })
    expect(await stored(RENT)).toEqual({ ...RENT_ROW, active: 1 })
  })

  it('takes back what an older version stored, and changes what the edit changes', async () => {
    const res = await call('PUT', `/api/recurring/${OLD}`, {
      ...FORM,
      description: '',
      amount: 850.5,
      type: 'deduction',
      frequency: 'biweekly',
      day_of_month: 1,
      next_date: '2026-03-01',
      account_id: ELSEWHERE_ACCOUNT,
      notes: 'Still here',
    })
    expect(res.status).toBe(200)
    expect(await stored(OLD)).toMatchObject({
      description: '',
      type: 'deduction',
      frequency: 'biweekly',
      account_id: ELSEWHERE_ACCOUNT,
      notes: 'Still here',
    })
  })

  it('pauses a rule with active or is_active, and the list and upcoming leave it out', async () => {
    const listed = async () =>
      ((await (await call('GET', '/api/recurring')).json()) as { id: number }[]).map((r) => r.id)
    // A rule an older version paused with is_active is left out already.
    expect(await listed()).toEqual([RENT, OLD])

    expect((await call('PUT', `/api/recurring/${RENT}`, { is_active: false })).status).toBe(200)
    expect((await stored(RENT))?.active).toBe(0)
    expect(await listed()).toEqual([OLD])
    const upcoming = (await (await call('GET', '/api/recurring/upcoming')).json()) as {
      transactions: { id: number }[]
    }
    // A rule whose next date has passed is listed on today, so each of these would be here.
    const due = upcoming.transactions.map((t) => t.id)
    expect(due).toContain(OLD)
    expect(due).not.toContain(RENT)
    expect(due).not.toContain(PAUSED)

    expect((await call('PUT', `/api/recurring/${PAUSED}`, { active: true })).status).toBe(200)
    expect(await stored(PAUSED)).toMatchObject({ active: 1 })
    expect(await stored(PAUSED)).not.toHaveProperty('is_active')
    expect(await listed()).toEqual([OLD, PAUSED])
  })

  it("answers 404 for another profile's rule, and changes nothing", async () => {
    const res = await call('PUT', `/api/recurring/${ELSEWHERE_RULE}`, { notes: 'Mine now' })
    expect(await refusal(res)).toEqual({ status: 404, body: { error: M.notFound } })
    expect(await refusal(await call('POST', `/api/recurring/${ELSEWHERE_RULE}/populate`))).toEqual({
      status: 404,
      body: { error: M.notFound },
    })
    expect((await stored(ELSEWHERE_RULE))?.notes).toBe('Flat 4')
  })
})

describe('DELETE /api/recurring/:id', () => {
  it("answers 404 for a rule the profile does not have, another profile's included", async () => {
    expect(await refusal(await call('DELETE', `/api/recurring/${ELSEWHERE_RULE}`))).toEqual({
      status: 404,
      body: { error: M.notFound },
    })
    expect(await stored(ELSEWHERE_RULE)).toBeDefined()
    expect((await call('DELETE', `/api/recurring/${RENT}`)).status).toBe(200)
    expect(await refusal(await call('DELETE', `/api/recurring/${RENT}`))).toEqual({
      status: 404,
      body: { error: M.notFound },
    })
  })
})

describe('POST /api/recurring/:id/populate', () => {
  it('answers the transaction it added and the next date, and says a period already added', async () => {
    const today = localToday()
    await (
      await getDB()
    ).put('recurring', {
      id: RENT,
      profile_id: 1,
      ...RENT_ROW,
      next_date: today,
      active: 1,
    } as never)

    const res = await call('POST', `/api/recurring/${RENT}/populate`)
    expect(res.status).toBe(200)
    const ran = (await res.json()) as { ok: boolean; transactionId: number; next_date: string }
    expect(ran).toEqual({
      ok: true,
      transactionId: expect.any(Number),
      next_date: expect.any(String),
    })
    expect(ran.next_date > today).toBe(true)
    expect(await (await getDB()).get('transactions', ran.transactionId)).toMatchObject({
      description: 'Rent',
      date: today,
    })

    expect(await refusal(await call('POST', `/api/recurring/${RENT}/populate`))).toEqual({
      status: 409,
      body: { error: M.populated },
    })
  })
})
