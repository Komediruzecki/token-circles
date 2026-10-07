/**
 * A v12 database as the app shipped it, for tests that need one to upgrade or to hold open.
 */
import type { IDBPDatabase } from 'idb'

/**
 * Every object store a v12 database has, with its key and indexes: upgradeSchema's v1 to v12
 * steps as they shipped. 'the upgrade from v12 ends at the schema a new install has' checks this
 * table against the real code, so a store or index missing here fails that test.
 */
const BY_PROFILE: Array<[string, string]> = [['by_profile', 'profile_id']]
const V12_STORES: Array<{ name: string; keyPath: string; indexes: Array<[string, string]> }> = [
  { name: 'profiles', keyPath: 'id', indexes: [] },
  {
    name: 'transactions',
    keyPath: 'id',
    indexes: [
      ...BY_PROFILE,
      ['by_date', 'date'],
      ['by_category', 'category_id'],
      ['by_type', 'type'],
    ],
  },
  { name: 'categories', keyPath: 'id', indexes: [...BY_PROFILE, ['by_type', 'type']] },
  { name: 'accounts', keyPath: 'id', indexes: BY_PROFILE },
  { name: 'budgets', keyPath: 'id', indexes: BY_PROFILE },
  { name: 'goals', keyPath: 'id', indexes: BY_PROFILE },
  { name: 'loans', keyPath: 'id', indexes: BY_PROFILE },
  { name: 'balanceHistory', keyPath: 'id', indexes: [['by_account', 'account_id']] },
  {
    name: 'receipts',
    keyPath: 'id',
    indexes: [...BY_PROFILE, ['by_transaction', 'transaction_id']],
  },
  { name: 'portfolioHoldings', keyPath: 'id', indexes: BY_PROFILE },
  { name: 'settings', keyPath: 'key', indexes: [] },
  { name: 'bills', keyPath: 'id', indexes: BY_PROFILE },
  { name: 'housings', keyPath: 'id', indexes: BY_PROFILE },
  { name: 'recurring', keyPath: 'id', indexes: BY_PROFILE },
  { name: 'tags', keyPath: 'id', indexes: BY_PROFILE },
  {
    name: 'logs',
    keyPath: 'id',
    indexes: [
      ['by_level', 'level'],
      ['by_timestamp', 'timestamp'],
    ],
  },
  { name: 'categoryMappings', keyPath: 'id', indexes: BY_PROFILE },
  { name: 'import_logs', keyPath: 'id', indexes: BY_PROFILE },
  { name: 'import_sources', keyPath: 'id', indexes: BY_PROFILE },
  { name: 'tagRules', keyPath: 'id', indexes: [...BY_PROFILE, ['by_tag', 'tag_id']] },
]

export function createV12Schema(db: IDBPDatabase): void {
  for (const { name, keyPath, indexes } of V12_STORES) {
    const store = db.createObjectStore(name, { keyPath, autoIncrement: keyPath === 'id' })
    for (const [index, path] of indexes) store.createIndex(index, path)
  }
}
