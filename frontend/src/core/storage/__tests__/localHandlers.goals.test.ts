import { beforeEach, describe, expect, it } from 'vitest'
import { getDB } from '../idb.js'
import {
  goalsContribute,
  goalsCreate,
  goalsDelete,
  goalsGet,
  goalsList,
  goalsUpdate,
} from '../localHandlers.js'

describe('localHandlers - goals', () => {
  beforeEach(async () => {
    localStorage.clear()
    localStorage.setItem('currentProfileId', '1')
    const db = await getDB()
    // Reset data
    await db.clear('profiles')
    await db.clear('goals')

    // Seed initial data
    await db.add('profiles', { id: 1, name: 'Test', created_at: '2026-01-01' })
  })

  it('creates, lists, and gets a goal', async () => {
    const createRes = await goalsCreate({
      name: 'Vacation',
      target_amount: 5000,
      current_amount: 1000,
      target_date: '2027-01-01',
    })
    expect(createRes.status).toBe(201)
    const created = await createRes.json()
    expect(created.id).toBeDefined()
    expect(created.name).toBe('Vacation')

    // List
    const listRes = await goalsList()
    expect(listRes.status).toBe(200)
    const list = await listRes.json()
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe(created.id)
    expect(list[0].target_amount).toBe(5000)

    // Get
    const getRes = await goalsGet({ p1: created.id.toString() })
    expect(getRes.status).toBe(200)
    const fetched = await getRes.json()
    expect(fetched.id).toBe(created.id)
  })

  it('updates a goal', async () => {
    const createRes = await goalsCreate({
      name: 'Car',
      target_amount: 20000,
      current_amount: 0,
      target_date: '2028-01-01',
    })
    const created = await createRes.json()

    const updateRes = await goalsUpdate(
      { p1: created.id.toString() },
      {
        ...created,
        target_amount: 25000,
      }
    )
    expect(updateRes.status).toBe(200)

    const getRes = await goalsGet({ p1: created.id.toString() })
    const fetched = await getRes.json()
    expect(fetched.target_amount).toBe(25000)
  })

  it('deletes a goal', async () => {
    const createRes = await goalsCreate({
      name: 'To Delete',
      target_amount: 1000,
      current_amount: 0,
    })
    const created = await createRes.json()

    const deleteRes = await goalsDelete({ p1: created.id.toString() })
    expect(deleteRes.status).toBe(200)

    const listRes = await goalsList()
    const list = await listRes.json()
    expect(list).toHaveLength(0)
  })

  it('contributes to a goal', async () => {
    const createRes = await goalsCreate({
      name: 'Emergency Fund',
      target_amount: 10000,
      current_amount: 1000,
    })
    const created = await createRes.json()

    const contributeRes = await goalsContribute({ p1: created.id.toString() }, { amount: 500 })
    expect(contributeRes.status).toBe(200)

    const getRes = await goalsGet({ p1: created.id.toString() })
    const fetched = await getRes.json()
    expect(fetched.current_amount).toBe(1500)
  })
})
