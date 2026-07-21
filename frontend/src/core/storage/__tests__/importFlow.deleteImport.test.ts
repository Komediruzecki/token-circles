/**
 * Delete-recent-import (undo a batch) for the IndexedDB path: importExecute stamps each
 * inserted transaction with the body's importId, and DELETE /api/import-logs/:id removes
 * every transaction carrying that batch id, recomputes balances, and drops the log row.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { getDB } from '../idb.js'
import { importExecute, importLogsCreate, importLogsDelete } from '../localHandlers.js'

async function resetDb() {
  const db = await getDB()
  for (const store of [
    'profiles',
    'transactions',
    'categories',
    'accounts',
    'budgets',
    'import_logs',
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

describe('delete recent import (undo a batch)', () => {
  it('stamps import_id on insert and removes the whole batch on delete', async () => {
    const db = await getDB()
    await db.add('accounts', {
      name: 'Erste Current',
      type: 'giro',
      balance: 0,
      starting_balance: 0,
      profile_id: 1,
    })

    const rows = [
      ['2026-07-01', 'Coffee', '-3', 'Dining', 'Erste Current'],
      ['2026-07-02', 'Tea', '-2', 'Dining', 'Erste Current'],
    ]
    const imp = await importExecute({
      rows,
      mapping: { date: 0, description: 1, amount: 2, category: 3, means_of_payment: 4 },
      importId: 'batch-1',
      dry_run: false,
    })
    expect(((await imp.json()) as { imported: number }).imported).toBe(2)

    // Inserted transactions carry the batch id.
    let txns = await db.getAllFromIndex('transactions', 'by_profile', 1)
    expect(txns.filter((t) => t.import_id === 'batch-1')).toHaveLength(2)

    const logRes = await importLogsCreate({ import_id: 'batch-1', source: 'Test', imported: 2 })
    const logId = ((await logRes.json()) as { id: number }).id

    const del = await importLogsDelete({ p1: String(logId) })
    expect(((await del.json()) as { deleted: number }).deleted).toBe(2)

    txns = await db.getAllFromIndex('transactions', 'by_profile', 1)
    expect(txns.filter((t) => t.import_id === 'batch-1')).toHaveLength(0)
    expect(await db.get('import_logs', logId)).toBeUndefined()
  })

  it('is a no-op delete (0 removed) for a log whose import predates batch stamping', async () => {
    const db = await getDB()
    // A transaction with no import_id (older import) must NOT be swept by a null-batch delete.
    await db.add('transactions', {
      profile_id: 1,
      type: 'expense',
      description: 'Legacy',
      date: '2026-01-01',
      amount: 5,
    })
    const logRes = await importLogsCreate({ source: 'Legacy', imported: 1 }) // no import_id
    const logId = ((await logRes.json()) as { id: number }).id

    const del = await importLogsDelete({ p1: String(logId) })
    expect(((await del.json()) as { deleted: number }).deleted).toBe(0)
    // Legacy transaction survives; only the log row is cleared.
    expect(await db.getAllFromIndex('transactions', 'by_profile', 1)).toHaveLength(1)
    expect(await db.get('import_logs', logId)).toBeUndefined()
  })
})
