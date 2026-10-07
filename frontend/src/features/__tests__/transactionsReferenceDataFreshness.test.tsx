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
import { removeToast, toasts } from '../../core/toastStore'

type Cat = {
  id: number
  name: string
  type: 'income' | 'expense'
  color: string
  profile_id: number
}
type Acct = { id: number; name: string; currency: string; profile_id: number }

/** The server's lists. Mutable, so another page's create is visible to the next fetch. */
let serverCategories: Cat[] = []
let serverAccounts: Acct[] = []

const getCategories = vi.fn(async () => serverCategories)
const getAccounts = vi.fn(async () => serverAccounts)
const getTags = vi.fn(async () => [] as Array<{ id: number; name: string; color: string }>)
const createAccount = vi.fn(async () => ({ id: 7 }))

vi.mock('../../core/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  api: {
    getTransactions: vi.fn(async () => []),
    getCategories: () => getCategories(),
    getTags: () => getTags(),
    getAccounts: () => getAccounts(),
    createAccount: () => createAccount(),
  },
  apiPut: vi.fn(async () => ({ ok: true })),
}))

let host: HTMLDivElement
let dispose: (() => void) | undefined

const flush = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  __resetDataVersionsForTest()
  // Every row is the active profile's (1), as a real list's are when one profile is selected.
  localStorage.setItem('currentProfileId', '1')
  serverCategories = [{ id: 1, name: 'Groceries', type: 'expense', color: '#fff', profile_id: 1 }]
  serverAccounts = [{ id: 1, name: 'Cash', currency: 'EUR', profile_id: 1 }]
  getCategories.mockClear()
  getAccounts.mockClear()
  getTags.mockClear()
  createAccount.mockClear()
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
  for (const t of toasts()) removeToast(t.id)
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

/** A request that answers when the test says so. */
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

/**
 * The names a filter-bar dropdown lists: the household's categories or accounts. Opened by its
 * button, read, and closed again.
 */
async function filterBarNames(root: HTMLElement, opener: () => HTMLElement): Promise<string[]> {
  opener().click()
  await flush()
  const names = Array.from(root.querySelectorAll('[data-test-id="filter-bar"] label'))
    .map((l) => l.textContent?.trim() ?? '')
    .filter((name) => name !== '' && !name.startsWith('All '))
  opener().click()
  await flush()
  return names
}
const filterBarCategories = (root: HTMLElement) =>
  filterBarNames(root, () =>
    root.querySelector<HTMLElement>('[data-test-id="transactions-filter-category"]')!
  )
