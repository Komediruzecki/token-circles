/**
 * Transfer account resolution + accounts-to-create preview for the IndexedDB import path.
 *
 * The serverless importExecute previously seeded its account map ONLY from category values
 * flagged 'account' in the current import, never from existing accounts. So a transfer whose
 * destination named an account that already existed (e.g. "Revolut") failed to resolve its
 * second leg (transfer_account_id null) and silently drained the source — the −39K bug. It
 * now seeds all existing accounts by name, matching the worker / Express backend.
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

beforeEach(async () => {
  localStorage.clear()
  localStorage.setItem('currentProfileId', '1')
  await resetDb()
})

describe('importExecute — transfer resolves against existing accounts', () => {
  it('resolves BOTH legs when the destination names an existing account not flagged in this import', async () => {
    const db = await getDB()
    const erste = (await db.add('accounts', {
      name: 'Erste Current',
      type: 'giro',
      balance: 0,
      starting_balance: 0,
      profile_id: 1,
    })) as number
    const revolut = (await db.add('accounts', {
      name: 'Revolut',
      type: 'giro',
      balance: 0,
      starting_balance: 0,
      profile_id: 1,
    })) as number

    // category=Revolut is an existing account but is NOT marked 'account' in categoryTypes.
    const rows = [['2026-07-20', 'Top-up', '200', 'Revolut', 'Erste Current', 'Transfer']]
    const res = await importExecute({
      rows,
      mapping: { date: 0, description: 1, amount: 2, category: 3, means_of_payment: 4, type: 5 },
      dry_run: false,
    })
    expect(((await res.json()) as { imported: number }).imported).toBe(1)

    const tx = (await db.getAllFromIndex('transactions', 'by_profile', 1)).find(
      (t) => t.description === 'Top-up'
    )!
    expect(tx.type).toBe('transfer')
    expect(tx.account_id).toBe(erste) // source leg
    expect(tx.transfer_account_id).toBe(revolut) // destination leg — the fix
  })

  it('resolves a transfer whose destination category has stray trailing whitespace', async () => {
    const db = await getDB()
    // "Revolut " (trailing space, as a sheet cell can carry) previously created an account
    // keyed "revolut " that the trimmed row-side lookup "revolut" never matched, so the
    // destination leg dropped (transfer_account_id null → "Erste Current → —").
    const rows = [['2026-07-20', 'Top-up', '200', 'Revolut ', 'Erste Current', 'Transfer']]
    const res = await importExecute({
      rows,
      mapping: { date: 0, description: 1, amount: 2, category: 3, means_of_payment: 4, type: 5 },
      categoryTypes: { 'Revolut ': 'account', 'Erste Current': 'account' },
      dry_run: false,
    })
    expect(((await res.json()) as { imported: number }).imported).toBe(1)
    const tx = (await db.getAllFromIndex('transactions', 'by_profile', 1)).find(
      (t) => t.description === 'Top-up'
    )!
    const accts = await db.getAllFromIndex('accounts', 'by_profile', 1)
    const erste = accts.find((a) => String(a.name).trim().toLowerCase() === 'erste current')!
    const revolut = accts.find((a) => String(a.name).trim().toLowerCase() === 'revolut')!
    expect(tx.account_id).toBe(erste.id)
    expect(tx.transfer_account_id).toBe(revolut.id)
  })
})

describe('importExecute — dry run reports accounts to be created', () => {
  it('lists account-typed values that do not exist yet and omits existing ones', async () => {
    const db = await getDB()
    await db.add('accounts', {
      name: 'Revolut',
      type: 'giro',
      balance: 0,
      starting_balance: 0,
      profile_id: 1,
    })
    const rows = [
      ['2026-07-20', 'Top-up', '200', 'Revolut', 'Erste Current', 'Transfer'], // Revolut exists
      ['2026-07-21', 'Buy', '50', 'IB', 'Erste Current', 'Transfer'], // IB is new
    ]
    const res = await importExecute({
      rows,
      mapping: { date: 0, description: 1, amount: 2, category: 3, means_of_payment: 4, type: 5 },
      categoryTypes: { Revolut: 'account', IB: 'account' },
      dry_run: true,
    })
    const body = (await res.json()) as { new_accounts: string[] }
    expect(body.new_accounts).toContain('IB')
    expect(body.new_accounts).not.toContain('Revolut')
  })
})

describe('importExecute — configured account currency', () => {
  it('uses the normalized configured currency for new accounts and rows without a currency', async () => {
    const db = await getDB()
    const res = await importExecute({
      rows: [['2026-07-20', 'Opening deposit', '200', 'Savings']],
      mapping: { date: 0, description: 1, amount: 2, category: 3 },
      categoryTypes: { Savings: 'account' },
      defaultCurrency: ' chf ',
      dry_run: false,
    })
    expect(((await res.json()) as { imported: number }).imported).toBe(1)

    const account = (await db.getAllFromIndex('accounts', 'by_profile', 1)).find(
      (item) => item.name === 'savings'
    )
    const transaction = (await db.getAllFromIndex('transactions', 'by_profile', 1)).find(
      (item) => item.description === 'Opening deposit'
    )
    expect(account?.currency).toBe('CHF')
    expect(transaction?.currency).toBe('CHF')
  })

  it('falls back to the local EUR setting when the request currency is invalid', async () => {
    localStorage.setItem('localCurrency', 'EUR')
    const db = await getDB()
    const res = await importExecute({
      rows: [['2026-07-20', 'Opening deposit', '200', 'Savings']],
      mapping: { date: 0, description: 1, amount: 2, category: 3 },
      categoryTypes: { Savings: 'account' },
      defaultCurrency: 'not-a-currency',
      dry_run: false,
    })
    expect(((await res.json()) as { imported: number }).imported).toBe(1)

    const account = (await db.getAllFromIndex('accounts', 'by_profile', 1)).find(
      (item) => item.name === 'savings'
    )
    expect(account?.currency).toBe('EUR')
  })
})
