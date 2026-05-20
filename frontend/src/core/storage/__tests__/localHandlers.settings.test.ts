import { beforeEach, describe, expect, it } from 'vitest'
import { getDB } from '../idb.js'
import {
  recurringCreate,
  recurringDelete,
  recurringGet,
  recurringList,
  recurringUpcoming,
  recurringUpdate,
  settingsGet,
  settingsUpdate,
} from '../localHandlers.js'

describe('localHandlers - settings', () => {
  beforeEach(async () => {
    localStorage.clear()
    localStorage.setItem('currentProfileId', '1')
    const db = await getDB()
    await db.clear('profiles')
    await db.clear('settings')
    await db.add('profiles', { id: 1, name: 'Test', created_at: '2026-01-01' })
  })

  it('returns default settings when none are stored', async () => {
    const res = await settingsGet()
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.theme).toBe('dark')
    expect(data.language).toBe('en')
    expect(data.currency).toBe('EUR')
    expect(data.primary_currency).toBe('EUR')
  })

  it('updates settings and retrieves them', async () => {
    const updateRes = await settingsUpdate({ theme: 'light', language: 'de' })
    expect(updateRes.status).toBe(200)
    const updateData = await updateRes.json()
    expect(updateData.ok).toBe(true)

    const getRes = await settingsGet()
    const data = await getRes.json()
    expect(data.theme).toBe('light')
    expect(data.language).toBe('de')
    // Defaults that were not overridden should remain
    expect(data.currency).toBe('EUR')
  })

  it('merges partial updates without clobbering other keys', async () => {
    await settingsUpdate({ theme: 'light', language: 'fr' })
    await settingsUpdate({ currency: 'USD' })

    const res = await settingsGet()
    const data = await res.json()
    expect(data.theme).toBe('light')
    expect(data.language).toBe('fr')
    expect(data.currency).toBe('USD')
  })

  it('returns 400 for invalid settings body', async () => {
    const res = await settingsUpdate(null)
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toBeDefined()
  })
})

