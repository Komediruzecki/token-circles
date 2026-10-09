/**
 * One kind of row exported on its own in local-first (GET /api/export/:type, through
 * `routeApiRequest`), with older rows in place: the twin of worker/test/export-by-type.test.ts,
 * which expects the same files (shared/exportColumns.ts).
 *
 * Before, local-first wrote columns of its own (a transaction's category by id, ids and profile
 * ids, no means of payment or beneficiary), quoted every description and guarded no cell a
 * spreadsheet would run as a formula; answered JSON as every field of each row inside
 * `{ <kind>: [...] }`; answered any kind its backup has (goals, settings) and the whole backup for
 * one it did not know; and, asked with no profile, exported every profile.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { EXPORT_MESSAGES } from '../../../../../shared/exportColumns'
import { getDB } from '../idb'

let routeApiRequest: (url: string, init?: RequestInit) => Promise<Response>

beforeAll(async () => {
  routeApiRequest = (await import('../localApiRouter')).routeApiRequest
}, 120_000)

const PROFILE = 1
const SIDE = 2

beforeEach(async () => {
  localStorage.clear()
  localStorage.setItem('finance_storage_mode', 'serverless')
  localStorage.setItem('currentProfileId', String(PROFILE))
  localStorage.setItem('selectedProfileIds', JSON.stringify([PROFILE]))
  const db = await getDB()
  for (const store of [
    'profiles',
    'categories',
    'transactions',
    'accounts',
    'budgets',
    'loans',
    'recurring',
  ] as const) {
    await db.clear(store)
  }
  await db.add('profiles', { id: PROFILE, name: 'Household', created_at: '2026-01-01T00:00:00Z' })
  await db.add('profiles', { id: SIDE, name: 'Side', created_at: '2026-01-01T00:00:00Z' })
  const add = (store: string, row: Record<string, unknown>) =>
    (db as unknown as { add(s: string, r: unknown): Promise<unknown> }).add(store, row)
  await add('categories', {
    id: 10,
    profile_id: PROFILE,
    name: 'Food',
    color: '#aa5500',
    icon: 'cart',
    type: 'expense',
  })
  await add('categories', {
    id: 11,
    profile_id: SIDE,
    name: 'Theirs',
    color: '#335577',
    icon: 'tag',
    type: 'expense',
  })
  // Older rows: no means of payment, payor or notes; one filed under another profile's category;
  // a description a spreadsheet would run as a formula, and a beneficiary with a comma and quotes.
  const tx = (
    id: number,
    profileId: number,
    date: string,
    description: string,
    amount: number
  ) => ({
    id,
    profile_id: profileId,
    date,
    description,
    amount,
    type: amount > 0 && description === 'Refund' ? 'income' : 'expense',
    currency: 'EUR',
    beneficiary: '',
  })
  await add('transactions', {
    ...tx(20, PROFILE, '2026-03-10', 'Groceries', 45.5),
    category_id: 10,
  })
  await add('transactions', {
    ...tx(21, PROFILE, '2026-03-10', '=SUM(A1)', -12),
    beneficiary: 'Shop, "Corner"',
    category_id: null,
  })
  await add('transactions', { ...tx(22, PROFILE, '2026-03-01', 'Refund', 5), category_id: 11 })
  await add('transactions', { ...tx(23, SIDE, '2026-02-01', 'Side tools', 20), category_id: 11 })
  await add('accounts', {
    id: 30,
    profile_id: PROFILE,
    name: 'Everyday',
    type: 'giro',
    currency: 'EUR',
    balance: 954.5,
    notes: '',
  })
  await add('accounts', {
    id: 31,
    profile_id: PROFILE,
    name: 'Card',
    type: 'credit',
    currency: 'EUR',
    balance: -250.75,
    notes: null,
  })
  // Budgets saved without the rollover fields; one for another profile's category.
  for (const [id, categoryId] of [
    [40, 10],
    [41, 11],
  ]) {
    await add('budgets', {
      id,
      profile_id: PROFILE,
      category_id: categoryId,
      amount: 300,
      period: 'monthly',
      start_date: '2026-03-01',
      created_at: '2026-03-01 09:00:00',
    })
  }
  await add('loans', {
    id: 50,
    profile_id: PROFILE,
    name: 'Car',
    principal: 12000,
    interest_rate: 4.5,
    start_date: '2026-01-01',
    term_months: 48,
    prepayments: [
      { month: 3, amount: 500 },
      { month: 6, amount: 250 },
    ],
  })
  await add('loans', {
    id: 51,
    profile_id: PROFILE,
    name: 'Bike',
    principal: 800,
    interest_rate: 0,
    start_date: '2026-02-01',
    term_months: 12,
  })
  // Local-first keeps a rule's flag as is_active.
  await add('recurring', {
    id: 60,
    profile_id: PROFILE,
    description: 'Rent',
    amount: 900,
    type: 'expense',
    frequency: 'monthly',
    day_of_month: 1,
    next_date: '2026-04-01',
    is_active: 1,
  })
  await add('recurring', {
    id: 61,
    profile_id: PROFILE,
    description: 'Gym',
    amount: 30,
    type: 'expense',
    frequency: 'monthly',
    day_of_month: 15,
    next_date: '2026-04-15',
    is_active: 0,
  })
})

function get(path: string, headers?: Record<string, string>): Promise<Response> {
  return routeApiRequest(path, { method: 'GET', headers })
}

async function text(path: string, headers?: Record<string, string>): Promise<string> {
  const res = await get(path, headers)
  expect(res.status).toBe(200)
  return res.text()
}

describe('a kind exported as CSV', () => {
  it('writes the transactions newest first, each category by name, guarding a formula', async () => {
    expect(await text('/api/export/transactions?format=csv')).toBe(
      [
        'date,description,amount,type,currency,means_of_payment,beneficiary,payor,notes,category',
        `2026-03-10,'=SUM(A1),-12,expense,EUR,,"Shop, ""Corner""",,,`,
        '2026-03-10,Groceries,45.5,expense,EUR,,,,,Food',
        '2026-03-01,Refund,5,income,EUR,,,,,',
      ].join('\n')
    )
  })

  it('writes every profile the request names', async () => {
    const csv = await text('/api/export/transactions?format=csv', {
      'X-Profile-Id': String(PROFILE),
      'X-Profile-Ids': JSON.stringify([PROFILE, SIDE]),
    })
    expect(csv.split('\n').slice(-1)).toEqual(['2026-02-01,Side tools,20,expense,EUR,,,,,Theirs'])
  })

  it('writes the other kinds with their own columns', async () => {
    expect(await text('/api/export/categories?format=csv')).toBe(
      'name,color,icon,type,parent_id\nFood,#aa5500,cart,expense,'
    )
    expect(await text('/api/export/accounts?format=csv')).toBe(
      'name,type,currency,balance,notes\nEveryday,giro,EUR,954.5,\nCard,credit,EUR,-250.75,'
    )
    // A budget whose category is another profile's is left out.
    expect(await text('/api/export/budgets?format=csv')).toBe(
      'id,category_id,amount,period,start_date,end_date,rollover_enabled,rollover_amount,rollover_used,created_at,profile_id,category_name\n' +
        '40,10,300,monthly,2026-03-01,,0,0,0,2026-03-01 09:00:00,1,Food'
    )
    expect(await text('/api/export/loans?format=csv')).toBe(
      'name,principal,interest_rate,start_date,term_months,total_prepaid\n' +
        'Car,12000,4.5,2026-01-01,48,750\n' +
        'Bike,800,0,2026-02-01,12,'
    )
    expect(await text('/api/export/recurring?format=csv')).toBe(
      'description,amount,type,frequency,day_of_month,next_date,notes,active\n' +
        'Rent,900,expense,monthly,1,2026-04-01,,1\n' +
        'Gym,30,expense,monthly,15,2026-04-15,,0'
    )
  })

  it('writes the header of a kind with no rows', async () => {
    expect(await text('/api/export/loans?format=csv', { 'X-Profile-Id': String(SIDE) })).toBe(
      'name,principal,interest_rate,start_date,term_months,total_prepaid'
    )
  })
})

describe('a kind exported as JSON', () => {
  it('is the list of rows, with a null where a row holds none', async () => {
    const res = await get('/api/export/accounts?format=json')
    expect(res.headers.get('Content-Disposition')).toBe('attachment; filename="accounts.json"')
    expect(await res.json()).toEqual([
      { name: 'Everyday', type: 'giro', currency: 'EUR', balance: 954.5, notes: '' },
      { name: 'Card', type: 'credit', currency: 'EUR', balance: -250.75, notes: null },
    ])
  })

  it('is indented when Settings asks for it formatted', async () => {
    expect(await text('/api/export/loans?format=json&pretty=true')).toBe(
      JSON.stringify(
        [
          {
            name: 'Car',
            principal: 12000,
            interest_rate: 4.5,
            start_date: '2026-01-01',
            term_months: 48,
            total_prepaid: 750,
          },
          {
            name: 'Bike',
            principal: 800,
            interest_rate: 0,
            start_date: '2026-02-01',
            term_months: 12,
            total_prepaid: null,
          },
        ],
        null,
        2
      )
    )
  })
})

describe('a kind there is no export of', () => {
  it('is refused, in words that list the kinds', async () => {
    for (const kind of ['settings', 'goals', 'everything']) {
      const res = await get(`/api/export/${kind}?format=json`)
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: EXPORT_MESSAGES.kind })
    }
  })
})
