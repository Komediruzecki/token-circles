import { beforeEach, describe, expect, it } from 'vitest'
import { getDB } from '../idb.js'
import {
  reconcileBatch,
  reconcileBulk,
  reconcileSummary,
  reconcileToggle,
  transactionsBulk,
  transactionsCreate,
  transactionsDelete,
  transactionsExport,
  transactionsGet,
  transactionsList,
  transactionsSummary,
  transactionsUpdate,
} from '../localHandlers.js'

describe('localHandlers - transactions', () => {
  beforeEach(async () => {
    localStorage.clear()
    localStorage.setItem('currentProfileId', '1')
    const db = await getDB()
    // Reset data
    await db.clear('profiles')
    await db.clear('transactions')
    await db.clear('categories')

    // Seed initial data required for transactions
    await db.add('profiles', { id: 1, name: 'Test', created_at: '2026-01-01' })
    await db.add('categories', {
      id: 1,
      profile_id: 1,
      name: 'Food',
      type: 'expense',
      color: '#ff0000',
    })
  })

  it('creates, lists, and gets a transaction', async () => {
    const createRes = await transactionsCreate({
      amount: 50,
      type: 'expense',
      date: '2026-05-20',
      description: 'Test Tx',
      category_id: 1,
    })
    expect(createRes.status).toBe(201)
    const created = await createRes.json()
    expect(created.id).toBeDefined()
    expect(created.description).toBe('Test Tx')

    // List
    const listRes = await transactionsList(new URLSearchParams())
    expect(listRes.status).toBe(200)
    const list = await listRes.json()
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe(created.id)
    expect(list[0].category_name).toBe('Food')

    // Get
    const getRes = await transactionsGet({ p1: created.id.toString() })
    expect(getRes.status).toBe(200)
    const fetched = await getRes.json()
    expect(fetched.id).toBe(created.id)
  })

  it('updates a transaction', async () => {
    const createRes = await transactionsCreate({
      amount: 100,
      type: 'income',
      date: '2026-05-20',
      description: 'Salary',
      category_id: 1,
    })
    const created = await createRes.json()

    const updateRes = await transactionsUpdate(
      { p1: created.id.toString() },
      {
        ...created,
        amount: 200,
        description: 'Bonus',
      }
    )
    expect(updateRes.status).toBe(200)

    const getRes = await transactionsGet({ p1: created.id.toString() })
    const fetched = await getRes.json()
    expect(fetched.amount).toBe(200)
    expect(fetched.description).toBe('Bonus')
  })

  it('deletes a transaction', async () => {
    const createRes = await transactionsCreate({
      amount: 100,
      type: 'expense',
      date: '2026-05-20',
      description: 'To Delete',
      category_id: 1,
    })
    const created = await createRes.json()

    const deleteRes = await transactionsDelete({ p1: created.id.toString() })
    expect(deleteRes.status).toBe(200)

    const listRes = await transactionsList(new URLSearchParams())
    const list = await listRes.json()
    expect(list).toHaveLength(0)
  })

  it('filters transactions in list', async () => {
    await transactionsCreate({
      amount: 10,
      type: 'expense',
      date: '2026-05-01',
      description: 'T1',
      category_id: 1,
    })
    await transactionsCreate({
      amount: 20,
      type: 'expense',
      date: '2026-05-15',
      description: 'T2',
      category_id: 1,
    })

    // Date from
    const list1 = await (
      await transactionsList(new URLSearchParams({ date_from: '2026-05-10' }))
    ).json()
    expect(list1).toHaveLength(1)
    expect(list1[0].description).toBe('T2')

    // Search
    const list2 = await (await transactionsList(new URLSearchParams({ search: 'T1' }))).json()
    expect(list2).toHaveLength(1)
    expect(list2[0].description).toBe('T1')
  })

  it('filters by category_id', async () => {
    await transactionsCreate({
      amount: 50,
      type: 'expense',
      date: '2026-05-20',
      description: 'CatFilter Tx',
      category_id: 1,
    })
    // Create a second transaction with different category_id to verify filter
    await transactionsCreate({
      amount: 30,
      type: 'expense',
      date: '2026-05-21',
      description: 'Other Tx',
      category_id: 99,
    })
    const res = await transactionsList(new URLSearchParams({ category_id: '1' }))
    const list = await res.json()
    expect(list.length).toBeGreaterThanOrEqual(1)
    for (const t of list) {
      expect(t.category_id).toBe(1)
    }
  })

  it('filters by type', async () => {
    await transactionsCreate({
      amount: 50,
      type: 'expense',
      date: '2026-05-20',
      description: 'Expense Tx',
      category_id: 1,
    })
    await transactionsCreate({
      amount: 100,
      type: 'income',
      date: '2026-05-20',
      description: 'Income Tx',
      category_id: null,
    })
    const res = await transactionsList(new URLSearchParams({ type: 'income' }))
    const list = await res.json()
    for (const t of list) {
      expect(t.type).toBe('income')
    }
  })

  it('rejects invalid transaction create body (null/undefined)', async () => {
    const res = await transactionsCreate(null)
    expect(res.status).toBe(400)
  })

  it('rejects a non-positive amount at the storage boundary', async () => {
    const res = await transactionsCreate({ type: 'expense', amount: 0, description: '', date: '' })
    expect(res.status).toBe(400)
  })

  it('creates transaction with all fields', async () => {
    const res = await transactionsCreate({
      amount: 99.99,
      type: 'expense',
      date: '2026-05-20',
      description: 'Full Tx',
      category_id: 1,
      beneficiary: 'Store',
      payor: 'Me',
      notes: 'note',
      currency: 'EUR',
      exchange_rate: 1.0,
      amount_local: 99.99,
      account_id: null,
    })
    expect(res.status).toBe(201)
    const created = await res.json()
    expect(created.beneficiary).toBe('Store')
    expect(created.payor).toBe('Me')
    expect(created.notes).toBe('note')
  })

  it('gets transaction not found', async () => {
    const res = await transactionsGet({ p1: '99999' })
    expect(res.status).toBe(404)
  })

  // ── Reconciliation ──
  it('reconcile toggle switches reconciled state', async () => {
    const createRes = await transactionsCreate({
      amount: 50,
      type: 'expense',
      date: '2026-05-20',
      description: 'To Reconcile',
      category_id: 1,
    })
    const created = await createRes.json()

    const toggleRes = await reconcileToggle({ p1: created.id.toString() })
    expect(toggleRes.status).toBe(200)
    const toggled = await toggleRes.json()
    expect(toggled.reconciled).toBe(1)

    const toggleRes2 = await reconcileToggle({ p1: created.id.toString() })
    const toggled2 = await toggleRes2.json()
    expect(toggled2.reconciled).toBe(0)
  })

  it('reconcile summary returns counts', async () => {
    const res = await reconcileSummary()
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data).toHaveProperty('reconciled_count')
    expect(data).toHaveProperty('unreconciled_count')
  })

  it('reconcile bulk marks range as reconciled', async () => {
    await transactionsCreate({
      amount: 10,
      type: 'expense',
      date: '2026-06-01',
      description: 'Bulk T1',
      category_id: 1,
    })
    await transactionsCreate({
      amount: 20,
      type: 'expense',
      date: '2026-06-02',
      description: 'Bulk T2',
      category_id: 1,
    })
    const res = await reconcileBulk({ date_from: '2026-06-01', date_to: '2026-06-30' })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.count).toBeGreaterThanOrEqual(2)
  })

  it('reconcile batch works with ids', async () => {
    const c1 = await (
      await transactionsCreate({
        amount: 10,
        type: 'expense',
        date: '2026-06-01',
        description: 'Batch T1',
        category_id: 1,
      })
    ).json()
    const c2 = await (
      await transactionsCreate({
        amount: 20,
        type: 'expense',
        date: '2026-06-02',
        description: 'Batch T2',
        category_id: 1,
      })
    ).json()
    const res = await reconcileBatch({ transaction_ids: [c1.id, c2.id] })
    expect(res.status).toBe(200)
  })

  // ── Bulk operations ──
  it('bulk update changes category_id', async () => {
    const c1 = await (
      await transactionsCreate({
        amount: 10,
        type: 'expense',
        date: '2026-06-01',
        description: 'BulkUp T1',
        category_id: 1,
      })
    ).json()
    const res = await transactionsBulk({
      ids: [c1.id],
      action: 'update',
      data: { category_id: 2 },
    })
    expect(res.status).toBe(200)
  })

  it('bulk delete removes transactions', async () => {
    const c1 = await (
      await transactionsCreate({
        amount: 10,
        type: 'expense',
        date: '2026-06-01',
        description: 'BulkDel T1',
        category_id: 1,
      })
    ).json()
    const res = await transactionsBulk({ ids: [c1.id], action: 'delete' })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.deleted).toBe(1)
  })

  it('bulk rejects empty ids', async () => {
    const res = await transactionsBulk({ ids: [], action: 'update', data: {} })
    expect(res.status).toBe(400)
  })

  it('bulk rejects unknown action', async () => {
    const res = await transactionsBulk({ ids: [1], action: 'unknown' })
    expect(res.status).toBe(400)
  })

  it('bulk rejects conversion to a transfer without account selection', async () => {
    const created = await (
      await transactionsCreate({
        amount: 10,
        type: 'expense',
        date: '2026-06-01',
        description: 'Cannot become a one-legged transfer',
      })
    ).json()
    const res = await transactionsBulk({
      ids: [created.id],
      action: 'update',
      data: { type: 'transfer' },
    })
    expect(res.status).toBe(400)
    expect((await (await getDB()).get('transactions', created.id))?.type).toBe('expense')
  })

  // ── Export ──
  it('exports transactions as CSV', async () => {
    await transactionsCreate({
      amount: 50,
      type: 'expense',
      date: '2026-05-20',
      description: 'Export Tx',
      category_id: 1,
    })
    const res = await transactionsExport(new URLSearchParams())
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).toContain('date,type,description,amount')
    expect(text).toContain('Export Tx')
  })

  // ── Summary ──
  it('summary returns totals', async () => {
    await transactionsCreate({
      amount: 100,
      type: 'income',
      date: '2026-05-20',
      description: 'Summary Income',
      category_id: null,
    })
    await transactionsCreate({
      amount: 30,
      type: 'expense',
      date: '2026-05-20',
      description: 'Summary Expense',
      category_id: 1,
    })
    const res = await transactionsSummary()
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.totalIncome).toBeGreaterThanOrEqual(100)
    expect(data.totalExpenses).toBeGreaterThanOrEqual(30)
  })

  // ── Edge cases ──
  it('handles filter with no matches gracefully', async () => {
    const res = await transactionsList(
      new URLSearchParams({ date_from: '2099-01-01', date_to: '2099-12-31' })
    )
    const list = await res.json()
    expect(list).toHaveLength(0)
  })

  it('updates transaction not found returns 404', async () => {
    const res = await transactionsUpdate({ p1: '99999' }, { amount: 500, description: 'Ghost' })
    expect(res.status).toBe(404)
  })

  it('CSV export escapes embedded double-quotes and commas', async () => {
    await transactionsCreate({
      amount: 12.5,
      type: 'expense',
      date: '2026-05-20',
      description: 'She said "hi"',
      notes: 'a, b, c',
      category_id: 1,
    })
    const res = await transactionsExport(new URLSearchParams())
    expect(res.status).toBe(200)
    const csv = await res.text()
    const dataLine = csv.split('\n')[1]
    // Interior quotes doubled, and the comma-bearing notes wrapped in quotes —
    // so the row round-trips through an RFC-4180 parser without corruption.
    expect(dataLine).toContain('"She said ""hi"""')
    expect(dataLine).toContain('"a, b, c"')
  })
})
