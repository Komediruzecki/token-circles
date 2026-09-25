/**
 * A choice made in the add-transaction form survives a refetch of the list it was chosen from.
 *
 * WHY THIS EXISTS. Since #570 the form's category and account lists follow writes made anywhere,
 * so they can refetch while the form is open — and #573 refetches everything when the app resumes.
 * A refetch returns new objects, `<For>` is keyed by reference, so it rebuilt every `<option>`.
 * Removing the selected option resets a `<select>` to its first entry, and the select's own
 * `value={...}` binding does not run again because the model did not change. The form then showed
 * "Uncategorized" while still holding the old category id, and saved a category the user could no
 * longer see.
 *
 * Each option now carries `selected={...}`, so a rebuilt option takes its state from the model.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setPage } from '../../core/appStore'
import { __resetDataVersionsForTest, invalidateEntity } from '../../core/dataVersions'
import { setPeriod } from '../../core/periodStore'

type Cat = { id: number; name: string; type: string; color: string }
type Account = { id: number; name: string; currency: string }

let serverCategories: Cat[] = []
let serverAccounts: Account[] = []

// Every read returns fresh objects, the way a real refetch does. Returning the same array would
// let <For> keep its nodes and hide the bug.
vi.mock('../../core/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  api: {
    getTransactions: vi.fn(async () => []),
    getCategories: vi.fn(async () => serverCategories.map((c) => ({ ...c }))),
    getTags: vi.fn(async () => []),
    getAccounts: vi.fn(async () => serverAccounts.map((a) => ({ ...a }))),
  },
  apiPut: vi.fn(async () => ({ ok: true })),
}))

const flush = () => new Promise((r) => setTimeout(r, 0))
const settle = async () => {
  await flush()
  await flush()
}

let host: HTMLDivElement
let dispose: (() => void) | undefined

beforeEach(() => {
  __resetDataVersionsForTest()
  serverCategories = [
    { id: 1, name: 'Groceries', type: 'expense', color: '#fff' },
    { id: 2, name: 'Utilities', type: 'expense', color: '#000' },
  ]
  serverAccounts = [
    { id: 1, name: 'Cash', currency: 'EUR' },
    { id: 2, name: 'Checking', currency: 'EUR' },
  ]
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
  host.remove()
  vi.unstubAllGlobals()
})

async function openAddForm() {
  const { default: Transactions } = await import('../Transactions')
  dispose = render(() => <Transactions />, host)
  await settle()
  host.querySelector<HTMLElement>('[data-test-id="add-transaction-btn"]')!.click()
  await settle()
}

const select = (testId: string) =>
  host.querySelector<HTMLSelectElement>(`[data-test-id="${testId}"]`)!

/** Pick an option the way a user does: the element's value changes, then the change event. */
function choose(testId: string, value: string) {
  const el = select(testId)
  el.value = value
  el.dispatchEvent(new Event('change', { bubbles: true }))
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

const shown = (testId: string) => select(testId).selectedOptions[0]?.textContent?.trim()

describe('the add-transaction form keeps its choices across a refetch', () => {
  it('keeps the chosen category when categories refetch', async () => {
    await openAddForm()
    choose('tx-category', '2')
    await flush()
    expect(shown('tx-category')).toBe('Utilities')

    invalidateEntity('categories')
    await settle()

    expect(select('tx-category').value).toBe('2')
    expect(shown('tx-category')).toBe('Utilities')
  })

  it('shows the new name when the chosen category is renamed elsewhere', async () => {
    // A rename produces a changed object for the very option that is selected, so even a list
    // that kept unchanged items by identity would rebuild this one.
    await openAddForm()
    choose('tx-category', '2')
    await flush()

    serverCategories = serverCategories.map((c) => (c.id === 2 ? { ...c, name: 'Bills' } : c))
    invalidateEntity('categories')
    await settle()

    expect(select('tx-category').value).toBe('2')
    expect(shown('tx-category')).toBe('Bills')
  })

  it('keeps the chosen account when accounts refetch', async () => {
    await openAddForm()
    choose('tx-account', '2')
    await flush()
    expect(shown('tx-account')).toContain('Checking')

    invalidateEntity('accounts')
    await settle()

    expect(select('tx-account').value).toBe('2')
    expect(shown('tx-account')).toContain('Checking')
  })

  it('keeps the chosen transfer destination when accounts refetch', async () => {
    await openAddForm()
    host.querySelector<HTMLElement>('[data-test-id="tx-type-transfer"]')!.click()
    await flush()
    choose('tx-transfer-account', '2')
    await flush()
    expect(shown('tx-transfer-account')).toBe('Checking')

    invalidateEntity('accounts')
    await settle()

    expect(select('tx-transfer-account').value).toBe('2')
    expect(shown('tx-transfer-account')).toBe('Checking')
  })
})
