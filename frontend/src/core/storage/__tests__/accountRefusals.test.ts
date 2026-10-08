/**
 * What the local-first router refuses for an account, and how it says it.
 *
 * The same rules and words as the Worker (shared/accountSchema.ts, and
 * worker/test/account-refusals.test.ts for the other runtime): a refused body answers 400
 * `{ error, fields }`. These go through `routeApiRequest`, the router `apiFetch` calls, so the
 * schema step and the handler are both in the path.
 *
 * Where local-first used to differ from the Worker:
 *
 * - It refused a body without a type, which the Worker made a giro account, and the type names
 *   v4 renamed, which older versions of this app stored.
 * - It took a starting date in any format.
 * - It stored the body as it came: keys the app never reads, and a new account's current balance
 *   apart from its starting balance, which the next recompute undid.
 * - An edit was checked against everything the form sent back, so a row with a name over 100
 *   characters could not be edited at all, and it wrote the currency the form sends on every save.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ACCOUNT_MESSAGES as M } from '../../../../../shared/accountSchema'
import { getDB } from '../idb'

let routeApiRequest: (url: string, init?: RequestInit) => Promise<Response>

beforeAll(async () => {
  routeApiRequest = (await import('../localApiRouter')).routeApiRequest
}, 120_000)

const EVERYDAY = 1
// Rows an import or an older version stored, which a create now refuses.
const LONG_NAMED = 2 // a name over 100 characters
const CHECKING = 3 // a type v4 renamed
const ODD_DATE = 4 // a starting date that is not YYYY-MM-DD

const LONG_NAME = 'Joint account '.repeat(8).trim()
const CONFLICT =
  'Account balances use EUR. Change the base currency in Settings before adding financial data.'

type Row = Record<string, unknown>

beforeEach(async () => {
  localStorage.clear()
  localStorage.setItem('currentProfileId', '1')
  localStorage.setItem('localCurrency', 'EUR')
  const db = await getDB()
  for (const store of ['profiles', 'accounts', 'settings', 'transactions'] as const) {
    await db.clear(store)
  }
  await db.add('profiles', { id: 1, name: 'Me', created_at: '2026-01-01T00:00:00.000Z' })
  await db.put('settings', { key: 'currency', value: 'EUR' })
  const account = (id: number, values: Row = {}) =>
    db.add('accounts', {
      id,
      profile_id: 1,
      name: 'Everyday',
      type: 'giro',
      bank_name: 'Credit Union',
      currency: 'EUR',
      balance: 920,
      starting_balance: 1000,
      starting_date: '2026-01-01',
      notes: '',
      ...values,
    } as never)
  await account(EVERYDAY)
  await account(LONG_NAMED, { name: LONG_NAME })
  await account(CHECKING, { name: 'Old checking', type: 'checking' })
  await account(ODD_DATE, { name: 'Old date', starting_date: '01/01/2026' })
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

const create = (body: unknown) => call('POST', '/api/accounts', body)
const edit = (id: number, body: unknown) => call('PUT', `/api/accounts/${id}`, body)

async function stored(id: number): Promise<Row> {
  return (await (await getDB()).get('accounts', id)) as Row
}

async function storedBy(name: string): Promise<Row[]> {
  const rows = (await (await getDB()).getAll('accounts')) as Row[]
  return rows.filter((r) => r.name === name)
}

async function count(): Promise<number> {
  return (await (await getDB()).getAll('accounts')).length
}

async function refusal(res: Response): Promise<{ error: string; fields?: Record<string, string> }> {
  expect(res.status).toBe(400)
  return (await res.json()) as { error: string; fields?: Record<string, string> }
}

/** What the Accounts form sends on an edit that changes nothing: the fields it shows. */
function formBody(row: Row, change: Row = {}): Row {
  return {
    name: row.name,
    type: row.type === 'checking' ? 'giro' : row.type,
    bank_name: row.bank_name,
    currency: 'EUR',
    starting_date: row.starting_date,
    ...change,
  }
}

