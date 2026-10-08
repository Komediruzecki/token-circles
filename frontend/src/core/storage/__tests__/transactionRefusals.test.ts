/**
 * What the local-first router refuses for a transaction, and how it says it.
 *
 * The same rules and words as the Worker (shared/transactionSchema.ts, and
 * worker/test/transaction-refusals.test.ts for the other runtime): a refused body answers 400
 * `{ error, fields }`, with a sentence per field for the form to show. These go through
 * `routeApiRequest`, the router `apiFetch` calls, so the schema step and the handler are both in
 * the path.
 *
 * Where local-first used to differ from the Worker:
 *
 * - It refused a deduction, a body without a description or without a `category_id` key, and
 *   any amount but a number. Imports and API clients send all of those, and the Worker took them.
 * - It took an amount with three decimals, which the Worker refused.
 * - It answered an account of another profile with "Account does not belong to this profile" and
 *   no field, and a transfer's missing destination in words of its own.
 * - It stored the body as it came, keys the app never reads included.
 * - An edit checked every field the form sent, so a row an import had stored with a date that is
 *   not YYYY-MM-DD, or a link to another profile's account, could not be edited at all.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { TRANSACTION_MESSAGES as M } from '../../../../../shared/transactionSchema'
import { localToday } from '../../../utils/period'
import { getDB } from '../idb'

let routeApiRequest: (url: string, init?: RequestInit) => Promise<Response>

beforeAll(async () => {
  routeApiRequest = (await import('../localApiRouter')).routeApiRequest
}, 120_000)

const OTHER_PROFILE = 2
const EVERYDAY = 1
const SAVINGS = 2
const ELSEWHERE_ACCOUNT = 3 // another profile's
const GROCERIES = 11
const RENT = 12
const ELSEWHERE_CATEGORY = 13 // another profile's

const PLAIN = 41
// Rows an import, an older version or the other runtime stored, which a create now refuses.
const CENTS = 42 // an amount with three decimals
const DATED = 43 // a date that is not YYYY-MM-DD
const EURO = 44 // a currency that is not a code
const NO_DESTINATION = 45 // a transfer with no account to go to
const CROSS_LINKED = 46 // an account of another profile
const FX = 47 // 100 USD, 92 in the base currency
const TRANSFER = 48

type Row = Record<string, unknown>

const STORES = ['profiles', 'accounts', 'categories', 'transactions', 'goals', 'tags', 'tagRules']

beforeEach(async () => {
  localStorage.clear()
  localStorage.setItem('currentProfileId', '1')
  localStorage.setItem('localCurrency', 'EUR')
  const db = await getDB()
  for (const store of STORES) {
    await db.clear(store as 'profiles')
  }
  await db.add('profiles', { id: 1, name: 'Me', created_at: '2026-01-01T00:00:00.000Z' })
  await db.add('profiles', {
    id: OTHER_PROFILE,
    name: 'Household',
    created_at: '2026-01-01T00:00:00.000Z',
  })
  const account = (id: number, profile: number, name: string, balance: number) =>
    db.add('accounts', {
      id,
      profile_id: profile,
      name,
      type: 'giro',
      currency: 'EUR',
      balance,
      starting_balance: balance,
    } as never)
  await account(EVERYDAY, 1, 'Everyday', 1000)
  await account(SAVINGS, 1, 'Savings', 500)
  await account(ELSEWHERE_ACCOUNT, OTHER_PROFILE, 'Elsewhere', 300)
  const category = (id: number, profile: number, name: string) =>
    db.add('categories', {
      id,
      profile_id: profile,
      name,
      type: 'expense',
      color: '#6e9bff',
      icon: 'tag',
      parent_id: null,
      tax_deductible: false,
      created_at: '2026-01-01T00:00:00.000Z',
    } as never)
  await category(GROCERIES, 1, 'Groceries')
  await category(RENT, 1, 'Rent')
  await category(ELSEWHERE_CATEGORY, OTHER_PROFILE, 'Elsewhere')
  const row = (values: Row) =>
    db.add('transactions', {
      profile_id: 1,
      type: 'expense',
      description: 'Row',
      amount: 10,
      amount_local: null,
      currency: 'EUR',
      exchange_rate: 1,
      date: '2026-10-01',
      category_id: null,
      account_id: EVERYDAY,
      transfer_account_id: null,
      notes: '',
      beneficiary: '',
      payor: '',
      means_of_payment: '',
      created_at: '2026-10-01T09:00:00.000Z',
      updated_at: '2026-10-01T09:00:00.000Z',
      ...values,
    } as never)
  await row({
    id: PLAIN,
    description: 'Weekly groceries',
    amount: 82.4,
    category_id: GROCERIES,
    notes: 'From the market',
  })
  await row({ id: CENTS, description: 'Old cents', amount: 12.345 })
  await row({ id: DATED, description: 'Old date', date: '2026-1-5' })
  await row({ id: EURO, description: 'Old currency', currency: 'euro' })
  await row({ id: NO_DESTINATION, description: 'Half a transfer', type: 'transfer', amount: 50 })
  await row({ id: CROSS_LINKED, description: 'Cross-linked', account_id: ELSEWHERE_ACCOUNT })
  await row({
    id: FX,
    description: 'Hotel',
    amount: 100,
    amount_local: 92,
    currency: 'USD',
    exchange_rate: 0.92,
  })
  await row({
    id: TRANSFER,
    description: 'To savings',
    type: 'transfer',
    amount: 40,
    transfer_account_id: SAVINGS,
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

function call(method: string, path: string, body?: unknown): Promise<Response> {
  return routeApiRequest(`http://localhost${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Profile-Id': '1' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

const create = (body: unknown) => call('POST', '/api/transactions', body)
const edit = (id: number, body: unknown) => call('PUT', `/api/transactions/${id}`, body)

async function refusal(res: Response): Promise<{ error: string; fields?: Record<string, string> }> {
  expect(res.status).toBe(400)
  return (await res.json()) as { error: string; fields?: Record<string, string> }
}

async function stored(id: number): Promise<Row> {
  return (await (await getDB()).get('transactions', id)) as Row
}

async function storedBy(description: string): Promise<Row[]> {
  const rows = (await (await getDB()).getAll('transactions')) as Row[]
  return rows.filter((r) => r.description === description)
}

async function balanceOf(id: number): Promise<number> {
  return ((await (await getDB()).get('accounts', id)) as { balance: number }).balance
}

/** Each account's balance, to the cent: a reversal applied again can come back with noise. */
async function expectBalances(expected: Record<number, number>): Promise<void> {
  for (const [id, balance] of Object.entries(expected)) {
    expect(await balanceOf(Number(id)), `account ${id}`).toBeCloseTo(balance, 6)
  }
}

