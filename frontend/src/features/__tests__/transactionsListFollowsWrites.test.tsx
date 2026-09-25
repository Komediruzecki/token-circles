/**
 * The transaction list follows every write that changes it — from any page, and on resume — and
 * refetches exactly once per write, its own writes included.
 *
 * It tracked the profile alone. A transaction written anywhere else — a bill marked paid, a
 * recurring rule added to transactions, an import or its undo, a quick-add from the command bar —
 * did not reach the list until a profile switch or a browser reload, and resume revalidation
 * (#573), which rides the entity counters, never reached it at all. Its own writes reloaded it by
 * hand instead, and the recurring section was handed a callback for the same reason.
 *
 * The list now reads the counters of everything its endpoint returns: the rows, and the category,
 * receipt and tags joined onto each row (GET /api/transactions, and the local handler that mirrors
 * it). Every mocked write below does what apiFetch does for it — bump the counters its real URL
 * names — so a manual reload left behind shows up as a third read, and a write the list does not
 * follow as a missing second one.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from '../../core/api'
import { setPage } from '../../core/appStore'
import {
  __resetDataVersionsForTest,
  invalidateAllEntities,
  invalidateEntity,
  invalidateForRequest,
} from '../../core/dataVersions'
import { setPeriod } from '../../core/periodStore'
import type { ConfirmOptions } from '../../core/confirmStore'
import type { Transaction } from '../../types/models'

const row = (id: number, description: string, extra: Partial<Transaction> = {}): Transaction =>
  ({
    id,
    profile_id: 1,
    description,
    type: 'expense',
    amount: 10,
    amount_local: 10,
    currency: 'EUR',
    exchange_rate: 1,
    date: `2026-09-${String((id % 28) + 1).padStart(2, '0')}`,
    account_id: 1,
    transfer_account_id: null,
    category_id: 1,
    category_name: 'Groceries',
    category_color: '#22c55e',
    receipt_id: null,
    receipt_name: null,
    reconciled: false,
    tags: [],
    ...extra,
  }) as unknown as Transaction

/** Two categorized rows (one with a receipt) and two imported rows nobody has categorized yet. */
const BASE_ROWS = [
  row(1, 'Coffee', { receipt_id: 3, receipt_name: 'till.png' }),
  row(2, 'Books'),
  row(3, 'Card payment 0417', { category_id: null, category_name: null }),
  row(4, 'Card payment 0418', { category_id: null, category_name: null }),
]

/** The server's rows. Mutable, so a write made elsewhere is visible to the next read. */
let serverRows: Transaction[] = []
/** The server's tags, mutable like its rows. */
const BASE_TAGS = [
  { id: 5, name: 'Holiday', color: '#f97316' },
  { id: 6, name: 'Work', color: '#3b82f6' },
]
let serverTags = BASE_TAGS.map((t) => ({ ...t }))
/** How many times the page asked for its list. */
let listReads = 0
/** While set, each read waits to be answered by hand, in whatever order a test chooses. */
let holdAnswers = false
let heldAnswers: Array<(rows: Transaction[]) => void> = []

function readList(): Promise<Transaction[]> {
  listReads += 1
  if (holdAnswers) return new Promise((resolve) => heldAnswers.push(resolve))
  // Fresh objects on every read, as a real response would be.
  return Promise.resolve(serverRows.map((r) => ({ ...r })))
}

const RECEIPT = {
  id: 3,
  transaction_id: 1,
  original_name: 'till.png',
  file_type: 'image/png',
  file_size: 2048,
  uploaded_at: '2026-09-01T10:00:00Z',
}

const RULE = {
  id: 1,
  description: 'Rent',
  amount: 500,
  type: 'expense',
  frequency: 'monthly',
  day_of_month: 1,
  next_date: '2026-10-01',
  category_id: null,
  account_id: null,
  transfer_account_id: null,
  notes: null,
}