describe('a new account in local-first', () => {
  it('stores the row the Worker stores: trimmed, with its defaults, and nothing else', async () => {
    const res = await create({ name: '  Holiday fund ', currency: 'EUR', current_balance: 5 })
    expect(res.status).toBe(201)

    const [row] = await storedBy('Holiday fund')
    expect(row).toEqual({
      id: expect.any(Number),
      profile_id: 1,
      name: 'Holiday fund',
      type: 'giro',
      bank_name: '',
      currency: 'EUR',
      balance: 0,
      starting_balance: 0,
      starting_date: null,
      notes: '',
    })
  })

  it('opens at its starting balance, whatever current balance the body sends', async () => {
    await create({ name: 'Card', starting_balance: 1000, balance: 1200 })
    expect(await storedBy('Card')).toMatchObject([{ balance: 1000, starting_balance: 1000 }])

    await create({ name: 'Wallet', balance: '35.5' })
    expect(await storedBy('Wallet')).toMatchObject([{ balance: 35.5, starting_balance: 35.5 }])
  })

  it('stores a type v4 renamed as the type that replaced it', async () => {
    expect((await create({ name: 'Brokerage', type: 'investment' })).status).toBe(201)
    expect(await storedBy('Brokerage')).toMatchObject([{ type: 'ib' }])
  })

  it('answers a refusal with each field and a summary of them all', async () => {
    expect(await refusal(await create({ name: ' ', type: 'credit' }))).toEqual({
      error: `${M.name} ${M.type}`,
      fields: { name: M.name, type: M.type },
    })
  })

  it.each([
    ['no name', { type: 'giro' }, { name: M.name }],
    ['a name over 100 characters', { name: 'x'.repeat(101) }, { name: M.nameLength }],
    ['a type it does not have', { name: 'A', type: 'credit' }, { type: M.type }],
    ['a balance that is not a number', { name: 'A', balance: '12abc' }, { balance: M.balance }],
    [
      'a starting balance that is not a number',
      { name: 'A', starting_balance: 'abc' },
      { starting_balance: M.startingBalance },
    ],
    [
      'a starting date that does not exist',
      { name: 'A', starting_date: '2026-02-30' },
      { starting_date: M.startingDate },
    ],
    ['a currency that is not a code', { name: 'A', currency: 'EURO' }, { currency: M.currency }],
  ])('refuses %s, and stores nothing', async (_, body, fields) => {
    const before = await count()
    expect((await refusal(await create(body))).fields).toEqual(fields)
    expect(await count()).toBe(before)
  })

  it('answers a currency other than the base currency with the 409 and its sentence', async () => {
    const res = await create({ name: 'Dollars', currency: 'USD' })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: CONFLICT })
    expect(await storedBy('Dollars')).toEqual([])
  })
})

describe('an edit of an account in local-first', () => {
  it('writes nothing for a save that changes nothing', async () => {
    const before = await stored(EVERYDAY)
    expect((await edit(EVERYDAY, formBody(before))).status).toBe(200)
    expect(await stored(EVERYDAY)).toEqual(before)
  })

  it('writes only what it changes', async () => {
    const before = await stored(EVERYDAY)
    const res = await edit(
      EVERYDAY,
      formBody(before, { name: 'Main', notes: 'Bills come out here' })
    )
    expect(res.status).toBe(200)
    expect(await stored(EVERYDAY)).toEqual({
      ...before,
      name: 'Main',
      notes: 'Bills come out here',
    })
  })

  it('keeps a balance correction: the starting balance and the balance together', async () => {
    const before = await stored(EVERYDAY)
    const res = await edit(EVERYDAY, formBody(before, { starting_balance: 1080, balance: 1000 }))
    expect(res.status).toBe(200)
    expect(await stored(EVERYDAY)).toMatchObject({ starting_balance: 1080, balance: 1000 })
  })

  it.each([
    ['a blank name', { name: '  ' }, { name: M.name }],
    ['a type it does not have', { type: 'credit' }, { type: M.type }],
    ['a balance that is not a number', { balance: 'abc' }, { balance: M.balance }],
    ['a blank balance', { balance: null }, { balance: M.balance }],
    [
      'a starting date that does not exist',
      { starting_date: '2026-13-01' },
      { starting_date: M.startingDate },
    ],
  ])(
    'refuses %s at its field, writes nothing, and says so on the console',
    async (_, change, fields) => {
      const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      const before = await stored(EVERYDAY)
      expect((await refusal(await edit(EVERYDAY, formBody(before, change)))).fields).toEqual(fields)
      expect(await stored(EVERYDAY)).toEqual(before)
      const lines = errors.mock.calls.map((args) => args.map(String).join(' '))
      expect(lines.some((line) => line.includes('[accountsUpdate] Validation failed'))).toBe(true)
    }
  )

  it.each([
    ['a name over 100 characters', LONG_NAMED],
    ['a type v4 renamed', CHECKING],
    ['a starting date in another format', ODD_DATE],
  ])('saves a notes change to a row with %s', async (_, id) => {
    const before = await stored(id)
    const res = await edit(id, formBody(before, { notes: 'Checked' }))
    expect(res.status, JSON.stringify(await res.clone().json())).toBe(200)
    expect(await stored(id)).toEqual({ ...before, notes: 'Checked' })
  })

  it('answers a currency other than the base currency with the 409 and its sentence', async () => {
    const before = await stored(EVERYDAY)
    const res = await edit(EVERYDAY, formBody(before, { name: 'Main', currency: 'USD' }))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: CONFLICT })
    expect(await stored(EVERYDAY)).toEqual(before)
  })
})
