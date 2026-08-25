/**
 * Bulk selection vs. the rows that actually exist, driven through the real page.
 *
 * The bug this pins: ticking a row and then deleting that same row with its own row-level
 * delete button left the id in `selectedTransactions`. The bar kept counting a row that was
 * gone ("1 selected" over an empty table), and the next bulk action posted an id the server no
 * longer had — the worker skipped it and the serverless path failed its ownership check, so the
 * action silently under-applied. Only a test that clicks the real controls catches a call site
 * forgetting a setter, so this file mounts the page.
 *
 * The complement matters just as much: a row hidden by a FILTER is still selected on purpose.
 * Selecting across pages/filters and then acting on the lot is what the bulk bar is for, so the
 * reconciliation is against the full list, never the filtered view.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { bumpProfileVersion, setPage } from '../../core/appStore'
import { setPeriod } from '../../core/periodStore'
import type { ConfirmOptions } from '../../core/confirmStore'
import type { Transaction } from '../../types/models'

const tx = (id: number, description: string): Transaction =>
  ({
    id,
    profile_id: 1,
    description,
    type: 'expense',
    amount: 10,
    amount_local: 10,
    currency: 'EUR',
    exchange_rate: 1,
    date: `2026-01-0${id}`,
    account_id: null,
    transfer_account_id: null,
    category_id: null,
    category_name: null,
    category_color: null,
    reconciled: false,
    tags: [],
  }) as unknown as Transaction

/** The server's list. Mutable, so a delete (or another device) can actually remove a row. */
let serverTransactions: Transaction[] = []

const deleteTransaction = vi.fn(async (id: number) => {
  serverTransactions = serverTransactions.filter((t) => t.id !== id)
  return { ok: true }
})

vi.mock('../../core/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  api: {
    getTransactions: vi.fn(async () => serverTransactions),
    getCategories: vi.fn(async () => []),
    getTags: vi.fn(async () => []),
    getAccounts: vi.fn(async () => []),
    deleteTransaction,
  },
  apiPut: vi.fn(async () => ({ ok: true })),
}))

// The confirm dialog runs the caller's work and reports progress; the delete lives inside that
// callback, so the mock has to actually invoke it rather than just resolving true.
vi.mock('../../core/confirmStore', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  showConfirm: vi.fn(async (_message: string, options?: ConfirmOptions) => {
    await options?.onConfirm?.(() => {})
    return true
  }),
}))

let host: HTMLDivElement
let dispose: (() => void) | undefined

const flush = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  serverTransactions = [tx(1, 'Coffee'), tx(2, 'Books')]
  deleteTransaction.mockClear()
  // jsdom implements neither; the page's period pills ask about prefers-reduced-motion and
  // various controls scroll themselves into view.
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
  // No date bound, so the rows' dates cannot filter them out from under the test.
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

const rows = (root: HTMLElement) =>
  Array.from(root.querySelectorAll<HTMLElement>('[data-test-id="transactions-row"]'))

const rowByDescription = (root: HTMLElement, description: string) =>
  rows(root).find(
    (r) =>
      r
        .querySelector('[data-test-id="transactions-cell-description"]')
        ?.textContent?.includes(description) ?? false
  )

const selectionCount = (root: HTMLElement) =>
  root
    .querySelector('[data-test-id="bulk-action-bar"]')
    ?.querySelector('span')
    ?.textContent?.trim() ?? null

function tick(row: HTMLElement) {
  const box = row.querySelector<HTMLInputElement>('input[type="checkbox"]')!
  box.checked = true
  box.dispatchEvent(new Event('change', { bubbles: true }))
}

describe('deleting a selected row', () => {
  it('drops it from the selection, so the bar stops counting a row that is gone', async () => {
    const root = await mountTransactions()
    expect(rows(root), 'both rows should have loaded').toHaveLength(2)

    tick(rowByDescription(root, 'Coffee')!)
    await flush()
    expect(selectionCount(root)).toBe('1 selected')

    const del = rowByDescription(root, 'Coffee')!.querySelector<HTMLButtonElement>(
      'button[aria-label="Delete transaction"]'
    )!
    del.click()
    await flush()
    await flush()

    expect(deleteTransaction).toHaveBeenCalledWith(1)
    expect(rowByDescription(root, 'Coffee'), 'row should be gone from the table').toBeUndefined()
    expect(selectionCount(root), 'nothing is selected any more').toBeNull()
  })

  it('leaves the rest of the selection alone', async () => {
    const root = await mountTransactions()

    tick(rowByDescription(root, 'Coffee')!)
    tick(rowByDescription(root, 'Books')!)
    await flush()
    expect(selectionCount(root)).toBe('2 selected')

    rowByDescription(root, 'Coffee')!
      .querySelector<HTMLButtonElement>('button[aria-label="Delete transaction"]')!
      .click()
    await flush()
    await flush()

    expect(selectionCount(root), 'the row that survived is still selected').toBe('1 selected')
  })
})

describe('a row that disappears from a refetch', () => {
  it('is unselected too — the refetch paths cannot unselect it themselves', async () => {
    const root = await mountTransactions()

    tick(rowByDescription(root, 'Books')!)
    await flush()
    expect(selectionCount(root)).toBe('1 selected')

    // Deleted elsewhere (another device, or a profile switch swapping the whole list out).
    serverTransactions = [tx(1, 'Coffee')]
    bumpProfileVersion()
    await flush()
    await flush()

    expect(rowByDescription(root, 'Books')).toBeUndefined()
    expect(selectionCount(root)).toBeNull()
  })
})

describe('a row hidden by a filter', () => {
  it('stays selected — filtering the view is not unselecting', async () => {
    const root = await mountTransactions()

    tick(rowByDescription(root, 'Books')!)
    await flush()
    expect(selectionCount(root)).toBe('1 selected')

    const search = root.querySelector<HTMLInputElement>('[data-test-id="transactions-search"]')!
    search.value = 'Coffee'
    search.dispatchEvent(new Event('input', { bubbles: true }))
    await flush()

    expect(rowByDescription(root, 'Books'), 'filtered out of the table').toBeUndefined()
    expect(selectionCount(root), 'but still selected').toBe('1 selected')
  })
})
