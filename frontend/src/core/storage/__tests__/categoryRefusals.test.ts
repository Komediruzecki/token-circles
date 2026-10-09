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
 *
 * - An edit that sends a field back with the value the row already holds is never refused for it,
 *   so a row saved under older, looser rules (a 3-digit or named color, a name over 100
 *   characters, a type the app does not read, two names that differ only in case) can still be
 *   edited. What the edit changes is checked as before.
 * - A parent from another profile is refused at `parent_id`, as the Worker refuses it.
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
// Rows saved under older rules, which the rules now refuse on a create.
const FUEL = 15 // a 3-digit color
const GIFTS = 16 // a named color
const ALLOTMENT = 17 // a name over 100 characters
const COFFEE = 18 // "Coffee" and "coffee", from before the duplicate check
const COFFEE_LOWER = 19
const SAVINGS = 20 // a type the app cannot read
const KIDS = 21 // a parent in another profile
const PADDED = 22 // a name over 100 characters, stored with a trailing space
const SPACES = 23 // a name of nothing but spaces
const GYM = 24 // "Gym " with a trailing space
// A second profile and a category in it.
const OTHER_PROFILE = 2
const ELSEWHERE = 30

const LONG_NAME = 'Allotment '.repeat(12).trim()
const PADDED_NAME = 'Garden '.repeat(16)
const PARENT = 'Choose a parent category from the list, or leave it empty.'