/** What apiFetch does after every successful write: bump the counters its URL names. */
const wrote = (url: string, method: string) => {
  invalidateForRequest(url, method, true)
}

/** Every write the page can make, each bumping exactly what the real request bumps. */
const writes = {
  createTransaction: vi.fn(async (_data: unknown) => {
    wrote('/api/transactions', 'POST')
    return { id: 99 }
  }),
  updateTransaction: vi.fn(async (id: number, _data: unknown) => {
    wrote(`/api/transactions/${id}`, 'PUT')
  }),
  deleteTransaction: vi.fn(async (id: number) => {
    wrote(`/api/transactions/${id}`, 'DELETE')
  }),
  bulkDeleteTransactions: vi.fn(async (_ids: number[]) => {
    wrote('/api/transactions/bulk', 'PUT')
  }),
  /** `apiPut`, which the bulk category and type changes call with the full URL. */
  apiPut: vi.fn(async (url: string, _body: unknown) => {
    wrote(url, 'PUT')
    return { ok: true }
  }),
  bulkTagTransactions: vi.fn(async (tagId: number, _ids: number[], _mode: string) => {
    wrote(`/api/tags/${tagId}/transactions`, 'POST')
    return { added: 1 }
  }),
  createTag: vi.fn(async (name: string, color?: string) => {
    const tag = { id: 7, name, color: color ?? '#6e9bff' }
    // Stored before the bump, as the server commits before it answers: the refetch the bump
    // sends has to find the new tag.
    serverTags = [...serverTags, tag]
    wrote('/api/tags', 'POST')
    return tag
  }),
  /** Replaces the row's whole tag set (PUT /api/transactions/:id/tags, in both runtimes). */
  setTransactionTags: vi.fn(async (transactionId: number, _tagIds: number[]) => {
    wrote(`/api/transactions/${transactionId}/tags`, 'PUT')
    return { ok: true }
  }),
  uploadReceipt: vi.fn(async (_transactionId: number, _file: File) => {
    wrote('/api/receipts/upload', 'POST')
    return RECEIPT
  }),
  deleteReceipt: vi.fn(async (id: number) => {
    wrote(`/api/receipts/${id}`, 'DELETE')
  }),
  reconcileByIds: vi.fn(async (_ids: number[]) => {
    wrote('/api/transactions/reconcile-batch', 'PUT')
    return { message: 'Reconciled', updated: 1 }
  }),
  reconcileByDateRange: vi.fn(async (_from: string, _to: string) => {
    wrote('/api/transactions/reconcile/bulk', 'POST')
    return { message: 'Reconciled', count: 2 }
  }),
  populateRecurring: vi.fn(async (id: number) => {
    wrote(`/api/recurring/${id}/populate`, 'POST')
    return { ok: true }
  }),
}

vi.mock('../../core/api', async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>()
  const reads: Record<string, (...args: never[]) => unknown> = {
    getTransactions: () => readList(),
    getCategories: async () => [{ id: 1, name: 'Groceries', type: 'expense', color: '#22c55e' }],
    getAccounts: async () => [{ id: 1, name: 'Cash', type: 'cash' }],
    getTags: async () => serverTags.map((t) => ({ ...t })),
    getRecurring: async () => [RULE],
    getCategoryMappings: async () => [],
    getReconciliationSummary: async () => ({
      reconciled_count: 0,
      unreconciled_count: 4,
      reconciled_total: 0,
      unreconciled_total: 40,
    }),
    getReceipt: async () => RECEIPT,
    getReceiptFile: async () => new Blob(['receipt'], { type: 'image/png' }),
  }
  return {
    ...original,
    toast: vi.fn(),
    apiPut: (url: string, body: unknown) => writes.apiPut(url, body),
    // Anything else the page's children ask the typed client for gets an empty list.
    api: new Proxy(reads, {
      get: (target, name: string) =>
        target[name] ?? (writes as Record<string, unknown>)[name] ?? (async () => []),
    }),
  }
})

