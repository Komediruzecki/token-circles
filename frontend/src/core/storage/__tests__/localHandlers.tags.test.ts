import { beforeEach, describe, expect, it } from 'vitest'
import { getDB } from '../idb.js'
import {
  tagsCreate,
  tagsDelete,
  tagsGetTransactions,
  tagsList,
  tagsUpdate,
  transactionsCreate,
} from '../localHandlers.js'

describe('localHandlers - tags', () => {
  beforeEach(async () => {
    localStorage.clear()
    localStorage.setItem('currentProfileId', '1')
    const db = await getDB()
    // Reset data
    await db.clear('profiles')
    await db.clear('tags')
    await db.clear('transactions')

    // Seed initial data
    await db.add('profiles', { id: 1, name: 'Test', created_at: '2026-01-01' })
  })

  it('creates, lists, and updates a tag', async () => {
    const createRes = await tagsCreate({ name: 'Urgent', color: '#ff0000' })
    expect(createRes.status).toBe(201)
    const created = await createRes.json()
    expect(created.id).toBeDefined()

    // List
    const listRes = await tagsList()
    expect(listRes.status).toBe(200)
    const list = await listRes.json()
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe(created.id)
    expect(list[0].name).toBe('Urgent')

    // Update
    const updateRes = await tagsUpdate({ p1: created.id.toString() }, { name: 'Very Urgent' })
    expect(updateRes.status).toBe(200)

    const listRes2 = await tagsList()
    const list2 = await listRes2.json()
    expect(list2[0].name).toBe('Very Urgent')
  })

  it('deletes a tag', async () => {
    const createRes = await tagsCreate({ name: 'To Delete' })
    const created = await createRes.json()

    const deleteRes = await tagsDelete({ p1: created.id.toString() })
    expect(deleteRes.status).toBe(200)

    const listRes = await tagsList()
    const list = await listRes.json()
    expect(list).toHaveLength(0)
  })

  it('gets transactions for a tag', async () => {
    const tagRes = await tagsCreate({ name: 'Trip' })
    const tag = await tagRes.json()

    // Create a transaction with this tag
    await transactionsCreate({
      amount: 100,
      description: 'Flight',
      tags: ['Trip'],
      tag_ids: [tag.id],
    })

    const getRes = await tagsGetTransactions({ p1: tag.id.toString() })
    expect(getRes.status).toBe(200)
    const txns = await getRes.json()
    expect(txns).toHaveLength(1)
    expect(txns[0].description).toBe('Flight')
  })
})
