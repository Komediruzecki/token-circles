/**
 * Every page that keeps a copy of server data follows writes made anywhere else in the app, and
 * refreshes when the app comes back from the background.
 *
 * Until this, only Transactions, Goals, Bills, Budgets and Tags read an entity counter
 * (core/dataVersions.ts), and only for their category lists. The pages below tracked the profile
 * alone: a write on one page never reached another until a reload or a profile switch, and resume
 * revalidation (#573), which rides the same counters, refreshed none of them.
 *
 * Each page also reloaded by hand after its own writes. The write already bumps the counter
 * through apiFetch, so the manual reload is gone and the counts below pin that: one fetch per
 * write, where a leftover manual reload makes it two.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiDelete, apiPost, apiPut } from '../../core/api'
import { setPage } from '../../core/appStore'
import {
  __resetDataVersionsForTest,
  invalidateAllEntities,
  invalidateEntity,
  invalidateForRequest,
} from '../../core/dataVersions'
import { setPeriod } from '../../core/periodStore'
import type { PageName } from '../../types/models'

/** Every read, in order, as the URL the page asked for. */
let reads: string[] = []

/** How many times the page read one endpoint, whatever its query string. */
const readsOf = (path: string) => reads.filter((url) => url.split('?')[0] === path).length

/** Just enough of each endpoint for its page to render one row it can act on. */
function respond(url: string): unknown {
  reads.push(url)
  switch (url.split('?')[0]) {
    case '/api/accounts':
      return [
        {
          id: 1,
          name: 'Checking',
          type: 'giro',
          bank_name: '',
          balance: 100,
          starting_balance: 100,
          currency: 'EUR',
          profile_id: 1,
        },
      ]
    case '/api/profiles':
      return [{ id: 1, name: 'Me' }]
    case '/api/categories':
      return [{ id: 1, name: 'Groceries', type: 'expense', color: '#ef4444', icon: null }]
    case '/api/loans':
      return [
        {
          id: 1,
          name: 'Car loan',
          principal: 1000,
          interest_rate: 5,
          term_months: 12,
          start_date: '2026-01-01',
          profile_id: 1,
        },
      ]
    case '/api/portfolio/holdings':
      return [{ id: 1, ticker: 'ACME', shares: 2, purchase_price: 10, purchase_date: '2026-01-01' }]
    case '/api/portfolio/summary':
      return {
        totalValue: 20,
        totalCostBasis: 20,
        totalGain: 0,
        totalGainPercent: 0,
        holdings: [],
        allocation: [{ ticker: 'ACME', value: 20, shares: 2, percentage: 100 }],
      }
    case '/api/housing':
      return { housings: [{ id: 1, type: 'rent', property_name: 'Flat', monthly_amount: 500 }] }
    case '/api/retirement-goals':
      return {
        settings: {},
        goals: [{ id: 1, name: 'Retire early', target_amount: 1000, current_amount: 100 }],
      }
    case '/api/retirement/settings':
      return { settings: {}, filled: [], missing: [] }
    case '/api/calculator/emergency-fund':
      return { avgMonthlyExpenses: 100, totalEmergencyFund: 300, monthsWithData: 3, coverage: [] }
    case '/api/savings-goals':
      return [
        {
          id: 1,
          name: 'Holiday',
          target_amount: 1000,
          current_amount: 100,
          deadline: '2027-01-01',
          category_id: null,
          profile_id: 1,
        },
      ]
    case '/api/bills':
      return [
        {
          id: 1,
          name: 'Rent',
          amount: 500,
          due_date: '2026-10-01',
          frequency: 'monthly',
          category: '',
          autopay: false,
          paid: false,
          type: 'bill',
          is_active: 1,
        },
      ]
    case '/api/bills/calendar':
      return {
        year: 2026,
        month: 9,
        monthLabel: 'September 2026',
        firstDow: 2,
        days: {
          '15': [
            {
              id: 1,
              name: 'Rent',
              amount: 500,
              frequency: 'monthly',
              date: '2026-09-15',
              paid: false,
              type: 'bill',
              is_overdue: false,
            },
          ],
        },
        summary: { totalAmount: 500, paidAmount: 0, billCount: 1 },
      }
    default:
      return []
  }
}

/**
 * Make the next mocked write behave like the real one: apiFetch bumps the counters for the URL it
 * wrote to. The module mock replaces the raw helpers wholesale, so without this a page's own write
 * would look, to the page, as if it had changed nothing.
 */
function nextWriteInvalidates(
  helper: typeof apiDelete | typeof apiPost | typeof apiPut,
  method: string
) {
  vi.mocked(helper).mockImplementationOnce(async (url: string) => {
    invalidateForRequest(url, method, true)
    return { ok: true } as never
  })
}

