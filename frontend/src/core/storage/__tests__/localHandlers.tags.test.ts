import { beforeEach, describe, expect, it } from 'vitest'
import { getDB } from '../idb.js'
import {
  tagsCreate,
  tagsDelete,
  tagsGetTransactions,
  tagsList,
  tagsUpdate,
  transactionsCreate,
  transactionTagsSet,
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

    // Create a transaction, and tag it the way the app does: in a request of its own, as the
    // Worker takes them. A create body's tags are not stored, in either runtime.
    const created = await (
      await transactionsCreate({ amount: 100, type: 'expense', description: 'Flight' })
    ).json()
    expect(
      (await transactionTagsSet({ p1: String(created.id) }, { tagIds: [tag.id] })).status
    ).toBe(200)

    const getRes = await tagsGetTransactions({ p1: tag.id.toString() })
    expect(getRes.status).toBe(200)
    const txns = await getRes.json()
    expect(txns).toHaveLength(1)
    expect(txns[0].description).toBe('Flight')
  })

  it("lists only the active profile's tags, in household view too", async () => {
    // The Worker lists the active profile's tags alone. This list used to span the household,
    // so the Transactions page offered tags no write there accepts.
    const db = await getDB()
    await db.add('profiles', { id: 2, name: 'Partner', created_at: '2026-01-01' })
    localStorage.setItem('selectedProfileIds', JSON.stringify([1, 2]))
    await db.add('tags', { profile_id: 1, name: 'Holiday', color: '#f97316' })
    await db.add('tags', { profile_id: 2, name: 'Garden', color: '#84cc16' })

    const names = async () =>
      ((await (await tagsList()).json()) as { name: string }[]).map((t) => t.name)
    expect(await names()).toEqual(['Holiday'])

    localStorage.setItem('currentProfileId', '2')
    expect(await names()).toEqual(['Garden'])
  })

  it('refuses a second tag of the same name in one profile, in any case, as the Worker does', async () => {
    // Both runtimes compare names without case or surrounding space (shared/tagSchema.ts).
    expect((await tagsCreate({ name: 'Groceries' })).status).toBe(201)

    const taken = 'You already have a tag called "Groceries". Choose another name.'
    for (const name of [' Groceries ', 'groceries']) {
      const again = await tagsCreate({ name })
      expect(again.status).toBe(400)
      expect(await again.json()).toEqual({ error: taken, fields: { name: taken } })
    }

    const db = await getDB()
    await db.add('profiles', { id: 2, name: 'Partner', created_at: '2026-01-01' })
    localStorage.setItem('currentProfileId', '2')
    expect((await tagsCreate({ name: 'Groceries' })).status).toBe(201)
  })
})
