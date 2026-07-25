import { deleteDB, openDB } from 'idb'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { repairTransactionProfileLinks } from '../idb.js'

// Audit H-03: transactions whose account/category belonged to another profile predate PR #377's
// create-time guard. `repairTransactionProfileLinks` (the v11 migration's per-row logic) nulls
// those foreign keys so the rows become consistent and editable again.

describe('repairTransactionProfileLinks', () => {
  const acctProfile = new Map<number, number>([
    [11, 1], // account 11 -> profile 1
    [22, 2], // account 22 -> profile 2
  ])
  const catProfile = new Map<number, number>([
    [111, 1],
    [222, 2],
  ])

  it('nulls a foreign source account and keeps an owned category', () => {
    const row = { profile_id: 1, account_id: 22, category_id: 111 }
    expect(repairTransactionProfileLinks(row, acctProfile, catProfile)).toBe(true)
    expect(row.account_id).toBeNull()
    expect(row.category_id).toBe(111)
  })

  it('nulls a foreign category and keeps an owned account', () => {
    const row = { profile_id: 1, account_id: 11, category_id: 222 }
    expect(repairTransactionProfileLinks(row, acctProfile, catProfile)).toBe(true)
    expect(row.account_id).toBe(11)
    expect(row.category_id).toBeNull()
  })

  it('nulls a foreign transfer account', () => {
    const row = { profile_id: 1, account_id: 11, transfer_account_id: 22, category_id: 111 }
    expect(repairTransactionProfileLinks(row, acctProfile, catProfile)).toBe(true)
    expect(row.transfer_account_id).toBeNull()
    expect(row.account_id).toBe(11)
  })

  it('nulls a foreign key pointing at a record that no longer exists', () => {
    const row = { profile_id: 1, account_id: 999, category_id: 111 }
    expect(repairTransactionProfileLinks(row, acctProfile, catProfile)).toBe(true)
    expect(row.account_id).toBeNull()
  })

  it('leaves a fully owned row unchanged (returns false)', () => {
    const row = { profile_id: 1, account_id: 11, transfer_account_id: null, category_id: 111 }
    expect(repairTransactionProfileLinks(row, acctProfile, catProfile)).toBe(false)
    expect(row.account_id).toBe(11)
    expect(row.category_id).toBe(111)
  })

  it('leaves null/undefined foreign keys alone', () => {
    const row = { profile_id: 2, account_id: null, category_id: undefined }
    expect(repairTransactionProfileLinks(row, acctProfile, catProfile)).toBe(false)
    expect(row.account_id).toBeNull()
  })
})

describe('v11 upgrade migration', () => {
  afterEach(async () => {
    vi.resetModules()
  })

  it('nulls cross-profile foreign keys on existing rows when upgrading v10 -> v11', async () => {
    await deleteDB('finance-manager')
    // Stand up a v10 database with only the stores the repair touches, then seed one corrupt row
    // (profile-1 tx pointing at profile-2's account + category) and one clean row.
    const v10 = await openDB('finance-manager', 10, {
      upgrade(db) {
        for (const name of ['transactions', 'accounts', 'categories']) {
          const store = db.createObjectStore(name, { keyPath: 'id', autoIncrement: true })
          store.createIndex('by_profile', 'profile_id')
        }
      },
    })
    await v10.add('accounts', { id: 11, profile_id: 1, name: 'Own' })
    await v10.add('accounts', { id: 22, profile_id: 2, name: 'Foreign' })
    await v10.add('categories', { id: 111, profile_id: 1, name: 'Own' })
    await v10.add('categories', { id: 222, profile_id: 2, name: 'Foreign' })
    await v10.add('transactions', {
      id: 1,
      profile_id: 1,
      account_id: 22,
      category_id: 222,
      description: 'corrupt',
      type: 'expense',
      amount: 5,
      date: '2026-01-01',
    })
    await v10.add('transactions', {
      id: 2,
      profile_id: 1,
      account_id: 11,
      category_id: 111,
      description: 'clean',
      type: 'expense',
      amount: 5,
      date: '2026-01-01',
    })
    v10.close()

    // Fresh module instance so getDB()'s cached promise is null and it re-opens at DB_VERSION=11,
    // driving the real upgradeSchema (oldVersion=10 → only the v11 repair block runs).
    vi.resetModules()
    const { getDB } = await import('../idb.js')
    const db = await getDB()
    try {
      const corrupt = await db.get('transactions', 1)
      expect(corrupt.account_id).toBeNull()
      expect(corrupt.category_id).toBeNull()

      const clean = await db.get('transactions', 2)
      expect(clean.account_id).toBe(11)
      expect(clean.category_id).toBe(111)
    } finally {
      // Close so a later deleteDB / re-open isn't blocked by this open connection.
      db.close()
      await deleteDB('finance-manager')
    }
  })
})
