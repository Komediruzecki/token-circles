/**
 * The invalidation seam: a successful write bumps the entity its URL names, and the derived views
 * that write moves. These are the guards that keep the "stale until browser reload" class of bug
 * from coming back — each one fails if the corresponding rule is removed.
 */
import { createComputed, createRoot } from 'solid-js'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  __resetDataVersionsForTest,
  entityVersion,
  invalidateEntity,
  invalidateForRequest,
  tagsForPath,
} from '../dataVersions'

beforeEach(() => {
  __resetDataVersionsForTest()
})

describe('entityVersion / invalidateEntity', () => {
  it('starts at zero for an entity nobody has touched', () => {
    expect(entityVersion('categories')).toBe(0)
  })

  it('increments only the entity that was invalidated', () => {
    invalidateEntity('categories')
    expect(entityVersion('categories')).toBe(1)
    expect(entityVersion('accounts')).toBe(0)
  })

  it('keeps counting so two writes are two distinct values', () => {
    invalidateEntity('tags')
    invalidateEntity('tags')
    expect(entityVersion('tags')).toBe(2)
  })
})

describe('tagsForPath', () => {
  it.each([
    ['/api/categories', 'categories'],
    ['/api/categories/5', 'categories'],
    ['/api/categories/5/merge', 'categories'],
    ['/api/categories?type=expense', 'categories'],
    ['/api/savings-goals/3/contribute', 'savings-goals'],
  ])('%s resolves to %s', (path, expected) => {
    expect(tagsForPath(path)[0]).toBe(expected)
  })

  it('returns nothing for a path that is not an app-API route, so it cannot invalidate the world', () => {
    expect(tagsForPath('/healthz')).toEqual([])
    expect(tagsForPath('https://cdn.example.com/font.woff2')).toEqual([])
    expect(tagsForPath('/api/')).toEqual([])
  })

  it('carries a transaction write into the derived views that show it', () => {
    const tags = tagsForPath('/api/transactions/9')
    expect(tags).toContain('transactions')
    // A transaction changes dashboard totals, analytics charts, budget spend and account balances.
    // Without these, saving a transaction leaves every one of those pages showing the old number.
    expect(tags).toEqual(
      expect.arrayContaining(['dashboard', 'analytics', 'budgets', 'reports', 'accounts'])
    )
  })
})

describe('invalidateForRequest', () => {
  it('bumps on a successful write', () => {
    invalidateForRequest('/api/categories', 'POST', true)
    expect(entityVersion('categories')).toBe(1)
  })

  it.each(['GET', 'HEAD', 'OPTIONS', undefined])(
    'does not bump on %s — a read changes nothing',
    (method) => {
      invalidateForRequest('/api/categories', method, true)
      expect(entityVersion('categories')).toBe(0)
    }
  )

  it('does not bump when the write failed — the server state is unchanged, so refetching is waste', () => {
    invalidateForRequest('/api/categories', 'POST', false)
    expect(entityVersion('categories')).toBe(0)
  })

  it('is one reactive update however many counters a write bumps', () => {
    // A category write bumps `categories` and `budgets`. Budgets tracks both; delivered as two
    // separate updates, one save made that page load everything twice.
    const seen: number[] = []
    const dispose = createRoot((dispose) => {
      createComputed(() => seen.push(entityVersion('categories') + entityVersion('budgets')))
      return dispose
    })

    invalidateForRequest('/api/categories', 'POST', true)
    dispose()

    expect(seen).toEqual([0, 2])
  })

  it.each(['POST', 'PUT', 'PATCH', 'DELETE', 'post', 'delete'])(
    'treats %s as a write, whatever its case',
    (method) => {
      invalidateForRequest('/api/accounts/2', method, true)
      expect(entityVersion('accounts')).toBe(1)
    }
  )
})
