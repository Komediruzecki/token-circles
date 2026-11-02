/**
 * The Bank Imports flow files a statement's rows by the rules, given the categories of the profile
 * it imports into, with the real flow and the local-first router behind it.
 *
 * A built-in rule that gives a default name now remembers the names it gave before
 * (shared/bankImport/categoryRules.ts), and gives one of those where the profile still has a
 * category under it. So the flow reads the profile's categories before it runs the rules: a fresh
 * profile is offered no second name beside a default, and one made from the old rules keeps fuel
 * under 'Car (Gas)' and parking under 'Transport'. A local-first category list answers for every
 * profile in the household, so the flow keeps only the target profile's. Every line of the
 * statement is made up.
 */
import { createRoot } from 'solid-js'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { setPage } from '../../../core/appStore'
import croatian5173 from '../../../core/bankImport/__tests__/fixtures/built-in-rules-croatian-v5.17.3.json'
import { __resetDataVersionsForTest } from '../../../core/dataVersions'
import { DEFAULT_CATEGORIES, getDB } from '../../../core/storage/idb'
import type * as ApiFetchModule from '../../../core/apiFetch'
import type { ImportFlow } from '../importFlow'

/** Set to answer the category list with a server error. */
const categoriesFail = vi.hoisted(() => ({ on: false }))

vi.mock('../../../core/apiFetch', async (importOriginal) => {
  const real = await importOriginal<typeof ApiFetchModule>()
  return {
    ...real,
    apiFetch: (url: string, init?: RequestInit) =>
      categoriesFail.on && url.startsWith('/api/categories')
        ? Promise.resolve(new Response('{"error":"Test failure"}', { status: 500 }))
        : real.apiFetch(url, init),
  }
})

const REVOLUT_HEADER =
  'Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance'

/** Fake statement lines: description, signed amount. */
const LINES: Array<[string, number]> = [
  ['PETROL TEST STATION 0000', -40],
  ['PARKING TEST GARAGE 0000', -3],
  ['LJEKARNA TEST 0000', -9],
  ['KONZUM TEST STORE 0000', -12],
]

function statement(): File {
  const rows = LINES.map(([description, amount], i) => {
    const day = `2026-01-${String(i + 1).padStart(2, '0')}`
    return `CARD_PAYMENT,Current,${day} 09:00:00,${day} 09:00:05,${description},${amount.toFixed(2)},0.00,EUR,COMPLETED,0.00`
  })
  return new File([[REVOLUT_HEADER, ...rows].join('\n')], 'account-statement_2026-01.csv', {
    type: 'text/csv',
  })
}

let dispose: (() => void) | undefined

beforeAll(async () => {
  await Promise.all([import('../importFlow'), import('../../../core/storage/localApiRouter')])
}, 120_000)

type Db = { add(store: string, row: unknown): Promise<unknown> }

async function addCategories(profileId: number, names: string[]) {
  const db = (await getDB()) as unknown as Db
  for (const name of names) {
    await db.add('categories', {
      name,
      type: 'expense',
      color: '#6b7280',
      icon: '',
      parent_id: null,
      created_at: '2026-01-01',
      profile_id: profileId,
    })
  }
}

const DEFAULT_NAMES = DEFAULT_CATEGORIES.map((c) => c.name)

beforeEach(async () => {
  categoriesFail.on = false
  localStorage.clear()
  localStorage.setItem('finance_storage_mode', 'serverless')
  localStorage.setItem('currentProfileId', '1')
  localStorage.setItem('selectedProfileIds', '[1]')
  __resetDataVersionsForTest()
  const db = await getDB()
  for (const store of Array.from(db.objectStoreNames)) await db.clear(store)
  const add = (db as unknown as Db).add.bind(db)
  await add('profiles', { id: 1, name: 'Home', created_at: '2026-01-01T00:00:00.000Z' })
  await add('profiles', { id: 2, name: 'Other', created_at: '2026-01-01T00:00:00.000Z' })
  await add('accounts', {
    id: 5,
    profile_id: 1,
    name: 'Test Giro',
    type: 'giro',
    currency: 'EUR',
    balance: 0,
  })
})

afterEach(() => {
  dispose?.()
  dispose = undefined
})

/** Drop the statement on the Bank Imports tab, process it and open the preview. */
async function previewStatement(): Promise<ImportFlow> {
  setPage('import')
  const { createImportFlow } = await import('../importFlow')
  let flow!: ImportFlow
  dispose = createRoot((disposeRoot) => {
    flow = createImportFlow({ initialTab: 'bank-imports' })
    flow.init()
    return disposeRoot
  })
  await vi.waitFor(() => {
    expect(flow.bankAccounts().map((a) => a.name)).toContain('Test Giro')
  })
  // What the file input on the Bank Imports tab hands the flow.
  flow.handleBankFileSelect({ target: { files: [statement()], value: '' } } as unknown as Event)
  await vi.waitFor(() => {
    expect(flow.bankFiles().map((f) => f.bankId)).toEqual(['revolut'])
    expect(flow.loading()).toBe(false)
  })
  flow.updateBankFile(0, { targetAccount: 'Test Giro' })
  await flow.processBankFiles()
  if (flow.error()) return flow
  await flow.goToPreview()
  return flow
}

