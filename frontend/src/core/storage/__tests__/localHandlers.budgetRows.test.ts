import { beforeEach, describe, expect, it } from 'vitest'
import { getDB } from '../idb.js'
import { budgetsAllocate, budgetsSummary, budgetsZeroBased } from '../localHandlers.js'

// A month can hold two budget rows for one category (two saves, an import, a restore). Every
// reader takes the one saved last, the later created_at and then the higher id, as on the Worker
// (worker/test/budgets-one-row-per-month.test.ts): the Budgets page (the last row of the summary and
// of zero-based for a category), Allocate, and Progress's advice. The summary and zero-based kept
// whichever row IndexedDB listed last, and Allocate changed the first.

beforeEach(async () => {
  localStorage.clear()
  localStorage.setItem('currentProfileId', '1')
  const db = await getDB()
  for (const store of ['profiles', 'budgets', 'categories', 'transactions'] as const) {
    await db.clear(store)
  }
  await db.add('profiles', { id: 1, name: 'Test', created_at: '2026-01-01' })
  await db.add('categories', { id: 1, profile_id: 1, name: 'Food', type: 'expense', color: '#f00' })
})

async function seed(
  rows: Array<{
    id: number
    amount: number
    created_at: string
    start?: string
    rollover?: boolean
  }>
): Promise<void> {
  const db = await getDB()
  for (const r of rows) {
    await db.add('budgets', {
      id: r.id,
      profile_id: 1,
      category_id: 1,
      amount: r.amount,
      period: 'monthly',
      start_date: r.start ?? '2026-05-01',
      end_date: null,
      created_at: r.created_at,
      rollover_enabled: r.rollover ?? false,
      rollover_amount: 0,
    } as never)
  }
}

async function readers(): Promise<{ summary: number; zeroBased: number; allocate: number }> {
  const summary = (await (
    await budgetsSummary(new URLSearchParams({ year: '2026', month: '5' }))
  ).json()) as Array<{ id: number; category_id: number }>
  const zeroBased = (await (
    await budgetsZeroBased(new URLSearchParams({ month: '2026-05' }))
  ).json()) as { allocations: Array<{ budget_id: number | null; category_id: number }> }
  const allocate = (await (
    await budgetsAllocate(new URLSearchParams({ month: '2026-05' }), {
      category_id: 1,
      amount: 500,
      period: 'monthly',
    })
  ).json()) as { id: number }
  return {
    summary: summary.filter((b) => b.category_id === 1).at(-1)!.id,
    zeroBased: zeroBased.allocations.find((a) => a.category_id === 1)!.budget_id!,
    allocate: allocate.id,
  }
}

describe('local-first: two budget rows for one category and month', () => {
  it('every reader takes the row saved later, whichever has the higher id', async () => {
    await seed([
      { id: 1, amount: 400, created_at: '2026-05-20T10:00:00.000Z' },
      { id: 2, amount: 250, created_at: '2026-05-02T10:00:00.000Z' },
    ])
    expect(await readers()).toEqual({ summary: 1, zeroBased: 1, allocate: 1 })
  })

  it('every reader takes the higher id when both were saved at the same time', async () => {
    await seed([
      { id: 1, amount: 400, created_at: '2026-05-02T10:00:00.000Z' },
      { id: 2, amount: 250, created_at: '2026-05-02T10:00:00.000Z' },
    ])
    expect(await readers()).toEqual({ summary: 2, zeroBased: 2, allocate: 2 })
  })

  it("carries last month's rollover from the row saved last", async () => {
    await seed([
      {
        id: 1,
        amount: 300,
        created_at: '2026-04-20T10:00:00.000Z',
        start: '2026-04-01',
        rollover: true,
      },
      {
        id: 2,
        amount: 100,
        created_at: '2026-04-02T10:00:00.000Z',
        start: '2026-04-01',
        rollover: true,
      },
      { id: 3, amount: 50, created_at: '2026-05-01T10:00:00.000Z', rollover: true },
    ])
    const rows = (await (
      await budgetsSummary(new URLSearchParams({ year: '2026', month: '5' }))
    ).json()) as Array<{ auto_rollover: number; effective_budget: number }>
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ auto_rollover: 300, effective_budget: 350 })
  })
})
