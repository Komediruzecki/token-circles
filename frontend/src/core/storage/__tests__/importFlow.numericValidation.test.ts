import { beforeEach, describe, expect, it } from 'vitest'
import { getDB } from '../idb.js'
import { importBulk, importExecute } from '../localHandlers.js'

beforeEach(async () => {
  localStorage.clear()
  localStorage.setItem('currentProfileId', '1')
  const db = await getDB()
  for (const store of ['transactions', 'accounts', 'categories', 'profiles'] as const) {
    await db.clear(store)
  }
  await db.add('profiles', { id: 1, name: 'Main', created_at: '2026-01-01' })
})

describe('serverless import numeric validation', () => {
  it('uses the strict parser for amount, local amount, exchange rate, and opening balance', async () => {
    const response = await importExecute({
      rows: [['2026-01-01', 'Opening', '2.468,13', 'Savings', '1 234,56', '7,53']],
      mapping: {
        date: 0,
        description: 1,
        amount: 2,
        category: 3,
        amount_local: 4,
        exchange_rate: 5,
      },
      categoryTypes: { Savings: 'account' },
      accountBalances: { Savings: '2,468.13' },
      dry_run: false,
    })
    expect(response.status).toBe(200)

    const db = await getDB()
    const transaction = (await db.getAll('transactions'))[0]
    const account = (await db.getAll('accounts'))[0]
    expect(transaction.amount).toBeCloseTo(2468.13, 2)
    expect(transaction.amount_local).toBeCloseTo(1234.56, 2)
    expect(transaction.exchange_rate).toBeCloseTo(7.53, 2)
    expect(account.starting_balance).toBeCloseTo(2468.13, 2)
  })

  it('reports exact invalid row fields during preview and writes nothing', async () => {
    const response = await importExecute({
      rows: [
        ['2026-01-01', 'Bad local', '10.00', '1,2,3', '1.00'],
        ['2026-01-02', 'Bad rate', '20.00', '20.00', 'abc'],
      ],
      mapping: {
        date: 0,
        description: 1,
        amount: 2,
        amount_local: 3,
        exchange_rate: 4,
      },
      dry_run: true,
    })
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.imported).toBe(0)
    // The row number is rendered by the UI, so the reason no longer repeats it ("Row 1: Invalid
    // amount_local on row 1"). It now quotes the row's own date and description instead, which is
    // what lets the user find the line in a multi-thousand-row sheet.
    expect(body.skipped_items).toEqual([
      {
        index: 0,
        reason: 'Could not read amount_local — check the number format',
        label: '2026-01-01 · Bad local',
      },
      {
        index: 1,
        reason: 'Could not read exchange_rate — check the number format',
        label: '2026-01-02 · Bad rate',
      },
    ])
    expect(await (await getDB()).count('transactions')).toBe(0)
  })

  it('rejects a malformed opening balance before creating the account', async () => {
    const response = await importExecute({
      rows: [['2026-01-01', 'Opening', '10.00', 'Savings']],
      mapping: { date: 0, description: 1, amount: 2, category: 3 },
      categoryTypes: { Savings: 'account' },
      accountBalances: { Savings: '1,2,3' },
      dry_run: false,
    })
    expect(response.status).toBe(422)
    expect(await (await getDB()).count('accounts')).toBe(0)
  })

  it('parses localized amounts on the bulk import endpoint', async () => {
    const response = await importBulk({
      items: [{ description: 'Localized', amount: '2.468,13', date: '2026-01-01' }],
    })
    expect(response.status).toBe(200)

    const transactions = await (await getDB()).getAll('transactions')
    expect(transactions).toHaveLength(1)
    expect(transactions[0].amount).toBeCloseTo(2468.13, 2)
  })

  it('rejects the entire bulk import before writing when any amount is malformed', async () => {
    const response = await importBulk({
      items: [
        { description: 'Valid', amount: '10.00', date: '2026-01-01' },
        { description: 'Malformed', amount: '1,2,3', date: '2026-01-02' },
      ],
    })
    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({
      validation_errors: [{ field: 'items.1.amount' }],
    })
    expect(await (await getDB()).count('transactions')).toBe(0)
  })
})
