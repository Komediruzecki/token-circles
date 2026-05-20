import { beforeEach, describe, expect, it } from 'vitest'
import { 
  housingCreate, 
  housingList, 
  housingGet, 
  housingUpdate,
  housingDelete,
  housingCalculate
} from '../localHandlers.js'
import { getDB } from '../idb.js'

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
      type: 'rent'
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

    // Get
    const getRes = await housingGet({ p1: created.id.toString() })
    expect(getRes.status).toBe(200)
    const fetched = await getRes.json()
    expect(fetched.id).toBe(created.id)
  })

  it('updates housing', async () => {
    const createRes = await housingCreate({
      property_name: 'Investment Property',
      monthly_amount: 1200,
      due_day: 1,
      type: 'rent'
    })
    const created = await createRes.json()

    const updateRes = await housingUpdate({ p1: created.id.toString() }, {
      property_name: 'Investment Property Updated',
      monthly_amount: 1300,
    })
    expect(updateRes.status).toBe(200)
    
    const getRes = await housingGet({ p1: created.id.toString() })
    const fetched = await getRes.json()
    expect(fetched.monthly_amount).toBe(1300)
  })

  it('deletes housing', async () => {
    const createRes = await housingCreate({
      property_name: 'To Delete',
      monthly_amount: 1000,
      due_day: 1,
      type: 'rent'
    })
    const created = await createRes.json()

    const deleteRes = await housingDelete({ p1: created.id.toString() })
    expect(deleteRes.status).toBe(200)

    const listRes = await housingList()
    const list = await listRes.json()
    expect(list.housings).toHaveLength(0)
  })

  it('calculates housing costs (affordability)', async () => {
    const calcRes = await housingCalculate({
      gross_income: 5000,
      living_expenses: 1000,
      transport_cost: 200,
      utilities_cost: 150,
      savings_target: 500
    })
    expect(calcRes.status).toBe(200)
    const calc = await calcRes.json()
    expect(calc.recommendedRent).toBeDefined()
    expect(calc.affordableRent).toBeDefined()
  })
})
