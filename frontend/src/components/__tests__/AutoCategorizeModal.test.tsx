/**
 * The auto-categorize modal, for the rows that reach it.
 *
 * Every one of them came from an import — the app will not create an uncategorized transaction —
 * so the person looking at the list did not type these rows in. The modal's job is to make them
 * identifiable (metadata, not just a bank-statement description string) and resolvable (a manual
 * pick when no mapping matches, which for a fresh import is most of them).
 */
import { createComputed, createRoot } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  __resetDataVersionsForTest,
  entityVersion,
  invalidateForRequest,
} from '../../core/dataVersions'
import { AutoCategorizeModal } from '../AutoCategorizeModal'
import type { AutoCategorizeTransaction } from '../AutoCategorizeModal'

vi.mock('../../core/api', () => ({
  api: {
    getCategoryMappings: vi.fn(() =>
      Promise.resolve([
        { id: 1, pattern: 'Netflix', category_id: 7, category_name: 'Entertainment' },
      ])
    ),
  },
}))

let host: HTMLDivElement
let dispose: (() => void) | undefined

const flush = () => new Promise((r) => setTimeout(r, 0))

const TXS: AutoCategorizeTransaction[] = [
  {
    id: 11,
    description: 'Netflix',
    date: '2026-07-22',
    amount: 12.99,
    currency: 'EUR',
    type: 'expense',
    account_id: 1,
  },
  {
    id: 12,
    description: '411111XXXXXX1111, Revolut**3333* Dublin',
    date: '2026-07-17',
    amount: 54.2,
    currency: 'EUR',
    type: 'expense',
    account_id: 2,
  },
]

function mount(opts: {
  txs?: AutoCategorizeTransaction[]
  onApply?: (id: number, cat: number) => void | Promise<void>
}) {
  host = document.createElement('div')
  document.body.appendChild(host)
  dispose = render(
    () => (
      <AutoCategorizeModal
        isOpen={() => true}
        onClose={() => {}}
        uncategorizedTransactions={() => opts.txs ?? TXS}
        categories={() => [
          { id: 7, name: 'Entertainment', type: 'expense' },
          { id: 8, name: 'Groceries', type: 'expense' },
          { id: 9, name: 'Salary', type: 'income' },
        ]}
        accountName={(id) => ({ 1: 'Erste Current', 2: 'Revolut' })[id]}
        onApply={opts.onApply ?? (() => {})}
      />
    ),
    host
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  __resetDataVersionsForTest()
})

afterEach(() => {
  dispose?.()
  dispose = undefined
  host.remove()
})

describe('identifying an imported row', () => {
  it('shows date, signed amount and account beside the description', async () => {
    mount({})
    await flush()
    const metas = host.querySelectorAll('[data-test-id="auto-cat-meta"]')
    expect(metas).toHaveLength(2)
    const first = metas[0]!.textContent!
    expect(first).toContain('2026-07-22')
    expect(first).toContain('12.99')
    expect(first).toContain('−') // an expense is signed, not a bare number
    expect(first).toContain('Erste Current')
  })
})

describe('a row with no suggestion', () => {
  it('offers a manual category pick instead of a dead end', async () => {
    mount({})
    await flush()
    const rows = host.querySelectorAll('[data-test-id="auto-cat-row"]')
    // Netflix matched a mapping; the bank string did not.
    expect(rows[0]!.querySelector('[data-test-id="auto-cat-manual-select"]')).toBeNull()
    const select = rows[1]!.querySelector<HTMLSelectElement>(
      '[data-test-id="auto-cat-manual-select"]'
    )
    expect(select).not.toBeNull()
    // Filtered to the row's own type: an expense is not offered Salary.
    const names = [...select!.options].map((o) => o.textContent)
    expect(names).toContain('Groceries')
    expect(names).not.toContain('Salary')
  })

  it('staging a manual pick counts toward Apply', async () => {
    mount({})
    await flush()
    const select = host.querySelector<HTMLSelectElement>('[data-test-id="auto-cat-manual-select"]')!
    select.value = '8'
    select.dispatchEvent(new Event('change', { bubbles: true }))
    await flush()
    expect(host.querySelector('[data-test-id="auto-cat-apply"]')!.textContent).toContain('Apply 1')
  })
})

describe('staging and applying are separate', () => {
  it('a row click stages without writing; Apply writes each staged row once, as one write', async () => {
    const applied: Array<[number, number]> = []
    // Every update a list following the transaction counter would see.
    const seen: number[] = []
    const stop = createRoot((dispose) => {
      createComputed(() => seen.push(entityVersion('transactions')))
      return dispose
    })
    mount({
      onApply: async (id, cat) => {
        applied.push([id, cat])
        // What the host's write does in apiFetch: bump the counters its URL names.
        invalidateForRequest(`/api/transactions/${id}`, 'PUT', true)
      },
    })
    await flush()

    // Stage the matched row via its + button, and the other one by hand.
    const plus = host.querySelectorAll<HTMLButtonElement>('button[aria-label^="Use "]')
    plus[0]!.click()
    const select = host.querySelector<HTMLSelectElement>('[data-test-id="auto-cat-manual-select"]')!
    select.value = '8'
    select.dispatchEvent(new Event('change', { bubbles: true }))
    await flush()
    expect(applied).toEqual([]) // nothing written yet — the old version wrote here AND on Apply

    host.querySelector<HTMLButtonElement>('[data-test-id="auto-cat-apply"]')!.click()
    await flush()
    stop()

    expect(applied).toEqual([
      [11, 7],
      [12, 8],
    ])
    // Two PUTs, one update: the list behind the modal refetches once for the whole batch, where it
    // used to reload after every row.
    expect(seen).toEqual([0, 1])
  })

  it('"Select all matches" stages every matched row in one click', async () => {
    mount({})
    await flush()
    host.querySelector<HTMLButtonElement>('[data-test-id="auto-cat-select-matches"]')!.click()
    await flush()
    // One of the two rows matches the mapping fixture.
    expect(host.querySelector('[data-test-id="auto-cat-apply"]')!.textContent).toContain('Apply 1')
  })
})
