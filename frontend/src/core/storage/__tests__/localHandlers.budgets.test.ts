import { beforeEach, describe, expect, it } from 'vitest'
import { BudgetSchema } from '../../../schemas/models'
import { getDB } from '../idb.js'
import {
  budgetsCreate,
  budgetsDelete,
  budgetsGet,
  budgetsList,
  budgetsSummary,
  budgetsUpdate,
} from '../localHandlers.js'

describe('localHandlers - budgets', () => {
  beforeEach(async () => {
    localStorage.clear()
    localStorage.setItem('currentProfileId', '1')
    const db = await getDB()
    // Reset data
    await db.clear('profiles')
    await db.clear('budgets')
    await db.clear('categories')
    await db.clear('transactions')

    // Seed initial data
    await db.add('profiles', { id: 1, name: 'Test', created_at: '2026-01-01' })
    await db.add('categories', {
      id: 1,
      profile_id: 1,
      name: 'Food',
      type: 'expense',
      color: '#ff0000',
    })
  })

  it('creates, lists, and gets a budget', async () => {
    const createRes = await budgetsCreate({
      category_id: 1,
      amount: 500,
      period: 'monthly',
      start_date: '2026-05-01',
      end_date: '2026-05-31',
    })
    expect(createRes.status).toBe(201)
    const created = await createRes.json()
    expect(created.id).toBeDefined()
    expect(created.amount).toBe(500)

    // List
    const listRes = await budgetsList()
    expect(listRes.status).toBe(200)
    const list = await listRes.json()
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe(created.id)
    expect(list[0].amount).toBe(500)

    // Get
    const getRes = await budgetsGet({ p1: created.id.toString() })
    expect(getRes.status).toBe(200)
    const fetched = await getRes.json()
    expect(fetched.id).toBe(created.id)
  })

  it('updates a budget', async () => {
    const createRes = await budgetsCreate({
      category_id: 1,
      amount: 200,
      period: 'monthly',
      start_date: '2026-05-01',
      end_date: '2026-05-31',
    })
    const created = await createRes.json()

    const updateRes = await budgetsUpdate(
      { p1: created.id.toString() },
      {
        ...created,
        amount: 300,
      }
    )
    expect(updateRes.status).toBe(200)

    const getRes = await budgetsGet({ p1: created.id.toString() })
    const fetched = await getRes.json()
    expect(fetched.amount).toBe(300)
  })

  it('deletes a budget', async () => {
    const createRes = await budgetsCreate({
      category_id: 1,
      amount: 100,
      period: 'monthly',
      start_date: '2026-05-01',
      end_date: '2026-05-31',
    })
    const created = await createRes.json()

    const deleteRes = await budgetsDelete({ p1: created.id.toString() })
    expect(deleteRes.status).toBe(200)

    const listRes = await budgetsList()
    const list = await listRes.json()
    expect(list).toHaveLength(0)
  })

  it('retrieves budget summary with actual spending', async () => {
    await budgetsCreate({
      category_id: 1,
      amount: 1000,
      period: 'monthly',
      start_date: '2026-05-01',
      end_date: '2026-05-31',
    })

    const db = await getDB()
    await db.add('transactions', {
      profile_id: 1,
      category_id: 1,
      amount: 300,
      type: 'expense',
      date: '2026-05-15',
      description: 'Groceries',
    })

    const summaryRes = await budgetsSummary(new URLSearchParams({ month: '5', year: '2026' }))
    expect(summaryRes.status).toBe(200)
    const summary = await summaryRes.json()

    expect(Array.isArray(summary)).toBe(true)
    expect(summary).toHaveLength(1)
    expect(summary[0].amount).toBe(1000)
    expect(summary[0].spent).toBe(300)
  })

  // Fix A4 (audit D6): ApiClient.request returns BudgetSchema.parse(rawData), and
  // Zod strips unknown keys. Rollover fields must be declared on the schema or every
  // fetched budget silently loses them.
  it('preserves rollover fields through BudgetSchema.parse (not stripped)', () => {
    const raw = {
      id: 1,
      category_id: 1,
      amount: 500,
      period: 'monthly' as const,
      start_date: '2026-05-01',
      end_date: null,
      created_at: '2026-05-01',
      profile_id: 1,
      // Worker persists rollover_enabled as 0/1.
      rollover_enabled: 1,
      rollover_amount: 40,
      rollover_used: 10,
    }
    const parsed = BudgetSchema.parse(raw)
    expect(parsed.rollover_enabled).toBe(true)
    expect(parsed.rollover_amount).toBe(40)
    expect(parsed.rollover_used).toBe(10)
  })

  // Fix A7 / D13: budgetsAllocate writes one budget row per month with no end_date.
  // Querying a month must return exactly one row per category — not April+May stacked.
  it('summary returns one budget row per category for the queried month (no stacking)', async () => {
    // Two budgets for the SAME category in consecutive months, both open-ended.
    await budgetsCreate({
      category_id: 1,
      amount: 100,
      period: 'monthly',
      start_date: '2026-04-01',
    })
    await budgetsCreate({
      category_id: 1,
      amount: 200,
      period: 'monthly',
      start_date: '2026-05-01',
    })

    const summaryRes = await budgetsSummary(new URLSearchParams({ month: '5', year: '2026' }))
    const summary = await summaryRes.json()

    expect(summary).toHaveLength(1)
    expect(summary[0].category_id).toBe(1)
    // The May row (200), not the April row (100), and not both summed.
    expect(summary[0].amount).toBe(200)
  })

  // Fix A7 / D12: in a household (multi-profile) selection, the summary must cover the
  // same profiles as the list — not drop other members' budgets.
  it('summary covers the same profiles as the list in a household selection', async () => {
    const db = await getDB()
    // Add a second profile with its own category + budget.
    await db.add('profiles', { id: 2, name: 'Partner', created_at: '2026-01-01' })
    await db.add('categories', {
      id: 2,
      profile_id: 2,
      name: 'Rent',
      type: 'expense',
      color: '#00ff00',
    })
    await db.add('budgets', {
      profile_id: 1,
      category_id: 1,
      amount: 500,
      period: 'monthly',
      start_date: '2026-05-01',
    })
    await db.add('budgets', {
      profile_id: 2,
      category_id: 2,
      amount: 800,
      period: 'monthly',
      start_date: '2026-05-01',
    })

    // Household view: both profiles selected.
    localStorage.setItem('selectedProfileIds', JSON.stringify([1, 2]))

    const listRes = await budgetsList()
    const list = await listRes.json()
    expect(list).toHaveLength(2)
    const listCats = new Set(list.map((b: { category_id: number }) => b.category_id))

    const summaryRes = await budgetsSummary(new URLSearchParams({ month: '5', year: '2026' }))
    const summary = await summaryRes.json()
    const summaryCats = new Set(summary.map((b: { category_id: number }) => b.category_id))

    // The summary must cover exactly the same categories/profiles as the list.
    expect(summary).toHaveLength(2)
    expect(summaryCats).toEqual(listCats)
    expect(summaryCats).toEqual(new Set([1, 2]))
  })
})
