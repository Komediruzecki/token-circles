import { beforeEach, describe, expect, it } from 'vitest'
import { getDB } from '../idb.js'
import { accountsCreate, importExecute, settingsUpdate } from '../localHandlers.js'

beforeEach(async () => {
  localStorage.clear()
  localStorage.setItem('currentProfileId', '1')
  localStorage.setItem('localCurrency', 'EUR')
  const db = await getDB()
  for (const store of ['transactions', 'accounts', 'settings', 'profiles'] as const) {
    await db.clear(store)
  }
  await db.add('profiles', { id: 1, name: 'Main', created_at: '2026-01-01' })
})

describe('serverless account balance currency invariant', () => {
  it('rejects an account currency that differs from the persisted base currency', async () => {
    expect((await settingsUpdate({ currency: 'EUR' })).status).toBe(200)

    const response = await accountsCreate({
      name: 'Dollar account',
      type: 'giro',
      currency: 'USD',
      balance: 100,
      starting_balance: 100,
    })
    expect(response.status).toBe(409)

    const db = await getDB()
    expect(await db.count('accounts')).toBe(0)
  })

  it('locks the base currency after financial data exists', async () => {
    expect((await settingsUpdate({ currency: 'EUR' })).status).toBe(200)
    expect(
      (
        await accountsCreate({
          name: 'Current',
          type: 'giro',
          currency: 'EUR',
          balance: 100,
          starting_balance: 100,
        })
      ).status
    ).toBe(201)

    const response = await settingsUpdate({ currency: 'USD' })
    expect(response.status).toBe(409)

    const db = await getDB()
    expect((await db.get('settings', 'currency'))?.value).toBe('EUR')
  })

  it('uses the first explicit setting to adopt and relabel legacy balances', async () => {
    const db = await getDB()
    await db.add('accounts', {
      name: 'Legacy EUR',
      type: 'giro',
      currency: 'EUR',
      balance: 100,
      starting_balance: 100,
      profile_id: 1,
    })
    await db.add('accounts', {
      name: 'Legacy USD label',
      type: 'giro',
      currency: 'USD',
      balance: 200,
      starting_balance: 200,
      profile_id: 1,
    })

    expect((await settingsUpdate({ currency: 'CHF' })).status).toBe(200)
    const accounts = await db.getAll('accounts')
    expect(accounts.map((account) => account.currency)).toEqual(['CHF', 'CHF'])
  })

  it('keeps import previews read-only and enforces the base currency on import', async () => {
    const body = {
      rows: [['2026-01-01', 'Opening', '100', 'Savings']],
      mapping: { date: 0, description: 1, amount: 2, category: 3 },
      categoryTypes: { Savings: 'account' },
      defaultCurrency: 'CHF',
      dry_run: true,
    }
    expect((await importExecute(body)).status).toBe(200)

    const db = await getDB()
    expect(await db.get('settings', 'currency')).toBeUndefined()
    expect(await db.count('accounts')).toBe(0)

    expect((await importExecute({ ...body, dry_run: false })).status).toBe(200)
    expect((await db.get('settings', 'currency'))?.value).toBe('CHF')
    expect((await db.getAll('accounts'))[0]?.currency).toBe('CHF')
  })
})
