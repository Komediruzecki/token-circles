/**
 * Local-first rows must satisfy the same zod contract the Worker's rows do.
 *
 * ApiClient.request parses every response against src/schemas/models.ts and throws when it does
 * not match. The Worker always satisfies it: every D1 column exists on every row, holding a value,
 * its default or NULL. IndexedDB has no columns, so a key no writer put there is simply absent,
 * and zod reads an absent key as `undefined`, which a nullable field does not accept.
 *
 * The demo seeder wrote budgets, loans and goals without `created_at`, goals without `deadline`,
 * and bills without `category_id`, `last_paid_date` or `next_due_date`; the local handlers that
 * create those rows left out the same keys. So a plain load of a seeded demo profile failed
 * validation on /budgets, /bills, /loans and /savings-goals. The achievements run reads all four
 * in one Promise.all, and AchievementsHost swallows its rejection, so no badge was ever evaluated
 * and the Progress page stayed empty. The only visible trace was four console errors.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { BillSchema, BudgetSchema, LoanSchema, SavingsGoalSchema } from '../../../schemas/models.js'
import { refreshAchievements, snapshot, unlocks } from '../../achievementsStore.js'
import { getDB, seedDemoProfiles } from '../idb.js'
import { routeApiRequest } from '../localApiRouter.js'

vi.mock('../../toastStore', () => ({ addToast: vi.fn() }))
vi.mock('../../appStore', () => ({ setPage: vi.fn() }))

const ENTITIES = [
  { store: 'budgets', path: '/budgets', schema: BudgetSchema },
  { store: 'bills', path: '/bills', schema: BillSchema },
  { store: 'loans', path: '/loans', schema: LoanSchema },
  { store: 'goals', path: '/savings-goals', schema: SavingsGoalSchema },
] as const

const DEMO_PROFILES = ['Example Low Income', 'Example Mid Income', 'Example High Income']
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T/

type Row = Record<string, unknown> & { id: number }

async function call(method: string, path: string, body?: unknown): Promise<Response> {
  return routeApiRequest(`/api${path}`, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

async function get(path: string): Promise<unknown> {
  const res = await call('GET', path)
  expect(res.status, `GET ${path}`).toBe(200)
  return res.json()
}

/** The zod issues as one line each, so a failure message is the diagnosis. */
function issuesOf(schema: z.ZodType, data: unknown): string[] {
  const result = schema.safeParse(data)
  if (result.success) return []
  return result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`)
}

/** Every list row and every single-row GET parses, the way ApiClient parses them. */
async function expectEndpointsParse(path: string, schema: z.ZodType): Promise<Row[]> {
  const rows = (await get(path)) as Row[]
  expect(issuesOf(z.array(schema), rows), `GET ${path}`).toEqual([])
  for (const row of rows) {
    expect(issuesOf(schema, await get(`${path}/${row.id}`)), `GET ${path}/${row.id}`).toEqual([])
  }
  return rows
}

async function rawRows(store: string, profileId: number): Promise<Row[]> {
  return (await (await getDB()).getAllFromIndex(store, 'by_profile', profileId)) as Row[]
}

function useProfile(id: number): void {
  localStorage.setItem('currentProfileId', String(id))
  localStorage.removeItem('selectedProfileIds')
}

async function profileNamed(name: string): Promise<number> {
  const profile = (await (await getDB()).getAll('profiles')).find((p) => p.name === name)
  expect(profile, `profile "${name}"`).toBeDefined()
  return profile!.id as number
}

async function addProfile(name: string): Promise<{ profileId: number; categoryId: number }> {
  const db = await getDB()
  const profileId = (await db.add('profiles', {
    name,
    created_at: '2026-01-01T00:00:00.000Z',
  })) as number
  const categoryId = (await db.add('categories', {
    name: 'Groceries',
    type: 'expense',
    color: '#F97316',
    icon: '',
    parent_id: null,
    created_at: '2026-01-01T00:00:00.000Z',
    profile_id: profileId,
  })) as number
  return { profileId, categoryId }
}

beforeAll(async () => {
  localStorage.clear()
  localStorage.setItem('finance_storage_mode', 'serverless')
  await seedDemoProfiles()
}, 60_000)

describe('the demo seed', () => {
  it('writes rows that satisfy the API contract on their own', async () => {
    const db = await getDB()
    for (const { store, schema } of ENTITIES) {
      const rows = (await db.getAll(store)) as Row[]
      expect(rows.length, `seeded ${store}`).toBeGreaterThan(0)
      expect(issuesOf(z.array(schema), rows), `stored ${store}`).toEqual([])
      if (store !== 'bills') {
        for (const row of rows) expect(row.created_at, `${store}/${row.id}`).toMatch(TIMESTAMP)
      }
    }
  })

  it('files each demo bill under the category it names, in its own profile', async () => {
    const db = await getDB()
    const categories = new Map(
      ((await db.getAll('categories')) as Row[]).map((c) => [c.id, c.profile_id])
    )
    for (const bill of (await db.getAll('bills')) as Row[]) {
      expect(typeof bill.category_id, `bill "${bill.name}"`).toBe('number')
      expect(categories.get(bill.category_id as number)).toBe(bill.profile_id)
    }
  })

  for (const profile of DEMO_PROFILES) {
    for (const { path, schema } of ENTITIES) {
      it(`${profile}: GET ${path} and GET ${path}/:id parse`, async () => {
        useProfile(await profileNamed(profile))
        await expectEndpointsParse(path, schema)
      })
    }
  }
})

describe('rows stored by earlier builds', () => {
  it('still parse, and a goal keeps the date it was given as target_date', async () => {
    const { profileId, categoryId } = await addProfile('Stored Before The Fix')
    useProfile(profileId)
    const db = await getDB()
    // The exact shapes the old demo seed and the old local handlers wrote.
    await db.add('budgets', {
      category_id: categoryId,
      amount: 100,
      period: 'monthly',
      start_date: '2026-01-01',
      end_date: null,
      rollover_enabled: 1,
      rollover_amount: 0,
      profile_id: profileId,
    })
    await db.add('budgets', {
      category_id: categoryId,
      amount: 120,
      period: 'monthly',
      start_date: '2026-02-01',
      profile_id: profileId,
      rollover_enabled: false,
      rollover_amount: 0,
    })
    await db.add('goals', {
      name: 'Emergency Fund',
      target_amount: 10000,
      current_amount: 4000,
      notes: 'Safety net',
      profile_id: profileId,
    })
    const datedGoalId = (await db.add('goals', {
      name: 'New Car',
      target_amount: 5000,
      target_date: '2027-06-30',
      monthly_contribution: null,
      category_id: null,
      profile_id: profileId,
    })) as number
    await db.add('loans', {
      name: 'Car Loan',
      principal: 18000,
      interest_rate: 4.9,
      start_date: '2022-08-01',
      term_months: 60,
      profile_id: profileId,
    })
    await db.add('bills', {
      name: 'Rent',
      amount: 900,
      due_date: '2026-09-01',
      recurring: 1,
      frequency: 'monthly',
      notes: 'Monthly rent',
      is_active: 1,
      profile_id: profileId,
      type: 'bill',
    })
    await db.add('bills', {
      profile_id: profileId,
      name: 'Water',
      amount: 40,
      frequency: 'monthly',
      due_date: '2026-09-10',
      day_of_month: 1,
      category_id: null,
      recurring: 1,
      autopay: 0,
      is_active: 1,
      notes: '',
      type: 'bill',
      created_at: '2026-09-01T10:00:00.000Z',
    })

    for (const { path, schema } of ENTITIES) {
      const rows = await expectEndpointsParse(path, schema)
      expect(rows.length, path).toBeGreaterThan(0)
    }
    const goals = (await get('/savings-goals')) as Row[]
    expect(goals.find((g) => g.id === datedGoalId)?.deadline).toBe('2027-06-30')
  })
})

describe('rows the local handlers create', () => {
  let profileId: number
  let categoryId: number

  beforeAll(async () => {
    ;({ profileId, categoryId } = await addProfile('Created Through The Router'))
    useProfile(profileId)
    // One August expense for the spending-based budget writers to work from.
    await (
      await getDB()
    ).add('transactions', {
      description: 'Market',
      amount: 42,
      type: 'expense',
      category_id: categoryId,
      date: '2026-08-14',
      currency: 'EUR',
      profile_id: profileId,
    })
  })

  /** Parsed straight from IndexedDB, so a read-side default cannot hide a writer's gap. */
  async function expectStoredRowsComplete(store: string, schema: z.ZodType): Promise<Row[]> {
    const rows = await rawRows(store, profileId)
    expect(rows.length, store).toBeGreaterThan(0)
    expect(issuesOf(z.array(schema), rows), `stored ${store}`).toEqual([])
    return rows
  }

  it('budgets: every writer stores a complete row with a real created_at', async () => {
    useProfile(profileId)
    const writes: Array<[string, unknown]> = [
      [
        '/budgets',
        { category_id: categoryId, amount: 300, period: 'monthly', start_date: '2026-07-01' },
      ],
      ['/budgets/backfill-from-spending', { from_month: '2026-08', to_month: '2026-08' }],
      ['/budgets/from-expenses', { year: 2026, month: 9 }],
      ['/budgets/duplicate-last', { year: 2026, month: 10 }],
    ]
    for (const [path, body] of writes) {
      const res = await call('POST', path, body)
      expect(res.status, `POST ${path}`).toBeLessThan(300)
      const result = (await res.json()) as { ok?: boolean }
      expect(result.ok, `POST ${path} wrote nothing`).not.toBe(false)
    }
    const rows = await expectStoredRowsComplete('budgets', BudgetSchema)
    expect(rows.map((b) => b.start_date).sort()).toEqual([
      '2026-07-01',
      '2026-08-01',
      '2026-09-01',
      '2026-10-01',
    ])
    for (const row of rows) expect(row.created_at, `budget ${row.start_date}`).toMatch(TIMESTAMP)
  })

  it('goals: the form sends target_date and no current_amount; the row still has both', async () => {
    useProfile(profileId)
    const form = {
      name: 'New Car',
      target_amount: 5000,
      target_date: '2027-06-30',
      monthly_contribution: null,
      category_id: null,
    }
    const res = await call('POST', '/savings-goals', form)
    expect(res.status).toBe(201)
    const { id } = (await res.json()) as { id: number }

    let [goal] = await expectStoredRowsComplete('goals', SavingsGoalSchema)
    expect(goal).toMatchObject({ id, deadline: '2027-06-30', current_amount: 0 })
    expect(goal.created_at).toMatch(TIMESTAMP)

    // Editing the date must move the deadline too, or the list shows the old one.
    await call('PUT', `/savings-goals/${id}`, { ...form, target_date: '2027-12-31' })
    ;[goal] = await expectStoredRowsComplete('goals', SavingsGoalSchema)
    expect(goal.deadline).toBe('2027-12-31')
  })

  it('loans: the created row is complete', async () => {
    useProfile(profileId)
    const res = await call('POST', '/loans', {
      name: 'Car Loan',
      principal: 18000,
      interest_rate: 4.9,
      term_months: 60,
      start_date: '2026-03-01',
      status: 'active',
      rate_periods: [],
    })
    expect(res.status).toBe(201)
    const [loan] = await expectStoredRowsComplete('loans', LoanSchema)
    expect(loan.created_at).toMatch(TIMESTAMP)
  })

  it('bills: the created row is complete', async () => {
    useProfile(profileId)
    const res = await call('POST', '/bills', {
      name: 'Water',
      amount: 40,
      dueDate: '2026-09-10',
      frequency: 'monthly',
      autopay: false,
      type: 'bill',
    })
    expect(res.status).toBe(201)
    await expectStoredRowsComplete('bills', BillSchema)
  })
})

describe('achievements on a seeded demo profile', () => {
  it('evaluate with every budget, goal, bill and loan in hand', async () => {
    useProfile(await profileNamed('Example Mid Income'))
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      await refreshAchievements()
      const validationErrors = errors.mock.calls
        .map((args) => String(args[0]))
        .filter((message) => message.includes('Validation failed'))
      expect(validationErrors).toEqual([])
    } finally {
      errors.mockRestore()
    }
    const snap = snapshot()
    expect(snap, 'the run never finished').not.toBeNull()
    expect(snap!.budgets.length).toBeGreaterThan(0)
    expect(snap!.goals.length).toBeGreaterThan(0)
    expect(snap!.bills.length).toBeGreaterThan(0)
    expect(snap!.loans.length).toBeGreaterThan(0)
    expect(unlocks().map((u) => u.id)).toEqual(
      expect.arrayContaining(['first-budget', 'goal-in-sight'])
    )
  })
})
