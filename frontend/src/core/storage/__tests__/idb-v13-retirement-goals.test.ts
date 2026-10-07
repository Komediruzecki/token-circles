/**
 * The v13 upgrade gives retirement goals their own store and moves the existing ones into it.
 *
 * Before v13 the local handlers filed a retirement goal among the savings goals, as the body the
 * Retirement page sent. A backup restore meanwhile parked a server backup's retirement goals in
 * the backup-extensions settings row, where no page could show them. Both kinds move; every
 * savings goal stays exactly as it was.
 */
import { deleteDB, openDB } from 'idb'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { addKeepingIds, isLegacyRetirementGoal } from '../retirementGoalRows.js'
import { createV12Schema } from './v12Schema'
import type { IDBPDatabase } from 'idb'

const DB_NAME = 'finance-manager'
const EXTENSIONS_KEY = '__backup_v3_extensions__'

/** Exactly what the Retirement page posts: all eight fields, an empty one as null. */
const PAGE_FORM = {
  name: 'Retire at 60',
  target_amount: 900000,
  current_amount: 120000,
  target_date: '2046-06-30',
  monthly_contribution: 1500,
  expected_return_rate: 6,
  current_age: 41,
  retirement_age: 60,
}

const EMPTY_PAGE_FORM = {
  name: 'Blank',
  target_amount: 100,
  current_amount: null,
  target_date: '',
  monthly_contribution: null,
  expected_return_rate: null,
  current_age: null,
  retirement_age: null,
}

/** A savings goal as each of its writers leaves it. */
const SEEDED_SAVINGS = {
  name: 'Emergency Fund',
  target_amount: 10000,
  current_amount: 4000,
  notes: 'Safety net',
}
const GOALS_FORM = {
  name: 'New Car',
  target_amount: 5000,
  target_date: '2027-06-30',
  monthly_contribution: null,
  category_id: null,
}
const LINKED_SAVINGS = {
  name: 'Groceries buffer',
  target_amount: 600,
  category_id: 5,
  tracking_start_date: '2026-01-01',
}
const SERVER_SAVINGS = {
  name: 'Holiday',
  target_amount: 2000,
  current_amount: 0,
  deadline: null,
  notes: '',
  category_id: null,
  monthly_contribution: 0,
  tracking_start_date: null,
  created_at: '2026-04-01 09:00:00',
}
const SERVER_RETIREMENT = {
  name: 'Server plan',
  target_amount: 500000,
  current_amount: 0,
  deadline: '2045-01-01',
  notes: '',
  current_age: 35,
  retirement_age: 67,
  monthly_contribution: 800,
  expected_return_rate: 7,
  created_at: '2026-05-01 10:00:00',
}

/** Stores, keys and indexes, in a form two databases can be compared by. */
function schemaOf(db: IDBPDatabase) {
  const names = Array.from(db.objectStoreNames).sort()
  const tx = db.transaction(names)
  return names.map((name) => {
    const store = tx.objectStore(name)
    return {
      name,
      keyPath: store.keyPath,
      autoIncrement: store.autoIncrement,
      indexes: Array.from(store.indexNames)
        .sort()
        .map((index) => {
          const idx = store.index(index)
          return { index, keyPath: idx.keyPath, unique: idx.unique, multiEntry: idx.multiEntry }
        }),
    }
  })
}

/** Every row of every store. */
async function contents(db: IDBPDatabase): Promise<Record<string, unknown[]>> {
  const out: Record<string, unknown[]> = {}
  for (const name of Array.from(db.objectStoreNames).sort()) out[name] = await db.getAll(name)
  return out
}

const names = (rows: ReadonlyArray<object>): string[] =>
  rows.map((r) => String((r as { name?: unknown }).name)).sort()

/** A v12 household as the app leaves it: two profiles, a row in every store, and both kinds of
 *  goal in `goals`, plus a server backup's retirement goal parked in the backup extensions. */
