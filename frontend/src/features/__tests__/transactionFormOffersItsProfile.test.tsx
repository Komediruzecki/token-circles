/**
 * The add/edit transaction form offers the categories and accounts of the profile the entry is
 * written to, in household view too. The filter bar keeps the household's.
 *
 * WHY THIS EXISTS. With two profiles ticked (Settings > Household) the page reads categories and
 * accounts for the household, because its filter bar covers every ticked profile. The form offered
 * the same lists, but a new entry is written to the active profile, and the save refuses a
 * category or an account of any other: "Category does not belong to this profile" (cloud and
 * local-first) and "Account does not belong to this profile" (local-first, where the account list
 * covers the household too). Reproduced in both modes on 2026-10-07. In local-first the account
 * preselected for a new entry could be another profile's as well.
 *
 * Another profile's row is not editable here: the table disables its controls (#386), because the
 * API scopes an edit to the profile in X-Profile-Id. So an edit is always of the active profile's
 * own row, and offers that profile's lists.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { bumpProfileVersion, setCurrentProfile, setPage } from '../../core/appStore'
import { __resetDataVersionsForTest } from '../../core/dataVersions'
import { setPeriod } from '../../core/periodStore'
import type { Transaction } from '../../types/models'

// Personal (1) is active; Family (2) is ticked as well. Family's list comes first, and has a
// category with the same name as one of Personal's, the way two profiles' defaults do.
const CATEGORIES = [
  { id: 21, name: 'Groceries', type: 'expense', color: '#f59e0b', profile_id: 2 },
  { id: 22, name: 'Fuel', type: 'expense', color: '#0ea5e9', profile_id: 2 },
  { id: 11, name: 'Groceries', type: 'expense', color: '#22c55e', profile_id: 1 },
  { id: 12, name: 'Salary', type: 'income', color: '#16a34a', profile_id: 1 },
]
const ACCOUNTS = [
  { id: 41, name: 'Joint', type: 'giro', profile_id: 2 },
  { id: 42, name: 'Card', type: 'giro', profile_id: 2 },
  { id: 31, name: 'Main', type: 'giro', profile_id: 1 },
  { id: 32, name: 'Savings', type: 'savings', profile_id: 1 },
]

const row = (id: number, description: string, extra: Partial<Transaction>): Transaction =>
  ({
    id,
    description,
    type: 'expense',
    amount: 10,
    amount_local: 10,
    currency: 'EUR',
    exchange_rate: 1,
    date: '2026-09-10',
    transfer_account_id: null,
    receipt_id: null,
    reconciled: false,
    tags: [],
    ...extra,
  }) as unknown as Transaction

const ROWS = [
  row(1, 'Coffee', { profile_id: 1, category_id: 11, account_id: 32 }),
  row(2, 'Diesel', { profile_id: 2, category_id: 22, account_id: 41 }),
]

vi.mock('../../core/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  api: new Proxy(
    {
      // Fresh objects on every read, as a real response would be.
      getTransactions: async () => ROWS.map((r) => ({ ...r })),
      getCategories: async () => CATEGORIES.map((c) => ({ ...c })),
      getAccounts: async () => ACCOUNTS.map((a) => ({ ...a })),
      getTags: async () => [],
    } as Record<string, unknown>,
    // Anything else the page's children ask the typed client for gets an empty list.
    { get: (target, name: string) => target[name] ?? (async () => []) }
  ),
}))

const flush = () => new Promise((r) => setTimeout(r, 0))
const settle = async () => {
  await flush()
  await flush()
  await flush()
}

let host: HTMLDivElement
let dispose: (() => void) | undefined

beforeAll(async () => {
  await import('../Transactions')
}, 120_000)

beforeEach(() => {
  __resetDataVersionsForTest()
  localStorage.setItem('currentProfileId', '1')
  localStorage.setItem('selectedProfileIds', JSON.stringify([1, 2]))
  setCurrentProfile({ id: 1, name: 'Personal' } as never)
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
  setPage('transactions')
  setPeriod({ mode: 'range', year: 2026, preset: 'all' })
  host = document.createElement('div')
  document.body.appendChild(host)
})

afterEach(() => {
  dispose?.()
  dispose = undefined
  host.remove()
  vi.unstubAllGlobals()
  localStorage.clear()
})

async function mountPage() {
  const { default: Transactions } = await import('../Transactions')
  dispose = render(() => <Transactions />, host)
  await settle()
}

async function openAddForm() {
  host.querySelector<HTMLElement>('[data-test-id="add-transaction-btn"]')!.click()
  await settle()
}

const select = (testId: string) =>
  host.querySelector<HTMLSelectElement>(`[data-test-id="${testId}"]`)!

/** The ids a select offers, its placeholder left out. */
const offered = (testId: string) =>
  Array.from(select(testId).options)
    .map((o) => o.value)
    .filter((v) => v !== '')
    .map(Number)

