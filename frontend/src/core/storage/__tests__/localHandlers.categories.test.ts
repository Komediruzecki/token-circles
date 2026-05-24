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
})
