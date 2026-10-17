/**
 * Getting started's step for entries with no category links to `#transactions?uncategorised=1`.
 * The page then lists what the step counted: the active profile's entries with no category,
 * transfers aside, from all time, whatever filters the list had before. A note above the list
 * says so, with the way back to every entry.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setPage } from '../../core/appStore'
import { period, setPeriod } from '../../core/periodStore'
import { fromPill } from '../../utils/period'
import type { Transaction } from '../../types/models'

const thisMonth = new Date().toISOString().slice(0, 7)

const tx = (id: number, description: string, over: Partial<Transaction> = {}): Transaction =>
  ({
    id,
    profile_id: 1,
    description,
    type: 'expense',
    amount: 10,
    amount_local: 10,
    currency: 'EUR',
    exchange_rate: 1,
    date: `${thisMonth}-02`,
    account_id: null,
    transfer_account_id: null,
    category_id: null,
    category_name: null,
    category_color: null,
    reconciled: false,
    tags: [],
    ...over,
  }) as unknown as Transaction

const serverTransactions: Transaction[] = [
  // Two years back: outside any month the period bar was on.
  tx(1, 'Old market', { date: '2024-03-04', reconciled: true }),
  tx(2, 'Refund', { type: 'income' }),
  tx(3, 'Groceries', {
    category_id: 7 as never,
    category_name: 'Food',
    account_id: 3 as never,
    tags: [{ id: 9, name: 'Trip', color: '#336699' }] as never,
  }),
  tx(4, 'To savings', { type: 'transfer' }),
  // Another profile's, shown with both ticked: not what the step counted.
  tx(5, 'Their lunch', { profile_id: 2 as never }),
]

vi.mock('../../core/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  api: {
    getTransactions: vi.fn(async () => serverTransactions),
    getCategories: vi.fn(async () => [{ id: 7, name: 'Food', type: 'expense', profile_id: 1 }]),
    getTags: vi.fn(async () => [{ id: 9, name: 'Trip', color: '#336699', profile_id: 1 }]),
    getAccounts: vi.fn(async () => [{ id: 3, name: 'Main', profile_id: 1 }]),
  },
}))

let host: HTMLDivElement
let dispose: (() => void) | undefined

const flush = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  localStorage.setItem('currentProfileId', '1')
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
  setPeriod(fromPill('thisMonth'))
  host = document.createElement('div')
  document.body.appendChild(host)
})

afterEach(() => {
  dispose?.()
  host?.remove()
  history.replaceState(null, '', '#')
  vi.unstubAllGlobals()
  localStorage.clear()
})

async function mountTransactions() {
  const { default: Transactions } = await import('../Transactions')
  dispose = render(() => <Transactions />, host)
  await flush()
  await flush()
  return host
}

/** The description of each row on screen, without the tags shown beside it. */
const shown = () =>
  Array.from(host.querySelectorAll<HTMLElement>('[data-test-id="transactions-row"]')).map(
    (row) =>
      row
        .querySelector('[data-test-id="transactions-cell-description"] > div')
        ?.firstChild?.textContent?.trim() ?? ''
  )

const note = () => host.querySelector('[data-test-id="uncategorised-note"]')

describe('arriving from Getting started', () => {
  it('lists the entries with no category, from all time, and says so', async () => {
    history.replaceState(null, '', '#transactions?uncategorised=1')
    await mountTransactions()

    expect(shown().sort()).toEqual(['Old market', 'Refund'])
    expect(note()?.textContent).toContain('Showing the 2 entries without a category.')
    expect(period().preset).toBe('all')
    // Taken off the address, so a reload shows the list as usual.
    expect(window.location.hash).not.toContain('uncategorised')
  })

  it('shows every entry again from the note', async () => {
    history.replaceState(null, '', '#transactions?uncategorised=1')
    await mountTransactions()

    host.querySelector<HTMLButtonElement>('[data-test-id="uncategorised-show-all"]')!.click()
    await flush()

    expect(note()).toBeNull()
    expect(shown()).toEqual(expect.arrayContaining(['Old market', 'Refund', 'Groceries']))
  })

  it('follows a link that arrives once the page is open', async () => {
    await mountTransactions()
    expect(note()).toBeNull()
    expect(shown()).toContain('Groceries')

    history.replaceState(null, '', '#transactions?uncategorised=1')
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    await flush()

    expect(shown().sort()).toEqual(['Old market', 'Refund'])
  })

  it('clears the filters the list had, so it shows the entries the step counted', async () => {
    // Filters from an earlier visit: a category, an account and a tag from a link, a type, a
    // search, and reconciled entries hidden.
    history.replaceState(null, '', '#transactions?category=Food&account=3&tag=9')
    await mountTransactions()
    host.querySelector<HTMLButtonElement>('[data-test-id="transactions-type-expense"]')!.click()
    const search = host.querySelector<HTMLInputElement>('[data-test-id="transactions-search"]')!
    search.value = 'Gro'
    search.dispatchEvent(new InputEvent('input', { bubbles: true }))
    host.querySelector<HTMLButtonElement>('button[title="Hide reconciled"]')!.click()
    await flush()
    expect(shown()).toEqual(['Groceries'])

    history.replaceState(null, '', '#transactions?uncategorised=1')
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    await flush()

    expect(shown().sort()).toEqual(['Old market', 'Refund'])
    expect(note()?.textContent).toContain('Showing the 2 entries without a category.')
    expect(search.value).toBe('')
    expect(host.querySelector('[data-test-id="transactions-type-all"]')?.className ?? '').toMatch(
      /typeBtnActive/i
    )
  })
})
