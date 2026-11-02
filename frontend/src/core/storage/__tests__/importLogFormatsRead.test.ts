/**
 * An import log local-first stored before bank formats were kept (migration 0038 on the Worker)
 * has no `bank_formats` key. The Worker answers NULL for its own old rows; local-first lists one
 * the same way, so the region choice reads both modes alike.
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
  for (const store of ['profiles', 'import_logs'] as const) await db.clear(store)
  await db.add('profiles', { id: 1, name: 'Me', created_at: '2026-01-01T00:00:00.000Z' })
  await db.add('import_logs', {
    id: 1,
    profile_id: 1,
    import_id: 'before-formats',
    source: 'statement.csv',
    imported: 3,
    duplicates_skipped: 0,
    accounts_created: 0,
    categories_created: 0,
    details: null,
    created_at: '2026-09-01T10:00:00.000Z',
  } as never)
})

describe('an import log from before bank formats were kept', () => {
  it('is listed with none, as the Worker answers', async () => {
    const res = await routeApiRequest('/api/import-logs')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([
      expect.objectContaining({ import_id: 'before-formats', bank_formats: null }),
    ])
  })
})