// The confirm dialog runs the caller's work inside it; a failure keeps it open, which to the
// caller reads as the dialog not having confirmed.
vi.mock('../../core/confirmStore', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  showConfirm: vi.fn(async (_message: string, options?: ConfirmOptions) => {
    try {
      await options?.onConfirm?.(() => {})
    } catch {
      return false
    }
    return true
  }),
}))

let host: HTMLDivElement
let dispose: (() => void) | undefined

const flush = () => new Promise((r) => setTimeout(r, 0))
/** A refetch settles over more than one turn; three flushes covers one landing. */
const settle = async () => {
  await flush()
  await flush()
  await flush()
}

// Loading the page module is the slow part of a mount. Done once up front, so a loaded machine
// cannot push the first test past its timeout — a mount that outlives its test keeps counting
// reads into the next one.
beforeAll(async () => {
  await import('../Transactions')
}, 120_000)

beforeEach(() => {
  __resetDataVersionsForTest()
  serverRows = BASE_ROWS.map((r) => ({ ...r }))
  serverTags = BASE_TAGS.map((t) => ({ ...t }))
  vi.mocked(toast).mockClear()
  listReads = 0
  holdAnswers = false
  heldAnswers = []
  for (const write of Object.values(writes)) write.mockClear()
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
  // jsdom has no object URLs; the receipt previews make them. Nothing else in this file needs the
  // real ones, so the stand-ins are left in place.
  URL.createObjectURL = () => 'blob:receipt'
  URL.revokeObjectURL = () => {}
  // No date bound, so the rows' dates cannot filter them out from under a test.
  setPeriod({ mode: 'range', year: 2026, preset: 'all' })
  host = document.createElement('div')
  document.body.appendChild(host)
})

afterEach(() => {
  dispose?.()
  dispose = undefined
  host?.remove()
  vi.unstubAllGlobals()
})

/** Mount the page as the visible one — every loader on it is gated on visibility. */
async function mountTransactions() {
  setPage('transactions')
  const { default: Transactions } = await import('../Transactions')
  dispose = render(() => <Transactions />, host)
  await settle()
  expect(listReads, 'the list loads once on mount').toBe(1)
}

function byTestId(testId: string): HTMLElement {
  const found = host.querySelector<HTMLElement>(`[data-test-id="${testId}"]`)
  expect(found, `nothing has data-test-id="${testId}"`).not.toBeNull()
  return found!
}

const inputById = (testId: string) => byTestId(testId) as HTMLInputElement
const selectById = (testId: string) => byTestId(testId) as HTMLSelectElement

/** The button whose text starts with `label`, optionally within one part of the page. */
function button(label: string, within: ParentNode = host): HTMLButtonElement {
  const found = Array.from(within.querySelectorAll('button')).find((b) =>
    (b.textContent ?? '').trim().startsWith(label)
  )
  expect(found, `no button reads "${label}"`).toBeDefined()
  return found!
}

const rows = () =>
  Array.from(host.querySelectorAll<HTMLElement>('[data-test-id="transactions-row"]'))

const rowFor = (description: string) =>
  rows().find((r) =>
    r
      .querySelector('[data-test-id="transactions-cell-description"]')
      ?.textContent?.includes(description)
  )

function rowButton(description: string, ariaLabel: string): HTMLButtonElement {
  const found = rowFor(description)?.querySelector<HTMLButtonElement>(
    `button[aria-label="${ariaLabel}"]`
  )
  expect(found, `no "${ariaLabel}" button on the ${description} row`).toBeTruthy()
  return found!
}

function tick(description: string) {
  const box = rowFor(description)!.querySelector<HTMLInputElement>('input[type="checkbox"]')!
  box.checked = true
  box.dispatchEvent(new Event('change', { bubbles: true }))
}