beforeEach(async () => {
  localStorage.clear()
  localStorage.setItem('currentProfileId', '1')
  const db = await getDB()
  await db.clear('profiles')
  await db.clear('categories')
  await db.add('profiles', { id: 1, name: 'Me', created_at: '2026-01-01T00:00:00.000Z' })
  await db.add('profiles', {
    id: OTHER_PROFILE,
    name: 'Household',
    created_at: '2026-01-01T00:00:00.000Z',
  })
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
  const legacy = { ...row, icon: 'tag', parent_id: null, tax_deductible: false }
  await db.add('categories', { ...legacy, id: FUEL, name: 'Fuel', type: 'expense', color: '#fff' })
  await db.add('categories', { ...legacy, id: GIFTS, name: 'Gifts', type: 'expense', color: 'red' })
  await db.add('categories', {
    ...legacy,
    id: ALLOTMENT,
    name: LONG_NAME,
    type: 'expense',
    color: '#59d2a2',
  })
  await db.add('categories', {
    ...legacy,
    id: COFFEE,
    name: 'Coffee',
    type: 'expense',
    color: '#59d2a2',
  })
  await db.add('categories', {
    ...legacy,
    id: COFFEE_LOWER,
    name: 'coffee',
    type: 'expense',
    color: '#59d2a2',
  })
  await db.add('categories', {
    ...legacy,
    id: SAVINGS,
    name: 'Savings',
    type: 'savings',
    color: '#59d2a2',
  })
  await db.add('categories', {
    ...legacy,
    profile_id: OTHER_PROFILE,
    id: ELSEWHERE,
    name: 'Shared house',
    type: 'expense',
    color: '#59d2a2',
  })
  await db.add('categories', {
    ...legacy,
    id: KIDS,
    name: 'Kids',
    type: 'expense',
    color: '#59d2a2',
    parent_id: ELSEWHERE,
  })
  // Names as older versions stored them: as typed, stray spaces and all.
  await db.add('categories', {
    ...legacy,
    id: PADDED,
    name: PADDED_NAME,
    type: 'expense',
    color: '#59d2a2',
  })
  await db.add('categories', {
    ...legacy,
    id: SPACES,
    name: '   ',
    type: 'expense',
    color: '#59d2a2',
  })
  await db.add('categories', {
    ...legacy,
    id: GYM,
    name: 'Gym ',
    type: 'expense',
    color: '#59d2a2',
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

/** An edit, answered 200, and the row it left behind. */
async function saved(id: number, body: unknown): Promise<Record<string, unknown>> {
  const res = await call('PUT', `/api/categories/${id}`, body)
  expect(res.status, JSON.stringify(await res.clone().json())).toBe(200)
  return stored(id)
}

describe('creating a category in local-first', () => {
  it('without a name is refused at the name, with no zod text and no details', async () => {
    const before = await names()
    const body = await refusal(await call('POST', '/api/categories', { name: '' }))

    expect(body).toEqual({
      error: 'Give the category a name.',
      fields: { name: 'Give the category a name.' },
    })
    expect(await names()).toEqual(before)
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
    const res = await call('POST', '/api/categories', { name: ' Tea ' })

    expect(res.status).toBe(201)
    const created = (await res.json()) as { id: number }
    expect(await stored(created.id)).toMatchObject({
      name: 'Tea',
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

  it('still logs a refused edit, as the release suite watches for', async () => {
    // The router used to check an edit, and logged the refusal. The handler checks it now,
    // against the stored row, and has to say so itself.
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      await call('PUT', `/api/categories/${FOOD}`, { name: '   ' })
      const lines = errors.mock.calls.map((args) => String(args[0]))
      expect(lines.some((line) => line.includes('Validation failed'))).toBe(true)
    } finally {
      errors.mockRestore()
    }
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

describe('a parent from another profile, in local-first', () => {
  it('is refused on a create, at parent_id, as the Worker refuses it', async () => {
    const before = await names()
    const body = await refusal(
      await call('POST', '/api/categories', { name: 'Utilities', parent_id: ELSEWHERE })
    )

    expect(body).toEqual({ error: PARENT, fields: { parent_id: PARENT } })
    expect(await names()).toEqual(before)
  })

  it('is refused on an edit, at parent_id, and the parent is kept', async () => {
    const body = await refusal(
      await call('PUT', `/api/categories/${FOOD}`, { parent_id: ELSEWHERE })
    )

    expect(body).toEqual({ error: PARENT, fields: { parent_id: PARENT } })
    expect((await stored(FOOD)).parent_id).toBe(HOUSING)
  })
})

describe('editing a local-first row saved under older rules', () => {
  // The edit forms send name, type, color and icon on every save, so each of these sends the
  // row's own value back for every field but the one it changes.
  it('sends a 3-digit color back unchanged, and the new name saves', async () => {
    const row = await saved(FUEL, {
      name: 'Petrol',
      type: 'expense',
      color: '#fff',
      icon: 'tag',
    })

    expect(row).toMatchObject({ name: 'Petrol', color: '#fff' })
  })

  it('sends a named color back unchanged, and the new icon saves', async () => {
    const row = await saved(GIFTS, { name: 'Gifts', type: 'expense', color: 'red', icon: 'gift' })

    expect(row).toMatchObject({ icon: 'gift', color: 'red' })
  })

  it('sends a name over 100 characters back unchanged, and the new color saves', async () => {
    const row = await saved(ALLOTMENT, {
      name: LONG_NAME,
      type: 'expense',
      color: '#f0a860',
      icon: 'tag',
    })

    expect(row).toMatchObject({ name: LONG_NAME, color: '#f0a860' })
  })

  // The dialogs sent the name back trimmed until they learned to send an untouched name as it
  // came. Without its trailing space this name is under no new rule, but over 100 characters.
  it('takes a name sent back without the space it was stored with as unchanged', async () => {
    const row = await saved(PADDED, {
      name: PADDED_NAME.trim(),
      type: 'expense',
      color: '#f0a860',
      icon: 'tag',
    })

    expect(row).toMatchObject({ name: PADDED_NAME, color: '#f0a860' })
  })

  it('takes a blank name sent back for a name of spaces as unchanged', async () => {
    const row = await saved(SPACES, { name: '', type: 'expense', color: '#f0a860', icon: 'tag' })

    expect(row).toMatchObject({ name: '   ', color: '#f0a860' })
  })

  it('sends a type the app cannot read back unchanged, and the new name saves', async () => {
    const row = await saved(SAVINGS, {
      name: 'Rainy day',
      type: 'savings',
      color: '#59d2a2',
      icon: 'tag',
    })

    expect(row).toMatchObject({ name: 'Rainy day', type: 'savings' })
  })

  it('keeps a name that another category holds in another case', async () => {
    const row = await saved(COFFEE_LOWER, {
      name: 'coffee',
      type: 'expense',
      color: '#6e9bff',
      icon: 'tag',
    })

    expect(row).toMatchObject({ name: 'coffee', color: '#6e9bff' })
  })

  it('renames itself in case alone, beside another of that name', async () => {
    const row = await saved(COFFEE_LOWER, {
      name: 'Coffee',
      type: 'expense',
      color: '#59d2a2',
      icon: 'tag',
    })

    expect(row.name).toBe('Coffee')
  })

  it('sends a parent from another profile back unchanged', async () => {
    const row = await saved(KIDS, { name: 'Children', parent_id: ELSEWHERE })

    expect(row).toMatchObject({ name: 'Children', parent_id: ELSEWHERE })
  })

  // A form field holds text, so a parent can come back as "30" rather than 30.
  it('sends that parent back as the string a form field holds, and it is still unchanged', async () => {
    const row = await saved(KIDS, { name: 'Children', parent_id: String(ELSEWHERE) })

    expect(row).toMatchObject({ name: 'Children', parent_id: ELSEWHERE })
  })

  it('still refuses a color the edit changes to one that cannot be used', async () => {
    const body = await refusal(
      await call('PUT', `/api/categories/${FUEL}`, {
        name: 'Fuel',
        type: 'expense',
        color: '#ffff',
        icon: 'tag',
      })
    )

    expect(body.fields).toEqual({ color: "That color can't be used. Pick another one." })
    expect((await stored(FUEL)).color).toBe('#fff')
  })

  it('still refuses a rename onto another category, whatever its case', async () => {
    const body = await refusal(
      await call('PUT', `/api/categories/${FUEL}`, {
        name: 'COFFEE',
        type: 'expense',
        color: '#fff',
        icon: 'tag',
      })
    )

    expect(body.fields).toEqual({
      name: 'You already have a category called "Coffee". Choose another name.',
    })
    expect((await stored(FUEL)).name).toBe('Fuel')
  })

  it('quotes a taken name without the stray space it was stored with', async () => {
    const body = await refusal(await call('PUT', `/api/categories/${FUEL}`, { name: 'gym' }))

    expect(body.fields).toEqual({
      name: 'You already have a category called "Gym". Choose another name.',
    })
  })
})
