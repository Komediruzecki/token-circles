/**
 * Learned category mappings in local-first, through `routeApiRequest`, the router `apiFetch`
 * calls, with older rows in place: the twin of worker/test/category-mappings.test.ts, by the same
 * rules (shared/categoryMappingSchema.ts, shared/autoCategorize.ts).
 *
 * Before, local-first stored a pattern saved twice as a second mapping and answered 201 `{ id }`;
 * listed every selected profile's raw rows, without their category, in the order they were
 * added, and one whose category was another profile's; filed transactions on apply-mappings by
 * the stored mappings a body named (`mapping_ids`) rather than the transactions it listed; and
 * filed rows itself on auto-map, by keyword lists of its own, where the Worker only suggests.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { CATEGORY_MAPPING_MESSAGES as M } from '../../../../../shared/categoryMappingSchema'
import { getDB } from '../idb'

let routeApiRequest: (url: string, init?: RequestInit) => Promise<Response>

beforeAll(async () => {
  routeApiRequest = (await import('../localApiRouter')).routeApiRequest
}, 120_000)

const PROFILE = 1
const SIDE = 2
const STREAMING = 10
const OTHER = 11
const GROCERIES = 12
const THEIRS = 13
const NETFLIX_TX = 20
const CORNER_TX = 21
const GROCERIES_TX = 22
const SIDE_TX = 23

function transaction(
  id: number,
  profileId: number,
  description: string,
  categoryId: number | null
) {
  return {
    id,
    profile_id: profileId,
    description,
    amount: 10,
    type: 'expense',
    date: '2026-03-01',
    currency: 'EUR',
    category_id: categoryId,
  }
}

beforeEach(async () => {
  localStorage.clear()
  localStorage.setItem('finance_storage_mode', 'serverless')
  localStorage.setItem('currentProfileId', String(PROFILE))
  localStorage.setItem('selectedProfileIds', JSON.stringify([PROFILE, SIDE]))
  const db = await getDB()
  for (const store of ['profiles', 'categories', 'categoryMappings', 'transactions'] as const) {
    await db.clear(store)
  }
  await db.add('profiles', { id: PROFILE, name: 'Household', created_at: '2026-01-01T00:00:00Z' })
  await db.add('profiles', { id: SIDE, name: 'Side', created_at: '2026-01-01T00:00:00Z' })
  for (const [id, profileId, name, color] of [
    [STREAMING, PROFILE, 'Streaming', '#225588'],
    [OTHER, PROFILE, 'Other', '#6b7280'],
    [GROCERIES, PROFILE, 'Groceries', '#aa5500'],
    [THEIRS, SIDE, 'Theirs', '#335577'],
  ] as const) {
    await db.add('categories', { id, profile_id: profileId, name, color, type: 'expense' })
  }
  // Older rows: a mapping used three times; one saved before local-first counted them, with no
  // confidence or use count; one naming another profile's category, as a row stored before
  // categories were checked against the profile would; and the other profile's own.
  await db.add('categoryMappings', {
    id: 40,
    profile_id: PROFILE,
    pattern: 'netflix',
    category_id: STREAMING,
    confidence: 0.8,
    use_count: 3,
  })
  await db.add('categoryMappings', {
    id: 41,
    profile_id: PROFILE,
    pattern: 'corner',
    category_id: THEIRS,
    confidence: 0.9,
    use_count: 9,
  })
  await db.add('categoryMappings', {
    id: 42,
    profile_id: PROFILE,
    pattern: 'lidl',
    category_id: GROCERIES,
    created_at: '2026-01-02T00:00:00.000Z',
  })
  await db.add('categoryMappings', {
    id: 43,
    profile_id: SIDE,
    pattern: 'tools',
    category_id: THEIRS,
    confidence: 0.9,
    use_count: 1,
  })
  await db.add('transactions', transaction(NETFLIX_TX, PROFILE, 'Netflix monthly', null))
  await db.add('transactions', transaction(CORNER_TX, PROFILE, 'Corner shop', OTHER))
  await db.add('transactions', transaction(GROCERIES_TX, PROFILE, 'Groceries run', GROCERIES))
  await db.add('transactions', transaction(SIDE_TX, SIDE, 'Side job tools', null))
})

async function send(method: string, path: string, body?: unknown): Promise<Response> {
  return routeApiRequest(path, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

async function answer(res: Response): Promise<{ status: number; body: any }> {
  return { status: res.status, body: await res.json() }
}

async function mappings(): Promise<Record<string, unknown>[]> {
  const rows = (await (await getDB()).getAll('categoryMappings')) as Record<string, unknown>[]
  return rows.sort((a, b) => (a.id as number) - (b.id as number))
}

async function categoryOf(id: number): Promise<unknown> {
  return ((await (await getDB()).get('transactions', id)) as { category_id: unknown }).category_id
}

describe('the mappings list', () => {
  it("holds the open profile's mappings with their category, most used first, leaving out one whose category is another profile's", async () => {
    const { status, body } = await answer(await send('GET', '/api/categories/mappings'))
    expect(status).toBe(200)
    expect(body).toEqual([
      expect.objectContaining({
        id: 40,
        pattern: 'netflix',
        confidence: 0.8,
        use_count: 3,
        category_name: 'Streaming',
        category_color: '#225588',
      }),
      // Saved before local-first counted mappings: read as the Worker stores one, used once.
      expect.objectContaining({
        id: 42,
        pattern: 'lidl',
        confidence: 0.9,
        use_count: 1,
        category_name: 'Groceries',
      }),
    ])
  })
})

describe('a mapping saved', () => {
  it('is refused at its field, and nothing is stored', async () => {
    const before = await mappings()
    expect(
      await answer(
        await send('POST', '/api/categories/mappings', { pattern: ' ', category_id: 'x' })
      )
    ).toEqual({
      status: 400,
      body: {
        error: `${M.pattern} ${M.category}`,
        fields: { pattern: M.pattern, category_id: M.category },
      },
    })
    expect(
      await answer(
        await send('POST', '/api/categories/mappings', { pattern: 'side', category_id: THEIRS })
      )
    ).toEqual({ status: 400, body: { error: M.category, fields: { category_id: M.category } } })
    for (const confidence of [0, -0.5, 1.5, 'sure']) {
      expect(
        await answer(
          await send('POST', '/api/categories/mappings', {
            pattern: 'side',
            category_id: STREAMING,
            confidence,
          })
        )
      ).toEqual({
        status: 400,
        body: { error: M.confidence, fields: { confidence: M.confidence } },
      })
    }
    expect(await mappings()).toEqual(before)
  })

  it('again, for a pattern the profile has, is that mapping counted once more', async () => {
    expect(
      await answer(
        await send('POST', '/api/categories/mappings', {
          pattern: ' netflix ',
          category_id: STREAMING,
        })
      )
    ).toEqual({ status: 200, body: { ok: true, id: 40, use_count: 4 } })
    // One saved before mappings were counted counts from one.
    expect(
      await answer(
        await send('POST', '/api/categories/mappings', { pattern: 'lidl', category_id: GROCERIES })
      )
    ).toEqual({ status: 200, body: { ok: true, id: 42, use_count: 2 } })
    const rows = await mappings()
    expect(rows).toContainEqual(
      expect.objectContaining({ id: 40, pattern: 'netflix', confidence: 0.9, use_count: 4 })
    )
    expect(rows.filter((row) => row.pattern === 'netflix')).toHaveLength(1)
    expect(rows.filter((row) => row.pattern === 'lidl')).toHaveLength(1)
  })
})

describe('apply-mappings', () => {
  it('refuses a body it cannot file at its field, and files and learns nothing', async () => {
    const before = await mappings()
    expect(
      await answer(await send('POST', '/api/categories/apply-mappings', { mapping_ids: [40] }))
    ).toEqual({ status: 400, body: { error: M.mappings, fields: { mappings: M.mappings } } })
    expect(
      (
        await answer(
          await send('POST', '/api/categories/apply-mappings', {
            mappings: [
              { transaction_id: NETFLIX_TX, category_id: STREAMING, pattern: 'Netflix' },
              { transaction_id: 'x', category_id: STREAMING, pattern: { text: 'x' } },
            ],
          })
        )
      ).body.fields
    ).toEqual({
      'mappings.1.transaction_id': M.transaction,
      'mappings.1.pattern': M.patternText,
    })
    expect(
      await answer(
        await send('POST', '/api/categories/apply-mappings', {
          mappings: [
            { transaction_id: NETFLIX_TX, category_id: STREAMING, pattern: 'Netflix monthly' },
            { transaction_id: CORNER_TX, category_id: THEIRS },
          ],
        })
      )
    ).toEqual({
      status: 400,
      body: { error: M.category, fields: { 'mappings.1.category_id': M.category } },
    })
    expect(await categoryOf(NETFLIX_TX)).toBeNull()
    expect(await mappings()).toEqual(before)
  })

  it("files the profile's transactions and learns their text, and skips another profile's", async () => {
    expect(
      await answer(
        await send('POST', '/api/categories/apply-mappings', {
          mappings: [
            { transaction_id: NETFLIX_TX, category_id: STREAMING, pattern: 'Netflix Monthly!' },
            { transaction_id: CORNER_TX, category_id: GROCERIES, pattern: 'ab' },
            { transaction_id: SIDE_TX, category_id: GROCERIES, pattern: 'Side job' },
          ],
        })
      )
    ).toEqual({ status: 200, body: { ok: true, updated: 2 } })
    expect(await categoryOf(NETFLIX_TX)).toBe(STREAMING)
    expect(await categoryOf(CORNER_TX)).toBe(GROCERIES)
    expect(await categoryOf(SIDE_TX)).toBeNull()
    // "ab" is too short to learn from; the others are learned in their matching form.
    expect(
      (await mappings())
        .filter((row) => row.profile_id === PROFILE)
        .map((row) => [row.pattern, row.category_id, row.use_count ?? null])
    ).toEqual([
      ['netflix', STREAMING, 3],
      ['corner', THEIRS, 9],
      ['lidl', GROCERIES, null],
      ['netflixmonthly', STREAMING, 1],
      ['sidejob', GROCERIES, 1],
    ])
  })
})

describe('auto-map', () => {
  it('suggests a category for the uncategorised transactions and files none', async () => {
    const { status, body } = await answer(await send('POST', '/api/categories/auto-map', {}))
    expect(status).toBe(200)
    // Netflix (no category) and the corner shop (Other); not the groceries, which are filed, nor
    // the other profile's. The corner shop's mapping names another profile's category, so it
    // suggests nothing.
    expect(body).toEqual({
      total: 2,
      mapped: 1,
      mappings: [
        {
          transaction_id: NETFLIX_TX,
          description: 'Netflix monthly',
          proposed_category_id: STREAMING,
          proposed_category_name: 'Streaming',
          proposed_category_color: '#225588',
          confidence: expect.any(Number),
        },
      ],
    })
    // 0.8, raised by three uses: 0.8 x (1 + log10(4) x 0.2).
    expect(body.mappings[0].confidence).toBeCloseTo(0.8963, 4)
    expect(await categoryOf(NETFLIX_TX)).toBeNull()
    expect(await categoryOf(CORNER_TX)).toBe(OTHER)
  })

  it('narrows to a description given with an amount', async () => {
    const { body } = await answer(
      await send('POST', '/api/categories/auto-map', { description: 'Corner', amount: 4.5 })
    )
    expect(body).toEqual({ total: 1, mapped: 0, mappings: [] })
  })

  it('refuses transaction ids that are not a list of ids', async () => {
    for (const transaction_ids of ['all', [NETFLIX_TX, 'x'], { id: NETFLIX_TX }]) {
      expect(
        await answer(await send('POST', '/api/categories/auto-map', { transaction_ids }))
      ).toEqual({
        status: 400,
        body: { error: M.transactionIds, fields: { transaction_ids: M.transactionIds } },
      })
    }
  })
})