const selectionCount = () =>
  host
    .querySelector('[data-test-id="bulk-action-bar"]')
    ?.querySelector('span')
    ?.textContent?.trim() ?? null

function typeInto(field: HTMLInputElement | HTMLTextAreaElement, value: string) {
  field.focus()
  field.value = value
  field.dispatchEvent(new Event('input', { bubbles: true }))
}

/** Pick an option the way a browser reports it: an input event, then a change event. */
function choose(select: HTMLSelectElement, value: string) {
  select.value = value
  select.dispatchEvent(new Event('input', { bubbles: true }))
  select.dispatchEvent(new Event('change', { bubbles: true }))
}

/** The `<select>` whose first option reads `placeholder`. */
function selectStartingWith(placeholder: string): HTMLSelectElement {
  const found = Array.from(host.querySelectorAll('select')).find(
    (s) => s.options[0]?.textContent?.trim() === placeholder
  )
  expect(found, `no select starts with "${placeholder}"`).toBeDefined()
  return found!
}

/** Open the add form and fill what saving requires; the account is preselected. */
async function fillNewTransaction(description: string) {
  byTestId('add-transaction-btn').click()
  await flush()
  typeInto(inputById('tx-description'), description)
  typeInto(inputById('tx-amount'), '4.20')
  choose(selectById('tx-category'), '1')
  await flush()
}

async function openEditor(description: string) {
  rowButton(description, 'Edit transaction').click()
  await settle()
}

describe('the list follows writes made anywhere else', () => {
  it.each(['transactions', 'categories', 'receipts', 'tags'])(
    'refetches once when %s is written elsewhere',
    async (tag) => {
      await mountTransactions()

      invalidateEntity(tag)
      await settle()

      expect(listReads).toBe(2)
    }
  )

  // The flows the list missed, by the request each one really makes. The import bumps both
  // `transactions` and `categories`, which the list follows, so it also proves one write is one
  // refetch however many followed counters it moves.
  it.each([
    { flow: 'a bill marked paid', url: '/api/bills/1/mark-paid', method: 'POST' },
    {
      flow: 'a recurring rule added to transactions',
      url: '/api/recurring/1/populate',
      method: 'POST',
    },
    { flow: 'an import', url: '/api/import/execute', method: 'POST' },
    { flow: 'an import undone', url: '/api/import-logs/7', method: 'DELETE' },
    { flow: 'a quick-add from the command bar', url: '/api/transactions', method: 'POST' },
    { flow: 'a category deleted', url: '/api/categories/1', method: 'DELETE' },
    { flow: 'a tag renamed', url: '/api/tags/5', method: 'PUT' },
  ])('refetches once for $flow', async ({ url, method }) => {
    await mountTransactions()

    invalidateForRequest(url, method, true)
    await settle()

    expect(listReads).toBe(2)
  })

  it('shows the row a bill marked paid on the Bills page created', async () => {
    await mountTransactions()
    expect(rowFor('Electricity')).toBeUndefined()

    serverRows = [...serverRows, row(7, 'Electricity')]
    invalidateForRequest('/api/bills/1/mark-paid', 'POST', true)
    await settle()

    expect(rowFor('Electricity')).toBeDefined()
  })

  it('refetches once when the app resumes', async () => {
    await mountTransactions()

    // Resume revalidation (core/dataRevalidation.ts) bumps every counter that is tracked.
    invalidateAllEntities()
    await settle()

    expect(listReads).toBe(2)
  })

  it('defers while the page is hidden, and refetches once on the next show', async () => {
    await mountTransactions()
    setPage('dashboard')
    await flush()

    invalidateForRequest('/api/bills/1/mark-paid', 'POST', true)
    invalidateForRequest('/api/import/execute', 'POST', true)
    invalidateAllEntities()
    await settle()
    expect(listReads).toBe(1)

    setPage('transactions')
    await settle()
    expect(listReads).toBe(2)
  })
})