describe('the transaction form, with two profiles ticked', () => {
  it('offers a new entry the active profile’s categories, not the household’s', async () => {
    await mountPage()
    await openAddForm()

    expect(offered('tx-category')).toEqual([11])
  })

  it('offers a new entry the active profile’s accounts, and preselects one of them', async () => {
    await mountPage()
    await openAddForm()

    expect(offered('tx-account')).toEqual([31, 32])
    expect(select('tx-account').value).toBe('31')
  })

  it('offers a transfer the active profile’s accounts at both ends', async () => {
    await mountPage()
    await openAddForm()
    host.querySelector<HTMLElement>('[data-test-id="tx-type-transfer"]')!.click()
    await settle()

    expect(offered('tx-account')).toEqual([31, 32])
    expect(offered('tx-transfer-account')).toEqual([31, 32])
  })

  it('offers an edit the lists of the row’s own profile, with its picks shown', async () => {
    await mountPage()
    const coffee = Array.from(host.querySelectorAll('[data-test-id="transactions-row"]')).find(
      (r) => r.textContent?.includes('Coffee')
    )!
    coffee.querySelector<HTMLButtonElement>('button[aria-label="Edit transaction"]')!.click()
    await settle()

    expect(offered('tx-category')).toEqual([11])
    expect(select('tx-category').value).toBe('11')
    expect(offered('tx-account')).toEqual([31, 32])
    expect(select('tx-account').value).toBe('32')
  })

  // The table opens an edit only for the active profile's own rows, so the two profiles part ways
  // only when the active one changes while the form is open. The row stays where it is.
  it('keeps an open edit on its row’s profile through a switch of the active profile', async () => {
    await mountPage()
    const coffee = Array.from(host.querySelectorAll('[data-test-id="transactions-row"]')).find(
      (r) => r.textContent?.includes('Coffee')
    )!
    coffee.querySelector<HTMLButtonElement>('button[aria-label="Edit transaction"]')!.click()
    await settle()
    localStorage.setItem('currentProfileId', '2')
    localStorage.setItem('selectedProfileIds', JSON.stringify([2, 1]))
    setCurrentProfile({ id: 2, name: 'Family' } as never)
    bumpProfileVersion()
    await settle()

    expect(offered('tx-category')).toEqual([11])
    expect(select('tx-category').value).toBe('11')
    expect(offered('tx-account')).toEqual([31, 32])
    expect(select('tx-account').value).toBe('32')
  })

  it('follows a switch of the active profile', async () => {
    await mountPage()
    localStorage.setItem('currentProfileId', '2')
    localStorage.setItem('selectedProfileIds', JSON.stringify([2, 1]))
    setCurrentProfile({ id: 2, name: 'Family' } as never)
    bumpProfileVersion()
    await settle()
    await openAddForm()

    expect(offered('tx-category')).toEqual([21, 22])
    expect(offered('tx-account')).toEqual([41, 42])
  })

  it('leaves the filter bar covering the household', async () => {
    await mountPage()
    host.querySelector<HTMLElement>('[data-test-id="transactions-filter-category"]')!.click()
    await settle()

    const names = Array.from(host.querySelectorAll('[data-test-id="filter-bar"] label')).map((l) =>
      l.textContent?.trim()
    )
    expect(names).toEqual(['All Categories', 'Groceries', 'Fuel', 'Groceries', 'Salary'])
  })
})
