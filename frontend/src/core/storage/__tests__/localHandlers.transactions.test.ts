import { beforeEach, describe, expect, it } from 'vitest'
import { 
  transactionsCreate, 
  transactionsList, 
  transactionsDelete, 
  transactionsUpdate,
  transactionsGet,
  categoriesCreate
} from '../localHandlers.js'
import { getDB } from '../idb.js'

describe('localHandlers - transactions', () => {
  beforeEach(async () => {
    localStorage.clear()
    localStorage.setItem('currentProfileId', '1')
    const db = await getDB()
    // Reset data
    await db.clear('profiles')
    await db.clear('transactions')
    await db.clear('categories')
    
    // Seed initial data required for transactions
    await db.add('profiles', { id: 1, name: 'Test', created_at: '2026-01-01' })
    await db.add('categories', { id: 1, profile_id: 1, name: 'Food', type: 'expense', color: '#ff0000' })
  })

  it('creates, lists, and gets a transaction', async () => {
    const createRes = await transactionsCreate({
      amount: 50,
      type: 'expense',
      date: '2026-05-20',
      description: 'Test Tx',
      category_id: 1,
    })
    expect(createRes.status).toBe(201)
    const created = await createRes.json()
    expect(created.id).toBeDefined()
    expect(created.description).toBe('Test Tx')

    // List
    const listRes = await transactionsList(new URLSearchParams())
    expect(listRes.status).toBe(200)
    const list = await listRes.json()
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe(created.id)
    expect(list[0].category_name).toBe('Food')

    // Get
    const getRes = await transactionsGet({ p1: created.id.toString() })
    expect(getRes.status).toBe(200)
    const fetched = await getRes.json()
    expect(fetched.id).toBe(created.id)
  })

  it('updates a transaction', async () => {
    const createRes = await transactionsCreate({
      amount: 100,
      type: 'income',
      date: '2026-05-20',
      description: 'Salary',
      category_id: 1,
    })
    const created = await createRes.json()

    const updateRes = await transactionsUpdate({ p1: created.id.toString() }, {
      ...created,
      amount: 200,
      description: 'Bonus',
    })
    expect(updateRes.status).toBe(200)
    
    const getRes = await transactionsGet({ p1: created.id.toString() })
    const fetched = await getRes.json()
    expect(fetched.amount).toBe(200)
    expect(fetched.description).toBe('Bonus')
  })

  it('deletes a transaction', async () => {
    const createRes = await transactionsCreate({
      amount: 100,
      type: 'expense',
      date: '2026-05-20',
      description: 'To Delete',
      category_id: 1,
    })
    const created = await createRes.json()

    const deleteRes = await transactionsDelete({ p1: created.id.toString() })
    expect(deleteRes.status).toBe(200)

    const listRes = await transactionsList(new URLSearchParams())
    const list = await listRes.json()
    expect(list).toHaveLength(0)
  })

  it('filters transactions in list', async () => {
    await transactionsCreate({ amount: 10, type: 'expense', date: '2026-05-01', description: 'T1', category_id: 1 })
    await transactionsCreate({ amount: 20, type: 'expense', date: '2026-05-15', description: 'T2', category_id: 1 })

    // Date from
    const list1 = await (await transactionsList(new URLSearchParams({ date_from: '2026-05-10' }))).json()
    expect(list1).toHaveLength(1)
    expect(list1[0].description).toBe('T2')

    // Search
    const list2 = await (await transactionsList(new URLSearchParams({ search: 'T1' }))).json()
    expect(list2).toHaveLength(1)
    expect(list2[0].description).toBe('T1')
  })
})
