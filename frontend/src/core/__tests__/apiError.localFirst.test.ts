/**
 * The local-first half of `ApiError`: a refusal from the IndexedDB router reaches a form with its
 * fields, through both client surfaces, exactly as the Worker's does. Nothing is mocked between
 * the call and IndexedDB: the real `apiFetch`, the real router, fake-indexeddb.
 *
 * This is the path maff's blank-icon report took. The router answered "Validation failed" with
 * zod's reasons in `details`, and `request()` and `parseJsonResponse()` both kept only "Validation
 * failed".
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { ApiError } from '../apiError'
import { getDB } from '../storage/idb'
import type * as ApiModule from '../api'

let client: typeof ApiModule

beforeAll(async () => {
  client = await import('../api')
  await import('../storage/localApiRouter')
}, 120_000)

beforeEach(async () => {
  localStorage.clear()
  localStorage.setItem('finance_storage_mode', 'serverless')
  localStorage.setItem('currentProfileId', '1')
  const db = await getDB()
  await db.clear('profiles')
  await db.clear('categories')
  await db.clear('tags')
  await db.add('profiles', { id: 1, name: 'Me', created_at: '2026-01-01T00:00:00.000Z' })
})

describe('a local-first refusal', () => {
  it('reaches apiPost as an ApiError with the field and its sentence', async () => {
    const error = (await client
      .apiPost('/api/categories', { name: '  ', icon: '' })
      .catch((e: unknown) => e)) as ApiError

    expect(error).toBeInstanceOf(ApiError)
    expect(error.status).toBe(400)
    expect(error.message).toBe('Give the category a name.')
    expect(error.fields).toEqual({ name: 'Give the category a name.' })
  })

  it('reaches the typed client the same way', async () => {
    const error = (await client.api
      .createTag('x'.repeat(51), '#6e9bff')
      .catch((e: unknown) => e)) as ApiError

    expect(error).toBeInstanceOf(ApiError)
    expect(error.status).toBe(400)
    expect(error.fields).toEqual({ name: 'Keep the name to 50 characters or fewer.' })
  })

  it('lets a blank icon through, stored as the default', async () => {
    const created = await client.apiPost<{ id: number; icon: string }>('/api/categories', {
      name: 'Coffee',
      type: 'expense',
      color: '#6e9bff',
      icon: null,
    })

    expect(created.icon).toBe('tag')
    expect(((await (await getDB()).get('categories', created.id)) as { icon: string }).icon).toBe(
      'tag'
    )
  })
})
