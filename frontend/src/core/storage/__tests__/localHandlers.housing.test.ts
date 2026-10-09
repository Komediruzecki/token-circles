import { beforeEach, describe, expect, it } from 'vitest'
import { getDB } from '../idb.js'
import { housingCreate, housingDelete, housingList, housingUpdate } from '../localHandlers.js'

describe('localHandlers - housing', () => {
  beforeEach(async () => {
    localStorage.clear()
    localStorage.setItem('currentProfileId', '1')
    const db = await getDB()
    // Reset data
    await db.clear('profiles')
    await db.clear('housings')

    // Seed initial data
    await db.add('profiles', { id: 1, name: 'Test', created_at: '2026-01-01' })
  })

  it('creates, lists, and gets housing', async () => {
    const createRes = await housingCreate({
      property_name: 'Primary Residence',
      monthly_amount: 1500,
      due_day: 1,
      type: 'rent',
    })
    expect(createRes.status).toBe(201)
    const created = await createRes.json()
    expect(created.id).toBeDefined()

    // List
    const listRes = await housingList()
    expect(listRes.status).toBe(200)
    const list = await listRes.json()
    expect(list.housings).toHaveLength(1)
    expect(list.housings[0].id).toBe(created.id)
    expect(list.housings[0].name).toBe('Primary Residence')
  })

  it('updates housing', async () => {
    const createRes = await housingCreate({
      property_name: 'Investment Property',
      monthly_amount: 1200,
      due_day: 1,
      type: 'rent',
    })
    const created = await createRes.json()

    const updateRes = await housingUpdate(
      { p1: created.id.toString() },
      {
        property_name: 'Investment Property Updated',
        monthly_amount: 1300,
      }
    )
    expect(updateRes.status).toBe(200)

    // Read back as the Housing page does, from the list.
    const { housings } = await (await housingList()).json()
    expect(housings[0].monthly_amount).toBe(1300)
  })

  it('deletes housing', async () => {
    const createRes = await housingCreate({
      property_name: 'To Delete',
      monthly_amount: 1000,
      due_day: 1,
      type: 'rent',
    })
    const created = await createRes.json()

    const deleteRes = await housingDelete({ p1: created.id.toString() })
    expect(deleteRes.status).toBe(200)

    const listRes = await housingList()
    const list = await listRes.json()
    expect(list.housings).toHaveLength(0)
  })
})
