import { beforeEach, describe, expect, it } from 'vitest'
import { getDB } from '../idb.js'
import {
  loansCalculate,
  loansCreate,
  loansDelete,
  loansGet,
  loansList,
  loansUpdate,
} from '../localHandlers.js'

describe('localHandlers - loans', () => {
  beforeEach(async () => {
    localStorage.clear()
    localStorage.setItem('currentProfileId', '1')
    const db = await getDB()
    // Reset data
    await db.clear('profiles')
    await db.clear('loans')

    // Seed initial data
    await db.add('profiles', { id: 1, name: 'Test', created_at: '2026-01-01' })
  })

  it('creates, lists, and gets a loan', async () => {
    const createRes = await loansCreate({
      name: 'Mortgage',
      principal: 200000,
      interest_rate: 3.5,
      term_months: 360,
      start_date: '2026-01-01',
    })
    expect(createRes.status).toBe(201)
    const created = await createRes.json()
    expect(created.id).toBeDefined()
    expect(created.name).toBe('Mortgage')

    // List
    const listRes = await loansList()
    expect(listRes.status).toBe(200)
    const list = await listRes.json()
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe(created.id)
    expect(list[0].principal).toBe(200000)

    // Get
    const getRes = await loansGet({ p1: created.id.toString() })
    expect(getRes.status).toBe(200)
    const fetched = await getRes.json()
    expect(fetched.id).toBe(created.id)
  })

  it('updates a loan', async () => {
    const createRes = await loansCreate({
      name: 'Car Loan',
      principal: 15000,
      interest_rate: 5,
      term_months: 60,
    })
    const created = await createRes.json()

    const updateRes = await loansUpdate(
      { p1: created.id.toString() },
      {
        ...created,
        interest_rate: 4.5,
      }
    )
    expect(updateRes.status).toBe(200)

    const getRes = await loansGet({ p1: created.id.toString() })
    const fetched = await getRes.json()
    expect(fetched.interest_rate).toBe(4.5)
  })

  it('deletes a loan', async () => {
    const createRes = await loansCreate({
      name: 'To Delete',
      principal: 1000,
      interest_rate: 10,
      term_months: 12,
    })
    const created = await createRes.json()

    const deleteRes = await loansDelete({ p1: created.id.toString() })
    expect(deleteRes.status).toBe(200)

    const listRes = await loansList()
    const list = await listRes.json()
    expect(list).toHaveLength(0)
  })

  it('calculates a loan schedule', async () => {
    const createRes = await loansCreate({
      name: 'Personal Loan',
      principal: 10000,
      interest_rate: 5,
      term_months: 12,
      start_date: '2026-01-01',
    })
    const created = await createRes.json()

    const calcRes = await loansCalculate({ p1: created.id.toString() })
    expect(calcRes.status).toBe(200)
    const schedule = await calcRes.json()

    // Assuming the calculate returns { summary: {...}, schedule: [...] }
    expect(schedule.summary).toBeDefined()
    expect(schedule.schedule).toBeDefined()
    expect(Array.isArray(schedule.schedule)).toBe(true)
  })
})
