/**
 * A bank import's rule categories in local-first (importExecute).
 *
 * The Croatian rules give default category names, so a newcomer's first import files its rows
 * into the categories the space was seeded with and offers none of the names the rules used to
 * give ('Salary Eur', 'Apartment (Bills)', 'Car (Gas)'). A space that already holds a category
 * under one of those old names keeps getting the matching rows there, and gets no second category
 * beside it. The rows are hand-written and fake; the categories come from the real rules.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { txnsToTable } from '../../../../../shared/bankImport/canonical'
import { categorize, DEFAULT_CATEGORY_RULES } from '../../../../../shared/bankImport/categoryRules'
import { getDB, seedDefaultCategories } from '../idb.js'
import { importExecute } from '../localHandlers.js'
import type { CanonicalTxn } from '../../../../../shared/bankImport/types'

const RETIRED = ['Salary Eur', 'Apartment (Bills)', 'Car (Gas)']

/** Fake statement lines: description, signed amount. */
const LINES: Array<[string, number]> = [
  ['PETROL TEST STATION 0000', -40],
  ['HEP TEST INVOICE 0000', -55],
  ['ISPLATA PLACE TEST EMPLOYER', 1000],
  ['KONZUM TEST STORE 0000', -12],
]

function ruleTable() {
  const txns: CanonicalTxn[] = LINES.map(([description, amount], i) => ({
    date: `2026-01-0${i + 1}`,
    type: amount < 0 ? 'Expense' : 'Income',
    meansOfPayment: 'Test Giro',
    category: categorize([description], DEFAULT_CATEGORY_RULES),
    amount: Math.abs(amount),
    currency: 'EUR',
    description,
  }))
  return txnsToTable(txns)
}

// Means of Payment is left unmapped: the test is about categories, not accounts.
const MAPPING = { date: 0, type: 1, category: 3, amount: 4, description: 6 }

async function run(dryRun: boolean) {
  const res = await importExecute({ rows: ruleTable().rows, mapping: MAPPING, dry_run: dryRun })
  expect(res.status).toBe(200)
  return (await res.json()) as {
    imported: number
    new_categories: string[]
    created_categories: string[]
  }
}

async function categories() {
  const db = await getDB()
  return (await db.getAllFromIndex('categories', 'by_profile', 1)) as Array<{
    id: number
    name: string
  }>
}

/** Category name of each imported row, by description. */
async function filedUnder(): Promise<Record<string, string | null>> {
  const db = await getDB()
  const byId = new Map((await categories()).map((c) => [c.id, c.name]))
  const txns = await db.getAllFromIndex('transactions', 'by_profile', 1)
  return Object.fromEntries(
    txns.map((t) => [
      String(t.description),
      typeof t.category_id === 'number' ? (byId.get(t.category_id) ?? null) : null,
    ])
  )
}

async function addCategory(name: string, type: 'income' | 'expense') {
  const db = await getDB()
  await db.add('categories', {
    name,
    type,
    color: '#6b7280',
    icon: '',
    parent_id: null,
    created_at: '2026-01-01',
    profile_id: 1,
  })
}

beforeEach(async () => {
  localStorage.clear()
  localStorage.setItem('currentProfileId', '1')
  const db = await getDB()
  for (const store of ['profiles', 'transactions', 'categories', 'accounts', 'budgets']) {
    await db.clear(store)
  }
  await db.add('profiles', { id: 1, name: 'Test', created_at: '2026-01-01' })
})

describe('local-first import: rule categories in a fresh space', () => {
  it('files the rule rows under the default categories and offers no old name', async () => {
    await seedDefaultCategories(1)

    const preview = await run(true)
    expect(preview.new_categories).toEqual(['Groceries'])

    const done = await run(false)
    expect(done.imported).toBe(4)
    expect(done.created_categories).toEqual(['Groceries'])
    expect(await filedUnder()).toEqual({
      'PETROL TEST STATION 0000': 'Transportation',
      'HEP TEST INVOICE 0000': 'Utilities',
      'ISPLATA PLACE TEST EMPLOYER': 'Salary',
      'KONZUM TEST STORE 0000': 'Groceries',
    })
    const names = (await categories()).map((c) => c.name)
    for (const old of RETIRED) expect(names).not.toContain(old)
  })
})

describe('local-first import: a space that holds the old names', () => {
  it('keeps filing the rows under the old names, ahead of the defaults beside them', async () => {
    await seedDefaultCategories(1)
    await addCategory('Car (Gas)', 'expense')
    await addCategory('Apartment (Bills)', 'expense')
    await addCategory('Salary Eur', 'income')
    const before = (await categories()).length

    expect((await run(true)).new_categories).toEqual(['Groceries'])
    await run(false)

    expect(await filedUnder()).toEqual({
      'PETROL TEST STATION 0000': 'Car (Gas)',
      'HEP TEST INVOICE 0000': 'Apartment (Bills)',
      'ISPLATA PLACE TEST EMPLOYER': 'Salary Eur',
      'KONZUM TEST STORE 0000': 'Groceries',
    })
    expect((await categories()).length).toBe(before + 1)
  })

  it('offers and creates no new name beside an old one when the space has no defaults', async () => {
    // Case-blind like every other import match.
    await addCategory('car (gas)', 'expense')
    await addCategory('Apartment (Bills)', 'expense')
    await addCategory('SALARY EUR', 'income')

    expect((await run(true)).new_categories).toEqual(['Groceries'])
    const done = await run(false)
    expect(done.created_categories).toEqual(['Groceries'])

    expect(await filedUnder()).toEqual({
      'PETROL TEST STATION 0000': 'car (gas)',
      'HEP TEST INVOICE 0000': 'Apartment (Bills)',
      'ISPLATA PLACE TEST EMPLOYER': 'SALARY EUR',
      'KONZUM TEST STORE 0000': 'Groceries',
    })
    expect((await categories()).map((c) => c.name).sort()).toEqual(
      ['Apartment (Bills)', 'Groceries', 'SALARY EUR', 'car (gas)'].sort()
    )
  })
})
