/**
 * What the local-first router refuses for a category, and how it says it.
 *
 * The same rules and words as the Worker (shared/categorySchema.ts, and
 * worker/test/category-refusals.test.ts for the other runtime): a refused body answers 400
 * `{ error, fields }`, with a sentence per field for the form to show. It used to answer
 * `{ error: 'Validation failed', details: [zod's own messages] }`, which the client threw away.
 *
 * These go through `routeApiRequest`, the router `apiFetch` calls, so the schema step and the
 * handler are both in the path.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDB } from '../idb'

let routeApiRequest: (url: string, init?: RequestInit) => Promise<Response>

beforeAll(async () => {
  routeApiRequest = (await import('../localApiRouter')).routeApiRequest
}, 120_000)

const HOUSING = 11
const FOOD = 12
const RENT = 13
const TRANSFERS = 14

beforeEach(async () => {
  localStorage.clear()
  localStorage.setItem('currentProfileId', '1')
  const db = await getDB()
  await db.clear('profiles')
  await db.clear('categories')
  await db.add('profiles', { id: 1, name: 'Me', created_at: '2026-01-01T00:00:00.000Z' })
  const row = { profile_id: 1, created_at: '2026-01-01T00:00:00.000Z' }
  await db.add('categories', {
    ...row,
    id: HOUSING,
    name: 'Housing',
    type: 'expense',
    color: '#6e9bff',
    icon: 'home',
    parent_id: null,
    tax_deductible: false,
  })
  await db.add('categories', {
    ...row,
    id: FOOD,
    name: 'Food',
    type: 'expense',
    color: '#6e9bff',
    icon: 'food',
    parent_id: HOUSING,
    tax_deductible: true,
  })
  await db.add('categories', {
    ...row,
    id: RENT,
    name: 'Rent',
    type: 'expense',
    color: '#f0a860',
    icon: 'home',
    parent_id: null,
    tax_deductible: false,
  })
  // What older imports left behind: a category of a type the forms do not offer.
  await db.add('categories', {
    ...row,
    id: TRANSFERS,
    name: 'Transfers',
    type: 'account',
    color: '#59d2a2',
    icon: 'tag',
    parent_id: null,
    tax_deductible: false,
  })
})

function call(method: string, path: string, body?: unknown): Promise<Response> {
  return routeApiRequest(`http://localhost${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Profile-Id': '1' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

async function refusal(res: Response): Promise<Record<string, unknown>> {
  expect(res.status).toBe(400)
  return (await res.json()) as Record<string, unknown>
}

async function stored(id: number): Promise<Record<string, unknown>> {
  return (await (await getDB()).get('categories', id)) as Record<string, unknown>
}

async function names(): Promise<string[]> {
  const rows = (await (await getDB()).getAll('categories')) as { name: string }[]
  return rows.map((r) => r.name).sort()
}

describe('creating a category in local-first', () => {
  it('without a name is refused at the name, with no zod text and no details', async () => {
    const body = await refusal(await call('POST', '/api/categories', { name: '' }))

    expect(body).toEqual({
      error: 'Give the category a name.',
      fields: { name: 'Give the category a name.' },
    })
    expect(await names()).toEqual(['Food', 'Housing', 'Rent', 'Transfers'])
  })

  it('names every field that is wrong, in form order', async () => {
    const body = await refusal(
      await call('POST', '/api/categories', { name: '', type: 'savings', color: 'red' })
    )

    expect(body.fields).toEqual({
      name: 'Give the category a name.',
      type: 'Choose Expense or Income.',
      color: "That color can't be used. Pick another one.",
    })
    expect(body.error).toBe(
      "Give the category a name. Choose Expense or Income. That color can't be used. Pick another one."
    )
  })

  it('with only a name is stored with the defaults, as the Worker stores it', async () => {
    const res = await call('POST', '/api/categories', { name: ' Coffee ' })

    expect(res.status).toBe(201)
    const created = (await res.json()) as { id: number }
    expect(await stored(created.id)).toMatchObject({
      name: 'Coffee',
      type: 'expense',
      color: '#6b7280',
      icon: 'tag',
      parent_id: null,
      tax_deductible: false,
      profile_id: 1,
    })
  })

  it('with a taken name is refused at the name, quoting the category that has it', async () => {
    const body = await refusal(await call('POST', '/api/categories', { name: 'RENT' }))

    expect(body).toEqual({
      error: 'You already have a category called "Rent". Choose another name.',
      fields: { name: 'You already have a category called "Rent". Choose another name.' },
    })
  })

  it('still logs the refusal the release suite watches for', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      await call('POST', '/api/categories', { name: '' })
      const lines = errors.mock.calls.map((args) => String(args[0]))
      expect(lines.some((line) => line.includes('Validation failed'))).toBe(true)
    } finally {
      errors.mockRestore()
    }
  })
})

describe('editing a category in local-first', () => {
  it('of a type the forms do not offer saves, as the Worker lets it', async () => {
    // The Categories form sends the category's own type back. An imported `account` category
    // failed every save here with "Validation failed".
    const res = await call('PUT', `/api/categories/${TRANSFERS}`, {
      name: 'Card payments',
      type: 'account',
      color: '#59d2a2',
      icon: null,
    })

    expect(res.status).toBe(200)
    expect(await stored(TRANSFERS)).toMatchObject({
      name: 'Card payments',
      type: 'account',
      icon: 'tag',
    })
  })

  it('to a name of only spaces is refused, and the name is kept', async () => {
    const body = await refusal(await call('PUT', `/api/categories/${FOOD}`, { name: '   ' }))

    expect(body.fields).toEqual({ name: 'Give the category a name.' })
    expect((await stored(FOOD)).name).toBe('Food')
  })

  it('to the name of another category is refused at the name', async () => {
    const body = await refusal(await call('PUT', `/api/categories/${FOOD}`, { name: 'rent' }))

    expect(body.fields).toEqual({
      name: 'You already have a category called "Rent". Choose another name.',
    })
    expect((await stored(FOOD)).name).toBe('Food')
  })

  it('stores only the category fields, keeping what the body leaves out', async () => {
    const res = await call('PUT', `/api/categories/${FOOD}`, {
      id: 999,
      profile_id: 7,
      name: 'Groceries',
      type: 'expense',
      color: '#59d2a2',
      icon: 'cart',
      surprise: 'kept out',
    })

    expect(res.status).toBe(200)
    const row = await stored(FOOD)
    expect(row).toMatchObject({
      id: FOOD,
      profile_id: 1,
      name: 'Groceries',
      color: '#59d2a2',
      icon: 'cart',
      parent_id: HOUSING,
      tax_deductible: true,
    })
    expect(row).not.toHaveProperty('surprise')
  })
})

describe('a refusal for an entity still on its zod schema', () => {
  it('names the field in plain words, not zod text', async () => {
    const body = await refusal(
      await call('POST', '/api/bills', { amount: 12, due_date: '2026-11-01' })
    )

    expect(body).toEqual({
      error: 'Fill in the name.',
      fields: { name: 'Fill in the name.' },
    })
  })

  it('uses the schema’s own sentence for a rule written for people', async () => {
    const body = await refusal(await call('POST', '/api/bills', { name: 'Rent', amount: 900 }))

    expect(body.fields).toEqual({ due_date: 'Pick a due date.' })
  })
})
