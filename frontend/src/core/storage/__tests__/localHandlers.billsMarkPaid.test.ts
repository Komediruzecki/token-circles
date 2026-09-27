/**
 * Marking a bill paid in local-first mode records the payment, as the Worker's mark-paid does.
 *
 * It used to stamp the bill paid and nothing else, so the payment never reached the transactions,
 * the account's balance, or anything counted from them. The Worker inserts an expense transaction,
 * debits the account and stamps the bill in one batch, guarded so a second tap writes nothing.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { isoDate } from '../../../utils/period'
import { getDB } from '../idb.js'
import { billsCreate, billsPayOrMarkPaid } from '../localHandlers.js'

let accountId: number
let categoryId: number

beforeEach(async () => {
  localStorage.clear()
  localStorage.setItem('currentProfileId', '1')
  localStorage.setItem('localCurrency', 'GBP')
  const db = await getDB()
  for (const store of ['profiles', 'bills', 'transactions', 'accounts', 'categories'] as const) {
    await db.clear(store)
  }
  await db.add('profiles', { id: 1, name: 'Personal', created_at: '2026-01-01' })
  await db.add('profiles', { id: 2, name: 'Partner', created_at: '2026-01-01' })
  accountId = (await db.add('accounts', {
    profile_id: 1,
    name: 'Current',
    type: 'giro',
    currency: 'GBP',
    balance: 500,
  })) as number
  categoryId = (await db.add('categories', {
    profile_id: 1,
    name: 'Housing',
    type: 'expense',
    color: '#EF4444',
  })) as number
})

/**
 * A bill as the Bills page creates it. `account_id` is set on the stored row: no form sends one,
 * but a bill restored from a cloud backup carries its account, and the Worker's API takes one.
 */
async function createBill(
  extra: { account_id?: number; category_id?: number } = {}
): Promise<number> {
  const res = await billsCreate({
    name: 'Rent',
    amount: 120,
    due_date: '2026-09-10',
    frequency: 'monthly',
    autopay: false,
    notes: 'Flat 2',
    category_id: extra.category_id,
  })
  expect(res.status).toBe(201)
  const id = ((await res.json()) as { id: number }).id
  if (extra.account_id !== undefined) {
    const db = await getDB()
    await db.put('bills', { ...(await db.get('bills', id)), account_id: extra.account_id })
  }
  return id
}

const pay = (id: number) => billsPayOrMarkPaid({ p1: String(id) })

async function transactions() {
  return (await getDB()).getAll('transactions')
}

async function balance() {
  return ((await (await getDB()).get('accounts', accountId)) as { balance: number }).balance
}

describe('marking a bill paid in local-first mode', () => {
  it('records the payment as an expense transaction on the bill’s account, as the Worker does', async () => {
    const id = await createBill({ account_id: accountId, category_id: categoryId })

    const res = await pay(id)

    expect(res.status).toBe(200)
    const [row, ...others] = await transactions()
    expect(others).toEqual([])
    expect(await res.json()).toEqual({ ok: true, transactionId: row!.id })
    expect(row).toMatchObject({
      profile_id: 1,
      description: 'Rent',
      amount: 120,
      type: 'expense',
      category_id: categoryId,
      account_id: accountId,
      transfer_account_id: null,
      date: isoDate(new Date()),
      notes: 'Flat 2',
      // A bill has no currency: its amount is in the base currency.
      currency: 'GBP',
      amount_local: 120,
      exchange_rate: 1,
      reconciled: 0,
    })
    expect(typeof row!.created_at).toBe('string')
    expect(await balance()).toBe(380)
  })

  it('stamps the bill paid on today’s local date', async () => {
    const id = await createBill({ account_id: accountId })
    await pay(id)

    const bill = await (await getDB()).get('bills', id)
    expect(bill).toMatchObject({ last_paid_date: isoDate(new Date()) })
  })

  it('refuses a second payment in the same period, and writes nothing', async () => {
    const id = await createBill({ account_id: accountId })
    expect((await pay(id)).status).toBe(200)

    const again = await pay(id)

    expect(again.status).toBe(409)
    expect(await again.json()).toEqual({ error: 'Bill already paid for current period' })
    expect(await transactions()).toHaveLength(1)
    expect(await balance()).toBe(380)
  })

  it('pays once when two taps arrive together', async () => {
    const id = await createBill({ account_id: accountId })

    const statuses = (await Promise.all([pay(id), pay(id)])).map((r) => r.status).sort()

    expect(statuses).toEqual([200, 409])
    expect(await transactions()).toHaveLength(1)
    expect(await balance()).toBe(380)
  })

  it('records a bill without an account as a transaction that moves no balance', async () => {
    const id = await createBill()

    expect((await pay(id)).status).toBe(200)

    const [row] = await transactions()
    expect(row).toMatchObject({ description: 'Rent', account_id: null, category_id: null })
    expect(await balance()).toBe(500)
  })

  it('does not pay another profile’s bill', async () => {
    const id = await createBill({ account_id: accountId })
    localStorage.setItem('currentProfileId', '2')

    expect((await pay(id)).status).toBe(404)
    expect(await transactions()).toEqual([])
    expect(await balance()).toBe(500)
  })
})
