import { beforeEach, describe, expect, it } from 'vitest'
import { getDB } from '../idb.js'
import { routeApiRequest } from '../localApiRouter.js'

// Serverless (IndexedDB) CRUD for saved import sources, exercised through the local API router —
// the same path the client hits in serverless mode. Real `idb` on fake-indexeddb (test-setup.ts).
//
// The cloud twin of this file is worker/test/import-sources.test.ts. A saved source is a standing
// instruction (the server-side daily cron re-imports from it), so the two runtimes have to agree
// on the contract exactly — same defaults, same enums, same ownership rules. The assertions here
// deliberately mirror that file so a drift in either one shows up as a failure.

interface ApiSource {
  id: number
  profile_id: number
  kind: string
  label: string
  config: { url?: string; sheetName?: string }
  mapping: Record<string, string> | null
  category_types: Record<string, string> | null
  default_account_id: number | null
  schedule: string
  last_synced_at: string | null
  last_cursor: string | null
  updated_at: string
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

const update = (id: number, body: unknown) =>
  routeApiRequest(`http://localhost/api/import-sources/${id}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  })

const list = async (): Promise<ApiSource[]> =>
  (await (await routeApiRequest('http://localhost/api/import-sources')).json()) as ApiSource[]

// Same fixture as the worker twin, so the two contracts are compared against identical input.
const SHEET = {
  kind: 'google_sheet',
  label: 'Budget 2026',
  config: {
    url: 'https://docs.google.com/spreadsheets/d/ABC/edit#gid=7',
    sheetName: 'transactions',
  },
  mapping: { date: 'Date', amount: 'Amount', description: 'Memo' },
  category_types: { 'Erste Giro': 'account' },
  schedule: 'daily',
}

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

  it('fills in defaults for a bare create', async () => {
    const created = (await (await create({})).json()) as ApiSource
    // `schedule` decides whether the server-side cron acts on this row; defaulting to anything
    // but 'manual' would start importing without the user asking.
    expect(created.kind).toBe('google_sheet')
    expect(created.schedule).toBe('manual')
    expect(created.label).toBe('')
    expect(created.config).toEqual({})
    expect(created.mapping).toBeNull()
    expect(created.last_synced_at).toBeNull()
  })

  it('lists newest first', async () => {
    await create({ ...SHEET, label: 'first' })
    await create({ ...SHEET, label: 'second' })
    expect((await list()).map((s) => s.label)).toEqual(['second', 'first'])
  })

  it('rejects an invalid kind', async () => {
    const res = await create({ kind: 'nonsense', label: 'x', config: {} })
    expect(res.status).toBe(400)
    expect(await list()).toHaveLength(0)
  })

  it('rejects an invalid schedule', async () => {
    // A typo like 'Daily' would create a source the cron silently never picks up.
    const res = await create({ ...SHEET, schedule: 'hourly' })
    expect(res.status).toBe(400)
  })

  it('rejects an invalid enum on update without touching the row', async () => {
    const created = (await (await create(SHEET)).json()) as ApiSource
    expect((await update(created.id, { schedule: 'weekly' })).status).toBe(400)
    expect((await update(created.id, { kind: 'ftp_drop' })).status).toBe(400)
    const after = (await list())[0]
    expect(after.schedule).toBe('daily')
    expect(after.kind).toBe('google_sheet')
  })

  it('clamps an overlong label and coerces a non-object config', async () => {
    const created = (await (
      await create({ ...SHEET, label: 'x'.repeat(500), config: 'not-an-object' })
    ).json()) as ApiSource
    expect(created.label).toHaveLength(200)
    expect(created.config).toEqual({})
  })

  it('nulls a default_account_id that is not a finite number, and floors one that is', async () => {
    const bad = (await (
      await create({ ...SHEET, default_account_id: 'seven' })
    ).json()) as ApiSource
    expect(bad.default_account_id).toBeNull()
    const good = (await (await create({ ...SHEET, default_account_id: 12.9 })).json()) as ApiSource
    expect(good.default_account_id).toBe(12)
  })

  it('clears mapping and category_types when the body sends null', async () => {
    const created = (await (await create(SHEET)).json()) as ApiSource
    const updated = (await (
      await update(created.id, { mapping: null, category_types: null })
    ).json()) as ApiSource
    expect(updated.mapping).toBeNull()
    expect(updated.category_types).toBeNull()
  })

  it('records the sync stamp written back after a re-import', async () => {
    const created = (await (await create(SHEET)).json()) as ApiSource
    const updated = (await (
      await update(created.id, {
        last_synced_at: '2026-07-01T09:00:00.000Z',
        last_cursor: 'row-42',
      })
    ).json()) as ApiSource
    expect(updated.last_synced_at).toBe('2026-07-01T09:00:00.000Z')
    expect(updated.last_cursor).toBe('row-42')
  })

  it('cannot move a source into another profile through an update', async () => {
    const created = (await (await create(SHEET)).json()) as ApiSource
    const updated = (await (
      await update(created.id, { profile_id: 2, label: 'moved' })
    ).json()) as ApiSource
    // profile_id is not a writable field — it decides whose books the source imports into.
    expect(updated.profile_id).toBe(1)
    expect(updated.label).toBe('moved')
  })

  it('deleting the same source twice is a 404, not a silent success', async () => {
    const created = (await (await create(SHEET)).json()) as ApiSource
    expect(
      (
        await routeApiRequest(`http://localhost/api/import-sources/${created.id}`, {
          method: 'DELETE',
        })
      ).status
    ).toBe(200)
    expect(
      (
        await routeApiRequest(`http://localhost/api/import-sources/${created.id}`, {
          method: 'DELETE',
        })
      ).status
    ).toBe(404)
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
