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
 * write, where a leftover manual reload makes it two. Each write is also made with its bump
 * withheld, when it must reload nothing at all: that is what fails if the page reloads by hand,
 * even where the hand-made reload is the only one.
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
        {
          id: 2,
          name: 'Gym',
          amount: 30,
          due_date: '2026-10-05',
          frequency: 'monthly',
          category: '',
          autopay: false,
          paid: false,
          type: 'subscription',
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
  // Reset, not clear: a one-off bumping implementation a failed test never used must not leak
  // into the next test's write.
  vi.mocked(apiPost).mockReset()
  vi.mocked(apiPut).mockReset()
  vi.mocked(apiDelete).mockReset()
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
  // The subscriptions panel on Housing is a list of bills, each coloured by its category.
  {
    page: 'housing',
    module: '../Housing',
    reads: '/api/bills',
    follows: ['bills', 'categories'],
  },
  {
    page: 'retirement',
    module: '../Retirement',
    reads: '/api/retirement-goals',
    follows: ['retirement-goals'],
  },
  // A goal linked to a category counts that category's transactions, recomputed on every read.
  {
    page: 'goals',
    module: '../Goals',
    reads: '/api/savings-goals',
    follows: ['savings-goals', 'transactions'],
  },
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

/** Type into a field the way a person does: the value, then the input event Solid listens for. */
function typeInto(root: HTMLElement, selector: string, value: string) {
  const field = root.querySelector<HTMLInputElement>(selector)
  expect(field, `nothing matches ${selector}`).not.toBeNull()
  field!.value = value
  field!.dispatchEvent(new Event('input', { bubbles: true }))
}

/** Click the button that reads `text`. The whole document: menus render in a portal. */
function clickText(text: string) {
  const button = [...document.querySelectorAll<HTMLElement>('button, [role="menuitem"]')].find(
    (b) => b.textContent?.trim() === text
  )
  expect(button, `no button reads ${text}`).toBeDefined()
  button!.click()
}

/**
 * Submit the form that holds `selector`. Dispatched rather than clicked, so jsdom's constraint
 * validation stays out of it: what is under test is what the save does, not the form's fields.
 */
function submit(root: HTMLElement, selector = 'button[type="submit"]') {
  const form = root.querySelector(selector)?.closest('form')
  expect(form, `no form holds ${selector}`).toBeTruthy()
  form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
}

const WRITE_HELPERS = { apiDelete, apiPost, apiPut }

interface OwnWrite {
  /** What the user does, as the test names it. */
  does: string
  page: PageName
  module: string
  reads: string
  /** Everything the user does, ending in the write. */
  act: (root: HTMLElement) => void | Promise<void>
  helper: keyof typeof WRITE_HELPERS
  method: string
  url: string
}

/** Open the subscription card's menu on Bills and pick one of its items. */
async function subscriptionMenu(root: HTMLElement, item: string) {
  click(root, '[data-test-id="bills-tab-subscriptions"]')
  await settle()
  click(root, 'button[aria-label="More actions for Gym"]')
  await settle()
  clickText(item)
}

/** Fill the Portfolio add form with one buy of `ticker` and save it. */
async function addHolding(root: HTMLElement, ticker: string) {
  click(root, '[data-test-id="add-holding-btn"]')
  await settle()
  typeInto(root, '[data-test-id="portfolio-form-ticker"]', ticker)
  typeInto(root, '[data-test-id="portfolio-form-shares"]', '1')
  typeInto(root, '[data-test-id="portfolio-form-price"]', '12')
  typeInto(root, '[data-test-id="portfolio-form-date"]', '2026-02-01')
  submit(root, '[data-test-id="portfolio-modal-submit"]')
}

const ACCOUNT_NAME = 'input[placeholder="e.g., Checking, Savings"]'

const OWN_WRITES: OwnWrite[] = [
  {
    does: 'creates an account',
    page: 'accounts',
    module: '../Accounts',
    reads: '/api/accounts',
    act: async (root) => {
      click(root, '[data-test-id="add-account-btn"]')
      await settle()
      typeInto(root, ACCOUNT_NAME, 'Savings')
      submit(root, ACCOUNT_NAME)
    },
    helper: 'apiPost',
    method: 'POST',
    url: '/api/accounts',
  },
  {
    does: 'edits an account',
    page: 'accounts',
    module: '../Accounts',
    reads: '/api/accounts',
    act: async (root) => {
      click(root, '[data-test-id="account-edit-btn"]')
      await settle()
      submit(root, ACCOUNT_NAME)
    },
    helper: 'apiPut',
    method: 'PUT',
    url: '/api/accounts/1',
  },
  {
    does: 'deletes an account',
    page: 'accounts',
    module: '../Accounts',
    reads: '/api/accounts',
    act: (root) => {
      click(root, '[data-test-id="account-delete-btn"]')
    },
    helper: 'apiDelete',
    method: 'DELETE',
    url: '/api/accounts/1',
  },
  {
    does: 'edits a category',
    page: 'categories',
    module: '../Categories',
    reads: '/api/categories',
    act: async (root) => {
      click(root, '[data-test-id="edit-category-btn"]')
      await settle()
      submit(root)
    },
    helper: 'apiPut',
    method: 'PUT',
    url: '/api/categories/1',
  },
  {
    does: 'deletes a category',
    page: 'categories',
    module: '../Categories',
    reads: '/api/categories',
    act: (root) => {
      click(root, 'button[aria-label="Delete category"]')
    },
    helper: 'apiDelete',
    method: 'DELETE',
    url: '/api/categories/1',
  },
  {
    does: 'recolours a category',
    page: 'categories',
    module: '../Categories',
    reads: '/api/categories',
    act: (root) => {
      click(root, 'button[title^="#"]')
    },
    helper: 'apiPut',
    method: 'PUT',
    url: '/api/categories/1',
  },
  {
    // The budget summary on each card is read with the categories.
    does: 'sets a category budget',
    page: 'categories',
    module: '../Categories',
    reads: '/api/categories',
    act: async (root) => {
      clickText('Budget')
      await settle()
      typeInto(root, 'input[placeholder="500.00"]', '250')
      clickText('Save Budget')
    },
    helper: 'apiPost',
    method: 'POST',
    url: '/api/budgets',
  },
  {
    does: 'edits a loan',
    page: 'loans',
    module: '../Loans',
    reads: '/api/loans',
    act: async (root) => {
      click(root, '[data-test-id="loans-item-edit"]')
      await settle()
      submit(root)
    },
    helper: 'apiPut',
    method: 'PUT',
    url: '/api/loans/1',
  },
  {
    does: 'deletes a loan',
    page: 'loans',
    module: '../Loans',
    reads: '/api/loans',
    act: (root) => {
      click(root, '[data-test-id="loans-item-delete"]')
    },
    helper: 'apiDelete',
    method: 'DELETE',
    url: '/api/loans/1',
  },
  {
    does: 'edits a holding',
    page: 'portfolio',
    module: '../Portfolio',
    reads: '/api/portfolio/holdings',
    act: async (root) => {
      click(root, 'button[title="Edit"]')
      await settle()
      submit(root, '[data-test-id="portfolio-modal-submit"]')
    },
    helper: 'apiPut',
    method: 'PUT',
    url: '/api/portfolio/holdings/1',
  },
  {
    // A buy of a ticker already held is merged into that holding, once the user agrees.
    does: 'merges a buy into the holding it adds to',
    page: 'portfolio',
    module: '../Portfolio',
    reads: '/api/portfolio/holdings',
    act: (root) => addHolding(root, 'ACME'),
    helper: 'apiPut',
    method: 'PUT',
    url: '/api/portfolio/holdings/1',
  },
  {
    does: 'adds a holding',
    page: 'portfolio',
    module: '../Portfolio',
    reads: '/api/portfolio/holdings',
    act: (root) => addHolding(root, 'NEWCO'),
    helper: 'apiPost',
    method: 'POST',
    url: '/api/portfolio/holdings',
  },
  {
    does: 'deletes a holding',
    page: 'portfolio',
    module: '../Portfolio',
    reads: '/api/portfolio/holdings',
    act: (root) => {
      click(root, 'button[title="Delete"]')
    },
    helper: 'apiDelete',
    method: 'DELETE',
    url: '/api/portfolio/holdings/1',
  },
  {
    does: 'adds a housing cost',
    page: 'housing',
    module: '../Housing',
    reads: '/api/housing',
    act: async (root) => {
      click(root, '[data-test-id="add-housing-btn"]')
      await settle()
      typeInto(root, '[data-test-id="housing-property-input"]', 'Studio')
      typeInto(root, '[data-test-id="housing-amount-input"]', '400')
      submit(root, '[data-test-id="housing-submit-btn"]')
    },
    helper: 'apiPost',
    method: 'POST',
    url: '/api/housing',
  },
  {
    does: 'deletes a housing cost',
    page: 'housing',
    module: '../Housing',
    reads: '/api/housing',
    act: (root) => {
      click(root, '[data-test-id="housing-card-delete"]')
    },
    helper: 'apiDelete',
    method: 'DELETE',
    url: '/api/housing/1',
  },
  {
    does: 'edits a retirement goal',
    page: 'retirement',
    module: '../Retirement',
    reads: '/api/retirement-goals',
    act: async (root) => {
      click(root, '[data-test-id="retirement-goal-edit-btn"]')
      await settle()
      submit(root, '[data-test-id="retirement-modal-submit"]')
    },
    helper: 'apiPut',
    method: 'PUT',
    url: '/api/retirement-goals/1',
  },
  {
    does: 'deletes a retirement goal',
    page: 'retirement',
    module: '../Retirement',
    reads: '/api/retirement-goals',
    act: (root) => {
      click(root, '[data-test-id="retirement-goal-delete-btn"]')
    },
    helper: 'apiDelete',
    method: 'DELETE',
    url: '/api/retirement-goals/1',
  },
  {
    does: 'edits a goal',
    page: 'goals',
    module: '../Goals',
    reads: '/api/savings-goals',
    act: async (root) => {
      click(root, '[data-test-id="goal-edit-btn"]')
      await settle()
      submit(root, '[data-test-id="goals-modal-submit"]')
    },
    helper: 'apiPut',
    method: 'PUT',
    url: '/api/savings-goals/1',
  },
  {
    does: 'puts money towards a goal',
    page: 'goals',
    module: '../Goals',
    reads: '/api/savings-goals',
    act: async (root) => {
      click(root, '[data-test-id="goal-contribute-btn"]')
      await settle()
      typeInto(root, 'input[placeholder="Amount..."]', '50')
      clickText('Add')
    },
    helper: 'apiPost',
    method: 'POST',
    url: '/api/savings-goals/1/contribute',
  },
  {
    does: 'deletes a goal',
    page: 'goals',
    module: '../Goals',
    reads: '/api/savings-goals',
    act: (root) => {
      click(root, '[data-test-id="goal-delete-btn"]')
    },
    helper: 'apiDelete',
    method: 'DELETE',
    url: '/api/savings-goals/1',
  },
  {
    does: 'edits a bill',
    page: 'bills',
    module: '../Bills',
    reads: '/api/bills',
    act: async (root) => {
      click(root, '[data-test-id="bill-edit-btn"]')
      await settle()
      submit(root, '[data-test-id="bill-form-submit"]')
    },
    helper: 'apiPut',
    method: 'PUT',
    url: '/api/bills/1',
  },
  {
    does: 'marks a bill paid',
    page: 'bills',
    module: '../Bills',
    reads: '/api/bills',
    act: (root) => {
      click(root, '[data-test-id="bill-mark-paid-btn"]')
    },
    helper: 'apiPost',
    method: 'POST',
    url: '/api/bills/1/mark-paid',
  },
  {
    does: 'pauses a subscription',
    page: 'bills',
    module: '../Bills',
    reads: '/api/bills',
    act: (root) => subscriptionMenu(root, 'Pause'),
    helper: 'apiPut',
    method: 'PUT',
    url: '/api/bills/2',
  },
  {
    does: 'deletes a subscription',
    page: 'bills',
    module: '../Bills',
    reads: '/api/bills',
    act: (root) => subscriptionMenu(root, 'Delete'),
    helper: 'apiDelete',
    method: 'DELETE',
    url: '/api/bills/2',
  },
  {
    does: 'adds a subscription from the catalog',
    page: 'bills',
    module: '../Bills',
    reads: '/api/bills',
    act: async (root) => {
      click(root, '[data-test-id="bills-tab-subscriptions"]')
      await settle()
      click(root, '[data-test-id="browse-catalog-btn"]')
      await settle()
      typeInto(root, 'input[aria-label="Search the catalog"]', 'Netflix')
      await settle()
      const row = [...root.querySelectorAll<HTMLElement>('[role="button"]')].find((r) =>
        r.textContent?.includes('Netflix')
      )
      expect(row, 'the catalog offers no Netflix').toBeDefined()
      row!.click()
      await settle()
      clickText('Add 1')
    },
    helper: 'apiPost',
    method: 'POST',
    url: '/api/bills',
  },
]

describe.each(OWN_WRITES)(
  '$page, when the user $does',
  ({ page, module, reads: path, act, helper, method, url }) => {
    const write = WRITE_HELPERS[helper]
    const body = helper === 'apiDelete' ? [] : [expect.anything()]

    it('reloads once, through the counter the write bumps', async () => {
      const root = await mountPage(page, module)
      expect(readsOf(path)).toBe(1)

      nextWriteInvalidates(write, method)
      await act(root)
      await settle()

      expect(write).toHaveBeenCalledWith(url, ...body)
      // Two: the mount and the write's own bump. A third is a leftover manual reload.
      expect(readsOf(path)).toBe(2)
    })

    it('does not reload by hand: with the bump withheld, nothing reloads', async () => {
      const root = await mountPage(page, module)
      expect(readsOf(path)).toBe(1)

      // The mocked helper succeeds without bumping anything. The one reload above has to be the
      // counter's: a page that still reloads after its own write reads a second time here.
      await act(root)
      await settle()

      expect(write).toHaveBeenCalledWith(url, ...body)
      expect(readsOf(path)).toBe(1)
    })
  }
)

describe('writes that take more than one click', () => {
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

  it('leaves both reloads after paying from the calendar to the counter', async () => {
    setPeriod({ mode: 'month', year: 2026, month: 9, preset: 'all' })
    const root = await mountPage('bills', '../Bills')
    clickText('Calendar')
    await settle()
    root.querySelector<HTMLElement>('[role="button"]')!.click()
    await settle()

    // The mocked write succeeds without bumping anything, so any reload here is one by hand.
    clickText('Pay')
    await settle()

    expect(apiPost).toHaveBeenCalledWith('/api/bills/1/mark-paid', {})
    expect(readsOf('/api/bills/calendar')).toBe(1)
    expect(readsOf('/api/bills')).toBe(1)
  })
})

describe('the bill calendar', () => {
  async function openCalendar() {
    setPeriod({ mode: 'month', year: 2026, month: 9, preset: 'all' })
    const root = await mountPage('bills', '../Bills')
    const calendarTab = [...root.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === 'Calendar'
    )
    expect(calendarTab).toBeDefined()
    calendarTab!.click()
    await settle()
    expect(readsOf('/api/bills/calendar')).toBe(1)
  }

  it('refetches once when a bill is written elsewhere', async () => {
    await openCalendar()
    invalidateEntity('bills')
    await settle()
    expect(readsOf('/api/bills/calendar')).toBe(2)
  })

  it('refetches once when a category is written elsewhere', async () => {
    // Each bill on it carries its category's name and colour, joined on the server.
    await openCalendar()
    invalidateEntity('categories')
    await settle()
    expect(readsOf('/api/bills/calendar')).toBe(2)
  })
})