describe("the page's own writes refetch the list once, through the counter they bump", () => {
  it('saving a new transaction', async () => {
    await mountTransactions()
    await fillNewTransaction('Bakery')

    byTestId('tx-save-btn').click()
    await settle()

    expect(writes.createTransaction).toHaveBeenCalledTimes(1)
    expect(listReads).toBe(2)
  })

  it('saving an edit', async () => {
    await mountTransactions()
    await openEditor('Books')

    byTestId('tx-save-btn').click()
    await settle()

    expect(writes.updateTransaction).toHaveBeenCalledTimes(1)
    expect(listReads).toBe(2)
  })

  it('saving with a receipt attached: two requests, one refetch', async () => {
    await mountTransactions()
    await fillNewTransaction('Bakery')
    byTestId('tx-advanced-toggle').click()
    await flush()
    const file = new File(['receipt'], 'bakery.png', { type: 'image/png' })
    const picker = host.querySelector<HTMLInputElement>('#tx-receipt')!
    Object.defineProperty(picker, 'files', { value: [file], configurable: true })
    picker.dispatchEvent(new Event('change', { bubbles: true }))
    await flush()

    byTestId('tx-save-btn').click()
    await settle()

    expect(writes.createTransaction).toHaveBeenCalledTimes(1)
    expect(writes.uploadReceipt).toHaveBeenCalledWith(99, file)
    expect(listReads).toBe(2)
  })

  it('deleting a row', async () => {
    await mountTransactions()

    rowButton('Books', 'Delete transaction').click()
    await settle()

    expect(writes.deleteTransaction).toHaveBeenCalledWith(2)
    expect(listReads).toBe(2)
  })

  it('deleting the selection', async () => {
    await mountTransactions()
    tick('Coffee')
    tick('Books')
    await flush()

    button('Delete Selected').click()
    await settle()

    expect(writes.bulkDeleteTransactions).toHaveBeenCalledWith([1, 2])
    expect(listReads).toBe(2)
  })

  it('changing the category of the selection', async () => {
    await mountTransactions()
    tick('Card payment 0417')
    await flush()

    button('Change Category').click()
    await flush()
    choose(selectStartingWith('No Category'), '1')
    button('Apply').click()
    await settle()

    expect(writes.apiPut).toHaveBeenCalledTimes(1)
    expect(listReads).toBe(2)
  })

  it('changing the type of the selection', async () => {
    await mountTransactions()
    tick('Books')
    await flush()

    button('Change Type').click()
    await flush()
    choose(selectStartingWith('Select type...'), 'income')
    button('Apply').click()
    await settle()

    expect(writes.apiPut).toHaveBeenCalledTimes(1)
    expect(listReads).toBe(2)
  })

  it('tagging the selection with two tags: two requests, one refetch', async () => {
    await mountTransactions()
    tick('Books')
    await flush()

    byTestId('bulk-tag-btn').click()
    await flush()
    button('Holiday', byTestId('bulk-tag-chips')).click()
    button('Work', byTestId('bulk-tag-chips')).click()
    byTestId('bulk-tag-apply').click()
    await settle()

    expect(writes.bulkTagTransactions).toHaveBeenCalledTimes(2)
    expect(listReads).toBe(2)
  })

  it.each([
    { action: 'reconciling the selection', control: 'Reconcile Selected', write: 'reconcileByIds' },
    {
      action: 'reconciling everything',
      control: 'Mark All Unreconciled as Reconciled',
      write: 'reconcileByDateRange',
    },
  ] as const)('$action', async ({ control, write }) => {
    await mountTransactions()
    tick('Books')
    await flush()

    button('Mark Reconciled').click()
    await flush()
    button(control).click()
    await settle()

    expect(writes[write]).toHaveBeenCalledTimes(1)
    expect(listReads).toBe(2)
  })

  it('deleting a receipt from the receipt viewer', async () => {
    await mountTransactions()
    rowButton('Coffee', 'View receipt').click()
    await settle()

    button('Delete', byTestId('receipt-modal')).click()
    await settle()

    expect(writes.deleteReceipt).toHaveBeenCalledWith(3)
    expect(listReads).toBe(2)
  })

  it('removing a receipt in the edit form', async () => {
    await mountTransactions()
    await openEditor('Coffee')

    host.querySelector<HTMLButtonElement>('button[title="Remove receipt"]')!.click()
    await settle()

    expect(writes.deleteReceipt).toHaveBeenCalledWith(3)
    expect(listReads).toBe(2)
  })

  it('applying auto-categorize picks to two rows: two requests, one refetch', async () => {
    await mountTransactions()
    button('Auto').click()
    await settle()
    const picks = host.querySelectorAll<HTMLSelectElement>(
      '[data-test-id="auto-cat-manual-select"]'
    )
    expect(picks).toHaveLength(2)
    for (const pick of picks) choose(pick, '1')
    await flush()

    byTestId('auto-cat-apply').click()
    await settle()

    expect(writes.updateTransaction).toHaveBeenCalledTimes(2)
    expect(listReads).toBe(2)
  })

  it('adding a recurring rule to transactions', async () => {
    await mountTransactions()
    host.querySelector<HTMLElement>('[class*="sectionHeader"]')!.click()
    await settle()

    host.querySelector<HTMLButtonElement>('button[title="Add to transactions"]')!.click()
    await settle()

    expect(writes.populateRecurring).toHaveBeenCalledWith(1)
    expect(listReads).toBe(2)
  })
})

