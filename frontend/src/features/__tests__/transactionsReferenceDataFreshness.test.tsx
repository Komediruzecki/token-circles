/**
 * Reference data on the Transactions page must follow writes made anywhere else.
 *
 * THE BUG THIS PINS. The add/edit transaction form's category dropdown was fed by a signal
 * written exactly once, in `onMount`. Pages stay mounted for the whole session (#317), so a
 * category created on the Categories page — or Budgets, Bills or Goals, which each have their own
 * inline category create — never reached this form. The user saw the new category everywhere
 * except the place they wanted to use it, and only a browser reload fixed it. The quick-add
 * surfaces (command bar, Guided Orbit) had been given their own fix; this one had not.
 *
 * Accounts had the same shape, and both were stale after a profile switch too, which is worse:
 * the form offered the previous profile's categories, and the server rejects those with a 400.
 *
 * WHAT IS BEING TESTED. `apiFetch` bumps an entity counter after every successful write, in both
 * storage modes (core/dataVersions.ts), and this page tracks those counters. The test goes through
 * the real signal rather than a mocked one, so removing either half — the bump in apiFetch or the
 * tracking here — fails it.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { bumpProfileVersion, setPage } from '../../core/appStore'
import { __resetDataVersionsForTest, invalidateEntity } from '../../core/dataVersions'
import { setPeriod } from '../../core/periodStore'

type Cat = { id: number; name: string; type: 'income' | 'expense'; color: string }
type Acct = { id: number; name: string; currency: string }

/** The server's lists. Mutable, so another page's create is visible to the next fetch. */
let serverCategories: Cat[] = []
let serverAccounts: Acct[] = []

const getCategories = vi.fn(async () => serverCategories)
const getAccounts = vi.fn(async () => serverAccounts)
const getTags = vi.fn(async () => [] as Array<{ id: number; name: string; color: string }>)

vi.mock('../../core/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  api: {
    getTransactions: vi.fn(async () => []),
    getCategories: () => getCategories(),
    getTags: () => getTags(),
    getAccounts: () => getAccounts(),
  },
  apiPut: vi.fn(async () => ({ ok: true })),
}))

let host: HTMLDivElement
let dispose: (() => void) | undefined

const flush = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  __resetDataVersionsForTest()
  serverCategories = [{ id: 1, name: 'Groceries', type: 'expense', color: '#fff' }]
  serverAccounts = [{ id: 1, name: 'Cash', currency: 'EUR' }]
  getCategories.mockClear()
  getAccounts.mockClear()
  getTags.mockClear()
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
  // refetchOnActive only loads while the page is the visible one.
  setPage('transactions')
  setPeriod({ mode: 'range', year: 2026, preset: 'all' })
  host = document.createElement('div')
  document.body.appendChild(host)
})

afterEach(() => {
  dispose?.()
  host?.remove()
  vi.unstubAllGlobals()
})

async function mountTransactions() {
  const { default: Transactions } = await import('../Transactions')
  dispose = render(() => <Transactions />, host)
  await flush()
  await flush()
  return host
}

/**
 * Open the add-transaction form — the surface the bug was reported against. Asserting against the
 * form's own dropdowns rather than the filter bar's is the point: this is the control the user
 * could not find their new category in.
 */
function openTransactionForm(root: HTMLElement) {
  root.querySelector<HTMLElement>('[data-test-id="add-transaction-btn"]')!.click()
}

/** The option labels of one `<select>` in the form, by test id. */
const optionsOf = (root: HTMLElement, testId: string) =>
  Array.from(
    root.querySelectorAll<HTMLSelectElement>(`[data-test-id="${testId}"]`)[0]?.options ?? []
  )
    .map((o) => o.textContent?.trim() ?? '')
    .filter(Boolean)

const offeredCategoryNames = (root: HTMLElement) => optionsOf(root, 'tx-category')
/** Account options render as "<name> (<balance>)", so match on the name rather than the label. */
const offersAccount = (root: HTMLElement, name: string) =>
  optionsOf(root, 'tx-account').some((label) => label.includes(name))

