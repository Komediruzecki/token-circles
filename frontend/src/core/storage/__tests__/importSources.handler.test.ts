import { beforeEach, describe, expect, it } from 'vitest'
import { getDB } from '../idb.js'
import { routeApiRequest } from '../localApiRouter.js'

// Serverless (IndexedDB) CRUD for saved import sources, exercised through the local API router —
// the same path the client hits in serverless mode. Real `idb` on fake-indexeddb (test-setup.ts).

interface ApiSource {
  id: number
  profile_id: number
  kind: string
  label: string
  config: { url?: string; sheetName?: string }
  mapping: Record<string, string> | null
  schedule: string
  last_synced_at: string | null
}

async function seed() {
  const db = await getDB()
  for (const s of ['profiles', 'import_sources']) {
    if (db.objectStoreNames.contains(s)) await db.clear(s)
  }
  await db.add('profiles', { id: 1, name: 'Me', created_at: '2026-01-01' })
  await db.add('profiles', { id: 2, name: 'Other', created_at: '2026-01-01' })
}

beforeEach(async () => {
  localStorage.clear()
  localStorage.setItem('currentProfileId', '1')
  localStorage.setItem('selectedProfileIds', '[1]')
  await seed()
})

const create = (body: unknown) =>
  routeApiRequest('http://localhost/api/import-sources', {
    method: 'POST',
    body: JSON.stringify(body),
  })

const list = async (): Promise<ApiSource[]> =>
  (await (await routeApiRequest('http://localhost/api/import-sources')).json()) as ApiSource[]

describe('import_sources handler (serverless)', () => {
  it('creates, lists, updates and deletes a google_sheet source', async () => {
    const res = await create({
      kind: 'google_sheet',
      label: 'Budget',
      config: { url: 'https://docs.google.com/spreadsheets/d/ABC/edit', sheetName: 'Sheet1' },
      mapping: { date: 'Date', amount: 'Amount', description: 'Memo' },
      schedule: 'manual',
    })
    expect(res.status).toBe(201)
    const created = (await res.json()) as ApiSource
    expect(created.id).toBeGreaterThan(0)
    expect(created.profile_id).toBe(1)
    expect(created.kind).toBe('google_sheet')
    expect(created.config.url).toContain('/d/ABC/')
    expect(created.mapping).toEqual({ date: 'Date', amount: 'Amount', description: 'Memo' })

    expect(await list()).toHaveLength(1)

    const putRes = await routeApiRequest(`http://localhost/api/import-sources/${created.id}`, {
      method: 'PUT',
      body: JSON.stringify({ label: 'Budget 2026', last_synced_at: '2026-07-01T00:00:00.000Z' }),
    })
    expect(putRes.status).toBe(200)
    const updated = (await putRes.json()) as ApiSource
    expect(updated.label).toBe('Budget 2026')
    expect(updated.last_synced_at).toBe('2026-07-01T00:00:00.000Z')
    // A partial update must not wipe unrelated fields.
    expect(updated.mapping).toEqual({ date: 'Date', amount: 'Amount', description: 'Memo' })

    const delRes = await routeApiRequest(`http://localhost/api/import-sources/${created.id}`, {
      method: 'DELETE',
    })
    expect(delRes.status).toBe(200)
    expect(await list()).toHaveLength(0)
  })

  it('rejects an invalid kind', async () => {
    const res = await create({ kind: 'nonsense', label: 'x', config: {} })
    expect(res.status).toBe(400)
  })

  it("never lists, updates or deletes another profile's source", async () => {
    const db = await getDB()
    const foreignId = (await db.add('import_sources', {
      profile_id: 2,
      kind: 'google_sheet',
      label: 'Theirs',
      config: {},
      mapping: null,
      category_types: null,
      default_account_id: null,
      schedule: 'manual',
      last_synced_at: null,
      last_cursor: null,
      created_at: '2026-01-01',
      updated_at: '2026-01-01',
    })) as number

    expect((await list()).find((s) => s.id === foreignId)).toBeUndefined()

    const putRes = await routeApiRequest(`http://localhost/api/import-sources/${foreignId}`, {
      method: 'PUT',
      body: JSON.stringify({ label: 'hacked' }),
    })
    expect(putRes.status).toBe(404)

    const delRes = await routeApiRequest(`http://localhost/api/import-sources/${foreignId}`, {
      method: 'DELETE',
    })
    expect(delRes.status).toBe(404)
  })
})