vi.mock('../../core/api', async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>()
  return {
    ...original,
    apiGet: vi.fn(async (url: string) => respond(url)),
    apiHouseholdGet: vi.fn(async (url: string) => respond(url)),
    apiPost: vi.fn(async () => ({ ok: true })),
    apiPut: vi.fn(async () => ({ ok: true })),
    apiDelete: vi.fn(async () => ({ ok: true })),
    showToast: vi.fn(),
    toast: vi.fn(),
    // Nothing on these pages should reach the typed client; if one does, it gets an empty list
    // instead of a real network call.
    api: new Proxy({}, { get: () => async () => [] }),
  }
})

// Deletes ask first through the shared modal. Answer yes, so the click runs the write.
vi.mock('../../core/confirmStore', async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>()
  return { ...original, showConfirm: vi.fn(async () => true) }
})

let host: HTMLDivElement
let dispose: (() => void) | undefined

const flush = () => new Promise((r) => setTimeout(r, 0))
/** Solid settles a resource over more than one microtask turn; three flushes covers a refetch. */
const settle = async () => {
  await flush()
  await flush()
  await flush()
}

// Loading a page module is the slow part of a mount. Done once up front, so a loaded machine
// cannot push a page's first test past its timeout — a mount that outlives its test keeps
// counting reads into the next one.
beforeAll(async () => {
  for (const module of new Set([...PAGES, ...OWN_WRITES].map((c) => c.module))) {
    await import(module)
  }
}, 120_000)

