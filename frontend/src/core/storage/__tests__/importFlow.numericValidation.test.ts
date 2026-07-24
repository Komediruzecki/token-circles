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
      rows: [['2026-01-01', 'Opening', '3.177,94', 'Savings', '1 234,56', '7,53']],
      mapping: {
        date: 0,
        description: 1,
        amount: 2,
        category: 3,
        amount_local: 4,
        exchange_rate: 5,
      },
      categoryTypes: { Savings: 'account' },
      accountBalances: { Savings: '3,177.94' },
      dry_run: false,
    })
    expect(response.status).toBe(200)

    const db = await getDB()
    const transaction = (await db.getAll('transactions'))[0]
    const account = (await db.getAll('accounts'))[0]
    expect(transaction.amount).toBeCloseTo(3177.94, 2)
    expect(transaction.amount_local).toBeCloseTo(1234.56, 2)
    expect(transaction.exchange_rate).toBeCloseTo(7.53, 2)
    expect(account.starting_balance).toBeCloseTo(3177.94, 2)
  })

  it('reports exact invalid row fields during preview and writes nothing', async () => {
    const response = await importExecute({
      rows: [
        ['2026-01-01', 'Bad local', '10.00', '1,234', '1.00'],
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
    expect(body.skipped_items).toEqual([
      { index: 0, reason: 'Invalid amount_local on row 1' },
      { index: 1, reason: 'Invalid exchange_rate on row 2' },
    ])
    expect(await (await getDB()).count('transactions')).toBe(0)
  })

  it('rejects an ambiguous opening balance before creating the account', async () => {
    const response = await importExecute({
      rows: [['2026-01-01', 'Opening', '10.00', 'Savings']],
      mapping: { date: 0, description: 1, amount: 2, category: 3 },
      categoryTypes: { Savings: 'account' },
      accountBalances: { Savings: '1,234' },
      dry_run: false,
    })
    expect(response.status).toBe(422)
    expect(await (await getDB()).count('accounts')).toBe(0)
  })

  it('parses localized amounts on the bulk import endpoint', async () => {
    const response = await importBulk({
      items: [{ description: 'Localized', amount: '3.177,94', date: '2026-01-01' }],
    })
    expect(response.status).toBe(200)

    const transactions = await (await getDB()).getAll('transactions')
    expect(transactions).toHaveLength(1)
    expect(transactions[0].amount).toBeCloseTo(3177.94, 2)
  })

  it('rejects the entire bulk import before writing when any amount is ambiguous', async () => {
    const response = await importBulk({
      items: [
        { description: 'Valid', amount: '10.00', date: '2026-01-01' },
        { description: 'Ambiguous', amount: '1,234', date: '2026-01-02' },
      ],
    })
    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({
      validation_errors: [{ field: 'items.1.amount' }],
    })
    expect(await (await getDB()).count('transactions')).toBe(0)
  })
})