const filterBarAccounts = (root: HTMLElement) =>
  filterBarNames(root, () =>
    Array.from(root.querySelectorAll<HTMLElement>('[data-test-id="filter-bar"] button')).find((b) =>
      b.textContent?.includes('All Accounts')
    )!
  )

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
      { id: 2, name: 'Utilities', type: 'expense', color: '#000', profile_id: 1 },
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

    serverAccounts = [...serverAccounts, { id: 2, name: 'Savings', currency: 'EUR', profile_id: 1 }]
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
    localStorage.setItem('currentProfileId', '2')
    serverCategories = [{ id: 9, name: 'Rent', type: 'expense', color: '#123', profile_id: 2 }]
    serverAccounts = [{ id: 9, name: 'Joint', currency: 'EUR', profile_id: 2 }]
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

  it('shows the newest category list when two refreshes cross, not the one that lands last', async () => {
    const root = await mountTransactions()
    // A refresh that is slow to answer, with the list as it stood when it was asked.
    const slow = deferred<Cat[]>()
    getCategories.mockImplementationOnce(() => slow.promise)
    invalidateEntity('categories')
    await flush()
    // A category created meanwhile, and the refresh after it answering at once.
    serverCategories = [
      ...serverCategories,
      { id: 2, name: 'Utilities', type: 'expense', color: '#000', profile_id: 1 },
    ]
    invalidateEntity('categories')
    await flush()
    await flush()
    // The slow one lands last.
    slow.resolve([{ id: 1, name: 'Groceries', type: 'expense', color: '#fff', profile_id: 1 }])
    await flush()
    await flush()

    expect(getCategories).toHaveBeenCalledTimes(3)
    openTransactionForm(root)
    await flush()
    expect(offeredCategoryNames(root)).toContain('Utilities')
  })

  it('shows the newest account list when two refreshes cross, not the one that lands last', async () => {
    const root = await mountTransactions()
    const slow = deferred<Acct[]>()
    getAccounts.mockImplementationOnce(() => slow.promise)
    invalidateEntity('accounts')
    await flush()
    serverAccounts = [...serverAccounts, { id: 2, name: 'Savings', currency: 'EUR', profile_id: 1 }]
    invalidateEntity('accounts')
    await flush()
    await flush()
    slow.resolve([{ id: 1, name: 'Cash', currency: 'EUR', profile_id: 1 }])
    await flush()
    await flush()

    expect(getAccounts).toHaveBeenCalledTimes(3)
    openTransactionForm(root)
    await flush()
    expect(offersAccount(root, 'Savings')).toBe(true)
  })

  it('drops the other profile’s lists when the refresh after a switch fails, instead of showing them as current', async () => {
    const root = await mountTransactions()
    expect(await filterBarCategories(root)).toEqual(['Groceries'])
    expect(await filterBarAccounts(root)).toEqual(['Cash'])

    getCategories.mockRejectedValueOnce(new Error('network down'))
    getAccounts.mockRejectedValueOnce(new Error('network down'))
    localStorage.setItem('currentProfileId', '2')
    bumpProfileVersion()
    await flush()
    await flush()

    expect(getCategories).toHaveBeenCalledTimes(2)
    expect(getAccounts).toHaveBeenCalledTimes(2)
    expect(await filterBarCategories(root)).toEqual([])
    expect(root.querySelector('[data-test-id="filter-bar"]')!.textContent).not.toContain(
      'All Accounts'
    )
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
      { id: 3, name: 'Transport', type: 'expense', color: '#0f0', profile_id: 1 },
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

describe('a new entry opened before the accounts are in', () => {
  const accountSelect = (root: HTMLElement) =>
    root.querySelector<HTMLSelectElement>('[data-test-id="tx-account"]')

  it('gets the account it would have opened with once they arrive', async () => {
    serverAccounts = [
      { id: 1, name: 'Cash', currency: 'EUR', profile_id: 1 },
      { id: 2, name: 'Savings', currency: 'EUR', profile_id: 1 },
    ]
    const slow = deferred<Acct[]>()
    getAccounts.mockImplementationOnce(() => slow.promise)
    const root = await mountTransactions()
    openTransactionForm(root)
    await flush()
    expect(accountSelect(root)).toBeNull()

    slow.resolve(serverAccounts)
    await flush()
    await flush()

    expect(accountSelect(root)!.value).toBe('1')
  })

  it('leaves the account alone once the person has picked, a later reload included', async () => {
    serverAccounts = [
      { id: 1, name: 'Cash', currency: 'EUR', profile_id: 1 },
      { id: 2, name: 'Savings', currency: 'EUR', profile_id: 1 },
    ]
    const slow = deferred<Acct[]>()
    getAccounts.mockImplementationOnce(() => slow.promise)
    const root = await mountTransactions()
    openTransactionForm(root)
    await flush()
    slow.resolve(serverAccounts)
    await flush()
    await flush()

    // The person clears the pick ("Select account..."), and the list reloads behind the form, as it
    // does on any account write or on coming back to the tab.
    const select = accountSelect(root)!
    select.value = ''
    select.dispatchEvent(new Event('input', { bubbles: true }))
    serverAccounts = serverAccounts.map((a) => ({ ...a })) // a fresh answer, as a real one is
    invalidateEntity('accounts')
    await flush()
    await flush()

    expect(getAccounts).toHaveBeenCalledTimes(2)
    expect(accountSelect(root)!.value).toBe('')
  })

  it('keeps the Cash account the person made from the form while the list was loading', async () => {
    // Until the list is in, the form offers to create a Cash account.
    serverAccounts = [{ id: 1, name: 'Main', currency: 'EUR', profile_id: 1 }]
    const slow = deferred<Acct[]>()
    getAccounts.mockImplementationOnce(() => slow.promise)
    const root = await mountTransactions()
    openTransactionForm(root)
    await flush()
    root.querySelector<HTMLElement>('[data-test-id="tx-create-cash-account"]')!.click()
    await flush()
    // The create lands as id 7, apiFetch's counter reloads the list, and the slow load ends too.
    serverAccounts = [...serverAccounts, { id: 7, name: 'Cash', currency: 'EUR', profile_id: 1 }]
    invalidateEntity('accounts')
    slow.resolve(serverAccounts)
    await flush()
    await flush()

    expect(createAccount).toHaveBeenCalledTimes(1)
    expect(accountSelect(root)!.value).toBe('7')
  })

  it('counts the account picked for it as no change of the person’s', async () => {
    const slow = deferred<Acct[]>()
    getAccounts.mockImplementationOnce(() => slow.promise)
    const root = await mountTransactions()
    openTransactionForm(root)
    await flush()
    slow.resolve(serverAccounts)
    await flush()
    await flush()

    // A switch closes the form, and names what it lost: here, nothing.
    localStorage.setItem('currentProfileId', '2')
    bumpProfileVersion()
    await flush()
    await flush()

    expect(root.querySelector('[data-test-id="tx-modal"]')!.className).not.toContain('show')
    expect(toasts().map((t) => t.message)).toEqual([])
  })
})
