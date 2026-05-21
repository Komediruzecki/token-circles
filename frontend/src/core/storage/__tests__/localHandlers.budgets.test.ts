import { beforeEach, describe, expect, it } from 'vitest'
import { getDB } from '../idb.js'
import {
  budgetsCreate,
  budgetsDelete,
  budgetsGet,
  budgetsList,
  budgetsSummary,
  budgetsUpdate} from '../localHandlers.js'

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
    await db.add('categories', { id: 1, profile_id: 1, name: 'Food', type: 'expense', color: '#ff0000' })
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

    const updateRes = await budgetsUpdate({ p1: created.id.toString() }, {
      ...created,
      amount: 300,
    })
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
      description: 'Groceries'
    })

    const summaryRes = await budgetsSummary(new URLSearchParams({ month: '5', year: '2026' }))
    expect(summaryRes.status).toBe(200)
    const summary = await summaryRes.json()
    
    expect(Array.isArray(summary)).toBe(true)
    expect(summary).toHaveLength(1)
    expect(summary[0].amount).toBe(1000)
    expect(summary[0].spent).toBe(300)
  })
})
