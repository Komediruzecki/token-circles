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
import { bumpProfileVersion, setCurrentProfile, setPage, setProfiles } from '../../core/appStore'
import { __resetDataVersionsForTest } from '../../core/dataVersions'
import { setPeriod } from '../../core/periodStore'
import { removeToast, toasts } from '../../core/toastStore'
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
  // Imported with no category: one in each profile.
  row(3, 'Bakery', { profile_id: 1, category_id: null, account_id: 31 }),
  row(4, 'Toll', { profile_id: 2, category_id: null, account_id: 41 }),
]

/** The page's category edits. Set per test to refuse one, the way the server does. */
const updateTransaction = vi.fn(async (_id: number, _data: unknown) => ({}))

vi.mock('../../core/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  api: new Proxy(
    {
      // Fresh objects on every read, as a real response would be.
      getTransactions: async () => ROWS.map((r) => ({ ...r })),
      getCategories: async () => CATEGORIES.map((c) => ({ ...c })),
      getAccounts: async () => ACCOUNTS.map((a) => ({ ...a })),
      getTags: async () => [],
      updateTransaction: (id: number, data: unknown) => updateTransaction(id, data),
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
  updateTransaction.mockClear()
  localStorage.setItem('currentProfileId', '1')
  localStorage.setItem('selectedProfileIds', JSON.stringify([1, 2]))
  setProfiles([
    { id: 1, name: 'Personal' },
    { id: 2, name: 'Family' },
  ] as never)
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
  for (const t of toasts()) removeToast(t.id)
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

const formIsOpen = () =>
  host.querySelector<HTMLElement>('[data-test-id="tx-modal"]')!.className.includes('show')

async function editCoffee() {
  const coffee = Array.from(host.querySelectorAll('[data-test-id="transactions-row"]')).find((r) =>
    r.textContent?.includes('Coffee')
  )!
  coffee.querySelector<HTMLButtonElement>('button[aria-label="Edit transaction"]')!.click()
  await settle()
}

/** What typing does to a field: its value, then an input event. */
function typeInto(testId: string, text: string) {
  const field = host.querySelector<HTMLInputElement>(`[data-test-id="${testId}"]`)!
  field.value = text
  field.dispatchEvent(new Event('input', { bubbles: true }))
}

/** A switch the way the profile menu makes one (App.tsx applyProfileSelection). */
async function switchTo(id: number, name: string) {
  localStorage.setItem('currentProfileId', String(id))
  localStorage.setItem('selectedProfileIds', JSON.stringify(id === 1 ? [1, 2] : [2, 1]))
  setCurrentProfile({ id, name } as never)
  bumpProfileVersion()
  await settle()
}

const toastMessages = () => toasts().map((t) => t.message)

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
    await editCoffee()

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

describe('an open form, when the active profile changes', () => {
  // The form writes to the profile it opened for. Saved after a switch, its entry would go out as
  // the profile switched to, which refuses the entry's category and account, and an edit of the
  // row would answer 404. So the form closes, and says so when that lost something.
  it('closes an edit, and names the entry’s profile when it had changes', async () => {
    await mountPage()
    await editCoffee()
    typeInto('tx-description', 'Coffee beans')
    await switchTo(2, 'Family')

    expect(formIsOpen()).toBe(false)
    expect(toastMessages()).toEqual([
      'Your changes weren’t saved. Switch back to Personal to edit this entry.',
    ])
  })

  it('closes a new entry, and names the profile it was for', async () => {
    await mountPage()
    await openAddForm()
    typeInto('tx-amount', '12')
    await switchTo(2, 'Family')

    expect(formIsOpen()).toBe(false)
    expect(toastMessages()).toEqual([
      'Your new entry wasn’t saved. Switch back to Personal to add it.',
    ])
  })

  it('closes a form nobody changed without a word', async () => {
    await mountPage()
    await editCoffee()
    await switchTo(2, 'Family')

    expect(formIsOpen()).toBe(false)
    expect(toastMessages()).toEqual([])
  })

  it('stays open through a profile notice that leaves the active profile as it was', async () => {
    // profileVersion moves on other writes too, a quick-add among them (App.tsx).
    await mountPage()
    await openAddForm()
    typeInto('tx-description', 'Lunch')
    bumpProfileVersion()
    await settle()

    expect(formIsOpen()).toBe(true)
    expect(host.querySelector<HTMLInputElement>('[data-test-id="tx-description"]')!.value).toBe(
      'Lunch'
    )
    expect(toastMessages()).toEqual([])
  })
})

/** The ids a select offers, its placeholder left out. */
const optionIds = (el: HTMLSelectElement) =>
  Array.from(el.options)
    .map((o) => o.value)
    .filter((v) => v !== '')
    .map(Number)

/** The select beside a label reading exactly `text`, inside `root`. */
function selectLabelled(root: ParentNode, text: string): HTMLSelectElement {
  const label = Array.from(root.querySelectorAll('label')).find(
    (l) => l.textContent?.trim() === text
  )!
  return label.parentElement!.querySelector('select')!
}

const buttonReading = (root: ParentNode, text: string) =>
  Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find(
    (b) => b.textContent?.trim() === text
  )!

describe('the rest of the page, with two profiles ticked', () => {
  // Only the active profile's rows can be selected (#386), and a recurring entry is written to the
  // active profile. Both writes refuse another profile's category or account.
  it('offers a bulk change of category the active profile’s categories', async () => {
    await mountPage()
    const coffee = Array.from(host.querySelectorAll('[data-test-id="transactions-row"]')).find(
      (r) => r.textContent?.includes('Coffee')
    )!
    const box = coffee.querySelector<HTMLInputElement>('input[type="checkbox"]')!
    box.checked = true
    box.dispatchEvent(new Event('change', { bubbles: true }))
    await settle()
    buttonReading(
      host.querySelector('[data-test-id="bulk-action-bar"]')!,
      'Change Category'
    ).click()
    await settle()

    expect(optionIds(selectLabelled(host, 'New Category'))).toEqual([11, 12])
  })

  it('keeps another profile’s rows out of reach while the profile record is still loading', async () => {
    // The app fills currentProfile in once the profile list arrives (App.tsx). The active profile
    // is in localStorage from the start, and every write already goes out as it.
    setCurrentProfile(null)
    await mountPage()
    const rowOf = (text: string) =>
      Array.from(host.querySelectorAll<HTMLElement>('[data-test-id="transactions-row"]')).find(
        (r) => r.textContent?.includes(text)
      )!
    const diesel = rowOf('Diesel')

    expect(diesel.querySelector<HTMLInputElement>('input[type="checkbox"]')!.disabled).toBe(true)
    expect(diesel.querySelector('button[aria-label="Edit transaction"]')).toBeNull()
    expect(
      rowOf('Coffee').querySelector<HTMLButtonElement>('button[aria-label="Edit transaction"]')!
        .disabled
    ).toBe(false)
  })

  it('offers a new recurring entry the active profile’s categories and accounts', async () => {
    await mountPage()
    const section = Array.from(host.querySelectorAll('h2')).find(
      (h) => h.textContent === 'Recurring Transactions'
    )!.parentElement!
    buttonReading(section, 'Add').click()
    await settle()
    const modal = Array.from(host.querySelectorAll('h3')).find(
      (h) => h.textContent === 'Add Recurring'
    )!.parentElement!.parentElement!

    expect(optionIds(selectLabelled(modal, 'Account'))).toEqual([31, 32])
    expect(optionIds(selectLabelled(modal, 'Category'))).toEqual([11, 12])
  })
})

describe('Auto Categorize, with two profiles ticked', () => {
  // An edit is scoped to the profile in X-Profile-Id: another profile's row answers 404, and a
  // category of another profile is refused for this one's rows.
  const modal = () =>
    Array.from(host.querySelectorAll('h2')).find((h) => h.textContent === 'Auto Categorize')!
      .parentElement!.parentElement!.parentElement!
  const modalIsOpen = () => modal().className.includes('isOpen')
  const modalRows = () =>
    Array.from(modal().querySelectorAll('[data-test-id="auto-cat-row"]')).map(
      (r) => r.querySelector('p')!.textContent
    )

  async function openAutoCategorize() {
    buttonReading(host, 'Auto').click()
    await settle()
  }

  it('lists the active profile’s uncategorized rows, and offers its categories', async () => {
    await mountPage()
    await openAutoCategorize()

    expect(modalRows()).toEqual(['Bakery'])
    const pick = modal().querySelector<HTMLSelectElement>(
      '[data-test-id="auto-cat-manual-select"]'
    )!
    expect(optionIds(pick)).toEqual([11])
  })

  it('says so when a pick does not save, and keeps it to try again', async () => {
    updateTransaction.mockRejectedValueOnce(
      Object.assign(new Error('Transaction not found'), { status: 404 })
    )
    await mountPage()
    await openAutoCategorize()
    const pick = modal().querySelector<HTMLSelectElement>(
      '[data-test-id="auto-cat-manual-select"]'
    )!
    pick.value = '11'
    pick.dispatchEvent(new Event('change', { bubbles: true }))
    await settle()
    modal().querySelector<HTMLButtonElement>('[data-test-id="auto-cat-apply"]')!.click()
    await settle()

    expect(updateTransaction).toHaveBeenCalledWith(3, { category_id: 11 })
    expect(toastMessages()).toEqual(["Couldn't categorize 1 of 1. Try again."])
    expect(modalIsOpen()).toBe(true)
    expect(modal().querySelector('[data-test-id="auto-cat-apply"]')!.textContent?.trim()).toBe(
      'Apply 1'
    )
  })
})
