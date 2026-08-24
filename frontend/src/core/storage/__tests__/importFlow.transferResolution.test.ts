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
  for (const store of [
    'profiles',
    'transactions',
    'categories',
    'accounts',
    'budgets',
    'settings',
  ]) {
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

  it('reports and skips missing-leg and self transfers without changing balances', async () => {
    const db = await getDB()
    const erste = (await db.add('accounts', {
      name: 'Erste Current',
      type: 'giro',
      balance: 1000,
      starting_balance: 1000,
      profile_id: 1,
    })) as number
    const revolut = (await db.add('accounts', {
      name: 'Revolut',
      type: 'giro',
      balance: 500,
      starting_balance: 500,
      profile_id: 1,
    })) as number
    const rows = [
      ['2026-07-20', 'Missing destination', '200', 'Unknown', 'Erste Current', 'Transfer'],
      ['2026-07-21', 'Self transfer', '100', 'Revolut', 'Revolut', 'Transfer'],
    ]
    const res = await importExecute({
      rows,
      mapping: { date: 0, description: 1, amount: 2, category: 3, means_of_payment: 4, type: 5 },
      dry_run: false,
    })
    const body = (await res.json()) as {
      imported: number
      skipped: number
      skipped_items: Array<{ index: number; reason: string; label?: string }>
    }
    expect(body.imported).toBe(0)
    expect(body.skipped).toBe(2)
    expect(body.skipped_items.map((item) => item.index)).toEqual([0, 1])

    // Both rejections must be actionable: name the row the way it appears in the sheet, and for
    // the self-transfer say which account both legs landed on and which columns decide them —
    // "source and destination must be different" alone leaves the user hunting for the cell.
    expect(body.skipped_items[0].label).toBe('2026-07-20 · Missing destination')
    expect(body.skipped_items[1].label).toBe('2026-07-21 · Self transfer')
    expect(body.skipped_items[1].reason).toContain('both sides resolve to "Revolut"')
    expect(body.skipped_items[1].reason).toContain('Means of Payment')
    // The missing-leg row has no single account to blame, so it keeps the plain invariant text.
    expect(body.skipped_items[0].reason).not.toContain('both sides resolve to')
    expect((await db.get('accounts', erste))?.balance).toBe(1000)
    expect((await db.get('accounts', revolut))?.balance).toBe(500)
    expect(await db.getAllFromIndex('transactions', 'by_profile', 1)).toHaveLength(0)
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

describe('a first import, before any account exists', () => {
  // The reported case: onboarding, Google Sheet connected, 341 transfer rows — every one
  // rejected with "A transfer must have both source and destination accounts", because nothing
  // ever enumerated the Means-of-Payment column as accounts to create.
  const rows = [
    ['2026-07-22', 'Top-up by *1111', '150', 'Revolut', 'Erste Current', 'Transfer'],
    ['2026-07-20', 'Groceries', '42', 'Food', 'Erste Current', 'Expense'],
  ]
  const mapping = { date: 0, description: 1, amount: 2, category: 3, means_of_payment: 4, type: 5 }

  it('offers BOTH sides of the transfer as accounts to create', async () => {
    const res = await importExecute({ rows, mapping, dry_run: true })
    const body = (await res.json()) as { new_accounts?: string[] }
    const offered = (body.new_accounts ?? []).map((n) => n.toLowerCase())

    // The source comes from Means of Payment — the column nothing used to read.
    expect(offered).toContain('erste current')
    // The destination is an account by construction: the row's own type says transfer.
    expect(offered).toContain('revolut')
    // The expense row's category stays a category.
    expect(offered).not.toContain('food')
  })

  it('rejects the unresolved transfer naming the side and the value, not just the rule', async () => {
    const res = await importExecute({ rows: [rows[0]!], mapping, dry_run: true })
    const body = (await res.json()) as {
      skipped_items: Array<{ reason: string }>
    }
    const reason = body.skipped_items[0]?.reason ?? ''
    expect(reason).toContain('Erste Current')
    expect(reason).toContain('Revolut')
    expect(reason).toContain('Means of Payment')
  })

  it('imports the transfer once both are approved as accounts', async () => {
    const res = await importExecute({
      rows: [rows[0]!],
      mapping,
      categoryTypes: { Revolut: 'account', 'Erste Current': 'account' },
      dry_run: false,
    })
    const body = (await res.json()) as { imported: number; skipped: number }
    expect(body.skipped).toBe(0)
    expect(body.imported).toBe(1)

    const db = await getDB()
    const tx = (await db.getAllFromIndex('transactions', 'by_profile', 1))[0]!
    expect(tx.type).toBe('transfer')
    expect(tx.account_id).not.toBeNull()
    expect(tx.transfer_account_id).not.toBeNull()
    expect(tx.account_id).not.toBe(tx.transfer_account_id)
  })
})
