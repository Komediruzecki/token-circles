/**
 * Two-sided transfer linking in the serverless import (importExecute).
 *
 * Bank imports emit a transfer as a single canonical row: means_of_payment =
 * source account, category = destination account, type = Transfer. Execute must
 * link account_id (source) AND transfer_account_id (destination) so the balance
 * moves on both sides — matching the worker import. These tests pin that, and
 * guard that transfers whose category is NOT an account keep their prior
 * (one-sided) behavior.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { getDB } from '../idb.js'
import { importExecute } from '../localHandlers.js'

async function resetDb() {
  const db = await getDB()
  for (const store of ['profiles', 'transactions', 'categories', 'accounts', 'budgets']) {
    await db.clear(store)
  }
  await db.add('profiles', { id: 1, name: 'Test', created_at: '2026-01-01' })
}

const MAPPING = {
  date: 0,
  type: 1,
  means_of_payment: 2,
  category: 3,
  amount: 4,
  currency: 5,
  description: 6,
}

describe('importExecute — two-sided transfers (bank imports)', () => {
  beforeEach(async () => {
    localStorage.clear()
    localStorage.setItem('currentProfileId', '1')
    await resetDb()
  })

  it('links means_of_payment as source and the account-category as destination', async () => {
    const db = await getDB()
    const erste = (await db.add('accounts', {
      name: 'Erste Current',
      balance: 1000,
      profile_id: 1,
    })) as number
    const revolut = (await db.add('accounts', {
      name: 'Revolut',
      balance: 100,
      profile_id: 1,
    })) as number

    // Outbound: money leaves Erste (source) → Revolut (destination).
    const rows = [
      ['2026-05-20', 'Transfer', 'Erste Current', 'Revolut', '200', 'EUR', 'To Revolut'],
    ]
    const res = await importExecute({
      rows,
      mapping: MAPPING,
      categoryTypes: { Revolut: 'account' },
      dry_run: false,
    })
    expect((await res.json()).imported).toBe(1)

    const txns = await db.getAllFromIndex('transactions', 'by_profile', 1)
    expect(txns).toHaveLength(1)
    expect(txns[0].type).toBe('transfer')
    expect(txns[0].account_id).toBe(erste) // source
    expect(txns[0].transfer_account_id).toBe(revolut) // destination
    expect(txns[0].amount).toBe(200)

    expect((await db.get('accounts', erste)).balance).toBe(800) // 1000 - 200
    expect((await db.get('accounts', revolut)).balance).toBe(300) // 100 + 200
  })

  it('respects direction when the target account is the source', async () => {
    const db = await getDB()
    const erste = (await db.add('accounts', {
      name: 'Erste Current',
      balance: 1000,
      profile_id: 1,
    })) as number
    const revolut = (await db.add('accounts', {
      name: 'Revolut',
      balance: 100,
      profile_id: 1,
    })) as number

    // Money leaves Revolut (source) → Erste (destination).
    const rows = [['2026-05-21', 'Transfer', 'Revolut', 'Erste Current', '50', 'EUR', 'Move out']]
    await importExecute({
      rows,
      mapping: MAPPING,
      categoryTypes: { 'Erste Current': 'account' },
      dry_run: false,
    })

    const txns = await db.getAllFromIndex('transactions', 'by_profile', 1)
    expect(txns[0].account_id).toBe(revolut)
    expect(txns[0].transfer_account_id).toBe(erste)
    expect((await db.get('accounts', revolut)).balance).toBe(50) // 100 - 50
    expect((await db.get('accounts', erste)).balance).toBe(1050) // 1000 + 50
  })

  it('leaves category-not-an-account transfers one-sided (no behavior change)', async () => {
    const db = await getDB()
    const erste = (await db.add('accounts', {
      name: 'Erste Current',
      balance: 1000,
      profile_id: 1,
    })) as number

    // Category "Other" is not an account → destination unresolved. Prior behavior:
    // means_of_payment becomes the transfer account (credited).
    const rows = [
      ['2026-05-22', 'Transfer', 'Erste Current', 'Other', '100', 'EUR', 'Legacy style'],
    ]
    await importExecute({ rows, mapping: MAPPING, categoryTypes: {}, dry_run: false })

    const txns = await db.getAllFromIndex('transactions', 'by_profile', 1)
    expect(txns[0].account_id ?? null).toBeNull()
    expect(txns[0].transfer_account_id).toBe(erste)
    expect((await db.get('accounts', erste)).balance).toBe(1100) // unchanged prior behavior
  })

  it('nets a same-account (self) transfer to zero', async () => {
    const db = await getDB()
    const revolut = (await db.add('accounts', {
      name: 'Revolut',
      balance: 100,
      profile_id: 1,
    })) as number
    // means_of_payment and category both resolve to the SAME account.
    const rows = [['2026-05-23', 'Transfer', 'Revolut', 'Revolut', '40', 'EUR', 'Self move']]
    await importExecute({
      rows,
      mapping: MAPPING,
      categoryTypes: { Revolut: 'account' },
      dry_run: false,
    })
    const txns = await db.getAllFromIndex('transactions', 'by_profile', 1)
    expect(txns[0].account_id).toBe(revolut)
    expect(txns[0].transfer_account_id).toBe(revolut)
    expect((await db.get('accounts', revolut)).balance).toBe(100) // -40 then +40 = net 0
  })
})