/** Category name of each row imported into `profileId`, by description. */
async function filedUnder(profileId = 1): Promise<Record<string, string | null>> {
  const db = await getDB()
  const cats = await db.getAllFromIndex('categories', 'by_profile', profileId)
  const byId = new Map(cats.map((c) => [c.id, String(c.name)]))
  const txns = await db.getAllFromIndex('transactions', 'by_profile', profileId)
  return Object.fromEntries(
    txns.map((t) => [
      String(t.description),
      typeof t.category_id === 'number' ? (byId.get(t.category_id) ?? null) : null,
    ])
  )
}

async function categoryNames(profileId: number): Promise<string[]> {
  const db = await getDB()
  return (await db.getAllFromIndex('categories', 'by_profile', profileId)).map((c) =>
    String(c.name)
  )
}

describe('a bank import into a profile with the default categories', () => {
  it('offers no second name beside a default and files the rows under the defaults', async () => {
    await addCategories(1, DEFAULT_NAMES)
    const flow = await previewStatement()

    // Every name these rules give is a default, Groceries included.
    expect(flow.newCategories()).toEqual([])
    await flow.handleImport('all')

    expect(await filedUnder()).toEqual({
      'PETROL TEST STATION 0000': 'Transportation',
      'PARKING TEST GARAGE 0000': 'Transportation',
      'LJEKARNA TEST 0000': 'Healthcare',
      'KONZUM TEST STORE 0000': 'Groceries',
    })
  })
})

describe('a bank import into a profile made from the old rules', () => {
  it('keeps fuel under Car (Gas), parking under Transport and the pharmacy under Health', async () => {
    await addCategories(1, [...DEFAULT_NAMES, 'Car (Gas)', 'Transport', 'Health'])
    const flow = await previewStatement()

    expect(flow.newCategories()).toEqual([])
    await flow.handleImport('all')

    expect(await filedUnder()).toEqual({
      'PETROL TEST STATION 0000': 'Car (Gas)',
      'PARKING TEST GARAGE 0000': 'Transport',
      'LJEKARNA TEST 0000': 'Health',
      'KONZUM TEST STORE 0000': 'Groceries',
    })
  })
})

describe('a bank import into a profile that switched the mapping on 5.17.3', () => {
  it('runs the rules as they are now, not the copy of the old ones the switch stored', async () => {
    await addCategories(1, DEFAULT_NAMES)
    localStorage.setItem('bankImportRuleGroup:1', 'croatian')
    localStorage.setItem('bankImportCategoryRules:1', JSON.stringify(croatian5173))
    const flow = await previewStatement()

    expect(flow.newCategories()).toEqual([])
    await flow.handleImport('all')

    expect(await filedUnder()).toEqual({
      'PETROL TEST STATION 0000': 'Transportation',
      'PARKING TEST GARAGE 0000': 'Transportation',
      'LJEKARNA TEST 0000': 'Healthcare',
      'KONZUM TEST STORE 0000': 'Groceries',
    })
  })
})

describe('a bank import while the household shows another profile', () => {
  it('files by the categories of the profile it imports into, not the other one', async () => {
    localStorage.setItem('selectedProfileIds', '[1,2]')
    await addCategories(1, DEFAULT_NAMES)
    await addCategories(2, ['Car (Gas)', 'Transport', 'Health'])
    const flow = await previewStatement()

    // Profile 2's old names would have been offered to profile 1 as new categories.
    expect(flow.newCategories()).toEqual([])
    await flow.handleImport('all')

    expect(await filedUnder(1)).toEqual({
      'PETROL TEST STATION 0000': 'Transportation',
      'PARKING TEST GARAGE 0000': 'Transportation',
      'LJEKARNA TEST 0000': 'Healthcare',
      'KONZUM TEST STORE 0000': 'Groceries',
    })
    expect(await categoryNames(1)).toEqual(DEFAULT_NAMES)
  })
})

describe('a bank import when the categories cannot be read', () => {
  it('says so and files nothing, rather than guessing', async () => {
    await addCategories(1, [...DEFAULT_NAMES, 'Car (Gas)', 'Transport'])
    categoriesFail.on = true
    const { BANK_CATEGORIES_UNREAD } = await import('../importFlow')
    const flow = await previewStatement()

    expect(flow.error()).toBe(BANK_CATEGORIES_UNREAD)
    expect(flow.activeStep()).toBe('upload')
    expect(flow.currentRows()).toEqual([])
  })
})

describe('the categories the rules editor suggests', () => {
  it('are the profile the import files into, not the other profile the household shows', async () => {
    localStorage.setItem('selectedProfileIds', '[1,2]')
    await addCategories(1, ['Test Home Category'])
    await addCategories(2, ['Test Other Category'])
    setPage('import')
    const { createImportFlow } = await import('../importFlow')
    let flow!: ImportFlow
    dispose = createRoot((disposeRoot) => {
      flow = createImportFlow({ initialTab: 'bank-imports' })
      return disposeRoot
    })

    await flow.loadBankCategories()
    expect(flow.bankCategories()).toEqual(['Test Home Category'])
  })
})
