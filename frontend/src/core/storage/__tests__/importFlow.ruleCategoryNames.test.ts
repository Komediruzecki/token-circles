/**
 * A bank import's rule categories in local-first (importExecute).
 *
 * The rules give default category names, so a newcomer's first import files its rows into the
 * categories the space was seeded with and offers no second name beside a default: not the
 * Croatian rules' old 'Car (Gas)', 'Apartment (Bills)' and 'Salary Eur', and not 'Transport' or
 * 'Health'. A space that already holds a category under a name a rule gave before keeps getting
 * that rule's rows there, even where two rules now give one name: fuel under 'Car (Gas)' and
 * parking under 'Transport'.
 *
 * The rows come from a made-up Revolut statement run through the real rules, given the names of
 * the space's categories, as the import page passes them (features/import/importFlow.ts). Mirrors
 * worker/test/import-rule-category-names.test.ts.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { processFiles } from '../../../../../shared/bankImport/process'
import { getDB, seedDefaultCategories } from '../idb.js'
import { importExecute } from '../localHandlers.js'

const REVOLUT_HEADER =
  'Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance'

/** Fake statement lines: description, signed amount. Every name and number is made up. */
const LINES: Array<[string, number]> = [
  ['PETROL TEST STATION 0000', -40],
  ['PARKING TEST GARAGE 0000', -3],
  ['LJEKARNA TEST 0000', -9],
  ['HEP TEST INVOICE 0000', -55],
  ['ISPLATA PLACE TEST EMPLOYER', 1000],
  ['KONZUM TEST STORE 0000', -12],
]

/** Lines only the parking rule matches. */
const PARKING_LINES: Array<[string, number]> = [
  ['PARKING TEST GARAGE 0000', -3],
  ['ZET TEST TICKET 0000', -2],
]

function statement(lines: Array<[string, number]>): Uint8Array {
  const rows = lines.map(([description, amount], i) => {
    const day = `2026-01-${String(i + 1).padStart(2, '0')}`
    const kind = amount < 0 ? 'CARD_PAYMENT' : 'DEPOSIT'
    return `${kind},Current,${day} 09:00:00,${day} 09:00:05,${description},${amount.toFixed(2)},0.00,EUR,COMPLETED,0.00`
  })
  return new TextEncoder().encode([REVOLUT_HEADER, ...rows].join('\n'))
}

async function categories() {
  const db = await getDB()
  return (await db.getAllFromIndex('categories', 'by_profile', 1)) as Array<{
    id: number
    name: string
  }>
}

/** The statement's rows as the rules categorize them for this space. */
async function ruleRows(lines = LINES): Promise<string[][]> {
  const categoryNames = (await categories()).map((c) => c.name)
  const result = await processFiles(
    [
      {
        filename: 'account-statement_test.csv',
        bytes: statement(lines),
        bankId: 'revolut',
        targetAccount: 'Test Giro',
      },
    ],
    { categoryNames }
  )
  expect(result.rows).toHaveLength(lines.length)
  return result.rows
}

// Means of Payment is left unmapped: the test is about categories, not accounts.
const MAPPING = { date: 0, type: 1, category: 3, amount: 4, description: 6 }

async function run(rows: string[][], dryRun: boolean) {
  const res = await importExecute({ rows, mapping: MAPPING, dry_run: dryRun })
  expect(res.status).toBe(200)
  return (await res.json()) as {
    imported: number
    new_categories: string[]
    created_categories: string[]
  }
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

/** The categories a space made from the rules before they gave default names. */
async function addOldNames() {
  await addCategory('Car (Gas)', 'expense')
  await addCategory('Transport', 'expense')
  await addCategory('Health', 'expense')
  await addCategory('Apartment (Bills)', 'expense')
  await addCategory('Salary Eur', 'income')
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
  it('files the rows under the default categories and offers no second name', async () => {
    await seedDefaultCategories(1)
    const rows = await ruleRows()

    // Every name these rules give is a default, Groceries included, so nothing is new.
    expect((await run(rows, true)).new_categories).toEqual([])

    const done = await run(rows, false)
    expect(done.imported).toBe(6)
    expect(done.created_categories).toEqual([])
    expect(await filedUnder()).toEqual({
      'PETROL TEST STATION 0000': 'Transportation',
      'PARKING TEST GARAGE 0000': 'Transportation',
      'LJEKARNA TEST 0000': 'Healthcare',
      'HEP TEST INVOICE 0000': 'Utilities',
      'ISPLATA PLACE TEST EMPLOYER': 'Salary',
      'KONZUM TEST STORE 0000': 'Groceries',
    })
  })
})

