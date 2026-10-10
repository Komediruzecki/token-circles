/**
 * "Add to transactions" on a recurring rule adds one transaction a period in local-first, however
 * many presses overlap, as the Worker's guard makes it (worker/test/concurrent-writes.test.ts,
 * "populates a period once when both taps read the same next date").
 *
 * The handler read the rule, wrote the transaction, then moved next_date on. Two populates that
 * overlapped both read the same next_date, so both added the period and the account was debited
 * twice. Now a populate claims the period first: it moves next_date on in one IndexedDB
 * transaction that rereads it, and a populate that finds it already moved is refused (409) before
 * it writes anything. A claim whose transaction then fails is given back.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { RECURRING_MESSAGES as M } from '../../../../../shared/recurringSchema'
import { localToday } from '../../../utils/period'
import { adapter } from '../handlers/helpers'
import { getDB } from '../idb'

let routeApiRequest: (url: string, init?: RequestInit) => Promise<Response>

beforeAll(async () => {
  routeApiRequest = (await import('../localApiRouter')).routeApiRequest
}, 120_000)

const GIRO = 32
const RULE = 41

beforeEach(async () => {
  localStorage.clear()
  localStorage.setItem('currentProfileId', '1')
  localStorage.setItem('selectedProfileIds', '[1]')
  const db = await getDB()
  for (const store of ['profiles', 'accounts', 'recurring', 'transactions'] as const) {
    await db.clear(store)
  }
  await db.add('profiles', { id: 1, name: 'Me', created_at: '2026-01-01T00:00:00.000Z' })
  await db.add('accounts', {
    id: GIRO,
    profile_id: 1,
    name: 'Giro',
    type: 'giro',
    currency: 'EUR',
    balance: 1000,
    starting_balance: 1000,
  } as never)
  await db.add('recurring', {
    id: RULE,
    profile_id: 1,
    description: 'Rent',
    amount: 250,
    type: 'expense',
    frequency: 'monthly',
    day_of_month: null,
    next_date: localToday(),
    category_id: null,
    account_id: GIRO,
    transfer_account_id: null,
    notes: '',
    active: 1,
    created_at: '2026-01-01T00:00:00.000Z',
  } as never)
})

afterEach(() => {
  vi.restoreAllMocks()
})

function populate(): Promise<Response> {
  return routeApiRequest(`http://localhost/api/recurring/${RULE}/populate`, {
    method: 'POST',
    headers: { 'X-Profile-Id': '1' },
  })
}

async function written(): Promise<{ transactions: number; balance: number; next: string }> {
  const db = await getDB()
  const transactions = await db.getAllFromIndex('transactions', 'by_profile', 1)
  const giro = (await db.get('accounts', GIRO)) as { balance: number }
  const rule = (await db.get('recurring', RULE)) as { next_date: string }
  return { transactions: transactions.length, balance: giro.balance, next: rule.next_date }
}

describe('adding a recurring rule to the transactions, twice at once', () => {
  it('adds the period once, debits the account once, and refuses the other press', async () => {
    const today = localToday()
    const answers = await Promise.all([populate(), populate()])

    expect(answers.map((a) => a.status).sort()).toEqual([200, 409])
    const refused = answers.find((a) => a.status === 409)!
    expect(await refused.json()).toEqual({ error: M.populated })
    const after = await written()
    expect(after.transactions).toBe(1)
    expect(after.balance).toBe(750)
    expect(after.next > today).toBe(true)
  })

  it('gives the period back when its transaction cannot be written, so a retry adds it', async () => {
    const today = localToday()
    vi.spyOn(adapter, 'createTransaction').mockRejectedValueOnce(new Error('The disk is full'))

    expect((await populate()).status).toBe(500)
    expect(await written()).toEqual({ transactions: 0, balance: 1000, next: today })

    expect((await populate()).status).toBe(200)
    expect(await written()).toMatchObject({ transactions: 1, balance: 750 })
  })
})