describe('a failed write resyncs the list itself, because it bumps nothing', () => {
  const refused = (status: number) => Object.assign(new Error('Refused'), { status })

  it('a row delete the server refused', async () => {
    await mountTransactions()
    writes.deleteTransaction.mockRejectedValueOnce(refused(500))

    rowButton('Books', 'Delete transaction').click()
    await settle()

    expect(listReads).toBe(2)
  })

  it('a bulk delete that failed part-way', async () => {
    await mountTransactions()
    writes.bulkDeleteTransactions.mockRejectedValueOnce(refused(500))
    tick('Coffee')
    tick('Books')
    await flush()

    button('Delete Selected').click()
    await settle()

    expect(listReads).toBe(2)
  })

  it('an edit refused because the row changed under it', async () => {
    await mountTransactions()
    await openEditor('Books')
    writes.updateTransaction.mockRejectedValueOnce(refused(409))

    byTestId('tx-save-btn').click()
    await settle()

    expect(listReads).toBe(2)
  })
})

describe('a refetch keeps what the user is doing', () => {
  it('stays on the page of results the user was reading', async () => {
    serverRows = Array.from({ length: 60 }, (_, i) => row(100 + i, `Payment ${i + 1}`))
    await mountTransactions()
    host
      .querySelector<HTMLButtonElement>(
        '[data-test-id="transactions-pagination"] button[class*="page-btn-next"]'
      )!
      .click()
    await flush()
    expect(rows()).toHaveLength(10)

    serverRows = [...serverRows, row(200, 'Late payment')]
    invalidateEntity('transactions')
    await settle()

    expect(listReads).toBe(2)
    // Still the second page: it now holds the 61st row.
    expect(rows()).toHaveLength(11)
  })

  it('keeps the selection', async () => {
    await mountTransactions()
    tick('Coffee')
    tick('Books')
    await flush()
    expect(selectionCount()).toBe('2 selected')

    serverRows = [...serverRows, row(8, 'Cinema')]
    invalidateEntity('transactions')
    await settle()

    expect(listReads).toBe(2)
    expect(rowFor('Cinema')).toBeDefined()
    expect(selectionCount()).toBe('2 selected')
    expect(
      rowFor('Books')!.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked
    ).toBe(true)
  })

  it('keeps an open edit form, and what was typed into it', async () => {
    await mountTransactions()
    await openEditor('Books')
    typeInto(inputById('tx-description'), 'Books for the course')

    serverRows = [...serverRows, row(8, 'Cinema')]
    invalidateEntity('transactions')
    await settle()

    expect(listReads).toBe(2)
    expect(rowFor('Cinema')).toBeDefined()
    expect(host.querySelector('#tx-modal-title')?.textContent).toBe('Edit Transaction')
    expect(inputById('tx-description').value).toBe('Books for the course')
    expect(selectById('tx-category').value).toBe('1')
    expect(selectById('tx-account').value).toBe('1')
  })

  it('shows the newest answer when two refetches overlap', async () => {
    await mountTransactions()
    holdAnswers = true

    // Two writes in quick succession: the first refetch is still out when the second is sent.
    invalidateEntity('transactions')
    invalidateEntity('transactions')
    await flush()
    expect(listReads).toBe(3)

    const [first, second] = heldAnswers
    second([...BASE_ROWS, row(8, 'Cinema')])
    await settle()
    // The first answer was read before the second write and arrives last.
    first(BASE_ROWS)
    await settle()

    expect(rowFor('Cinema')).toBeDefined()
  })
})

