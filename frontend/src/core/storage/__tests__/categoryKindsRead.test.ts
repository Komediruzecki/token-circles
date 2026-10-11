/**
 * A local-first category stored before categories had a kind holds neither `kind` nor `essential`.
 * Read back, it answers null for both, as a Worker row of that age does (its columns are NULL), so
 * the two runtimes answer the same and the app goes by the category's name.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { getDB } from '../idb'

let routeApiRequest: (url: string, init?: RequestInit) => Promise<Response>

beforeAll(async () => {
  routeApiRequest = (await import('../localApiRouter')).routeApiRequest
}, 120_000)

beforeEach(async () => {
  localStorage.clear()
  localStorage.setItem('finance_storage_mode', 'serverless')
  localStorage.setItem('currentProfileId', '1')
  localStorage.setItem('selectedProfileIds', '[1]')
  const db = await getDB()
  for (const store of ['profiles', 'categories'] as const) await db.clear(store)
  await db.add('profiles', { id: 1, name: 'Me', created_at: '2026-01-01T00:00:00.000Z' })
  await db.add('categories', {
    id: 7,
    profile_id: 1,
    name: 'Food',
    type: 'expense',
    color: '#F97316',
    tax_deductible: false,
  } as never)
})

describe('a category from before kinds, read in local-first', () => {
  it('answers null for its kind and its choice, in the list and on its own', async () => {
    const list = (await (await routeApiRequest('/api/categories')).json()) as Record<
      string,
      unknown
    >[]
    expect(list).toEqual([expect.objectContaining({ id: 7, kind: null, essential: null })])
    const one = (await (await routeApiRequest('/api/categories/7')).json()) as Record<
      string,
      unknown
    >
    expect(one).toMatchObject({ id: 7, kind: null, essential: null })
  })
})
