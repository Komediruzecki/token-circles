import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_CATEGORIES, getDB } from '../idb.js'
import { routeApiRequest } from '../localApiRouter.js'

// The write routes only local-first serves, each sent through the real router as apiFetch sends
// it. The routes both runtimes serve are the contract's (contract.test.ts); these have no Worker
// twin, and shared/contract/routes.ts lists them in LOCAL_ONLY with the reason.

type Row = Record<string, unknown>

async function send(profile: number, method: string, path: string, body?: unknown) {
  localStorage.setItem('currentProfileId', String(profile))
  localStorage.setItem('selectedProfileIds', JSON.stringify([profile]))
  const res = await routeApiRequest(`http://localhost${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Profile-Id': String(profile) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : null }
}

async function added(profile: number, path: string, body: unknown): Promise<number> {
  const reply = await send(profile, 'POST', path, body)
  expect(reply.status, `POST ${path}: ${JSON.stringify(reply.body)}`).toBe(201)
  return reply.body.id as number
}

const account = (profile: number, name: string) =>
  added(profile, '/api/accounts', { name, type: 'giro', currency: 'EUR', balance: 100 })

async function history(profile: number, accountId: number): Promise<Row[]> {
  const reply = await send(profile, 'GET', `/api/accounts/${accountId}/history`)
  expect(reply.status).toBe(200)
  return reply.body as Row[]
}

beforeEach(async () => {
  localStorage.clear()
  const db = await getDB()
  for (const store of Array.from(db.objectStoreNames)) await db.clear(store)
  await db.add('profiles', { id: 1, name: 'Me', created_at: '2026-01-01' })
  await db.add('profiles', { id: 2, name: 'Partner', created_at: '2026-01-01' })
})

describe('DELETE /api/accounts/:id/history/:entryId', () => {
  it('removes one recorded balance and keeps the others', async () => {
    const everyday = await account(1, 'Everyday')
    const first = await added(1, `/api/accounts/${everyday}/history`, { balance: 120 })
    const second = await added(1, `/api/accounts/${everyday}/history`, { balance: 95.5 })

    const removed = await send(1, 'DELETE', `/api/accounts/${everyday}/history/${first}`)
    expect(removed.status).toBe(200)
    expect((await history(1, everyday)).map((e) => e.id)).toEqual([second])
    // Gone, so asking again finds nothing to remove.
    expect((await send(1, 'DELETE', `/api/accounts/${everyday}/history/${first}`)).status).toBe(404)
  })

  it("leaves a balance alone through another profile or another account's path", async () => {
    const everyday = await account(1, 'Everyday')
    const cash = await account(1, 'Cash')
    const entry = await added(1, `/api/accounts/${everyday}/history`, { balance: 120 })

    // The account is not the other profile's.
    expect((await send(2, 'DELETE', `/api/accounts/${everyday}/history/${entry}`)).status).toBe(404)
    // The balance is not the other account's.
    expect((await send(1, 'DELETE', `/api/accounts/${cash}/history/${entry}`)).status).toBe(404)
    expect((await history(1, everyday)).map((e) => e.id)).toEqual([entry])
  })
})

describe('POST /api/categories/seed', () => {
  const defaults = DEFAULT_CATEGORIES.map((c) => c.name).sort()

  it('puts the default categories in the active profile, once', async () => {
    const seeded = await send(1, 'POST', '/api/categories/seed')
    expect(seeded).toEqual({ status: 200, body: { ok: true, categories: defaults.length } })
    const mine = (await send(1, 'GET', '/api/categories')).body as Row[]
    expect(mine.map((c) => c.name).sort()).toEqual(defaults)
    expect(mine.every((c) => c.profile_id === 1)).toBe(true)
    expect((await send(2, 'GET', '/api/categories')).body).toEqual([])

    // Seeding again adds none.
    expect((await send(1, 'POST', '/api/categories/seed')).body).toEqual({
      ok: true,
      categories: defaults.length,
    })
    expect((await send(1, 'GET', '/api/categories')).body).toHaveLength(defaults.length)
  })

  it('adds nothing to a profile that has categories of its own', async () => {
    await added(1, '/api/categories', { name: 'Rent', type: 'expense', color: '#455a64' })
    expect((await send(1, 'POST', '/api/categories/seed')).body).toEqual({
      ok: true,
      categories: 1,
    })
    expect(((await send(1, 'GET', '/api/categories')).body as Row[]).map((c) => c.name)).toEqual([
      'Rent',
    ])
  })
})

describe('POST /api/logs and POST /api/logs/clear', () => {
  it('stores entries, reads them back newest first, and clears them', async () => {
    const older = await added(1, '/api/logs', {
      timestamp: '2026-03-01T10:00:00.000Z',
      level: 'error',
      message: 'Sync failed',
    })
    const newer = await added(1, '/api/logs', {
      timestamp: '2026-03-02T10:00:00.000Z',
      level: 'warn',
      source: 'import',
      error: 'Slow sheet',
      stack: 'at readSheet',
    })

    expect((await send(1, 'GET', '/api/logs')).body).toEqual([
      expect.objectContaining({
        id: newer,
        level: 'warn',
        source: 'import',
        error: 'Slow sheet',
        stack: 'at readSheet',
      }),
      // A message stands in for the error, and the source defaults to the client.
      expect.objectContaining({
        id: older,
        level: 'error',
        source: 'client',
        error: 'Sync failed',
      }),
    ])
    expect(((await send(1, 'GET', '/api/logs?level=warn')).body as Row[]).map((l) => l.id)).toEqual(
      [newer]
    )

    expect((await send(1, 'POST', '/api/logs/clear')).status).toBe(200)
    expect((await send(1, 'GET', '/api/logs')).body).toEqual([])
  })

  it('refuses an entry that is not an object', async () => {
    expect((await send(1, 'POST', '/api/logs', 'Sync failed')).status).toBe(400)
    expect((await send(1, 'GET', '/api/logs')).body).toEqual([])
  })
})

describe('POST /api/auth/login', () => {
  it('answers the fixed local user for any username, and refuses no username', async () => {
    expect(await send(1, 'POST', '/api/auth/login', { username: 'anyone', password: 'x' })).toEqual(
      { status: 200, body: { id: 1, username: 'anyone', role: 'admin' } }
    )
    expect((await send(1, 'POST', '/api/auth/login', { password: 'x' })).status).toBe(400)
  })
})

describe('POST /api/profiles/reseed-demo', () => {
  it("replaces every profile with the demo's three example profiles", async () => {
    await account(1, 'Everyday')
    await account(2, 'Theirs')

    const reply = await send(1, 'POST', '/api/profiles/reseed-demo')
    expect(reply).toEqual({ status: 200, body: { ok: true, message: 'Demo data reseeded' } })
    const db = await getDB()
    const names = ((await db.getAll('profiles')) as Row[]).map((p) => p.name)
    expect(names).toEqual(['Example Low Income', 'Example Mid Income', 'Example High Income'])
    // The example profiles come with their own accounts; the two made here are gone.
    const accounts = ((await db.getAll('accounts')) as Row[]).map((a) => a.name)
    expect(accounts).not.toContain('Everyday')
    expect(accounts).not.toContain('Theirs')
  })
})