const V12_SAVINGS_GOALS = [
  { id: 2, profile_id: 1, ...SEEDED_SAVINGS },
  { id: 3, profile_id: 2, ...GOALS_FORM },
  { id: 5, profile_id: 1, ...LINKED_SAVINGS },
  { id: 6, profile_id: 1, ...GOALS_FORM, ...PAGE_FORM, name: 'Edited on both pages' },
  { id: 7, profile_id: 1, ...SERVER_SAVINGS },
]
const V12_RETIREMENT_GOALS = [
  { id: 1, profile_id: 1, ...PAGE_FORM },
  { id: 4, profile_id: 2, ...PAGE_FORM, name: 'Partner plan', current_age: 38 },
]
const V12_EXTENSIONS = {
  budgetsZeroBased: [{ id: 1, profile_id: 1, category_id: 1, amount: 50 }],
  // Same id as a retirement goal in `goals`: it gets a new one rather than failing the upgrade.
  retirementGoals: [{ id: 4, profile_id: 1, ...SERVER_RETIREMENT }],
  emergencyFundConfig: [{ id: 1, profile_id: 1, monthly_expenses: 1000 }],
  customReports: [{ id: 1, name: 'Tax' }],
  settingsRows: [{ key: 'currency', value: 'EUR', profile_id: 1 }],
}
const V12_ROWS: Record<string, Array<Record<string, unknown>>> = {
  profiles: [
    { id: 1, name: 'Me', created_at: '2025-01-01T00:00:00.000Z' },
    { id: 2, name: 'Partner', created_at: '2025-01-01T00:00:00.000Z' },
  ],
  categories: [
    { id: 1, profile_id: 1, name: 'Groceries', type: 'expense', color: '#F97316' },
    { id: 2, profile_id: 2, name: 'Salary', type: 'income', color: '#22C55E' },
  ],
  accounts: [{ id: 1, profile_id: 1, name: 'Main', type: 'giro', currency: 'EUR', balance: 1200 }],
  transactions: [
    {
      id: 1,
      profile_id: 1,
      account_id: 1,
      category_id: 1,
      type: 'expense',
      amount: 42,
      currency: 'EUR',
      date: '2026-08-14',
      description: 'Market',
    },
    {
      id: 2,
      profile_id: 2,
      account_id: null,
      category_id: 2,
      type: 'income',
      amount: 3000,
      currency: 'EUR',
      date: '2026-08-01',
      description: 'Pay',
    },
  ],
  balanceHistory: [{ id: 1, account_id: 1, balance: 1200, date: '2026-08-31' }],
  budgets: [
    {
      id: 1,
      profile_id: 1,
      category_id: 1,
      amount: 300,
      period: 'monthly',
      start_date: '2026-08-01',
    },
  ],
  goals: [...V12_RETIREMENT_GOALS, ...V12_SAVINGS_GOALS],
  loans: [
    {
      id: 1,
      profile_id: 1,
      name: 'Car Loan',
      principal: 18000,
      interest_rate: 4.9,
      start_date: '2024-08-01',
      term_months: 60,
      rate_periods: [],
      prepayments: [],
    },
  ],
  receipts: [{ id: 1, profile_id: 1, transaction_id: 1, name: 'receipt.pdf', size: 3 }],
  portfolioHoldings: [{ id: 1, profile_id: 2, symbol: 'TEST', quantity: 10 }],
  bills: [{ id: 1, profile_id: 1, name: 'Rent', amount: 900, due_date: '2026-10-01' }],
  housings: [{ id: 1, profile_id: 1, name: 'Flat', monthly_rent: 900 }],
  recurring: [{ id: 1, profile_id: 1, description: 'Gym', amount: 30, type: 'expense' }],
  tags: [{ id: 1, profile_id: 1, name: 'Holiday', color: '#06B6D4' }],
  tagRules: [{ id: 1, profile_id: 1, tag_id: 1, match: 'hotel' }],
  categoryMappings: [{ id: 1, profile_id: 1, pattern: 'MARKET', category_id: 1 }],
  import_logs: [{ id: 1, profile_id: 1, source: 'csv', imported: 2 }],
  import_sources: [{ id: 1, profile_id: 1, name: 'Bank CSV' }],
  logs: [{ id: 1, timestamp: '2026-08-15T10:00:00.000Z', level: 'error', error: 'test' }],
  settings: [
    { key: 'currency', value: 'EUR' },
    { key: 'retirement_settings:1', value: { annualReturnPct: 5 } },
    { key: EXTENSIONS_KEY, value: V12_EXTENSIONS },
  ],
}

