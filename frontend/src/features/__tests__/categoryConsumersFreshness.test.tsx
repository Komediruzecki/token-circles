/**
 * Every page that keeps its own category list must follow writes made anywhere else.
 *
 * #570 gave Transactions the fix and left these four behind, listed as known-stale: Goals, Bills
 * and Budgets each hold a private copy loaded once per profile change, and Tags folds categories
 * into a resource keyed on profile and date range. A category created on the Categories page — or
 * in any *other* page's inline create modal — did not reach them until a revisit or a reload.
 *
 * Each page also created categories from its own modal and then called its own loader by hand.
 * That second mechanism is now redundant: the write already bumps the counter through apiFetch, so
 * the manual call is removed and the page refreshes through the same seam as everyone else. The
 * count assertions below are what pin that — a leftover manual reload shows up as a third fetch.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiPost, apiPut } from '../../core/api'
import { setPage } from '../../core/appStore'
import {
  __resetDataVersionsForTest,
  invalidateEntity,
  invalidateForRequest,
} from '../../core/dataVersions'
import { setPeriod } from '../../core/periodStore'

type Cat = { id: number; name: string; type: 'income' | 'expense'; color: string }

/** The server's category list. Mutable, so a create elsewhere is visible to the next fetch. */
let serverCategories: Cat[] = []

/** Every read of /api/categories, by whichever client surface the page happens to use. */
const categoryFetches = vi.fn()

/** Every read of Budgets' allocation plan — the table the page is named for. */
const planFetches = vi.fn()

function getByPath(url: string): unknown {
  if (url.startsWith('/api/categories')) {
    categoryFetches()
    return serverCategories
  }
  if (url.startsWith('/api/budgets/zero-based?')) planFetches()
  return []
}

/**
 * Make the next mocked write behave like the real one: apiFetch bumps the counters for the URL
 * it wrote to. The module mock replaces the raw helpers wholesale, so without this a page's own
 * write would look, to the page, as if it had changed nothing.
 */
function nextWriteInvalidates(
  helper: typeof apiPost | typeof apiPut,
  method: string,
  body: unknown
) {
  vi.mocked(helper).mockImplementationOnce(async (url: string) => {
    invalidateForRequest(url, method, true)
    return body as never
  })
}

vi.mock('../../core/api', async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>()
  return {
    ...original,
    apiGet: vi.fn(async (url: string) => getByPath(url)),
    apiHouseholdGet: vi.fn(async (url: string) => getByPath(url)),
    apiPost: vi.fn(async () => ({ ok: true })),
    apiPut: vi.fn(async () => ({ ok: true })),
    apiDelete: vi.fn(async () => ({ ok: true })),
    showToast: vi.fn(),
    api: {
      getCategories: vi.fn(async () => {
        categoryFetches()
        return serverCategories
      }),
      getAccounts: vi.fn(async () => []),
      getTagsSummary: vi.fn(async () => []),
      getTagRules: vi.fn(async () => []),
    },
  }
})

let host: HTMLDivElement
let dispose: (() => void) | undefined

const flush = () => new Promise((r) => setTimeout(r, 0))
/** Solid settles a resource over more than one microtask turn; two flushes covers a refetch. */
const settle = async () => {
  await flush()
  await flush()
}

beforeEach(() => {
  __resetDataVersionsForTest()
  serverCategories = [{ id: 1, name: 'Groceries', type: 'expense', color: '#fff' }]
  categoryFetches.mockClear()
  planFetches.mockClear()
  Element.prototype.scrollIntoView = () => {}
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  }))
  setPeriod({ mode: 'range', year: 2026, preset: 'all' })
  host = document.createElement('div')
  document.body.appendChild(host)
})

afterEach(() => {
  dispose?.()
  host?.remove()
  vi.unstubAllGlobals()
})

/** Mount one page as the visible page — the loaders are all gated on visibility. */
async function mountPage(page: 'goals' | 'bills' | 'budgets' | 'tags', module: string) {
  setPage(page)
  const { default: Page } = await import(module)
  dispose = render(() => <Page />, host)
  await settle()
  return host
}

const PAGES = [
  { page: 'goals', module: '../Goals' },
  { page: 'bills', module: '../Bills' },
  { page: 'budgets', module: '../Budgets' },
  { page: 'tags', module: '../Tags' },
] as const

