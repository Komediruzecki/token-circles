import { beforeEach, describe, expect, it } from 'vitest'
import { getDB } from '../idb.js'
import { accountsCreate, accountsGet, recurringCreate, recurringPopulate } from '../localHandlers.js'

// Serverless (IndexedDB) recurring populate must move account balances the same
// way the worker/backend do: income/expense move one account, a transfer moves
// From -> To (two-legged), and an account-less recurring is a pure reminder.
const today = new Date().toISOString().slice(0, 10)

describe('localHandlers - recurring balance integrity', () => {
  beforeEach(async () => {
    localStorage.clear()
    localStorage.setItem('currentProfileId', '1')
    const db = await getDB()
    await db.clear('profiles')
    await db.clear('accounts')
    await db.clear('transactions')
    await db.clear('recurring')
    await db.add('profiles', { id: 1, name: 'Test', created_at: '2026-01-01' })
  })

  let acctSeq = 0

  async function createAccount(balance: number): Promise<number> {
    const res = await accountsCreate({ name: `A${++acctSeq}`, type: 'giro', balance })
    return (await res.json()).id
  }

  async function balanceOf(id: number): Promise<number> {
    const res = await accountsGet({ p1: String(id) })
    return (await res.json()).balance
  }

  async function createRecurring(body: Record<string, unknown>): Promise<number> {
    const res = await recurringCreate({ frequency: 'monthly', next_date: today, ...body })
    return (await res.json()).id
  }

  it('populating an income recurring credits the linked account', async () => {
    const acc = await createAccount(1000)
    const id = await createRecurring({
      description: 'Salary',
      amount: 50,
      type: 'income',
      account_id: acc,
    })
    const pop = await recurringPopulate({ p1: String(id) })
    expect(pop.status).toBe(200)
    expect(await balanceOf(acc)).toBe(1050)
  })

  it('a transfer recurring with From + To moves money two-legged', async () => {
    const from = await createAccount(1000)
    const to = await createAccount(500)
    const id = await createRecurring({
      description: 'Monthly savings',
      amount: 200,
      type: 'transfer',
      account_id: from,
      transfer_account_id: to,
    })
    const pop = await recurringPopulate({ p1: String(id) })
    expect(pop.status).toBe(200)
    expect(await balanceOf(from)).toBe(800)
    expect(await balanceOf(to)).toBe(700)
  })

  it('a second same-day populate is rejected (idempotency, no double-count)', async () => {
    const acc = await createAccount(1000)
    const id = await createRecurring({
      description: 'Rent',
      amount: 30,
      type: 'expense',
      account_id: acc,
    })
    expect((await recurringPopulate({ p1: String(id) })).status).toBe(200)
    expect(await balanceOf(acc)).toBe(970)
    const second = await recurringPopulate({ p1: String(id) })
    expect(second.status).toBe(409)
    expect(await balanceOf(acc)).toBe(970)
  })

  it('an account-less recurring is a pure reminder (no balance change)', async () => {
    const acc = await createAccount(1000)
    const id = await createRecurring({ description: 'Note', amount: 99, type: 'expense' })
    const pop = await recurringPopulate({ p1: String(id) })
    expect(pop.status).toBe(200)
    expect(await balanceOf(acc)).toBe(1000)
  })
})