describe("the form's tags are the transaction's, not the list filter's", () => {
  const HOLIDAY = { id: 5, name: 'Holiday', color: '#f97316' }
  const WORK = { id: 6, name: 'Work', color: '#3b82f6' }

  /**
   * Tag Books, and clear its local amount: that is the one other field the advanced section holds
   * that Books has, so after this only its tags can open the section.
   */
  const tagBooks = (tags: Array<{ id: number; name: string; color: string }>) => {
    serverRows = serverRows.map((r) =>
      r.description === 'Books' ? { ...r, tags, amount_local: null } : r
    )
  }

  /** The tags the open form will save, read off its chips. */
  const formTags = () =>
    Array.from(host.querySelectorAll('[data-test-id="tx-tag-chip"]')).map((chip) =>
      chip.textContent?.trim()
    )

  const formIsOpen = () => byTestId('tx-modal').className.includes('show')

  async function openAdvanced() {
    byTestId('tx-advanced-toggle').click()
    await flush()
  }

  /** Type a tag name into the form and press Enter. */
  async function enterTag(name: string) {
    const input = inputById('tx-tag-new-input')
    typeInto(input, name)
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await settle()
  }

  it('creating a tag in the form leaves the list behind it unfiltered', async () => {
    await mountTransactions()
    await fillNewTransaction('Train ticket')
    await openAdvanced()
    await enterTag('Commute')

    expect(writes.createTag).toHaveBeenCalledTimes(1)
    expect(rows(), 'every row is still listed behind the form').toHaveLength(4)
    expect(formTags()).toEqual(['Commute'])
    expect(inputById('tx-tag-new-input').value).toBe('')
  })

  it('a held-down Enter creates the tag once', async () => {
    await mountTransactions()
    await fillNewTransaction('Train ticket')
    await openAdvanced()
    const input = inputById('tx-tag-new-input')
    typeInto(input, 'Commute')
    // Key repeat: the second Enter arrives while the create the first one sent is still out.
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await settle()

    expect(writes.createTag).toHaveBeenCalledTimes(1)
    expect(formTags()).toEqual(['Commute'])
  })

  it('saving attaches a tag created in the form to the new transaction, as one write', async () => {
    await mountTransactions()
    await fillNewTransaction('Train ticket')
    await openAdvanced()
    await enterTag('Commute')
    // Creating the tag is a write of its own; the list follows tags, so it refetched for it.
    expect(listReads).toBe(2)

    button('Save Transaction').click()
    await settle()

    expect(writes.createTransaction).toHaveBeenCalledTimes(1)
    expect(writes.setTransactionTags).toHaveBeenCalledTimes(1)
    expect(writes.setTransactionTags).toHaveBeenCalledWith(99, [7])
    expect(listReads, 'the save and its tags refetch once, together').toBe(3)
    expect(formIsOpen()).toBe(false)
  })

  it('picks an existing tag, by its chip or by typing its name, without creating one', async () => {
    await mountTransactions()
    await fillNewTransaction('Train ticket')
    await openAdvanced()

    button('Work', byTestId('tx-tag-options')).click()
    await flush()
    await enterTag('holiday')

    expect(writes.createTag).not.toHaveBeenCalled()
    expect(formTags()).toEqual(['Work', 'Holiday'])
    // Both are on the transaction now, so neither is still offered.
    expect(host.querySelector('[data-test-id="tx-tag-options"]')).toBeNull()

    button('Save Transaction').click()
    await settle()
    expect(writes.setTransactionTags).toHaveBeenCalledWith(99, [6, 5])
  })

  it('editing a tagged row shows its tags, and saving them untouched sends no tag request', async () => {
    tagBooks([HOLIDAY])
    await mountTransactions()
    await openEditor('Books')

    // No click on "Show advanced options": a row's tags are never hidden behind it.
    expect(formTags()).toEqual(['Holiday'])

    button('Save Transaction').click()
    await settle()
    expect(writes.updateTransaction).toHaveBeenCalledTimes(1)
    expect(writes.setTransactionTags).not.toHaveBeenCalled()
    expect(listReads).toBe(2)
  })

  it('removing a tag from an edited row detaches it on save', async () => {
    tagBooks([HOLIDAY, WORK])
    await mountTransactions()
    await openEditor('Books')

    expect(formTags()).toEqual(['Holiday', 'Work'])
    const remove = host.querySelector<HTMLButtonElement>(
      '[data-test-id="tx-tag-chip"] button[aria-label="Remove tag Holiday"]'
    )
    expect(remove, 'the Holiday chip has a remove button').not.toBeNull()
    remove!.click()
    await flush()
    expect(formTags()).toEqual(['Work'])

    button('Save Transaction').click()
    await settle()
    expect(writes.setTransactionTags).toHaveBeenCalledWith(2, [6])
    expect(listReads, 'the edit and its tags refetch once, together').toBe(2)
  })

  it('duplicating a tagged row gives the copy the same tags', async () => {
    tagBooks([HOLIDAY])
    await mountTransactions()
    rowButton('Books', 'Duplicate transaction').click()
    await settle()

    expect(formTags()).toEqual(['Holiday'])

    button('Save Transaction').click()
    await settle()
    expect(writes.createTransaction).toHaveBeenCalledTimes(1)
    expect(writes.setTransactionTags).toHaveBeenCalledWith(99, [5])
  })

  it('a tag request that fails keeps the saved transaction, closes the form, and says so', async () => {
    writes.setTransactionTags.mockRejectedValueOnce(new Error('Tag request failed'))
    await mountTransactions()
    await fillNewTransaction('Train ticket')
    await openAdvanced()
    await enterTag('Commute')

    button('Save Transaction').click()
    await settle()

    // Leaving the form open would invite a second Save, and that would create the row twice.
    expect(writes.createTransaction).toHaveBeenCalledTimes(1)
    expect(formIsOpen()).toBe(false)
    expect(vi.mocked(toast)).toHaveBeenCalledWith(expect.stringMatching(/tags/i), 'warning')
    expect(listReads, 'what did save still reaches the list').toBe(3)
  })

  it('a tag renamed elsewhere renames its chip, and keeps what the form has picked', async () => {
    tagBooks([HOLIDAY])
    await mountTransactions()
    await openEditor('Books')
    button('Work', byTestId('tx-tag-options')).click()
    await flush()

    serverTags = serverTags.map((t) => (t.id === 5 ? { ...t, name: 'Vacation' } : t))
    invalidateForRequest('/api/tags/5', 'PUT', true)
    await settle()

    expect(formTags()).toEqual(['Vacation', 'Work'])
  })
})