describe.each(PAGES)('$page keeps its category list fresh', ({ page, module }) => {
  it('loads categories exactly once on mount', async () => {
    await mountPage(page, module)
    expect(categoryFetches).toHaveBeenCalledTimes(1)
  })

  it('refetches when a category is created elsewhere, without a browser reload', async () => {
    await mountPage(page, module)
    expect(categoryFetches).toHaveBeenCalledTimes(1)

    // What a create on any other surface does: the row lands on the server, and apiFetch raises
    // the counter for everyone holding a copy.
    serverCategories = [
      ...serverCategories,
      { id: 2, name: 'Utilities', type: 'expense', color: '#000' },
    ]
    invalidateEntity('categories')
    await settle()

    // Exactly two: the mount load and this one. A third would mean the page still calls its own
    // loader by hand as well as tracking the counter.
    expect(categoryFetches).toHaveBeenCalledTimes(2)
  })

  it('defers the refetch while hidden and flushes it once on the next show', async () => {
    await mountPage(page, module)
    expect(categoryFetches).toHaveBeenCalledTimes(1)

    setPage('dashboard')
    await flush()

    // Two writes land off screen. A mounted-but-hidden page refetching for each one is the
    // keep-alive fan-out that pageVisibility exists to prevent.
    invalidateEntity('categories')
    invalidateEntity('categories')
    await settle()
    expect(categoryFetches).toHaveBeenCalledTimes(1)

    setPage(page)
    await settle()
    expect(categoryFetches).toHaveBeenCalledTimes(2)
  })
})

describe('Budgets renders the refreshed list', () => {
  // Budgets is the one of the four that renders its categories on the page itself rather than
  // only inside a modal, so it can prove the refetched rows actually reach the DOM.
  it('shows a category created elsewhere without a reload', async () => {
    const root = await mountPage('budgets', '../Budgets')
    expect(root.textContent).toContain('Groceries')
    expect(root.textContent).not.toContain('Utilities')

    serverCategories = [
      ...serverCategories,
      { id: 2, name: 'Utilities', type: 'expense', color: '#000' },
    ]
    invalidateEntity('categories')
    await settle()

    expect(root.textContent).toContain('Utilities')
  })
})

describe('Budgets follows every write that moves its figures', () => {
  // The allocation plan is keyed on categories and totals spending, so a category write and a
  // transaction write both change it. It used to follow only the focus month and the profile:
  // a category created on the Categories page never became a row here until the month changed.
  it('refetches the allocation plan when a transaction is saved elsewhere', async () => {
    await mountPage('budgets', '../Budgets')
    expect(planFetches).toHaveBeenCalledTimes(1)

    invalidateForRequest('/api/transactions', 'POST', true)
    await settle()

    expect(planFetches).toHaveBeenCalledTimes(2)
  })

  it('refetches the allocation plan when a category is created elsewhere', async () => {
    await mountPage('budgets', '../Budgets')
    expect(planFetches).toHaveBeenCalledTimes(1)

    invalidateForRequest('/api/categories', 'POST', true)
    await settle()

    expect(planFetches).toHaveBeenCalledTimes(2)
  })

  it('fetches the category list once for a write that bumps both counters it tracks', async () => {
    await mountPage('budgets', '../Budgets')
    expect(categoryFetches).toHaveBeenCalledTimes(1)

    // A category write bumps `categories` and, through the fan-out, `budgets`. The list tracks
    // both; if the two bumps arrive as separate updates the page loads everything twice.
    invalidateForRequest('/api/categories', 'POST', true)
    await settle()

    expect(categoryFetches).toHaveBeenCalledTimes(2)
  })

  it('does not reload by hand after its own colour change', async () => {
    const root = await mountPage('budgets', '../Budgets')
    expect(categoryFetches).toHaveBeenCalledTimes(1)

    nextWriteInvalidates(apiPut, 'PUT', { ok: true })
    const swatch = root.querySelector<HTMLButtonElement>('button[title^="#"]')
    expect(swatch).not.toBeNull()
    swatch!.click()
    await settle()

    expect(apiPut).toHaveBeenCalledWith('/api/categories/1', expect.objectContaining({}))
    // Two: the mount and the write's own bump. A third is a leftover manual loadCategories().
    expect(categoryFetches).toHaveBeenCalledTimes(2)
  })

  it('does not refetch by hand after its own bulk action', async () => {
    const root = await mountPage('budgets', '../Budgets')
    expect(planFetches).toHaveBeenCalledTimes(1)

    nextWriteInvalidates(apiPost, 'POST', { ok: true, count: 2 })
    const copyLastMonth = root.querySelector<HTMLButtonElement>(
      '[title^="Copy the budget amounts"]'
    )
    expect(copyLastMonth).not.toBeNull()
    copyLastMonth!.click()
    await settle()

    expect(apiPost).toHaveBeenCalledWith('/api/budgets/duplicate-last', expect.anything())
    // Two: the mount and the write's own bump. A third is a leftover manual refetch.
    expect(planFetches).toHaveBeenCalledTimes(2)
  })
})