describe('local-first import: a space that holds the names the rules gave before', () => {
  it('keeps filing each rule’s rows under its old name, ahead of the defaults', async () => {
    await seedDefaultCategories(1)
    await addOldNames()
    const before = (await categories()).length
    const rows = await ruleRows()

    expect((await run(rows, true)).new_categories).toEqual([])
    await run(rows, false)

    expect(await filedUnder()).toEqual({
      'PETROL TEST STATION 0000': 'Car (Gas)',
      'PARKING TEST GARAGE 0000': 'Transport',
      'LJEKARNA TEST 0000': 'Health',
      'HEP TEST INVOICE 0000': 'Apartment (Bills)',
      'ISPLATA PLACE TEST EMPLOYER': 'Salary Eur',
      'KONZUM TEST STORE 0000': 'Groceries',
    })
    expect((await categories()).length).toBe(before)
  })

  it('creates no new name beside an old one when the space has no defaults', async () => {
    // Case-blind like every other import match.
    await addCategory('car (gas)', 'expense')
    await addCategory('TRANSPORT', 'expense')
    await addCategory('Health', 'expense')
    await addCategory('Apartment (Bills)', 'expense')
    await addCategory('SALARY EUR', 'income')
    const rows = await ruleRows()

    expect((await run(rows, true)).new_categories).toEqual(['Groceries'])
    expect((await run(rows, false)).created_categories).toEqual(['Groceries'])

    expect(await filedUnder()).toEqual({
      'PETROL TEST STATION 0000': 'car (gas)',
      'PARKING TEST GARAGE 0000': 'TRANSPORT',
      'LJEKARNA TEST 0000': 'Health',
      'HEP TEST INVOICE 0000': 'Apartment (Bills)',
      'ISPLATA PLACE TEST EMPLOYER': 'SALARY EUR',
      'KONZUM TEST STORE 0000': 'Groceries',
    })
  })

  it('keeps filing parking under Transport in a space with no Car (Gas)', async () => {
    await seedDefaultCategories(1)
    await addCategory('Transport', 'expense')
    const rows = await ruleRows()

    expect((await run(rows, true)).new_categories).toEqual([])
    await run(rows, false)

    const filed = await filedUnder()
    expect(filed['PARKING TEST GARAGE 0000']).toBe('Transport')
    expect(filed['PETROL TEST STATION 0000']).toBe('Transportation')
  })

  it('offers no category to a space with only Transport', async () => {
    await addCategory('Transport', 'expense')
    const rows = await ruleRows(PARKING_LINES)

    expect((await run(rows, true)).new_categories).toEqual([])
    expect((await run(rows, false)).created_categories).toEqual([])

    expect(await filedUnder()).toEqual({
      'PARKING TEST GARAGE 0000': 'Transport',
      'ZET TEST TICKET 0000': 'Transport',
    })
    expect((await categories()).map((c) => c.name)).toEqual(['Transport'])
  })
})

describe('local-first import: a category the file names itself', () => {
  it('files under that name, even beside a name the rules gave before', async () => {
    // Only a rule remembers what it gave before. A sheet or CSV that says Salary means Salary.
    await seedDefaultCategories(1)
    await addCategory('Salary Eur', 'income')
    const rows = [['2026-01-05', 'Income', '', 'Salary', '1000', 'EUR', 'TEST EMPLOYER PAY']]

    expect((await run(rows, true)).new_categories).toEqual([])
    await run(rows, false)

    expect(await filedUnder()).toEqual({ 'TEST EMPLOYER PAY': 'Salary' })
  })
})
