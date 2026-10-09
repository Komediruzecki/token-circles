/**
 * Local-first takes a category called "IB" or "Interactive Brokers", sent without a type, as an
 * investment account, and names it as the sheet spells it.
 *
 * It named the account in lower case: the detection keyed it by its lowercased name, and the
 * account was created from that key, so a sheet's "IB" became an account called "ib" and
 * "Interactive Brokers" one called "interactive brokers".
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { getDB } from '../idb.js'
import { importExecute } from '../localHandlers.js'

beforeEach(async () => {
  localStorage.clear()
  localStorage.setItem('currentProfileId', '1')
  const db = await getDB()
  for (const store of ['profiles', 'accounts', 'transactions', 'categories', 'settings']) {
    await db.clear(store)
  }
  await db.add('profiles', { id: 1, name: 'Household', created_at: '2026-01-01T00:00:00.000Z' })
})

async function accounts(): Promise<{ name: string; type: string }[]> {
  const rows = (await (await getDB()).getAll('accounts')) as { name: string; type: string }[]
  return rows.map(({ name, type }) => ({ name, type }))
}

describe('an investment account an import detects in local-first', () => {
  it('is named as the sheet spells it', async () => {
    const res = await importExecute({
      rows: [
        ['2026-03-01', 'Monthly deposit', '-500', 'IB'],
        ['2026-03-02', 'Top-up', '-250', 'Interactive Brokers'],
      ],
      mapping: { date: 0, description: 1, amount: 2, category: 3 },
    })
    expect(res.status).toBe(200)
    expect(await accounts()).toEqual([
      { name: 'IB', type: 'ib' },
      { name: 'Interactive Brokers', type: 'ib' },
    ])
  })

  it('is made once for a name the sheet spells two ways, as it first spells it', async () => {
    await importExecute({
      rows: [
        ['2026-03-01', 'Monthly deposit', '-500', 'IB'],
        ['2026-03-02', 'Top-up', '-250', 'ib'],
      ],
      mapping: { date: 0, description: 1, amount: 2, category: 3 },
    })
    expect(await accounts()).toEqual([{ name: 'IB', type: 'ib' }])
  })
})
