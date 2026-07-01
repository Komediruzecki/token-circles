/**
 * Regression guards for the serverless-storage performance rewrites.
 *
 * Each optimization (import duplicate detection, batched importExecute,
 * single-pass budgets forecast/history, single-pass statsMonthly) must be
 * RESULT-PRESERVING. These tests pin the exact outputs against hand-computed
 * expected values so a future refactor cannot silently change results.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { getDB } from '../idb.js'
import {
  budgetsForecast,
  budgetsHistory,
  importExecute,
  importFileSheet,
  statsMonthly,
} from '../localHandlers.js'

async function resetDb() {
  const db = await getDB()
  for (const store of ['profiles', 'transactions', 'categories', 'accounts', 'budgets']) {
    await db.clear(store)
  }
  await db.add('profiles', { id: 1, name: 'Test', created_at: '2026-01-01' })
}

describe('perf: import duplicate detection (O(N+M) rewrite)', () => {
  beforeEach(async () => {
    localStorage.clear()
    localStorage.setItem('currentProfileId', '1')
    await resetDb()
  })

  it('flags exactly the rows that duplicate an existing transaction', async () => {
    const db = await getDB()
    // Existing transactions in the store.
    await db.add('transactions', {
      profile_id: 1,
      type: 'expense',
      description: 'Coffee',
      date: '2026-05-01',
      amount: 3.5,
    })
    await db.add('transactions', {
      profile_id: 1,
      type: 'expense',
      description: 'Rent',
      date: '2026-05-02',
      amount: 900,
    })

    // Build an import session via importFileSheet using a tiny in-memory workbook.
    // importFileSheet reads from a stored session, so drive detection through
    // importExecute(dry_run) which calls the same detectDuplicates internally and
    // returns imported/skipped counts. We assert dup handling via the "clean"
    // path: only non-duplicate rows are imported.
    const rows = [
      ['2026-05-01', 'Coffee', '3.5'], // dup of existing (exact)
      ['2026-05-01', 'coffee', '3.504'], // dup: desc case-insensitive + amount within 0.01
      ['2026-05-02', 'Rent', '900'], // dup of existing
      ['2026-05-03', 'Groceries', '42.10'], // NEW
      ['2026-05-01', 'Coffee', '3.52'], // NEW: amount differs by > 0.01 (0.02)
    ]
    const res = await importExecute({
      rows,
      mapping: { date: 0, description: 1, amount: 2 },
      dry_run: true,
    })
    const body = (await res.json()) as { imported: number; skipped: number }
    // 5 rows: 3 duplicates removed by detectDuplicates, 2 remain and are
    // "imported" (dry-run counts them). None are skipped for missing fields.
    expect(body.imported).toBe(2)
    expect(body.skipped).toBe(0)
  })

  it('treats an empty existing store as zero duplicates', async () => {
    const rows = [
      ['2026-06-01', 'A', '10'],
      ['2026-06-02', 'B', '20'],
    ]
    const res = await importExecute({
      rows,
      mapping: { date: 0, description: 1, amount: 2 },
      dry_run: true,
    })
    const body = (await res.json()) as { imported: number }
    expect(body.imported).toBe(2)
  })

  it('detectDuplicates via importFileSheet reports the right duplicate indices', async () => {
    // Seed one existing transaction.
    const db = await getDB()
    await db.add('transactions', {
      profile_id: 1,
      type: 'expense',
      description: 'Netflix',
      date: '2026-04-10',
      amount: 15.99,
    })

    // importUpload/importFileSheet operate on an in-memory xlsx session. Build a
    // CSV workbook the same way importUpload does, then register it. We reach the
    // session indirectly by calling importUpload with a FormData-like File.
    const csv = 'date,description,amount\n2026-04-10,Netflix,15.99\n2026-04-11,Spotify,9.99\n'
    const file = new File([csv], 'txns.csv', { type: 'text/csv' })
    const form = new FormData()
    form.set('file', file)
    const { importUpload } = await import('../localHandlers.js')
    const upRes = await importUpload(form)
    const up = (await upRes.json()) as { session_id: string }

    const sheetRes = await importFileSheet({ session_id: up.session_id })
    const sheet = (await sheetRes.json()) as {
      total: number
      new_items: number
      duplicate_indices: number[]
    }
    expect(sheet.total).toBe(2)
    expect(sheet.new_items).toBe(1)
    expect(sheet.duplicate_indices).toEqual([0]) // row 0 (Netflix) duplicates existing
  })
})

describe('perf: batched importExecute (single transaction, identical balances)', () => {
  beforeEach(async () => {
    localStorage.clear()
    localStorage.setItem('currentProfileId', '1')
    await resetDb()
  })

  it('applies the same net balance change as sequential per-row updates', async () => {
    const db = await getDB()
    // Account id will be 1 (first insert into the accounts store).
    const acctId = (await db.add('accounts', {
      name: 'Checking',
      type: 'checking',
      balance: 1000,
      starting_balance: 1000,
      profile_id: 1,
    })) as number

    // Import: 3 expenses + 1 income, all linked to the account via account_id.
    const rows = [
      ['2026-05-01', 'Groceries', '150', 'expense'],
      ['2026-05-02', 'Rent', '800', 'expense'],
      ['2026-05-03', 'Salary', '3000', 'income'],
      ['2026-05-04', 'Gas', '60', 'expense'],
    ]
    const res = await importExecute({
      rows,
      mapping: { date: 0, description: 1, amount: 2, type: 3 },
      account_id: acctId,
      dry_run: false,
    })
    const body = (await res.json()) as { imported: number; imported_ids: number[] }
    expect(body.imported).toBe(4)
    expect(body.imported_ids).toHaveLength(4)

    // Balance: 1000 - 150 - 800 + 3000 - 60 = 2990
    const acct = await db.get('accounts', acctId)
    expect(acct.balance).toBe(2990)

    // All four transactions persisted with positive amounts and the account link.
    const txns = await db.getAllFromIndex('transactions', 'by_profile', 1)
    expect(txns).toHaveLength(4)
    for (const t of txns) {
      expect(t.amount).toBeGreaterThan(0)
      expect(t.account_id).toBe(acctId)
    }
  })

  it('accumulates multiple deltas to the same account and writes it once', async () => {
    const db = await getDB()
    const acctId = (await db.add('accounts', {
      name: 'Checking',
      balance: 0,
      profile_id: 1,
    })) as number

    // Ten small expenses to the same account: exercises the in-memory delta
    // accumulation + single write-back path (the core of the batching change).
    const rows = Array.from({ length: 10 }, (_, i) => [
      `2026-05-${String(i + 1).padStart(2, '0')}`,
      `Item ${i + 1}`,
      '1.1',
      'expense',
    ])
    const res = await importExecute({
      rows,
      mapping: { date: 0, description: 1, amount: 2, type: 3 },
      account_id: acctId,
      dry_run: false,
    })
    expect((await res.json()).imported).toBe(10)

    // Reproduce the exact sequential float accumulation the old code performed:
    // start 0, then -1.1 ten times, in row order.
    let expected = 0
    for (let i = 0; i < 10; i++) expected = expected + -1.1
    const acct = await db.get('accounts', acctId)
    expect(acct.balance).toBe(expected)
  })

  it('dry-run inserts no transactions and does not change balances', async () => {
    const db = await getDB()
    const acctId = (await db.add('accounts', {
      name: 'Checking',
      balance: 1000,
      profile_id: 1,
    })) as number

    const rows = [['2026-05-01', 'Groceries', '150', 'expense']]
    const res = await importExecute({
      rows,
      mapping: { date: 0, description: 1, amount: 2, type: 3 },
      account_id: acctId,
      dry_run: true,
    })
    const body = (await res.json()) as { imported: number; imported_ids: number[] }
    expect(body.imported).toBe(1) // counted
    expect(body.imported_ids).toEqual([]) // but nothing inserted

    const acct = await db.get('accounts', acctId)
    expect(acct.balance).toBe(1000) // unchanged

    const txns = await db.getAllFromIndex('transactions', 'by_profile', 1)
    expect(txns).toHaveLength(0)
  })
})

describe('perf: single-pass budgets forecast/history', () => {
  beforeEach(async () => {
    localStorage.clear()
    localStorage.setItem('currentProfileId', '1')
    await resetDb()
  })

  it('budgetsHistory sums expenses per month bucket (1st-of-month windows)', async () => {
    const db = await getDB()
    await db.add('categories', { id: 1, profile_id: 1, name: 'Food', type: 'expense' })
    // Two monthly budgets for the same category.
    await db.add('budgets', {
      profile_id: 1,
      category_id: 1,
      amount: 500,
      period: 'monthly',
      start_date: '2026-05-01',
    })
    await db.add('budgets', {
      profile_id: 1,
      category_id: 1,
      amount: 550,
      period: 'monthly',
      start_date: '2026-06-01',
    })
    // Expenses across those months.
    for (const [date, amount] of [
      ['2026-05-05', 120],
      ['2026-05-20', 80], // May total = 200
      ['2026-06-10', 300], // June total = 300
      ['2026-04-30', 999], // outside both windows -> ignored
    ] as [string, number][]) {
      await db.add('transactions', {
        profile_id: 1,
        category_id: 1,
        type: 'expense',
        description: 'x',
        date,
        amount,
      })
    }

    const res = await budgetsHistory(new URLSearchParams({ category_id: '1', months: '6' }))
    const history = (await res.json()) as { month: string; budget_amount: number; spent: number }[]
    // Sorted by start_date desc: June first, then May.
    expect(history).toEqual([
      { month: '2026-06-01', budget_amount: 550, spent: 300 },
      { month: '2026-05-01', budget_amount: 500, spent: 200 },
    ])
  })

  it('budgetsHistory fallback: a mid-month budget window still sums exactly', async () => {
    const db = await getDB()
    await db.add('categories', { id: 1, profile_id: 1, name: 'Food', type: 'expense' })
    // Budget window starts on the 15th -> [2026-05-15, 2026-06-15).
    await db.add('budgets', {
      profile_id: 1,
      category_id: 1,
      amount: 400,
      period: 'monthly',
      start_date: '2026-05-15',
    })
    for (const [date, amount] of [
      ['2026-05-10', 50], // before window -> excluded
      ['2026-05-15', 70], // in window (inclusive start)
      ['2026-06-14', 30], // in window
      ['2026-06-15', 90], // at/after window end -> excluded
    ] as [string, number][]) {
      await db.add('transactions', {
        profile_id: 1,
        category_id: 1,
        type: 'expense',
        description: 'x',
        date,
        amount,
      })
    }

    const res = await budgetsHistory(new URLSearchParams({ category_id: '1', months: '6' }))
    const history = (await res.json()) as { month: string; spent: number }[]
    // Only 70 + 30 = 100 fall inside [05-15, 06-15).
    expect(history).toEqual([{ month: '2026-05-15', budget_amount: 400, spent: 100 }])
  })

  it('budgetsForecast total_budget equals the sum of applicable budget amounts', async () => {
    const db = await getDB()
    await db.add('categories', { id: 1, profile_id: 1, name: 'Food', type: 'expense' })
    await db.add('categories', { id: 2, profile_id: 1, name: 'Transport', type: 'expense' })
    await db.add('budgets', {
      profile_id: 1,
      category_id: 1,
      amount: 500,
      period: 'monthly',
      start_date: '2026-01-01',
    })
    await db.add('budgets', {
      profile_id: 1,
      category_id: 2,
      amount: 150,
      period: 'monthly',
      start_date: '2026-01-01',
    })

    // Use a month >= the budget start so both budgets are "applicable".
    const res = await budgetsForecast(new URLSearchParams({ month: '2026-06' }))
    const body = (await res.json()) as { total_budget: number; forecast: unknown[] }
    expect(body.total_budget).toBe(650)
    expect(Array.isArray(body.forecast)).toBe(true)
    expect(body.forecast.length).toBe(6)
  })
})

describe('perf: single-pass statsMonthly', () => {
  beforeEach(async () => {
    localStorage.clear()
    localStorage.setItem('currentProfileId', '1')
    await resetDb()
  })

  it('buckets income/expense for the current month identically to the reference sum', async () => {
    const db = await getDB()
    // Seed transactions in the current month (computed the same way the handler
    // derives its month buckets), so the result is deterministic across run dates.
    const now = new Date()
    const monthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    const seed: { type: string; amount: number }[] = [
      { type: 'income', amount: 3000 },
      { type: 'income', amount: 250.25 },
      { type: 'expense', amount: 120.5 },
      { type: 'expense', amount: 40 },
      { type: 'transfer', amount: 999 }, // ignored by statsMonthly
    ]
    for (const s of seed) {
      await db.add('transactions', {
        profile_id: 1,
        type: s.type,
        description: 'x',
        date: `${monthStr}-15`,
        amount: s.amount,
      })
    }

    const res = await statsMonthly(new URLSearchParams({ months: '24' }))
    const arr = (await res.json()) as { month: string; income: number; expense: number }[]
    expect(arr).toHaveLength(24)
    const current = arr[arr.length - 1] // i=0 -> current month is last
    expect(current.month).toBe(monthStr)
    // income = 3000 + 250.25 ; expense = 120.5 + 40 ; transfer excluded.
    expect(current.income).toBe(3250.25)
    expect(current.expense).toBe(160.5)

    // A month with no transactions reports zeros.
    const earlier = arr[0]
    expect(earlier.income).toBe(0)
    expect(earlier.expense).toBe(0)
  })
})