/** What the Transactions form sends on every save: every field it shows, from the row. */
function formBody(row: Row, change: Row = {}): Row {
  return {
    type: row.type,
    description: row.description,
    amount: row.amount,
    currency: row.currency,
    date: row.date,
    category_id: row.category_id,
    transfer_account_id: row.type === 'transfer' ? row.transfer_account_id : null,
    account_id: row.account_id,
    beneficiary: row.beneficiary,
    payor: row.payor,
    exchange_rate: row.exchange_rate,
    notes: row.notes,
    means_of_payment: row.means_of_payment,
    ...change,
  }
}

describe('a new transaction in local-first', () => {
  it('stores the row the Worker stores, not the body as it came', async () => {
    const res = await create({
      type: 'expense',
      description: '  Market run ',
      amount: '23.50',
      date: '2026-10-07',
      category_id: String(GROCERIES),
      account_id: EVERYDAY,
      currency: 'eur',
      tags: [{ id: 1, name: 'made up', color: '#000' }],
      reconciled: 1,
    })
    expect(res.status).toBe(201)

    const [row] = await storedBy('Market run')
    expect(row).toMatchObject({
      type: 'expense',
      amount: 23.5,
      currency: 'EUR',
      exchange_rate: 1,
      date: '2026-10-07',
      category_id: GROCERIES,
      account_id: EVERYDAY,
      notes: '',
      profile_id: 1,
    })
    expect(row).not.toHaveProperty('tags')
    expect(row).not.toHaveProperty('reconciled')
    expect(typeof row.created_at).toBe('string')
    await expectBalances({ [EVERYDAY]: 976.5 })
  })

  it('saves without a description, a category or a date, as an import or an API client sends it', async () => {
    const res = await create({ type: 'income', amount: 40 })
    expect(res.status).toBe(201)
    expect(await res.json()).toMatchObject({
      description: '',
      category_id: null,
      date: localToday(),
      currency: 'EUR',
    })
  })

  it('saves a deduction, which moves no balance', async () => {
    expect((await create({ type: 'deduction', amount: 15, account_id: EVERYDAY })).status).toBe(201)
    await expectBalances({ [EVERYDAY]: 1000 })
  })

  it('answers a refusal with each field and a summary of them all', async () => {
    const body = await refusal(await create({ type: 'transfer', amount: '', account_id: EVERYDAY }))
    expect(body).toEqual({
      error: `${M.amount} ${M.transferTo}`,
      fields: { amount: M.amount, transfer_account_id: M.transferTo },
    })
  })

  it.each([
    ['no type', { amount: 5 }, { type: M.type }],
    ['no amount', { type: 'expense' }, { amount: M.amount }],
    ['an amount of zero', { type: 'expense', amount: 0 }, { amount: M.amountPositive }],
    ['three decimals', { type: 'expense', amount: 100.555 }, { amount: M.amountCents }],
    [
      'a date that does not exist',
      { type: 'expense', amount: 5, date: '2026-02-30' },
      { date: M.date },
    ],
    [
      'a currency that is not a code',
      { type: 'expense', amount: 5, currency: 'euro' },
      { currency: M.currency },
    ],
    [
      'a category id that is not one',
      { type: 'expense', amount: 5, category_id: 1.5 },
      { category_id: M.category },
    ],
  ])('refuses %s, and stores nothing', async (_, body, fields) => {
    const before = ((await (await getDB()).getAll('transactions')) as Row[]).length
    expect((await refusal(await create(body))).fields).toEqual(fields)
    expect((await (await getDB()).getAll('transactions')).length).toBe(before)
  })

  it('refuses a transfer without its accounts, or with the same one twice', async () => {
    expect((await refusal(await create({ type: 'transfer', amount: 5 }))).fields).toEqual({
      account_id: M.transferFrom,
      transfer_account_id: M.transferTo,
    })
    expect(
      (
        await refusal(
          await create({
            type: 'transfer',
            amount: 5,
            account_id: EVERYDAY,
            transfer_account_id: EVERYDAY,
          })
        )
      ).fields
    ).toEqual({ transfer_account_id: M.transferSame })
    await expectBalances({ [EVERYDAY]: 1000 })
  })

  it("refuses another profile's account or category at its field, and moves no balance", async () => {
    expect(
      (
        await refusal(
          await create({
            type: 'transfer',
            amount: 5,
            account_id: EVERYDAY,
            transfer_account_id: ELSEWHERE_ACCOUNT,
            category_id: ELSEWHERE_CATEGORY,
          })
        )
      ).fields
    ).toEqual({ transfer_account_id: M.account, category_id: M.category })
    await expectBalances({ [EVERYDAY]: 1000, [SAVINGS]: 500, [ELSEWHERE_ACCOUNT]: 300 })
  })

  it('says so on the console, where the release suite looks', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await refusal(await create({ type: 'expense', amount: -1 }))
    const lines = errors.mock.calls.map((args) => args.map(String).join(' '))
    expect(lines.some((line) => line.includes('Validation failed'))).toBe(true)
  })
})

