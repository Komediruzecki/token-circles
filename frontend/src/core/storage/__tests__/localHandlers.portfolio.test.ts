import { beforeEach, describe, expect, it } from 'vitest'
import { getDB } from '../idb.js'
import {
  authCheck,
  authLogin,
  authLogout,
  authMe,
  portfolioHoldingsCreate,
  portfolioHoldingsDelete,
  portfolioHoldingsList,
  portfolioHoldingsUpdate,
  portfolioSummary,
  profilesCreate,
  profilesDelete,
  profilesGet,
  profilesList,
  profilesUpdate,
} from '../localHandlers.js'

describe('localHandlers - auth stubs', () => {
  it('login returns user object', async () => {
    const res = await authLogin({ username: 'admin', password: 'pw' })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.username).toBe('admin')
    expect(data.role).toBe('admin')
  })

  it('login rejects missing credentials', async () => {
    const res = await authLogin(null)
    expect(res.status).toBe(400)
  })

  it('authCheck returns authenticated', async () => {
    const res = await authCheck()
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.authenticated).toBe(true)
  })

  it('authLogout returns ok', async () => {
    const res = await authLogout()
    expect(res.status).toBe(200)
  })

  it('authMe returns local user', async () => {
    const res = await authMe()
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.username).toBe('local')
  })
})

describe('localHandlers - profiles', () => {
  beforeEach(async () => {
    localStorage.clear()
    localStorage.setItem('currentProfileId', '1')
    const db = await getDB()
    await db.clear('profiles')
    await db.clear('categories')
    await db.add('profiles', { id: 1, name: 'Main', created_at: '2026-01-01' })
  })

  it('lists profiles', async () => {
    const res = await profilesList()
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data).toBeInstanceOf(Array)
    expect(data.length).toBeGreaterThanOrEqual(1)
  })

  it('creates a profile', async () => {
    const res = await profilesCreate({ name: 'Second Profile' })
    expect(res.status).toBe(201)
    const data = await res.json()
    expect(data.id).toBeDefined()
  })

  it('gets a profile by id', async () => {
    const res = await profilesGet({ p1: '1' })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.name).toBe('Main')
  })

  it('updates a profile', async () => {
    const res = await profilesUpdate({ p1: '1' }, { name: 'Updated Name' })
    expect(res.status).toBe(200)

    const getRes = await profilesGet({ p1: '1' })
    const data = await getRes.json()
    expect(data.name).toBe('Updated Name')
  })

  it('deletes a profile', async () => {
    const createRes = await profilesCreate({ name: 'To Delete' })
    const created = await createRes.json()

    const res = await profilesDelete({ p1: created.id.toString() })
    expect(res.status).toBe(200)
  })
})

describe('localHandlers - portfolio', () => {
  beforeEach(async () => {
    localStorage.clear()
    localStorage.setItem('currentProfileId', '1')
    const db = await getDB()
    await db.clear('profiles')
    await db.clear('portfolioHoldings')
    await db.add('profiles', { id: 1, name: 'Test', created_at: '2026-01-01' })
  })

  it('creates and lists portfolio holdings', async () => {
    const createRes = await portfolioHoldingsCreate({
      ticker: 'AAPL',
      shares: 10,
      purchase_price: 150.5,
      purchase_date: '2026-01-15',
      notes: 'Long term hold',
    })
    expect(createRes.status).toBe(201)
    const created = await createRes.json()
    expect(created.id).toBeDefined()
    expect(created.ticker).toBe('AAPL')

    const listRes = await portfolioHoldingsList()
    expect(listRes.status).toBe(200)
    const list = await listRes.json()
    expect(list).toHaveLength(1)
    expect(list[0].ticker).toBe('AAPL')
    expect(list[0].marketValue).toBe(1505)
  })

  it('updates a portfolio holding', async () => {
    const createRes = await portfolioHoldingsCreate({
      ticker: 'GOOG',
      shares: 5,
      purchase_price: 100,
      purchase_date: '2026-02-01',
    })
    const created = await createRes.json()

    const updateRes = await portfolioHoldingsUpdate({ p1: created.id.toString() }, { shares: 10 })
    expect(updateRes.status).toBe(200)
    const updated = await updateRes.json()
    expect(updated.shares).toBe(10)
  })

  it('deletes a portfolio holding', async () => {
    const createRes = await portfolioHoldingsCreate({
      ticker: 'TSLA',
      shares: 2,
      purchase_price: 200,
      purchase_date: '2026-03-01',
    })
    const created = await createRes.json()

    const deleteRes = await portfolioHoldingsDelete({ p1: created.id.toString() })
    expect(deleteRes.status).toBe(200)

    const listRes = await portfolioHoldingsList()
    const list = await listRes.json()
    expect(list).toHaveLength(0)
  })

  it('validates required fields on create', async () => {
    const res = await portfolioHoldingsCreate({ ticker: 'AAPL' })
    expect(res.status).toBe(400)
  })

  it('gets portfolio summary', async () => {
    await portfolioHoldingsCreate({
      ticker: 'AAPL',
      shares: 10,
      purchase_price: 150,
      purchase_date: '2026-01-15',
    })
    await portfolioHoldingsCreate({
      ticker: 'GOOG',
      shares: 5,
      purchase_price: 100,
      purchase_date: '2026-02-01',
    })

    const res = await portfolioSummary()
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.totalValue).toBe(2000) // 150*10 + 100*5
    expect(data.totalCostBasis).toBe(2000)
    expect(data.holdings).toHaveLength(2)
    expect(data.allocation).toBeInstanceOf(Array)
    expect(data.allocation).toHaveLength(2)
  })
})