describe('isLegacyRetirementGoal', () => {
  it.each([
    ['the Retirement page body', PAGE_FORM],
    ['the Retirement page body with every optional field left empty', EMPTY_PAGE_FORM],
  ])('recognises %s', (_label, row) => {
    expect(isLegacyRetirementGoal(row)).toBe(true)
  })

  it.each([
    ['a seeded savings goal', SEEDED_SAVINGS],
    ['a savings goal from the Goals page', GOALS_FORM],
    ['a category-linked savings goal', LINKED_SAVINGS],
    ['a savings goal from a server backup', SERVER_SAVINGS],
    ['a savings goal later saved through the Retirement page', { ...GOALS_FORM, ...PAGE_FORM }],
    [
      'a seeded savings goal later saved through the Retirement page',
      { ...SEEDED_SAVINGS, ...PAGE_FORM },
    ],
    // A server retirement goal arrives as retirementGoals, never inside goals.
    ['a server retirement goal, which carries notes', SERVER_RETIREMENT],
    ['an empty row', {}],
  ])('leaves %s alone', (_label, row) => {
    expect(isLegacyRetirementGoal(row)).toBe(false)
  })
})

describe('addKeepingIds', () => {
  it('keeps every id it can, and numbers the rest after them', async () => {
    const name = 'add-keeping-ids'
    await deleteDB(name)
    const db = await openDB(name, 1, {
      upgrade(d) {
        d.createObjectStore('rows', { keyPath: 'id', autoIncrement: true })
      },
    })
    try {
      const tx = db.transaction('rows', 'readwrite')
      await addKeepingIds(tx.store, [
        { id: 1, name: 'a' },
        { id: 1, name: 'b' },
        // The id b would have been handed, had it gone in straight away.
        { id: 2, name: 'c' },
        { name: 'd' },
        { id: '4', name: 'e' },
      ])
      await tx.done
      expect((await db.getAll('rows')).map((row) => [row.id, row.name])).toEqual([
        [1, 'a'],
        [2, 'c'],
        [3, 'b'],
        [4, 'd'],
        [5, 'e'],
      ])
    } finally {
      db.close()
      await deleteDB(name)
    }
  })
})

