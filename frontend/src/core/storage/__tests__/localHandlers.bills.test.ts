import { beforeEach, describe, expect, it } from 'vitest'
import { getDB } from '../idb.js'
import {
  billsCreate,
  billsDelete,
  billsGet,
  billsList,
  billsPayOrMarkPaid,
  billsUpcoming,
  billsUpdate,
} from '../localHandlers.js'

describe('localHandlers - bills', () => {
  beforeEach(async () => {
    localStorage.clear()
    localStorage.setItem('currentProfileId', '1')
    const db = await getDB()
    // Reset data
    await db.clear('profiles')
    await db.clear('bills')

    // Seed initial data
    await db.add('profiles', { id: 1, name: 'Test', created_at: '2026-01-01' })
  })

  it('creates, lists, and gets a bill', async () => {
    const createRes = await billsCreate({
      name: 'Internet',
      amount: 50,
      due_date: '2026-05-15',
      frequency: 'monthly',
      autopay: true,
    })
    expect(createRes.status).toBe(201)
    const created = await createRes.json()
    expect(created.id).toBeDefined()

    // List
    const listRes = await billsList()
    expect(listRes.status).toBe(200)
    const list = await listRes.json()
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe(created.id)
    expect(list[0].name).toBe('Internet')
    expect(list[0].autopay).toBe(true)

    // Get
    const getRes = await billsGet({ p1: created.id.toString() })
    expect(getRes.status).toBe(200)
    const fetched = await getRes.json()
    expect(fetched.id).toBe(created.id)
    expect(fetched.autopay).toBe(true)
  })

  it('updates a bill', async () => {
    const createRes = await billsCreate({
      name: 'Electricity',
      amount: 100,
      due_date: '2026-05-20',
      frequency: 'monthly',
      autopay: false,
    })
    const created = await createRes.json()

    const updateRes = await billsUpdate(
      { p1: created.id.toString() },
      {
        ...created,
        amount: 120,
        autopay: true,
      }
    )
    expect(updateRes.status).toBe(200)

    const getRes = await billsGet({ p1: created.id.toString() })
    const fetched = await getRes.json()
    expect(fetched.amount).toBe(120)
    expect(fetched.autopay).toBe(true)
  })

  it('deletes a bill', async () => {
    const createRes = await billsCreate({
      name: 'To Delete',
      amount: 10,
      due_date: '2026-05-01',
      frequency: 'monthly',
      autopay: false,
    })
    const created = await createRes.json()

    const deleteRes = await billsDelete({ p1: created.id.toString() })
    expect(deleteRes.status).toBe(200)

    const listRes = await billsList()
    const list = await listRes.json()
    expect(list).toHaveLength(0)
  })

  it('marks a bill as paid', async () => {
    const createRes = await billsCreate({
      name: 'Water',
      amount: 40,
      due_date: '2026-05-10',
      frequency: 'monthly',
      autopay: false,
    })
    const created = await createRes.json()

    const payRes = await billsPayOrMarkPaid({ p1: created.id.toString() })
    expect(payRes.status).toBe(200)

    // Check list with paid=true
    const listRes = await billsList(new URLSearchParams({ paid: 'true' }))
    const list = await listRes.json()
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe(created.id)
  })

  it('fetches upcoming bills', async () => {
    // We create a bill for next month to ensure it appears in upcoming
    const today = new Date()
    today.setMonth(today.getMonth() + 1)
    const nextMonth = today.toISOString().split('T')[0]

    await billsCreate({
      name: 'Upcoming Bill',
      amount: 60,
      due_date: nextMonth,
      frequency: 'monthly',
      autopay: false,
    })

    const upcomingRes = await billsUpcoming()
    expect(upcomingRes.status).toBe(200)
    const upcoming = await upcomingRes.json()
    expect(Array.isArray(upcoming)).toBe(true)
  })
})