describe('an edit in local-first', () => {
  it('writes only what it changes', async () => {
    const before = await stored(PLAIN)
    const res = await edit(PLAIN, formBody(before, { description: 'Groceries, week 40' }))
    expect(res.status).toBe(200)

    expect(await stored(PLAIN)).toEqual({ ...before, description: 'Groceries, week 40' })
    await expectBalances({ [EVERYDAY]: 1000 })
  })

  it('answers 200 when it changes nothing, a save that changed only the tags', async () => {
    const before = await stored(PLAIN)
    expect((await edit(PLAIN, formBody(before))).status).toBe(200)
    expect((await edit(PLAIN, {})).status).toBe(200)
    expect(await stored(PLAIN)).toEqual(before)
  })

  it('refuses a changed value the rules refuse, at its field, and says so on the console', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect((await refusal(await edit(PLAIN, { amount: 12.345 }))).fields).toEqual({
      amount: M.amountCents,
    })
    expect((await refusal(await edit(PLAIN, { date: '2026-02-30', type: 'gift' }))).fields).toEqual(
      {
        type: M.type,
        date: M.date,
      }
    )
    expect((await refusal(await edit(PLAIN, { category_id: ELSEWHERE_CATEGORY }))).fields).toEqual({
      category_id: M.category,
    })
    expect(await stored(PLAIN)).toMatchObject({ amount: 82.4, date: '2026-10-01' })
    const lines = errors.mock.calls.map((args) => args.map(String).join(' '))
    expect(lines.some((line) => line.includes('[transactionsUpdate] Validation failed'))).toBe(true)
  })

  it('clears what the form sends blank', async () => {
    const before = await stored(PLAIN)
    expect((await edit(PLAIN, formBody(before, { notes: '' }))).status).toBe(200)
    expect((await stored(PLAIN)).notes).toBe('')
  })

  it('makes a transfer into an expense without its destination, and moves the balances back', async () => {
    const before = await stored(TRANSFER)
    const res = await edit(
      TRANSFER,
      formBody(before, { type: 'expense', transfer_account_id: null })
    )
    expect(res.status).toBe(200)

    expect(await stored(TRANSFER)).toMatchObject({ type: 'expense', transfer_account_id: null })
    // The seeded balances never had the transfer applied: undoing it gives Everyday 40 and takes
    // 40 from Savings; as an expense it takes the 40 from Everyday again.
    await expectBalances({ [EVERYDAY]: 1000, [SAVINGS]: 460 })
  })

  describe('of a row stored under older rules', () => {
    it.each([
      ['an amount with three decimals', CENTS],
      ['a date that is not YYYY-MM-DD', DATED],
      ['a currency that is not a code', EURO],
      ['a transfer without a destination', NO_DESTINATION],
      ["an account of another profile's", CROSS_LINKED],
    ])('saves a description change to one with %s', async (_, id) => {
      const before = await stored(id)
      const balances = {
        [EVERYDAY]: await balanceOf(EVERYDAY),
        [SAVINGS]: await balanceOf(SAVINGS),
        [ELSEWHERE_ACCOUNT]: await balanceOf(ELSEWHERE_ACCOUNT),
      }

      const res = await edit(id, formBody(before, { description: 'Renamed' }))
      expect(res.status, JSON.stringify(await res.clone().json())).toBe(200)

      expect(await stored(id)).toEqual({ ...before, description: 'Renamed' })
      await expectBalances(balances)
    })

    it('still refuses a change to how such a row moves money that leaves it broken', async () => {
      const before = await stored(NO_DESTINATION)
      expect(
        (await refusal(await edit(NO_DESTINATION, formBody(before, { amount: 60 })))).fields
      ).toEqual({ transfer_account_id: M.transferTo })

      const fixed = await edit(
        NO_DESTINATION,
        formBody(before, { amount: 60, transfer_account_id: SAVINGS })
      )
      expect(fixed.status).toBe(200)
      expect(await stored(NO_DESTINATION)).toMatchObject({
        amount: 60,
        transfer_account_id: SAVINGS,
      })
    })
  })

  it("keeps a foreign-currency row's local amount, and its account's balance, on a description change", async () => {
    const before = await stored(FX)
    const res = await edit(FX, formBody(before, { description: 'Hotel, two nights' }))
    expect(res.status).toBe(200)

    expect(await stored(FX)).toMatchObject({ amount: 100, amount_local: 92, exchange_rate: 0.92 })
    await expectBalances({ [EVERYDAY]: 1000 })
  })

  it('moves the local amount with a new amount, at the row rate, as the Worker does', async () => {
    const before = await stored(FX)
    expect((await edit(FX, formBody(before, { amount: 110 }))).status).toBe(200)

    expect(await stored(FX)).toMatchObject({ amount: 110, amount_local: 101.2 })
    await expectBalances({ [EVERYDAY]: 990.8 })
  })
})
