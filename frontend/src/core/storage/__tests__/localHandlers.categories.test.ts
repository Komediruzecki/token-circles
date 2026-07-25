import { beforeEach, describe, expect, it } from 'vitest'
import { getDB } from '../idb.js'
import {
  categoriesCreate,
  categoriesDelete,
  categoriesGet,
  categoriesList,
  categoriesUpdate,
} from '../localHandlers.js'

describe('localHandlers - categories', () => {
  beforeEach(async () => {
    localStorage.clear()
    localStorage.setItem('currentProfileId', '1')
    const db = await getDB()
    // Reset data
    await db.clear('profiles')
    await db.clear('categories')

    // Seed initial data
    await db.add('profiles', { id: 1, name: 'Test', created_at: '2026-01-01' })
  })

  it('creates, lists, and gets a category', async () => {
    const createRes = await categoriesCreate({
      name: 'Entertainment',
      type: 'expense',
      color: '#00ff00',
    })
    expect(createRes.status).toBe(201)
    const created = await createRes.json()
    expect(created.id).toBeDefined()
    expect(created.name).toBe('Entertainment')

    // List
    const listRes = await categoriesList(new URLSearchParams())
    expect(listRes.status).toBe(200)
    const list = await listRes.json()
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe(created.id)
    expect(list[0].name).toBe('Entertainment')

    // Get
    const getRes = await categoriesGet({ p1: created.id.toString() })
    expect(getRes.status).toBe(200)
    const fetched = await getRes.json()
    expect(fetched.id).toBe(created.id)
  })

  it('updates a category', async () => {
    const createRes = await categoriesCreate({
      name: 'Work',
      type: 'income',
      color: '#ffffff',
    })
    const created = await createRes.json()

    const updateRes = await categoriesUpdate(
      { p1: created.id.toString() },
      {
        ...created,
        name: 'Job',
        color: '#eeeeee',
      }
    )
    expect(updateRes.status).toBe(200)

    const getRes = await categoriesGet({ p1: created.id.toString() })
    const fetched = await getRes.json()
    expect(fetched.name).toBe('Job')
    expect(fetched.color).toBe('#eeeeee')
  })

  it('deletes a category', async () => {
    const createRes = await categoriesCreate({
      name: 'To Delete',
      type: 'expense',
      color: '#123456',
    })
    const created = await createRes.json()

    const deleteRes = await categoriesDelete({ p1: created.id.toString() })
    expect(deleteRes.status).toBe(200)

    const listRes = await categoriesList(new URLSearchParams())
    const list = await listRes.json()
    expect(list).toHaveLength(0)
  })

  it('detaches or removes every dependent when a single category is deleted (M-07)', async () => {
    const db = await getDB()
    for (const store of [
      'categories',
      'transactions',
      'budgets',
      'goals',
      'bills',
      'recurring',
      'categoryMappings',
    ]) {
      await db.clear(store)
    }
    // Target category (100) with a child (101) and an unrelated sibling (102).
    await db.add('categories', {
      id: 100,
      profile_id: 1,
      name: 'Custom',
      type: 'expense',
      color: '#111111',
      parent_id: null,
    })
    await db.add('categories', {
      id: 101,
      profile_id: 1,
      name: 'Child',
      type: 'expense',
      color: '#222222',
      parent_id: 100,
    })
    await db.add('categories', {
      id: 102,
      profile_id: 1,
      name: 'Keep',
      type: 'expense',
      color: '#333333',
      parent_id: null,
    })
    // Dependents of the target category.
    await db.add('transactions', {
      id: 200,
      profile_id: 1,
      category_id: 100,
      amount: 1,
      date: '2026-07-01',
      description: 'Target tx',
    })
    await db.add('transactions', {
      id: 201,
      profile_id: 1,
      category_id: 102,
      amount: 1,
      date: '2026-07-01',
      description: 'Keep tx',
    })
    await db.add('budgets', { id: 300, profile_id: 1, category_id: 100, amount: 1 })
    await db.add('budgets', { id: 301, profile_id: 1, category_id: 102, amount: 1 })
    await db.add('goals', {
      id: 400,
      profile_id: 1,
      category_id: 100,
      name: 'Goal',
      target_amount: 1,
    })
    await db.add('bills', { id: 500, profile_id: 1, category_id: 100, name: 'Bill', amount: 1 })
    await db.add('recurring', {
      id: 600,
      profile_id: 1,
      category_id: 100,
      description: 'Recurring',
      amount: 1,
    })
    await db.add('categoryMappings', {
      id: 700,
      profile_id: 1,
      category_id: 100,
      pattern: 'custom',
    })

    const deleteRes = await categoriesDelete({ p1: '100' })
    expect(deleteRes.status).toBe(200)

    // Target gone; child re-parented to top level; unrelated category survives.
    expect(await db.get('categories', 100)).toBeUndefined()
    expect((await db.get('categories', 101)).parent_id).toBeNull()
    expect(await db.get('categories', 102)).toBeDefined()

    // Nullable references become uncategorized but survive.
    expect((await db.get('transactions', 200)).category_id).toBeNull()
    expect((await db.get('goals', 400)).category_id).toBeNull()
    expect((await db.get('bills', 500)).category_id).toBeNull()
    expect((await db.get('recurring', 600)).category_id).toBeNull()

    // Category-required rows and the mapping are removed (no orphaned/hidden budget).
    expect(await db.get('budgets', 300)).toBeUndefined()
    expect(await db.get('categoryMappings', 700)).toBeUndefined()

    // The unrelated category's references are untouched.
    expect((await db.get('transactions', 201)).category_id).toBe(102)
    expect(await db.get('budgets', 301)).toBeDefined()
  })
})
