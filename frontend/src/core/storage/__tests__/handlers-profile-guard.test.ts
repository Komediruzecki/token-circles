import { beforeEach, describe, expect, it } from 'vitest'
import { getDB } from '../idb.js'
import { routeApiRequest } from '../localApiRouter.js'

// Audit B2: the by-id transaction handlers (update/delete/reconcile) must only act on rows in a
// selected profile, like the bulk handlers — a row in another (same-browser household) profile is
// treated as not found. Real `idb` on fake-indexeddb (see src/test-setup.ts).

async function seed() {
  const db = await getDB()
  for (const s of ['profiles', 'transactions', 'accounts', 'categories']) {
    if (db.objectStoreNames.contains(s)) await db.clear(s)
  }
  await db.add('profiles', { id: 1, name: 'Me', created_at: '2026-01-01' })
  await db.add('profiles', { id: 2, name: 'Other', created_at: '2026-01-01' })
  // id 100 belongs to profile 1 (selected); id 200 belongs to profile 2 (not selected).
  await db.add('transactions', {
    id: 100,
    profile_id: 1,
    type: 'expense',
    amount: 10,
    description: 'mine',
    date: '2026-05-01',
  })
  await db.add('transactions', {
    id: 200,
    profile_id: 2,
    type: 'expense',
    amount: 20,
    description: 'theirs',
    date: '2026-05-01',
  })
}

beforeEach(async () => {
  localStorage.clear()
  localStorage.setItem('currentProfileId', '1')
  localStorage.setItem('selectedProfileIds', '[1]')
  await seed()
})

const descOf = async (id: number): Promise<string | undefined> =>
  ((await (await getDB()).get('transactions', id)) as { description?: string } | undefined)
    ?.description

describe('by-id transaction handlers respect the selected profile (audit B2)', () => {
  it('update of an unselected-profile row is rejected and does not mutate it', async () => {
    const res = await routeApiRequest('http://localhost/api/transactions/200', {
      method: 'PUT',
      body: JSON.stringify({ description: 'hacked' }),
    })
    expect(res.status).toBe(404)
    expect(await descOf(200)).toBe('theirs')
  })

  it('delete of an unselected-profile row is rejected and keeps it', async () => {
    const res = await routeApiRequest('http://localhost/api/transactions/200', { method: 'DELETE' })
    expect(res.status).toBe(404)
    expect(await descOf(200)).toBe('theirs')
  })

  it('reconcile-toggle of an unselected-profile row is rejected', async () => {
    const res = await routeApiRequest('http://localhost/api/transactions/200/reconcile', {
      method: 'PATCH',
    })
    expect(res.status).toBe(404)
  })

  it('reconcile-batch skips unselected-profile rows', async () => {
    const res = await routeApiRequest('http://localhost/api/transactions/reconcile-batch', {
      method: 'PUT',
      body: JSON.stringify({ transaction_ids: [100, 200] }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { updated: number }
    expect(body.updated).toBe(1) // only the selected-profile row
  })

  it('still operates on a selected-profile row', async () => {
    const res = await routeApiRequest('http://localhost/api/transactions/100', {
      method: 'PUT',
      body: JSON.stringify({ description: 'edited' }),
    })
    expect(res.status).toBe(200)
    expect(await descOf(100)).toBe('edited')
  })
})
