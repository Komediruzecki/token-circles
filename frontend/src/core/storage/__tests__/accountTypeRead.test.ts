/**
 * Local-first reads every stored account type back (`normalizeAccount`, through
 * `storedAccountType` in shared/accountSchema.ts): a type this build does not have stays as it is,
 * a type v4 renamed reads as the one that replaced it, and a row without one is a giro account.
 * The app's own reader (`api.getAccounts`) then loads the whole list. One account of a type it did
 * not know used to fail that list, every account with it.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { getDB } from '../idb'
import type { ApiClient } from '../../api'

let routeApiRequest: (url: string, init?: RequestInit) => Promise<Response>
let api: ApiClient

beforeAll(async () => {
  routeApiRequest = (await import('../localApiRouter')).routeApiRequest
  api = (await import('../../api')).api
}, 120_000)

beforeEach(async () => {
  localStorage.clear()
  localStorage.setItem('finance_storage_mode', 'serverless')
  localStorage.setItem('currentProfileId', '1')
  localStorage.setItem('selectedProfileIds', '[1]')
  localStorage.setItem('localCurrency', 'EUR')
  const db = await getDB()
  for (const store of ['profiles', 'accounts', 'settings'] as const) await db.clear(store)
  await db.add('profiles', { id: 1, name: 'Me', created_at: '2026-01-01T00:00:00.000Z' })
  await db.put('settings', { key: 'currency', value: 'EUR' })
  const account = (id: number, name: string, type?: string) =>
    db.add('accounts', {
      id,
      profile_id: 1,
      name,
      ...(type === undefined ? {} : { type }),
      bank_name: '',
      currency: 'EUR',
      balance: 10,
      starting_balance: 10,
      starting_date: null,
      notes: '',
    } as never)
  await account(1, 'A everyday', 'giro')
  await account(2, 'B sock drawer', 'sock_drawer')
  await account(3, 'C old', 'checking')
  await account(4, 'D bare')
})

const typesOf = (rows: Array<{ name: string; type: string }>) =>
  rows.map((row) => [row.name, row.type]).sort(([a], [b]) => a.localeCompare(b))

describe('a stored account type, read back in local-first', () => {
  it('is kept when this build does not have it, and the list loads', async () => {
    const expected = [
      ['A everyday', 'giro'],
      ['B sock drawer', 'sock_drawer'],
      ['C old', 'giro'],
      ['D bare', 'giro'],
    ]
    const res = await routeApiRequest('/api/accounts')
    expect(res.status).toBe(200)
    expect(typesOf(await res.json())).toEqual(expected)
    expect(typesOf(await api.getAccounts('active'))).toEqual(expected)
  })
})

describe('an account stored before limits and rates', () => {
  // Migration 0037's columns read NULL on the Worker for a row from before them. A local row from
  // before them has neither key, and reads the same.
  it('reads none for both, as the Worker answers', async () => {
    const res = await routeApiRequest('/api/accounts')
    const rows = (await res.json()) as Array<Record<string, unknown>>
    expect(rows).toHaveLength(4)
    for (const row of rows) {
      expect(row, String(row.name)).toMatchObject({ credit_limit: null, credit_rate: null })
    }
  })
})