describe('Transactions reference data', () => {
  it('loads categories and accounts once on mount, with no duplicate fetch', async () => {
    await mountTransactions()
    // The load is driven by refetchOnActive, which also performs the initial load. An onMount
    // fetch beside it — the shape this page used to have for tags — would double every one.
    expect(getCategories).toHaveBeenCalledTimes(1)
    expect(getAccounts).toHaveBeenCalledTimes(1)
    // Tags had BOTH a refetchOnActive and an onMount load — the onMount one existed only to apply
    // the ?tag= hash filter, and fetched the list a second time to do it. That is now one load.
    expect(getTags).toHaveBeenCalledTimes(1)
  })

  it('picks up a category created on another page, without a browser reload', async () => {
    const root = await mountTransactions()
    openTransactionForm(root)
    await flush()
    expect(offeredCategoryNames(root)).toContain('Groceries')
    expect(offeredCategoryNames(root)).not.toContain('Utilities')

    // What creating a category on the Categories page does: the row lands on the server, and
    // apiFetch raises the counter for everyone holding a copy.
    serverCategories = [
      ...serverCategories,
      { id: 2, name: 'Utilities', type: 'expense', color: '#000' },
    ]
    invalidateEntity('categories')
    await flush()
    await flush()

    expect(getCategories).toHaveBeenCalledTimes(2)
    expect(offeredCategoryNames(root)).toContain('Utilities')
  })

  it('picks up an account created elsewhere', async () => {
    const root = await mountTransactions()
    openTransactionForm(root)
    await flush()
    expect(offersAccount(root, 'Savings')).toBe(false)

    serverAccounts = [...serverAccounts, { id: 2, name: 'Savings', currency: 'EUR' }]
    invalidateEntity('accounts')
    await flush()
    await flush()

    expect(getAccounts).toHaveBeenCalledTimes(2)
    expect(offersAccount(root, 'Savings')).toBe(true)
  })

  it("reloads both lists on a profile switch, so the form cannot offer another profile's rows", async () => {
    await mountTransactions()

    // The switched-to profile owns different rows — categories and accounts are per-profile in the
    // schema, and the worker rejects a foreign category_id with a 400.
    serverCategories = [{ id: 9, name: 'Rent', type: 'expense', color: '#123' }]
    serverAccounts = [{ id: 9, name: 'Joint', currency: 'EUR' }]
    bumpProfileVersion()
    await flush()
    await flush()

    expect(getCategories).toHaveBeenCalledTimes(2)
    expect(getAccounts).toHaveBeenCalledTimes(2)
    openTransactionForm(host)
    await flush()
    expect(offeredCategoryNames(host)).toContain('Rent')
    expect(offeredCategoryNames(host)).not.toContain('Groceries')
    expect(offersAccount(host, 'Joint')).toBe(true)
    expect(offersAccount(host, 'Cash')).toBe(false)
  })

  it('keeps the list on screen when a refresh fails, rather than blanking a dropdown in use', async () => {
    const root = await mountTransactions()
    openTransactionForm(root)
    await flush()
    expect(offeredCategoryNames(root)).toContain('Groceries')

    getCategories.mockRejectedValueOnce(new Error('network down'))
    invalidateEntity('categories')
    await flush()
    await flush()

    expect(offeredCategoryNames(root)).toContain('Groceries')
  })

  it('does not refetch while the page is hidden, and flushes once when it is shown again', async () => {
    await mountTransactions()
    expect(getCategories).toHaveBeenCalledTimes(1)

    setPage('dashboard')
    await flush()

    // Two writes land while this page is off screen. A mounted-but-hidden page refetching for
    // each one is the fan-out that keep-alive mounting made possible; pageVisibility defers it.
    serverCategories = [
      ...serverCategories,
      { id: 3, name: 'Transport', type: 'expense', color: '#0f0' },
    ]
    invalidateEntity('categories')
    invalidateEntity('categories')
    await flush()
    expect(getCategories).toHaveBeenCalledTimes(1)

    setPage('transactions')
    await flush()
    await flush()

    expect(getCategories).toHaveBeenCalledTimes(2)
    openTransactionForm(host)
    await flush()
    expect(offeredCategoryNames(host)).toContain('Transport')
  })
})
