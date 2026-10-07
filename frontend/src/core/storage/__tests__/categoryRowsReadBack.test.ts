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

  it('can have its icon cleared afterwards', async () => {
    const created = await apiPost<{ id: number }>('/api/categories', formBody('Food', 'food'))

    // The edit form sends the same body, with `icon: null` once the field is emptied.
    const res = await fetchLocal(`/api/categories/${created.id}`, 'PUT', formBody('Food', null))

    expect(res.status).toBe(200)
    const list = await api.getCategories()
    expect(list.map((c) => c.name)).toEqual(['Food'])
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

async function fetchLocal(path: string, method: string, body: unknown): Promise<Response> {
  const { apiFetch } = await import('../../apiFetch')
  return apiFetch(path, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Profile-Id': '1' },
    body: JSON.stringify(body),
  })
}
