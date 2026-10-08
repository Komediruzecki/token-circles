/**
 * A category made in local-first mode reads back through the typed client, the way the Worker's do.
 *
 * WHY THIS TEST EXISTS. The local router stored the body of `POST /api/categories` as it came. The
 * forms send `{ name, type, color, icon }`: no `tax_deductible`, and `icon: null` when the icon field
 * was left blank. `CategorySchema` requires both, and `normalizeCategory` filled in neither, so after
 * one such category every `api.getCategories()` covering its profile threw a validation error. App's
 * quick entry kept whatever list it had before: "No expense categories yet" straight after making
 * one on Budgets, and after a profile switch, the previous profile's categories (reported on dev,
 * 2026-10-07). Transactions, Tags and the badges read through the same call. A blank icon did not get
 * that far: the router's body schema refused `icon: null`, which the Worker accepts, and the form
 * said "Failed to save category".
 *
 * Everything here goes through the real `apiFetch`, local router, handler and zod schema.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { api, apiPost } from '../../api'
import { getDB } from '../idb'

/** What Budgets and Categories send (Budgets.tsx handleCatSubmit, Categories.tsx handleSubmit). */
const formBody = (name: string, icon: string | null) => ({
  name,
  type: 'expense',
  color: '#6e9bff',
  icon,
})

beforeEach(async () => {
  localStorage.clear()
  localStorage.setItem('finance_storage_mode', 'serverless')
  localStorage.setItem('finance_had_profiles', '1')
  localStorage.setItem('currentProfileId', '1')
  localStorage.setItem('selectedProfileIds', JSON.stringify([1]))
  const db = await getDB()
  await db.clear('profiles')
  await db.clear('categories')
  await db.put('profiles', { id: 1, name: 'Personal', created_at: '2026-01-01T00:00:00.000Z' })
})

describe('a category made in local-first mode', () => {
  it('reads back through api.getCategories() when an icon was typed', async () => {
    await apiPost('/api/categories', formBody('Food', 'food'))

    const list = await api.getCategories()

    expect(list.map((c) => c.name)).toEqual(['Food'])
    expect(list[0]).toMatchObject({ icon: 'food', tax_deductible: false, profile_id: 1 })
  })

  it('saves and reads back when the icon was left blank', async () => {
    // Budgets: "Leave it blank to choose one from the category name."
    await apiPost('/api/categories', formBody('Rent', null))

    const list = await api.getCategories()

    expect(list.map((c) => c.name)).toEqual(['Rent'])
    // The Worker's default for a blank icon; the renderer reads it as "none chosen".
    expect(list[0].icon).toBe('tag')
  })

  it('is stored complete, as the Worker stores it', async () => {
    await apiPost('/api/categories', formBody('Food', 'food'))

    const [row] = await (await getDB()).getAll('categories')

    expect(row).toMatchObject({
      name: 'Food',
      type: 'expense',
      color: '#6e9bff',
      icon: 'food',
      parent_id: null,
      tax_deductible: false,
      profile_id: 1,
    })
    expect(typeof row.created_at).toBe('string')
    expect(row.created_at).not.toBe('')
  })

  it('reads back one at a time through api.getCategory()', async () => {
    const created = await apiPost<{ id: number }>('/api/categories', formBody('Food', 'food'))

    await expect(api.getCategory(created.id)).resolves.toMatchObject({ name: 'Food' })
  })

  it('can have its icon cleared afterwards, and stores the default for it as a create does', async () => {
    const created = await apiPost<{ id: number }>('/api/categories', formBody('Food', 'food'))

    // The edit form sends the same body, with `icon: null` once the field is emptied.
    const res = await fetchLocal(`/api/categories/${created.id}`, 'PUT', formBody('Food', null))

    expect(res.status).toBe(200)
    const list = await api.getCategories()
    expect(list.map((c) => c.name)).toEqual(['Food'])
    // What the Worker stores for the same edit (worker/test/category-icon-default.test.ts).
    expect(list[0].icon).toBe('tag')
    expect((await (await getDB()).get('categories', created.id))?.icon).toBe('tag')
  })

  it('stores the default for an icon emptied to an empty string', async () => {
    const created = await apiPost<{ id: number }>('/api/categories', formBody('Food', 'food'))

    await fetchLocal(`/api/categories/${created.id}`, 'PUT', formBody('Food', ''))

    expect((await (await getDB()).get('categories', created.id))?.icon).toBe('tag')
  })

  it('keeps the icon through an edit that does not send one', async () => {
    const created = await apiPost<{ id: number }>('/api/categories', formBody('Food', 'food'))

    await fetchLocal(`/api/categories/${created.id}`, 'PUT', { name: 'Groceries' })

    expect((await (await getDB()).get('categories', created.id))?.icon).toBe('food')
  })
})

describe('a category row stored before this fix', () => {
  it('still reads back: the rows already on people’s devices lack the same fields', async () => {
    const db = await getDB()
    await db.add('categories', {
      name: 'Food',
      type: 'expense',
      color: '#6e9bff',
      icon: null,
      profile_id: 1,
    } as never)
    await db.add('categories', {
      name: 'Rent',
      type: 'expense',
      color: '#6e9bff',
      icon: 'home',
      profile_id: 1,
    } as never)

    const list = await api.getCategories()

    expect(list.map((c) => c.name).sort()).toEqual(['Food', 'Rent'])
    expect(list.map((c) => c.tax_deductible)).toEqual([false, false])
  })
})

describe('a category edited in local-first mode', () => {
  // The Worker's PUT reset the parent and the tax-deductible flag whenever the body left them out
  // (worker/test/category-edit-keeps-fields.test.ts). The local router merges the body into the
  // stored row, so it already kept them: this pins that the two runtimes agree.
  it('keeps its parent and its tax-deductible flag through the edit form and a swatch', async () => {
    const db = await getDB()
    const health = (await db.add('categories', {
      name: 'Health',
      type: 'expense',
      color: '#22c55e',
      icon: 'heart',
      parent_id: null,
      tax_deductible: false,
      created_at: '2026-01-01T00:00:00.000Z',
      profile_id: 1,
    } as never)) as number
    const pharmacy = (await db.add('categories', {
      name: 'Pharmacy',
      type: 'expense',
      color: '#0ea5e9',
      icon: 'pill',
      parent_id: health,
      tax_deductible: true,
      created_at: '2026-01-01T00:00:00.000Z',
      profile_id: 1,
    } as never)) as number

    const edit = await fetchLocal(`/api/categories/${pharmacy}`, 'PUT', {
      ...formBody('Pharmacy & drugstore', 'pill'),
      color: '#0284c7',
    })
    const swatch = await fetchLocal(`/api/categories/${pharmacy}`, 'PUT', { color: '#f97316' })

    expect([edit.status, swatch.status]).toEqual([200, 200])
    expect(await db.get('categories', pharmacy)).toMatchObject({
      name: 'Pharmacy & drugstore',
      color: '#f97316',
      parent_id: health,
      tax_deductible: true,
    })
  })
})

async function fetchLocal(path: string, method: string, body: unknown): Promise<Response> {
  const { apiFetch } = await import('../../apiFetch')
  return apiFetch(path, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Profile-Id': '1' },
    body: JSON.stringify(body),
  })
}
