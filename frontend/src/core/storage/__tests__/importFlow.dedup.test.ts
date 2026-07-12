/**
 * Resolution-aware duplicate detection (audit A2) and confirm-before-create
 * categories (audit B5) for the IndexedDB import path (importExecute).
 *
 * A2: duplicate detection keys on the RESOLVED (date, description, account_id,
 *     type, currency) with a ±0.01 amount tolerance, so rows that merely share
 *     date+description+amount but differ in account/type/currency all import.
 * B5: category auto-creation is gated by an `approvedCategories` list when present;
 *     absent keeps the auto-create-all behavior.
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

describe('importExecute — resolution-aware duplicate detection (A2)', () => {
  it('imports two rows with the same date/description/amount but DIFFERENT accounts', async () => {
    const db = await getDB()
    await db.add('accounts', { name: 'Cash', balance: 0, profile_id: 1 })
    await db.add('accounts', { name: 'Card', balance: 0, profile_id: 1 })

    const rows = [
      ['2026-06-01', 'Lunch', '-20', 'Cash'],
      ['2026-06-01', 'Lunch', '-20', 'Card'],
    ]
    const res = await importExecute({
      rows,
      mapping: { date: 0, description: 1, amount: 2, means_of_payment: 3 },
      dry_run: false,
    })
    const body = (await res.json()) as { imported: number; duplicates: number }
    expect(body.imported).toBe(2)
    expect(body.duplicates).toBe(0)

    const txns = await db.getAllFromIndex('transactions', 'by_profile', 1)
    expect(txns).toHaveLength(2)
    expect(new Set(txns.map((t) => t.account_id)).size).toBe(2)
  })

  it('imports an income and an expense of the same date/description/amount', async () => {
    const db = await getDB()
    const rows = [
      ['2026-06-02', 'Adjustment', '50'], // positive → income
      ['2026-06-02', 'Adjustment', '-50'], // negative → expense
    ]
    const res = await importExecute({
      rows,
      mapping: { date: 0, description: 1, amount: 2 },
      dry_run: false,
    })
    const body = (await res.json()) as { imported: number; duplicates: number }
    expect(body.imported).toBe(2)
    expect(body.duplicates).toBe(0)

    const txns = await db.getAllFromIndex('transactions', 'by_profile', 1)
    expect(new Set(txns.map((t) => t.type))).toEqual(new Set(['income', 'expense']))
  })

  it('flags a truly-identical row against an existing transaction and does not double-insert', async () => {
    const db = await getDB()
    await db.add('transactions', {
      profile_id: 1,
      type: 'expense',
      description: 'Bill',
      date: '2026-06-03',
      amount: 30,
      currency: 'EUR',
      account_id: null,
    })

    const rows = [['2026-06-03', 'Bill', '-30']]
    const res = await importExecute({
      rows,
      mapping: { date: 0, description: 1, amount: 2 },
      dry_run: false,
    })
    const body = (await res.json()) as { imported: number; duplicates: number }
    expect(body.imported).toBe(0)
    expect(body.duplicates).toBe(1)

    const txns = await db.getAllFromIndex('transactions', 'by_profile', 1)
    expect(txns).toHaveLength(1) // not double-inserted
  })

  it('flags the second of two identical rows within one file (in-file dedup)', async () => {
    const db = await getDB()
    const rows = [
      ['2026-06-04', 'Bill', '-30'],
      ['2026-06-04', 'Bill', '-30'],
    ]
    const res = await importExecute({
      rows,
      mapping: { date: 0, description: 1, amount: 2 },
      dry_run: false,
    })
    const body = (await res.json()) as {
      imported: number
      duplicates: number
      duplicate_indices: number[]
    }
    expect(body.imported).toBe(1)
    expect(body.duplicates).toBe(1)
    expect(body.duplicate_indices).toEqual([1])

    const txns = await db.getAllFromIndex('transactions', 'by_profile', 1)
    expect(txns).toHaveLength(1)
  })
})

describe('importExecute — confirm before creating categories (B5)', () => {
  const MAPPING = { date: 0, description: 1, amount: 2, category: 3 }

  it('creates only approved categories; unapproved rows import uncategorized', async () => {
    const db = await getDB()
    const rows = [
      ['2026-07-01', 'Apples', '-10', 'Groceries'],
      ['2026-07-02', 'Widget', '-15', 'Junk'],
    ]
    const res = await importExecute({
      rows,
      mapping: MAPPING,
      approvedCategories: ['Groceries'],
      dry_run: false,
    })
    const body = (await res.json()) as { imported: number; created_categories: string[] }
    expect(body.imported).toBe(2)

    const cats = await db.getAllFromIndex('categories', 'by_profile', 1)
    const catNames = cats.map((c) => c.name)
    expect(catNames).toContain('Groceries')
    expect(catNames).not.toContain('Junk')

    const txns = await db.getAllFromIndex('transactions', 'by_profile', 1)
    const groceriesCat = cats.find((c) => c.name === 'Groceries')!
    const apples = txns.find((t) => t.description === 'Apples')!
    const widget = txns.find((t) => t.description === 'Widget')!
    expect(apples.category_id).toBe(groceriesCat.id)
    expect(widget.category_id ?? null).toBeNull() // uncategorized, not skipped
  })

  it('auto-creates ALL categories when the field is absent (backward-compat)', async () => {
    const db = await getDB()
    const rows = [
      ['2026-07-01', 'Apples', '-10', 'Groceries'],
      ['2026-07-02', 'Widget', '-15', 'Junk'],
    ]
    const res = await importExecute({ rows, mapping: MAPPING, dry_run: false })
    const body = (await res.json()) as { categories_created: number }
    expect(body.categories_created).toBe(2)

    const catNames = (await db.getAllFromIndex('categories', 'by_profile', 1)).map((c) => c.name)
    expect(catNames).toContain('Groceries')
    expect(catNames).toContain('Junk')
  })

  it('preview (dry_run) reports the distinct new categories', async () => {
    const db = await getDB()
    await db.add('categories', { name: 'Groceries', type: 'expense', profile_id: 1 })

    const rows = [
      ['2026-07-01', 'Apples', '-10', 'Groceries'], // existing → not new
      ['2026-07-02', 'Widget', '-15', 'Junk'], // new
      ['2026-07-03', 'Gadget', '-5', 'Junk'], // same new value → distinct
    ]
    const res = await importExecute({ rows, mapping: MAPPING, dry_run: true })
    const body = (await res.json()) as { new_categories: string[] }
    expect(body.new_categories).toEqual(['Junk'])
  })
})
