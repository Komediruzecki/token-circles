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
  invalidateAllEntities,
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

  it('carries a completed import into everything it creates', () => {
    // The import routes are `/api/import/*`, singular. The table was keyed `imports`, a root no
    // URL ever produced, so a finished import refreshed nothing: not the transaction list, not
    // the accounts it created, not the dashboard.
    expect(tagsForPath('/api/import/execute')).toEqual(
      expect.arrayContaining(['transactions', 'accounts', 'categories', 'dashboard', 'budgets'])
    )
  })

  it.each(['/api/bills/3/mark-paid', '/api/recurring/4/populate', '/api/import/execute'])(
    '%s moves everything a transaction write moves, because it writes transactions',
    (path) => {
      // Each of these lists `transactions` in the fan-out table. Copying the transaction entry by
      // hand dropped views on the way: marking a bill paid never reached the budgets, analytics or
      // reports, although the payment it records is spending in all three.
      expect(tagsForPath(path)).toEqual(expect.arrayContaining(tagsForPath('/api/transactions')))
    }
  )

  it('moves only the goal when money is put towards it', () => {
    // A contribution raises the goal's saved amount and nothing else, in the worker and in the
    // local handler alike: no transaction row, no account balance. The table used to claim both,
    // which reloaded every transaction-derived view for a change none of them show.
    expect(tagsForPath('/api/savings-goals/5/contribute')).toEqual(['savings-goals'])
  })

  it('names each entity once, however many routes through the table reach it', () => {
    const tags = tagsForPath('/api/import/execute')
    expect(new Set(tags).size).toBe(tags.length)
  })

  it.each([
    '/api/portfolio/prices',
    '/api/loans/7/calculate',
    '/api/tags/rules/preview',
    '/api/import/upload',
    '/api/import/googlesheet',
  ])('treats %s as the read it is, although it is sent as a POST', (path) => {
    // These lookups take a body, so they POST. They change nothing, and each is called from a
    // page that follows the entity its URL names: counting a price quote as a portfolio write
    // reloaded the holdings after every quote refresh, and an import preview would refresh every
    // page the import feeds before a single row was written.
    expect(tagsForPath(path)).toEqual([])
  })

  it('still counts the import that writes', () => {
    expect(tagsForPath('/api/import/execute')).toContain('transactions')
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

describe('invalidateAllEntities', () => {
  it('bumps every tracked counter in one update, so a page tracking several refetches once', () => {
    // Resume revalidation calls this. Budgets tracks `categories` and `budgets`; bumped one at a
    // time, every return to the app loaded that page twice.
    const seen: number[] = []
    const dispose = createRoot((dispose) => {
      createComputed(() => seen.push(entityVersion('categories') + entityVersion('budgets')))
      return dispose
    })

    invalidateAllEntities()
    dispose()

    expect(seen).toEqual([0, 2])
  })
})