describe('v13 upgrade', () => {
  let db: IDBPDatabase | null = null

  afterEach(async () => {
    db?.close()
    db = null
    await deleteDB(DB_NAME)
    vi.resetModules()
  })

  /** Stand up a v12 database with every store v12 has, then open it with today's code. */
  async function upgradeFromV12(seed: (v12: IDBPDatabase) => Promise<void>): Promise<IDBPDatabase> {
    await deleteDB(DB_NAME)
    const v12 = await openDB(DB_NAME, 12, { upgrade: createV12Schema })
    await seed(v12)
    v12.close()
    return openWithTodaysCode()
  }

  /** A fresh module, so getDB() opens the database again and runs the real upgradeSchema. */
  async function openWithTodaysCode(): Promise<IDBPDatabase> {
    db?.close()
    vi.resetModules()
    const { getDB } = await import('../idb.js')
    db = (await getDB()) as unknown as IDBPDatabase
    return db
  }

  /** The household above, stored at v12; returns every row as v12 stored it. */
  async function seedFullV12(v12: IDBPDatabase): Promise<Record<string, unknown[]>> {
    for (const [store, rows] of Object.entries(V12_ROWS)) {
      for (const row of rows) await v12.put(store, row)
    }
    return contents(v12)
  }

  it('the upgrade from v12 ends at the schema a new install has', async () => {
    await deleteDB(DB_NAME)
    const fresh = schemaOf(await openWithTodaysCode())
    db?.close()
    db = null
    await deleteDB(DB_NAME)

    const upgraded = await upgradeFromV12(async () => undefined)

    expect(upgraded.version).toBe(13)
    expect(schemaOf(upgraded)).toEqual(fresh)
  })

  it('moves every retirement goal out of a full v12 database, and every other row stays as it was', async () => {
    let before: Record<string, unknown[]> = {}
    const upgraded = await upgradeFromV12(async (v12) => {
      before = await seedFullV12(v12)
    })
    const after = await contents(upgraded)

    expect(upgraded.version).toBe(13)
    // Nothing else is touched: every other store holds exactly the rows it held.
    for (const store of Object.keys(before)) {
      if (store === 'goals' || store === 'settings') continue
      expect(after[store], store).toEqual(before[store])
    }
    expect(after.settings).toEqual(
      (before.settings as Array<{ key: string; value: unknown }>).map((row) =>
        row.key === EXTENSIONS_KEY
          ? { ...row, value: { ...V12_EXTENSIONS, retirementGoals: [] } }
          : row
      )
    )

    // Every savings goal stays, unchanged; every retirement goal leaves.
    expect(after.goals).toEqual(V12_SAVINGS_GOALS)

    // Nothing lost and nothing duplicated: each goal, and the parked one, is in exactly one store.
    const moved = after.retirement_goals as Array<Record<string, unknown>>
    expect(before.goals.length + V12_EXTENSIONS.retirementGoals.length).toBe(
      after.goals.length + moved.length
    )
    expect(names(moved)).toEqual(['Partner plan', 'Retire at 60', 'Server plan'])
    expect(new Set(moved.map((g) => g.id)).size).toBe(moved.length)
    expect(moved.find((g) => g.name === 'Retire at 60')).toMatchObject({
      id: 1,
      profile_id: 1,
      deadline: '2046-06-30',
      current_age: 41,
    })
    expect(moved.find((g) => g.name === 'Partner plan')).toMatchObject({
      id: 4,
      profile_id: 2,
      current_age: 38,
    })
    expect(moved.find((g) => g.name === 'Server plan')).toMatchObject({
      profile_id: 1,
      deadline: '2045-01-01',
      created_at: '2026-05-01 10:00:00',
    })
    for (const row of moved) expect(row).not.toHaveProperty('target_date')
    expect(names(await upgraded.getAllFromIndex('retirement_goals', 'by_profile', 1))).toEqual([
      'Retire at 60',
      'Server plan',
    ])
    expect(names(await upgraded.getAllFromIndex('retirement_goals', 'by_profile', 2))).toEqual([
      'Partner plan',
    ])
  })

  it('a second open at v13 changes nothing', async () => {
    await upgradeFromV12(async (v12) => {
      await seedFullV12(v12)
    })
    const first = await contents(db!)

    const reopened = await openWithTodaysCode()

    expect(reopened.version).toBe(13)
    expect(await contents(reopened)).toEqual(first)
  })

  it('writes every copy before it removes anything', async () => {
    // idb does not abort the upgrade when upgradeSchema throws part-way: whatever ran before the
    // throw commits with the version bump, and the upgrade never runs again. A removal that ran
    // before its copy had been written would then be a goal lost for good.
    const ops: string[] = []
    const spyOn = (proto: object, method: string, label: (self: never) => string) => {
      const original = (proto as Record<string, (...args: unknown[]) => unknown>)[method]
      vi.spyOn(proto as Record<string, (...args: unknown[]) => unknown>, method).mockImplementation(
        function (this: never, ...args: unknown[]) {
          ops.push(`${label(this)}.${method}`)
          return original.apply(this, args)
        }
      )
    }
    await deleteDB(DB_NAME)
    const v12 = await openDB(DB_NAME, 12, { upgrade: createV12Schema })
    await seedFullV12(v12)
    v12.close()
    try {
      for (const method of ['add', 'put', 'delete', 'clear']) {
        spyOn(IDBObjectStore.prototype, method, (store: IDBObjectStore) => store.name)
      }
      for (const method of ['delete', 'update']) {
        spyOn(
          IDBCursor.prototype,
          method,
          (cursor: IDBCursor) => `${(cursor.source as IDBObjectStore).name}.cursor`
        )
      }
      await openWithTodaysCode()
    } finally {
      vi.restoreAllMocks()
    }

    const at = (pattern: RegExp) => ops.flatMap((op, i) => (pattern.test(op) ? [i] : []))
    const copies = at(/^retirement_goals\.add$/)
    // Removing a goal from `goals`, and clearing the parked rows out of the backup extensions.
    const removals = at(/^(goals\.(delete|put|clear|cursor\.delete|cursor\.update)|settings\.\w+)$/)
    expect(copies).toHaveLength(V12_RETIREMENT_GOALS.length + V12_EXTENSIONS.retirementGoals.length)
    expect(removals.length).toBeGreaterThan(0)
    expect(Math.max(...copies)).toBeLessThan(Math.min(...removals))
  })

  it('a malformed legacy row moves without aborting the upgrade', async () => {
    const upgraded = await upgradeFromV12(async (v12) => {
      // What an old build could hold in `goals`: a retirement row with no name or target and
      // text where numbers belong, and rows whose key is a string or a fraction.
      await v12.put('goals', { id: 1, profile_id: 1, current_age: '41', retirement_age: 'sixty' })
      await v12.put('goals', { id: 2.5, profile_id: 1, ...PAGE_FORM, name: 'Fractional id' })
      await v12.put('goals', { id: 'legacy', profile_id: 1, ...PAGE_FORM, name: 'Text id' })
      await v12.put('goals', { id: 3, profile_id: 1, ...SEEDED_SAVINGS })
      await v12.put('settings', {
        key: EXTENSIONS_KEY,
        value: {
          retirementGoals: [
            { profile_id: 1, ...SERVER_RETIREMENT, name: 'No id' },
            { id: 0, profile_id: 1, ...SERVER_RETIREMENT, name: 'Zero id' },
            { id: -3, profile_id: 1, ...SERVER_RETIREMENT, name: 'Negative id' },
            { id: '9', profile_id: 1, ...SERVER_RETIREMENT, name: 'Text 9' },
            { id: 1, profile_id: 1, ...SERVER_RETIREMENT, name: 'Clashes with goal 1' },
            null,
            'x',
            42,
            [],
          ],
        },
      })
    })

    expect(upgraded.version).toBe(13)
    expect(await upgraded.getAll('goals')).toEqual([{ id: 3, profile_id: 1, ...SEEDED_SAVINGS }])
    const moved = await upgraded.getAll('retirement_goals')
    // Every row moved, each under an id of its own; only the entries that are not rows are gone.
    expect(moved.map((g) => g.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect(moved[0]).toMatchObject({ id: 1, profile_id: 1, current_age: '41' })
    expect(names(moved.slice(1))).toEqual([
      'Clashes with goal 1',
      'Fractional id',
      'Negative id',
      'No id',
      'Text 9',
      'Text id',
      'Zero id',
    ])
    expect((await upgraded.get('settings', EXTENSIONS_KEY)).value.retirementGoals).toEqual([])
  })

  it('moves the retirement goals out of goals, and leaves every savings goal as it was', async () => {
    const savings = [
      { id: 3, profile_id: 1, ...SEEDED_SAVINGS },
      { id: 4, profile_id: 2, ...GOALS_FORM },
      { id: 5, profile_id: 1, ...PAGE_FORM, name: 'Edited on both pages', category_id: null },
      { id: 7, profile_id: 1, ...LINKED_SAVINGS },
    ]
    const upgraded = await upgradeFromV12(async (v12) => {
      await v12.add('goals', { id: 1, profile_id: 1, ...PAGE_FORM })
      await v12.add('goals', { id: 2, profile_id: 1, ...EMPTY_PAGE_FORM })
      for (const row of savings) await v12.add('goals', row)
      await v12.add('goals', {
        id: 6,
        profile_id: 2,
        ...PAGE_FORM,
        name: 'Partner plan',
        created_at: '2026-09-01T10:00:00.000Z',
      })
    })

    expect(await upgraded.getAll('goals')).toEqual(savings)

    const moved = await upgraded.getAll('retirement_goals')
    expect(moved).toEqual([
      {
        id: 1,
        profile_id: 1,
        name: 'Retire at 60',
        target_amount: 900000,
        current_amount: 120000,
        deadline: '2046-06-30',
        notes: '',
        current_age: 41,
        retirement_age: 60,
        monthly_contribution: 1500,
        expected_return_rate: 6,
      },
      {
        id: 2,
        profile_id: 1,
        name: 'Blank',
        target_amount: 100,
        // The Worker's defaults, which its insert applies to the same empty fields.
        current_amount: 0,
        deadline: null,
        notes: '',
        current_age: 30,
        retirement_age: 65,
        monthly_contribution: 0,
        expected_return_rate: 7,
      },
      expect.objectContaining({
        id: 6,
        name: 'Partner plan',
        created_at: '2026-09-01T10:00:00.000Z',
      }),
    ])
    for (const row of moved) expect(row).not.toHaveProperty('target_date')
    expect(await upgraded.getAllFromIndex('retirement_goals', 'by_profile', 2)).toEqual([
      expect.objectContaining({ id: 6 }),
    ])
  })

  it('moves the retirement goals a restore had parked in the backup extensions', async () => {
    const otherExtensions = {
      budgetsZeroBased: [{ id: 1, profile_id: 1, category_id: 2, amount: 10 }],
      emergencyFundConfig: [],
      customReports: [],
      settingsRows: [{ key: 'currency', value: 'EUR', profile_id: 1 }],
    }
    const upgraded = await upgradeFromV12(async (v12) => {
      await v12.add('goals', { id: 1, profile_id: 1, ...PAGE_FORM })
      await v12.put('settings', {
        key: EXTENSIONS_KEY,
        value: {
          ...otherExtensions,
          retirementGoals: [
            // Same id as the goal moved out of `goals`: it must get a new one, not fail the upgrade.
            { id: 1, profile_id: 1, ...SERVER_RETIREMENT },
            // The id the store would have handed the row above, had it been added first.
            { id: 2, profile_id: 2, ...SERVER_RETIREMENT, name: 'Server plan 2' },
          ],
        },
      })
    })

    const moved = await upgraded.getAll('retirement_goals')
    expect(moved.map((g) => g.name).sort()).toEqual([
      'Retire at 60',
      'Server plan',
      'Server plan 2',
    ])
    expect(moved.find((g) => g.name === 'Retire at 60')?.id).toBe(1)
    expect(moved.find((g) => g.name === 'Server plan')?.id).toBe(3)
    expect(moved.find((g) => g.name === 'Server plan 2')).toMatchObject({
      id: 2,
      profile_id: 2,
      deadline: '2045-01-01',
      created_at: '2026-05-01 10:00:00',
    })

    const extensions = (await upgraded.get('settings', EXTENSIONS_KEY)).value
    expect(extensions).toEqual({ ...otherExtensions, retirementGoals: [] })
  })

  it('drops a parked entry that is not a row, and still moves the rest', async () => {
    const upgraded = await upgradeFromV12(async (v12) => {
      await v12.add('goals', { id: 1, profile_id: 1, ...PAGE_FORM })
      await v12.put('settings', {
        key: EXTENSIONS_KEY,
        value: { retirementGoals: [null, 'x', [], { id: 4, profile_id: 1, ...SERVER_RETIREMENT }] },
      })
    })

    expect((await upgraded.getAll('retirement_goals')).map((g) => g.name)).toEqual([
      'Retire at 60',
      'Server plan',
    ])
    expect(await upgraded.getAll('goals')).toEqual([])
    expect((await upgraded.get('settings', EXTENSIONS_KEY)).value.retirementGoals).toEqual([])
  })

  it('upgrades a database with nothing to move', async () => {
    const upgraded = await upgradeFromV12(async () => undefined)

    expect(await upgraded.getAll('retirement_goals')).toEqual([])
    expect(await upgraded.getAll('goals')).toEqual([])
    expect(await upgraded.get('settings', EXTENSIONS_KEY)).toBeUndefined()
  })

  it('creates the store, with its profile index, in a new database', async () => {
    await deleteDB(DB_NAME)
    vi.resetModules()
    const { getDB } = await import('../idb.js')
    db = (await getDB()) as unknown as IDBPDatabase

    expect(db.objectStoreNames.contains('retirement_goals')).toBe(true)
    expect(db.transaction('retirement_goals').store.indexNames.contains('by_profile')).toBe(true)
  })
})