beforeEach(() => {
  __resetDataVersionsForTest()
  reads = []
  vi.mocked(apiPost).mockClear()
  vi.mocked(apiPut).mockClear()
  vi.mocked(apiDelete).mockClear()
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
  // Portfolio asks with the browser's own confirm().
  vi.stubGlobal('confirm', () => true)
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

/** Mount one page as the visible page — every loader is gated on visibility. */
async function mountPage(page: PageName, module: string) {
  setPage(page)
  const { default: Page } = await import(module)
  dispose = render(() => <Page />, host)
  await settle()
  return host
}

/** Click a control, or the button inside the wrapper that carries the test id. */
function click(root: HTMLElement, selector: string) {
  const found = root.querySelector<HTMLElement>(selector)
  expect(found, `nothing matches ${selector}`).not.toBeNull()
  const button = found!.tagName === 'BUTTON' ? found! : found!.querySelector('button')
  expect(button, `no button in ${selector}`).not.toBeNull()
  button!.click()
}

interface PageCase {
  page: PageName
  module: string
  /** The endpoint that holds the page's own list. */
  reads: string
  /** Every entity whose writes change what that endpoint returns. */
  follows: string[]
}

const PAGES: PageCase[] = [
  {
    page: 'accounts',
    module: '../Accounts',
    reads: '/api/accounts',
    follows: ['accounts', 'transactions', 'profiles'],
  },
  {
    page: 'categories',
    module: '../Categories',
    reads: '/api/categories',
    follows: ['categories', 'budgets'],
  },
  { page: 'loans', module: '../Loans', reads: '/api/loans', follows: ['loans'] },
  {
    page: 'portfolio',
    module: '../Portfolio',
    reads: '/api/portfolio/holdings',
    follows: ['portfolio'],
  },
  { page: 'housing', module: '../Housing', reads: '/api/housing', follows: ['housing'] },
  // The subscriptions panel on Housing is a list of bills.
  { page: 'housing', module: '../Housing', reads: '/api/bills', follows: ['bills'] },
  {
    page: 'retirement',
    module: '../Retirement',
    reads: '/api/retirement-goals',
    follows: ['retirement-goals'],
  },
  { page: 'goals', module: '../Goals', reads: '/api/savings-goals', follows: ['savings-goals'] },
  { page: 'bills', module: '../Bills', reads: '/api/bills', follows: ['bills'] },
  {
    page: 'budgets',
    module: '../Budgets',
    reads: '/api/budgets/improvements',
    follows: ['budgets'],
  },
  {
    page: 'counterparties',
    module: '../Counterparties',
    reads: '/api/counterparties',
    follows: ['transactions'],
  },
  {
    page: 'emergency',
    module: '../EmergencyFundCalculator',
    reads: '/api/calculator/emergency-fund',
    follows: ['transactions', 'accounts'],
  },
]

describe.each(PAGES)(
  '$page follows the data it shows',
  ({ page, module, reads: path, follows }) => {
    it('reads once on mount', async () => {
      await mountPage(page, module)
      expect(readsOf(path)).toBe(1)
    })

    it.each(follows)('refetches once when %s is written elsewhere', async (tag) => {
      await mountPage(page, module)
      expect(readsOf(path)).toBe(1)

      // What a write on any other page does: apiFetch raises the counter for everyone holding a
      // copy of that entity.
      invalidateEntity(tag)
      await settle()

      expect(readsOf(path)).toBe(2)
    })

    it('refetches once when the app resumes', async () => {
      await mountPage(page, module)
      expect(readsOf(path)).toBe(1)

      // Resume revalidation (core/dataRevalidation.ts) bumps every counter that is tracked.
      invalidateAllEntities()
      await settle()

      expect(readsOf(path)).toBe(2)
    })

    it('defers while hidden and refetches once on the next show', async () => {
      await mountPage(page, module)
      expect(readsOf(path)).toBe(1)

      setPage('transactions')
      await flush()
      for (const tag of follows) invalidateEntity(tag)
      invalidateAllEntities()
      await settle()
      expect(readsOf(path)).toBe(1)

      setPage(page)
      await settle()
      expect(readsOf(path)).toBe(2)
    })
  }
)

describe('one write that moves several entities a page follows is one refetch', () => {
  // A transaction write bumps `transactions` and `accounts` in one batch; a category write bumps
  // `categories` and `budgets`. A page tracking both must load once, not once per counter.
  it.each([
    { page: 'accounts', module: '../Accounts', path: '/api/accounts', write: '/api/transactions' },
    {
      page: 'categories',
      module: '../Categories',
      path: '/api/categories',
      write: '/api/categories',
    },
    {
      page: 'emergency',
      module: '../EmergencyFundCalculator',
      path: '/api/calculator/emergency-fund',
      write: '/api/transactions',
    },
  ] as const)('$page, for a POST to $write', async ({ page, module, path, write }) => {
    await mountPage(page, module)
    expect(readsOf(path)).toBe(1)

    invalidateForRequest(write, 'POST', true)
    await settle()

    expect(readsOf(path)).toBe(2)
  })
})

interface OwnWrite {
  page: PageName
  module: string
  reads: string
  control: string
  helper: 'apiDelete' | 'apiPut'
  method: string
  url: string
}

const OWN_WRITES: OwnWrite[] = [
  {
    page: 'accounts',
    module: '../Accounts',
    reads: '/api/accounts',
    control: '[data-test-id="account-delete-btn"]',
    helper: 'apiDelete',
    method: 'DELETE',
    url: '/api/accounts/1',
  },
  {
    page: 'categories',
    module: '../Categories',
    reads: '/api/categories',
    control: 'button[aria-label="Delete category"]',
    helper: 'apiDelete',
    method: 'DELETE',
    url: '/api/categories/1',
  },
  {
    page: 'categories',
    module: '../Categories',
    reads: '/api/categories',
    control: 'button[title^="#"]',
    helper: 'apiPut',
    method: 'PUT',
    url: '/api/categories/1',
  },
  {
    page: 'loans',
    module: '../Loans',
    reads: '/api/loans',
    control: '[data-test-id="loans-item-delete"]',
    helper: 'apiDelete',
    method: 'DELETE',
    url: '/api/loans/1',
  },
  {
    page: 'portfolio',
    module: '../Portfolio',
    reads: '/api/portfolio/holdings',
    control: 'button[title="Delete"]',
    helper: 'apiDelete',
    method: 'DELETE',
    url: '/api/portfolio/holdings/1',
  },
  {
    page: 'housing',
    module: '../Housing',
    reads: '/api/housing',
    control: '[data-test-id="housing-card-delete"]',
    helper: 'apiDelete',
    method: 'DELETE',
    url: '/api/housing/1',
  },
  {
    page: 'retirement',
    module: '../Retirement',
    reads: '/api/retirement-goals',
    control: '[data-test-id="retirement-goal-delete-btn"]',
    helper: 'apiDelete',
    method: 'DELETE',
    url: '/api/retirement-goals/1',
  },
  {
    page: 'goals',
    module: '../Goals',
    reads: '/api/savings-goals',
    control: '[data-test-id="goal-delete-btn"]',
    helper: 'apiDelete',
    method: 'DELETE',
    url: '/api/savings-goals/1',
  },
]

describe.each(OWN_WRITES)(
  '$page does not reload by hand after its own $method',
  ({ page, module, reads: path, control, helper, method, url }) => {
    it('loads once for the write, through the counter the write bumps', async () => {
      const root = await mountPage(page, module)
      expect(readsOf(path)).toBe(1)

      const write = helper === 'apiDelete' ? apiDelete : apiPut
      nextWriteInvalidates(write, method)
      click(root, control)
      await settle()

      expect(write).toHaveBeenCalledWith(url, ...(helper === 'apiPut' ? [expect.anything()] : []))
      // Two: the mount and the write's own bump. A third is a leftover manual reload.
      expect(readsOf(path)).toBe(2)
    })
  }
)

describe('writes that take more than one click', () => {
  it('Goals: a contribution loads the goals once', async () => {
    const root = await mountPage('goals', '../Goals')
    expect(readsOf('/api/savings-goals')).toBe(1)

    click(root, '[data-test-id="goal-contribute-btn"]')
    await settle()
    const amount = root.querySelector<HTMLInputElement>('input[placeholder="Amount..."]')
    expect(amount).not.toBeNull()
    amount!.value = '50'
    amount!.dispatchEvent(new Event('input', { bubbles: true }))
    nextWriteInvalidates(apiPost, 'POST')
    const add = [...root.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Add')
    expect(add).toBeDefined()
    add!.click()
    await settle()

    expect(apiPost).toHaveBeenCalledWith('/api/savings-goals/1/contribute', { amount: 50 })
    expect(readsOf('/api/savings-goals')).toBe(2)
  })

  it('Portfolio: refreshing prices does not reload the holdings', async () => {
    const root = await mountPage('portfolio', '../Portfolio')
    expect(readsOf('/api/portfolio/holdings')).toBe(1)

    // The real apiFetch hands every POST to invalidateForRequest. A quote lookup has to come out
    // of it having bumped nothing, or every refresh reloads the page it was pressed on.
    vi.mocked(apiPost).mockImplementationOnce(async (url: string) => {
      invalidateForRequest(url, 'POST', true)
      return { ACME: { price: 11, previousClose: 10, change: 1, changePercent: 10 } } as never
    })
    click(root, '[data-test-id="refresh-prices-btn"]')
    await settle()

    expect(apiPost).toHaveBeenCalledWith('/api/portfolio/prices', { tickers: ['ACME'] })
    expect(readsOf('/api/portfolio/holdings')).toBe(1)
  })

  it('Housing: each list reloads only for writes to what it shows', async () => {
    await mountPage('housing', '../Housing')
    expect(readsOf('/api/housing')).toBe(1)
    expect(readsOf('/api/bills')).toBe(1)

    // A subscription edited on the Bills page.
    invalidateForRequest('/api/bills/3', 'PUT', true)
    await settle()
    expect(readsOf('/api/bills')).toBe(2)
    expect(readsOf('/api/housing')).toBe(1)

    invalidateForRequest('/api/housing', 'POST', true)
    await settle()
    expect(readsOf('/api/housing')).toBe(2)
    expect(readsOf('/api/bills')).toBe(2)
  })
})

describe('Bills marks a bill paid through the counter, not by hand', () => {
  it('reloads the list once when a bill is marked paid', async () => {
    const root = await mountPage('bills', '../Bills')
    expect(readsOf('/api/bills')).toBe(1)

    nextWriteInvalidates(apiPost, 'POST')
    click(root, '[data-test-id="bill-mark-paid-btn"]')
    await settle()

    expect(apiPost).toHaveBeenCalledWith('/api/bills/1/mark-paid', {})
    // Two: the mount and the write's own bump. A third is the old reload after success.
    expect(readsOf('/api/bills')).toBe(2)
  })

  it('still reloads once to undo the optimistic tick when marking paid fails', async () => {
    const root = await mountPage('bills', '../Bills')
    expect(readsOf('/api/bills')).toBe(1)

    // A rejected write bumps nothing, so the page has to ask for the refetch that reverts it.
    vi.mocked(apiPost).mockRejectedValueOnce(new Error('offline'))
    click(root, '[data-test-id="bill-mark-paid-btn"]')
    await settle()

    expect(readsOf('/api/bills')).toBe(2)
  })

  it('reloads the calendar and the list once each when paid from the calendar', async () => {
    setPeriod({ mode: 'month', year: 2026, month: 9, preset: 'all' })
    const root = await mountPage('bills', '../Bills')
    const calendarTab = [...root.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === 'Calendar'
    )
    expect(calendarTab).toBeDefined()
    calendarTab!.click()
    await settle()
    expect(readsOf('/api/bills/calendar')).toBe(1)
    expect(readsOf('/api/bills')).toBe(1)

    root.querySelector<HTMLElement>('[role="button"]')!.click()
    await settle()
    const pay = [...root.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Pay')
    expect(pay).toBeDefined()
    nextWriteInvalidates(apiPost, 'POST')
    pay!.click()
    await settle()

    expect(apiPost).toHaveBeenCalledWith('/api/bills/1/mark-paid', {})
    // One each, from the write's bump. The calendar used to refetch itself and then ask Bills to
    // refetch too, on top of what the counter now does.
    expect(readsOf('/api/bills/calendar')).toBe(2)
    expect(readsOf('/api/bills')).toBe(2)
  })
})