describe('localHandlers - recurring', () => {
  beforeEach(async () => {
    localStorage.clear()
    localStorage.setItem('currentProfileId', '1')
    const db = await getDB()
    await db.clear('profiles')
    await db.clear('recurring')
    await db.add('profiles', { id: 1, name: 'Test', created_at: '2026-01-01' })
  })

  it('returns an empty list when no recurring transactions exist', async () => {
    const res = await recurringList()
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data).toHaveLength(0)
  })

  it('creates a recurring transaction', async () => {
    const res = await recurringCreate({
      description: 'Netflix',
      amount: 15.99,
      type: 'expense',
      frequency: 'monthly',
      day_of_month: 5,
      next_date: '2026-06-05',
    })
    expect(res.status).toBe(201)
    const data = await res.json()
    expect(data.id).toBeDefined()
    expect(data.profile_id).toBe(1)
  })

  it('lists created recurring transactions', async () => {
    await recurringCreate({
      description: 'Rent',
      amount: 1200,
      type: 'expense',
      frequency: 'monthly',
    })
    await recurringCreate({
      description: 'Salary',
      amount: 5000,
      type: 'income',
      frequency: 'monthly',
    })

    const res = await recurringList()
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data).toHaveLength(2)
  })

  it('gets a specific recurring transaction by id', async () => {
    const createRes = await recurringCreate({
      description: 'Gym',
      amount: 30,
      type: 'expense',
      frequency: 'monthly',
      day_of_month: 1,
      next_date: '2026-07-01',
      notes: 'annual membership',
    })
    const created = await createRes.json()

    const getRes = await recurringGet({ p1: created.id.toString() })
    expect(getRes.status).toBe(200)
    const item = await getRes.json()
    expect(item.id).toBe(created.id)
    expect(item.description).toBe('Gym')
    expect(item.amount).toBe(30)
    expect(item.type).toBe('expense')
    expect(item.frequency).toBe('monthly')
    expect(item.day_of_month).toBe(1)
    expect(item.next_date).toBe('2026-07-01')
    expect(item.notes).toBe('annual membership')
    expect(item.is_active).toBe(1)
  })

  it('returns 404 for a non-existent recurring transaction', async () => {
    const res = await recurringGet({ p1: '9999' })
    expect(res.status).toBe(404)
    const data = await res.json()
    expect(data.error).toContain('not found')
  })

  it('updates a recurring transaction', async () => {
    const createRes = await recurringCreate({
      description: 'Insurance',
      amount: 200,
      type: 'expense',
      frequency: 'monthly',
    })
    const created = await createRes.json()

    const updateRes = await recurringUpdate(
      { p1: created.id.toString() },
      { amount: 220, description: 'Health Insurance' }
    )
    expect(updateRes.status).toBe(200)

    const getRes = await recurringGet({ p1: created.id.toString() })
    const item = await getRes.json()
    expect(item.amount).toBe(220)
    expect(item.description).toBe('Health Insurance')
  })

  it('update returns 404 for non-existent recurring transaction', async () => {
    const res = await recurringUpdate({ p1: '9999' }, { amount: 100 })
    expect(res.status).toBe(404)
  })

  it('deletes a recurring transaction', async () => {
    const createRes = await recurringCreate({
      description: 'To Delete',
      amount: 10,
      type: 'expense',
      frequency: 'monthly',
    })
    const created = await createRes.json()

    const deleteRes = await recurringDelete({ p1: created.id.toString() })
    expect(deleteRes.status).toBe(200)

    const listRes = await recurringList()
    const list = await listRes.json()
    expect(list).toHaveLength(0)
  })

  it('recurringUpcoming returns only active items', async () => {
    const res1 = await recurringCreate({
      description: 'Active Sub',
      amount: 10,
      type: 'expense',
      frequency: 'monthly',
    })
    const item1 = await res1.json()

    const res2 = await recurringCreate({
      description: 'Cancelled Sub',
      amount: 20,
      type: 'expense',
      frequency: 'monthly',
    })
    const item2 = await res2.json()

    // Deactivate the second one
    await recurringUpdate({ p1: item2.id.toString() }, { is_active: false })

    const upRes = await recurringUpcoming()
    expect(upRes.status).toBe(200)
    const upcoming = await upRes.json()
    expect(upcoming).toHaveLength(1)
    expect(upcoming[0].id).toBe(item1.id)
    expect(upcoming[0].description).toBe('Active Sub')
  })

  it('recurringUpcoming returns empty when all are inactive', async () => {
    const res = await recurringCreate({
      description: 'Inactive',
      amount: 5,
      type: 'expense',
      frequency: 'monthly',
    })
    const created = await res.json()
    await recurringUpdate({ p1: created.id.toString() }, { is_active: false })

    const upRes = await recurringUpcoming()
    const upcoming = await upRes.json()
    expect(upcoming).toHaveLength(0)
  })

  it('returns 400 when creating with invalid body', async () => {
    const res = await recurringCreate(null)
    expect(res.status).toBe(400)
  })

  it('uses default values for optional fields during create', async () => {
    const createRes = await recurringCreate({ description: 'Minimal' })
    const created = await createRes.json()

    const getRes = await recurringGet({ p1: created.id.toString() })
    const item = await getRes.json()
    expect(item.amount).toBe(0)
    expect(item.type).toBe('expense')
    expect(item.frequency).toBe('monthly')
    expect(item.day_of_month).toBe(1)
    expect(item.next_date).toBe('')
    expect(item.category_id).toBeNull()
    expect(item.notes).toBe('')
    expect(item.is_active).toBe(1)
    expect(item.created_at).toBeDefined()
  })

  it('accepts the "day" alias for day_of_month', async () => {
    const createRes = await recurringCreate({
      description: 'Day Alias Test',
      amount: 50,
      day: 15,
    })
    const created = await createRes.json()

    const getRes = await recurringGet({ p1: created.id.toString() })
    const item = await getRes.json()
    expect(item.day_of_month).toBe(15)
  })

  it('update with "day" field sets day_of_month', async () => {
    const createRes = await recurringCreate({
      description: 'Day Update',
      amount: 10,
      day_of_month: 1,
    })
    const created = await createRes.json()

    await recurringUpdate({ p1: created.id.toString() }, { day: 20 })

    const getRes = await recurringGet({ p1: created.id.toString() })
    const item = await getRes.json()
    expect(item.day_of_month).toBe(20)
  })

  it('parses amount as float from string during create', async () => {
    const createRes = await recurringCreate({
      description: 'String Amount',
      amount: '42.50',
    })
    const created = await createRes.json()

    const getRes = await recurringGet({ p1: created.id.toString() })
    const item = await getRes.json()
    expect(item.amount).toBe(42.5)
  })

  it('parses amount as float from string during update', async () => {
    const createRes = await recurringCreate({
      description: 'Update Amount',
      amount: 10,
    })
    const created = await createRes.json()

    await recurringUpdate({ p1: created.id.toString() }, { amount: '99.99' })

    const getRes = await recurringGet({ p1: created.id.toString() })
    const item = await getRes.json()
    expect(item.amount).toBe(99.99)
  })
})
