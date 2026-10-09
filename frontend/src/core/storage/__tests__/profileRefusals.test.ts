/**
 * What the local-first router refuses for a profile, and how it says it: the twin of
 * worker/test/profile-refusals.test.ts, by the same rules (shared/profileSchema.ts), through
 * `routeApiRequest`, the router `apiFetch` calls.
 *
 * Where local-first used to differ from the Worker:
 *
 * - A blank name was "Profile name is required" or zod's words, with no field the dialog could
 *   place; a duplicate was compared exactly and refused with no field.
 * - A rename was stored as it came: blank, a duplicate, anything; it answered { ok: true }.
 * - Delete Profile answered 403 for every profile but the ones in use, so the Danger Zone could
 *   not delete another profile, and it deleted a person's last profile, leaving none.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PROFILE_MESSAGES as M } from '../../../../../shared/profileSchema'
import { getDB } from '../idb'

let routeApiRequest: (url: string, init?: RequestInit) => Promise<Response>

beforeAll(async () => {
  routeApiRequest = (await import('../localApiRouter')).routeApiRequest
}, 120_000)

const HOUSEHOLD = 1
const SIDE = 2
const OLD = 3 // a name over 100 characters, stored before the cap
const TWIN = 4 // "household ", which differs from Household only in case and space
const LONG = 'Weekend house by the lake '.repeat(5).trim()
const STORED = ['Household', 'Side business', LONG, 'household ']

beforeEach(async () => {
  localStorage.clear()
  localStorage.setItem('currentProfileId', String(HOUSEHOLD))
  localStorage.setItem('selectedProfileIds', JSON.stringify([HOUSEHOLD]))
  const db = await getDB()
  for (const store of ['profiles', 'accounts', 'transactions', 'budgets'] as const) {
    await db.clear(store)
  }
  const profile = (id: number, name: string, created_at: string) =>
    db.add('profiles', { id, name, created_at })
  await profile(HOUSEHOLD, 'Household', '2026-01-02T09:00:00.000Z')
  await profile(SIDE, 'Side business', '2026-01-03T09:00:00.000Z')
  await profile(OLD, LONG, '2026-01-04T09:00:00.000Z')
  await profile(TWIN, 'household ', '2026-01-05T09:00:00.000Z')
})

async function call(method: string, path: string, body?: unknown): Promise<Response> {
  return routeApiRequest(path, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

async function answer(res: Response): Promise<{ status: number; body: unknown }> {
  return { status: res.status, body: await res.json() }
}

async function names(): Promise<string[]> {
  const rows = (await (await getDB()).getAll('profiles')) as { name: string }[]
  return rows.map((p) => p.name)
}

const taken = (name: string) => ({
  status: 400,
  body: {
    error: `You already have a profile called "${name}". Choose another name.`,
    fields: { name: `You already have a profile called "${name}". Choose another name.` },
  },
})

describe('POST /api/profiles', () => {
  it('refuses a blank name at the field', async () => {
    for (const body of [{}, { name: '' }, { name: '   ' }, { name: 7 }]) {
      expect(await answer(await call('POST', '/api/profiles', body))).toEqual({
        status: 400,
        body: { error: M.name, fields: { name: M.name } },
      })
    }
    expect(await names()).toEqual(STORED)
  })

  it('refuses a name over 100 characters', async () => {
    expect(await answer(await call('POST', '/api/profiles', { name: 'x'.repeat(101) }))).toEqual({
      status: 400,
      body: { error: M.nameLength, fields: { name: M.nameLength } },
    })
    expect(await names()).toEqual(STORED)
  })

  it('refuses a name another profile has in another case, quoting it', async () => {
    expect(await answer(await call('POST', '/api/profiles', { name: ' SIDE BUSINESS ' }))).toEqual(
      taken('Side business')
    )
    expect(await names()).toEqual(STORED)
  })

  it('answers 201 with the new profile and its empty counts', async () => {
    const res = await call('POST', '/api/profiles', { name: '  Holiday house ' })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { id: number; created_at: string }
    expect(body).toEqual({
      id: expect.any(Number),
      name: 'Holiday house',
      created_at: expect.any(String),
      transaction_count: 0,
      account_count: 0,
      budget_count: 0,
    })
    expect(await names()).toEqual([...STORED, 'Holiday house'])
    const row = await (await getDB()).get('profiles', body.id)
    expect(row).toEqual({ id: body.id, name: 'Holiday house', created_at: body.created_at })
  })
})

describe('renaming a profile', () => {
  for (const method of ['PUT', 'PATCH']) {
    it(`${method} refuses a blank name, and a body without one`, async () => {
      for (const body of [{ name: ' ' }, {}]) {
        expect(await answer(await call(method, `/api/profiles/${SIDE}`, body))).toEqual({
          status: 400,
          body: { error: M.name, fields: { name: M.name } },
        })
      }
      expect(await names()).toEqual(STORED)
    })

    it(`${method} refuses another profile's name in another case`, async () => {
      expect(
        await answer(await call(method, `/api/profiles/${SIDE}`, { name: 'HOUSEHOLD' }))
      ).toEqual(taken('Household'))
      expect(await names()).toEqual(STORED)
    })
  }

  it('answers the renamed profile', async () => {
    expect(
      await answer(await call('PUT', `/api/profiles/${SIDE}`, { name: ' Freelance ' }))
    ).toEqual({
      status: 200,
      body: { id: SIDE, name: 'Freelance', created_at: '2026-01-03T09:00:00.000Z' },
    })
    expect(await names()).toEqual(['Household', 'Freelance', LONG, 'household '])
  })

  it('saves a re-cased name of its own', async () => {
    const res = await call('PUT', `/api/profiles/${SIDE}`, { name: 'SIDE Business' })
    expect(res.status).toBe(200)
    expect(await names()).toEqual(['Household', 'SIDE Business', LONG, 'household '])
  })

  it('saves an older name over 100 characters sent back, and refuses a change to it', async () => {
    expect((await call('PUT', `/api/profiles/${OLD}`, { name: LONG })).status).toBe(200)
    expect(await answer(await call('PUT', `/api/profiles/${OLD}`, { name: `${LONG}!` }))).toEqual({
      status: 400,
      body: { error: M.nameLength, fields: { name: M.nameLength } },
    })
    expect(await names()).toEqual(STORED)
  })

  it("refuses re-casing a twin onto the other twin's exact name", async () => {
    expect(await answer(await call('PUT', `/api/profiles/${TWIN}`, { name: 'Household' }))).toEqual(
      taken('Household')
    )
    expect((await call('PUT', `/api/profiles/${TWIN}`, { name: 'HOUSEHOLD' })).status).toBe(200)
    expect(await names()).toEqual(['Household', 'Side business', LONG, 'HOUSEHOLD'])
  })

  it('answers 404 for a profile that is not there', async () => {
    expect(await answer(await call('PUT', '/api/profiles/99', { name: 'Mine now' }))).toEqual({
      status: 404,
      body: { error: M.notFound },
    })
    expect(await names()).toEqual(STORED)
  })
})

describe('deleting a profile', () => {
  it('deletes one that is not in use, with its rows, and leaves the selection alone', async () => {
    const db = await getDB()
    await db.add('accounts', { id: 31, profile_id: SIDE, name: 'Invoices', balance: 10 } as never)
    await db.add('accounts', {
      id: 32,
      profile_id: HOUSEHOLD,
      name: 'Everyday',
      balance: 5,
    } as never)

    expect(await answer(await call('DELETE', `/api/profiles/${SIDE}`))).toEqual({
      status: 200,
      body: { ok: true },
    })
    expect(await names()).toEqual(['Household', LONG, 'household '])
    expect(((await db.getAll('accounts')) as { id: number }[]).map((a) => a.id)).toEqual([32])
    expect(localStorage.getItem('currentProfileId')).toBe(String(HOUSEHOLD))
    expect(localStorage.getItem('selectedProfileIds')).toBe(JSON.stringify([HOUSEHOLD]))
  })

  it('drops the one in use from the selection', async () => {
    localStorage.setItem('selectedProfileIds', JSON.stringify([HOUSEHOLD, SIDE]))
    expect((await call('DELETE', `/api/profiles/${HOUSEHOLD}`)).status).toBe(200)
    expect(localStorage.getItem('currentProfileId')).toBeNull()
    expect(localStorage.getItem('selectedProfileIds')).toBe(JSON.stringify([SIDE]))
  })

  it('refuses the last one, in words that say how to get past it, and keeps its rows', async () => {
    for (const id of [SIDE, OLD, TWIN]) {
      expect((await call('DELETE', `/api/profiles/${id}`)).status).toBe(200)
    }
    const db = await getDB()
    await db.add('accounts', {
      id: 33,
      profile_id: HOUSEHOLD,
      name: 'Everyday',
      balance: 5,
    } as never)
    expect(await answer(await call('DELETE', `/api/profiles/${HOUSEHOLD}`))).toEqual({
      status: 400,
      body: { error: M.onlyProfile },
    })
    expect(await names()).toEqual(['Household'])
    expect(await db.count('accounts')).toBe(1)
  })

  it('answers 404 for a profile that is not there', async () => {
    expect(await answer(await call('DELETE', '/api/profiles/99'))).toEqual({
      status: 404,
      body: { error: M.notFound },
    })
  })
})
