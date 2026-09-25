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

  /** Stand up a v12 database with the stores the upgrade reads, then open it with today's code. */
  async function upgradeFromV12(seed: (v12: IDBPDatabase) => Promise<void>): Promise<IDBPDatabase> {
    await deleteDB(DB_NAME)
    const v12 = await openDB(DB_NAME, 12, {
      upgrade(old) {
        const goals = old.createObjectStore('goals', { keyPath: 'id', autoIncrement: true })
        goals.createIndex('by_profile', 'profile_id')
        old.createObjectStore('settings', { keyPath: 'key' })
      },
    })
    await seed(v12)
    v12.close()
    // A fresh module, so getDB() opens the database again and runs the real upgradeSchema.
    vi.resetModules()
    const { getDB } = await import('../idb.js')
    db = (await getDB()) as unknown as IDBPDatabase
    return db
  }

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
