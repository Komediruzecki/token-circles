import { beforeEach, describe, expect, it } from 'vitest'
import { getDB } from '../idb.js'
import {
  accountsCreate,
  accountsDelete,
  accountsGet,
  accountsHistory,
  accountsHistoryRecord,
  accountsList,
  accountsTimeline,
  accountsUpdate,
} from '../localHandlers.js'

describe('localHandlers - accounts', () => {
  beforeEach(async () => {
    localStorage.clear()
    localStorage.setItem('currentProfileId', '1')
    const db = await getDB()
    // Reset data
    await db.clear('profiles')
    await db.clear('accounts')
    await db.clear('balanceHistory')

    // Seed initial data
    await db.add('profiles', { id: 1, name: 'Test', created_at: '2026-01-01' })
  })

  it('creates, lists, and gets an account', async () => {
    const createRes = await accountsCreate({
      name: 'Main Checking',
      type: 'checking',
      balance: 1000,
    })
    expect(createRes.status).toBe(201)
    const created = await createRes.json()
    expect(created.id).toBeDefined()
    expect(created.name).toBe('Main Checking')

    // List
    const listRes = await accountsList()
    expect(listRes.status).toBe(200)
    const list = await listRes.json()
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe(created.id)
    expect(list[0].name).toBe('Main Checking')

    // Get
    const getRes = await accountsGet({ p1: created.id.toString() })
    expect(getRes.status).toBe(200)
    const fetched = await getRes.json()
    expect(fetched.id).toBe(created.id)
  })

  it('updates an account', async () => {
    const createRes = await accountsCreate({
      name: 'Savings',
      type: 'savings',
      balance: 500,
    })
    const created = await createRes.json()

    const updateRes = await accountsUpdate(
      { p1: created.id.toString() },
      {
        ...created,
        name: 'Super Savings',
        balance: 600,
      }
    )
    expect(updateRes.status).toBe(200)

    const getRes = await accountsGet({ p1: created.id.toString() })
    const fetched = await getRes.json()
    expect(fetched.name).toBe('Super Savings')
    expect(fetched.balance).toBe(600)
  })

  it('deletes an account', async () => {
    const createRes = await accountsCreate({
      name: 'To Delete',
      type: 'checking',
      balance: 0,
    })
    const created = await createRes.json()

    const deleteRes = await accountsDelete({ p1: created.id.toString() })
    expect(deleteRes.status).toBe(200)

    const listRes = await accountsList()
    const list = await listRes.json()
    expect(list).toHaveLength(0)
  })

  it('records and retrieves balance history', async () => {
    const createRes = await accountsCreate({
      name: 'History Acc',
      type: 'checking',
      balance: 100,
    })
    const created = await createRes.json()

    // Record history
    const recordRes = await accountsHistoryRecord(
      { p1: created.id.toString() },
      {
        balance: 150,
        date: '2026-05-20',
      }
    )
    expect(recordRes.status).toBe(201)

    // Get history
    const historyRes = await accountsHistory({ p1: created.id.toString() })
    expect(historyRes.status).toBe(200)
    const history = await historyRes.json()
    expect(history).toHaveLength(1)
    expect(history[0].balance).toBe(150)
  })

  it('fetches accounts timeline', async () => {
    const createRes = await accountsCreate({
      name: 'Timeline Acc',
      type: 'checking',
      balance: 100,
    })
    const created = await createRes.json()

    await accountsHistoryRecord(
      { p1: created.id.toString() },
      {
        balance: 200,
        date: '2026-05-20',
      }
    )

    const timelineRes = await accountsTimeline()
    expect(timelineRes.status).toBe(200)
    const timeline = await timelineRes.json()
    expect(Array.isArray(timeline)).toBe(true)
  })
})
