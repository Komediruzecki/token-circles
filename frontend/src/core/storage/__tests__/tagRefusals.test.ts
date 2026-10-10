/**
 * What the local-first router refuses for a tag, and how it says it: the twin of
 * worker/test/tag-refusals.test.ts, by the same rules (shared/tagSchema.ts), through
 * `routeApiRequest`, the router `apiFetch` calls.
 *
 * Where local-first used to differ from the Worker:
 *
 * - A tag sent without a colour was always #6e9bff (the contract's `tag-default-colour`).
 * - A rename onto another tag's name was stored, and the list then showed two tags of one name
 *   (`tag-rename-duplicate`); an edit stored a blank name, a name of any length and any colour.
 * - Another profile's tag put on a transaction was refused in other words than the Worker's.
 * - GET /api/transactions/by-tag/:tagId answered every tagged row in key order and read none of
 *   its filters (`transactions-by-tag`).
 * - Its refusals said one sentence and named no field.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { CONSTELLATION } from '../../../../../shared/palette'
import { TAG_MESSAGES as M } from '../../../../../shared/tagSchema'
import { getDB } from '../idb'

let routeApiRequest: (url: string, init?: RequestInit) => Promise<Response>

beforeAll(async () => {
  routeApiRequest = (await import('../localApiRouter')).routeApiRequest
}, 120_000)

const OTHER_PROFILE = 2
const HOLIDAY = 31
const TWIN = 32 // "holiday": stored before names were compared without case
const OLD = 33 // a name over 50 characters and the colour "red", stored before the rules
const WORK = 34
const ELSEWHERE = 35 // another profile's
const FOOD = 11
const FIRST = 51
const SECOND = 52
const THIRD = 53
const LONG = 'Weekend trips to the coast with the family '.repeat(2).trim()

beforeEach(async () => {
  localStorage.clear()
  localStorage.setItem('currentProfileId', '1')
  const db = await getDB()
  for (const store of ['profiles', 'categories', 'tags', 'transactions'] as const) {
    await db.clear(store)
  }
  await db.add('profiles', { id: 1, name: 'Me', created_at: '2026-01-01T00:00:00.000Z' })
  await db.add('profiles', { id: OTHER_PROFILE, name: 'Else', created_at: '2026-01-01' })
  await db.add('categories', {
    id: FOOD,
    profile_id: 1,
    name: 'Food',
    type: 'expense',
    color: '#aa5500',
    icon: 'tag',
  } as never)
  const tag = (id: number, profile: number, name: string, color: string) =>
    db.add('tags', { id, profile_id: profile, name, color, created_at: '2026-01-02' } as never)
  await tag(HOLIDAY, 1, 'Holiday', '#22aa66')
  await tag(TWIN, 1, 'holiday', '#225588')
  await tag(OLD, 1, LONG, 'red')
  await tag(WORK, 1, 'Work', '#aa5500')
  await tag(ELSEWHERE, OTHER_PROFILE, 'Elsewhere', '#000000')
  const spend = (id: number, date: string, type = 'expense', category_id: number | null = null) =>
    db.add('transactions', {
      id,
      profile_id: 1,
      description: 'Ferry',
      amount: 20,
      type,
      date,
      category_id,
      tag_ids: [],
      tags: [],
    } as never)
  await spend(FIRST, '2026-03-01', 'expense', FOOD)
  await spend(SECOND, '2026-03-31T12:00:00')
  await spend(THIRD, '2026-03-09', 'income')
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

async function stored(id: number): Promise<{ name: string; color: string } | undefined> {
  const tag = await (await getDB()).get('tags', id)
  return tag ? { name: tag.name as string, color: tag.color as string } : undefined
}

async function tagCount(): Promise<number> {
  return (await (await getDB()).getAllFromIndex('tags', 'by_profile', 1)).length
}

const taken = (name: string) => {
  const message = `You already have a tag called "${name}". Choose another name.`
  return { status: 400, body: { error: message, fields: { name: message } } }
}

describe('POST /api/tags', () => {
  it('refuses a blank name at the field', async () => {
    for (const body of [{}, { name: '' }, { name: '   ' }, { name: 7 }]) {
      expect(await refusal(await call('POST', '/api/tags', body))).toEqual({
        status: 400,
        body: { error: M.name, fields: { name: M.name } },
      })
    }
    expect(await tagCount()).toBe(4)
  })

  it('refuses a name over 50 characters and a colour that is not #RRGGBB', async () => {
    const res = await call('POST', '/api/tags', { name: 'x'.repeat(51), color: 'red' })
    expect(await refusal(res)).toEqual({
      status: 400,
      body: {
        error: `${M.nameLength} ${M.color}`,
        fields: { name: M.nameLength, color: M.color },
      },
    })
    expect(await tagCount()).toBe(4)
  })

  it('refuses a name another tag has in another case, quoting it', async () => {
    expect(await refusal(await call('POST', '/api/tags', { name: ' WORK ' }))).toEqual(
      taken('Work')
    )
    expect(await tagCount()).toBe(4)
  })

  it("takes a name only another profile's tag has", async () => {
    expect((await call('POST', '/api/tags', { name: 'Elsewhere' })).status).toBe(201)
  })

  it("gives a tag sent without a colour the one the Tags page offers next: the palette's, by the profile's tag count", async () => {
    const res = await call('POST', '/api/tags', { name: 'Groceries' })
    const { id, color } = (await res.json()) as { id: number; color: string }
    // Four tags of this profile's; the other profile's tag does not count.
    expect(color).toBe(CONSTELLATION[4])
    expect(await stored(id)).toEqual({ name: 'Groceries', color: CONSTELLATION[4] })
  })
})

describe('PUT /api/tags/:id', () => {
  it('keeps the colour when the edit leaves it out', async () => {
    expect((await call('PUT', `/api/tags/${WORK}`, { name: 'Office' })).status).toBe(200)
    expect(await stored(WORK)).toEqual({ name: 'Office', color: '#aa5500' })
  })

  it('refuses a blank or long name and a colour that is not #RRGGBB, and stores nothing', async () => {
    expect(await refusal(await call('PUT', `/api/tags/${WORK}`, { name: ' ' }))).toEqual({
      status: 400,
      body: { error: M.name, fields: { name: M.name } },
    })
    const long = await call('PUT', `/api/tags/${WORK}`, { name: 'x'.repeat(51), color: '#abc' })
    expect(await refusal(long)).toEqual({
      status: 400,
      body: {
        error: `${M.nameLength} ${M.color}`,
        fields: { name: M.nameLength, color: M.color },
      },
    })
    expect(await stored(WORK)).toEqual({ name: 'Work', color: '#aa5500' })
  })

  it("refuses a rename onto another tag's name in another case, quoting it", async () => {
    const res = await call('PUT', `/api/tags/${WORK}`, { name: 'holiday', color: '#aa5500' })
    expect(await refusal(res)).toEqual(taken('Holiday'))
    expect(await stored(WORK)).toEqual({ name: 'Work', color: '#aa5500' })
  })

  it('lets a tag change the case of its own name, unless a tag has exactly that name', async () => {
    expect((await call('PUT', `/api/tags/${WORK}`, { name: 'WORK' })).status).toBe(200)
    expect(await stored(WORK)).toEqual({ name: 'WORK', color: '#aa5500' })
    const twin = await call('PUT', `/api/tags/${TWIN}`, { name: 'Holiday', color: '#225588' })
    expect(await refusal(twin)).toEqual(taken('Holiday'))
    expect(await stored(TWIN)).toEqual({ name: 'holiday', color: '#225588' })
  })

  it('takes back what an older version stored, and changes what the edit changes', async () => {
    expect((await call('PUT', `/api/tags/${OLD}`, { name: LONG, color: 'red' })).status).toBe(200)
    expect((await call('PUT', `/api/tags/${OLD}`, { name: LONG, color: '#225588' })).status).toBe(
      200
    )
    expect(await stored(OLD)).toEqual({ name: LONG, color: '#225588' })
  })

  it("answers 404 for another profile's tag, and changes nothing", async () => {
    const res = await call('PUT', `/api/tags/${ELSEWHERE}`, { name: 'Mine', color: '#123456' })
    expect(await refusal(res)).toEqual({ status: 404, body: { error: M.notFound } })
    expect(await stored(ELSEWHERE)).toEqual({ name: 'Elsewhere', color: '#000000' })
  })
})

describe('PUT /api/transactions/:id/tags', () => {
  async function tagsOn(id: number): Promise<number[]> {
    const row = await (await getDB()).get('transactions', id)
    return [...((row?.tag_ids as number[]) ?? [])].sort((a, b) => a - b)
  }

  it('refuses anything but a list of tag ids at tagIds', async () => {
    for (const tagIds of [undefined, 'Holiday', HOLIDAY, [0], ['x']]) {
      expect(
        await refusal(await call('PUT', `/api/transactions/${FIRST}/tags`, { tagIds }))
      ).toEqual({ status: 400, body: { error: M.tagIds, fields: { tagIds: M.tagIds } } })
    }
  })

  it("refuses another profile's tag at tagIds, and stores none of the list", async () => {
    const res = await call('PUT', `/api/transactions/${FIRST}/tags`, {
      tagIds: [HOLIDAY, ELSEWHERE],
    })
    expect(await refusal(res)).toEqual({
      status: 400,
      body: { error: M.tagIds, fields: { tagIds: M.tagIds } },
    })
    expect(await tagsOn(FIRST)).toEqual([])
  })

  it("stores the profile's own tags, each once", async () => {
    const res = await call('PUT', `/api/transactions/${FIRST}/tags`, {
      tagIds: [WORK, HOLIDAY, WORK],
    })
    expect(res.status).toBe(200)
    expect(await tagsOn(FIRST)).toEqual([HOLIDAY, WORK])
  })
})

describe('GET /api/transactions/by-tag/:tagId', () => {
  beforeEach(async () => {
    for (const id of [FIRST, SECOND, THIRD]) {
      const res = await call('PUT', `/api/transactions/${id}/tags`, { tagIds: [HOLIDAY] })
      expect(res.status).toBe(200)
    }
  })

  async function rows(query: string): Promise<Record<string, unknown>[]> {
    const res = await call('GET', `/api/transactions/by-tag/${HOLIDAY}${query}`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { rows: Record<string, unknown>[]; total: number }
    expect(body.total).toBe(body.rows.length)
    return body.rows
  }

  const ids = async (query: string) => (await rows(query)).map((row) => row.id)

  it('answers newest first, and counts a timestamped row on its own day', async () => {
    expect(await ids('')).toEqual([SECOND, THIRD, FIRST])
    expect(await ids('?startDate=2026-03-02&endDate=2026-03-31')).toEqual([SECOND, THIRD])
    expect(await ids('?type=income')).toEqual([THIRD])
    expect(await ids(`?category_ids=${FOOD},999`)).toEqual([FIRST])
  })

  it('pages with a limit, an offset, or an offset alone', async () => {
    expect(await ids('?limit=1&offset=1')).toEqual([THIRD])
    expect(await ids('?offset=2')).toEqual([FIRST])
    expect(await ids('?limit=2')).toEqual([SECOND, THIRD])
  })

  it("names each row's category, as the Worker does", async () => {
    const [first] = await rows(`?category_ids=${FOOD}`)
    expect(first).toMatchObject({
      id: FIRST,
      category_name: 'Food',
      category_color: '#aa5500',
      category_icon: 'tag',
    })
  })
})
