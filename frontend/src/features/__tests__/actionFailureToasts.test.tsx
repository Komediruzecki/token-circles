/**
 * What Goals, Bills, Budgets and Categories say when an action with no form in front of it fails.
 *
 * Each said "Failed to ..." whatever went wrong: a bill already paid in another tab, a goal or a
 * category deleted on another device, the server busy, the network down. Now each says the
 * answer's own words, and a plain sentence of its own for a failure that brought none
 * (plainMessage in core/apiError.ts).
 *
 * The pages run against the real local-first router on fake-indexeddb. A refusal that router gives
 * (a row deleted or paid elsewhere first) comes from it. A failure it cannot give, a server error,
 * no connection, or a TypeError from a bug, is answered at apiFetch in its place.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { GENERIC_ERROR } from '../../../../shared/genericError'
import { networkError, statusMessage, UNREACHABLE } from '../../core/apiError'
import * as fetching from '../../core/apiFetch'
import { setCurrentProfile, setPage, setProfiles } from '../../core/appStore'
import { confirmRequests, resolveConfirm } from '../../core/confirmStore'
import { __resetDataVersionsForTest } from '../../core/dataVersions'
import { setPeriod } from '../../core/periodStore'
import { getDB } from '../../core/storage/idb'
import * as localHandlers from '../../core/storage/localHandlers'
import { removeToast, toasts } from '../../core/toastStore'
import { defaultPeriod, localToday } from '../../utils/period'
import type { Component } from 'solid-js'

vi.mock('../../components/Chart', () => ({ default: () => null }))

const GROCERIES = 1
const SAVINGS = 1
const RENT = 1
const GYM = 2

/** What the Worker answers when D1 is briefly locked (worker/src/error-response.ts). */
const RETRY_SHORTLY = 'Service temporarily unavailable, please retry shortly.'

type Row = Record<string, unknown>
type Page = 'goals' | 'bills' | 'budgets' | 'categories'

const MODULES: Record<Page, string> = {
  goals: '../Goals',
  bills: '../Bills',
  budgets: '../Budgets',
  categories: '../Categories',
}

let host: HTMLDivElement
let dispose: (() => void) | undefined

beforeAll(async () => {
  // Paid here, not inside the first test's waitFor: the pages and the router `apiFetch` loads on
  // the first request are heavy imports, and a loaded machine made them outlast a timeout.
  await Promise.all([
    ...Object.values(MODULES).map((module) => import(/* @vite-ignore */ module)),
    import('../../core/storage/localApiRouter'),
  ])
}, 120_000)

beforeEach(async () => {
  localStorage.clear()
  localStorage.setItem('finance_storage_mode', 'serverless')
  localStorage.setItem('currentProfileId', '1')
  localStorage.setItem('localCurrency', 'EUR')
  __resetDataVersionsForTest()
  const db = await getDB()
  for (const store of Array.from(db.objectStoreNames)) await db.clear(store)
  await db.add('profiles', { id: 1, name: 'Me', created_at: '2026-01-01T00:00:00.000Z' })
  await db.put('settings', { key: 'currency', value: 'EUR' })
  await db.add('categories', {
    id: GROCERIES,
    profile_id: 1,
    name: 'Groceries',
    type: 'expense',
    color: '#59d2a2',
    icon: 'cart',
    parent_id: null,
    tax_deductible: false,
  } as never)
  await db.add('goals', {
    id: SAVINGS,
    profile_id: 1,
    name: 'Rainy Day',
    target_amount: 3000,
    current_amount: 500,
    category_id: null,
  } as never)
  await db.add('bills', bill({ id: RENT, name: 'Rent', amount: 900 }))
  await db.add(
    'bills',
    bill({ id: GYM, name: 'Gym', amount: 30, type: 'subscription', due_date: thisMonth(20) })
  )
  for (const toast of toasts()) removeToast(toast.id)

  setProfiles([{ id: 1, name: 'Me' }] as never)
  setCurrentProfile({ id: 1, name: 'Me' } as never)
  setPeriod(defaultPeriod())
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
  vi.spyOn(console, 'error').mockImplementation(() => {})
  host = document.createElement('div')
  document.body.appendChild(host)
})

afterEach(() => {
  dispose?.()
  dispose = undefined
  host.remove()
  setPeriod(defaultPeriod())
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/** This month's `day`, YYYY-MM-DD. */
const thisMonth = (day: number) => `${localToday().slice(0, 7)}-${String(day).padStart(2, '0')}`

/** A monthly bill as local-first stores one, due on the 15th of this month and not yet paid. */
function bill(fields: Row): never {
  return {
    profile_id: 1,
    due_date: thisMonth(15),
    day_of_month: null,
    frequency: 'monthly',
    category_id: null,
    account_id: null,
    notes: '',
    type: 'bill',
    autopay: 0,
    last_paid_date: null,
    next_due_date: null,
    recurring: 1,
    is_active: 1,
    created_at: '2026-01-01T00:00:00.000Z',
    ...fields,
  } as never
}

/** Changes a stored row behind the page's back, as another tab or device does. */
async function elsewhere(store: 'bills' | 'goals' | 'categories', id: number, change: Row | null) {
  const db = await getDB()
  if (change === null) {
    await db.delete(store, id)
    return
  }
  await db.put(store, { ...(await db.get(store, id)), ...change } as never)
}

/**
 * Answers `method path` with `answer` in place of the router; a throw is the request failing.
 * Every other request goes through to it.
 */
function answerInstead(method: string, path: string, answer: () => Response): void {
  const real = fetching.apiFetch
  vi.spyOn(fetching, 'apiFetch').mockImplementation(async (url, init) =>
    (init?.method ?? 'GET').toUpperCase() === method && url.split('?')[0] === path
      ? answer()
      : real(url, init)
  )
}

/** An answer with words of its own, as both runtimes give them: `{ error }`. */
const saying = (status: number, error: string) => () =>
  new Response(JSON.stringify({ error }), {
    status,
    headers: { 'content-type': 'application/json' },
  })

/** An answer with none: a gateway's HTML page. */
const bare = (status: number) => () =>
  new Response('<html><body>Bad gateway</body></html>', {
    status,
    headers: { 'content-type': 'text/html' },
  })

/** No answer at all: what apiFetch throws when the network is down. */
const unreachable = (): Response => {
  throw networkError(new TypeError('Failed to fetch'))
}

/** Not an answer: a bug's TypeError, whose words mean nothing to the person reading them. */
const bug = (): Response => {
  throw new TypeError("Cannot read properties of undefined (reading 'id')")
}

async function mount(page: Page, ready: () => boolean): Promise<void> {
  setPage(page)
  const { default: Page } = (await import(/* @vite-ignore */ MODULES[page])) as {
    default: Component
  }
  dispose = render(() => <Page />, host)
  await vi.waitFor(() => {
    expect(ready()).toBe(true)
  })
}

const button = (selector: string) => host.querySelector<HTMLButtonElement>(selector)

/** The button that reads `text`, anywhere in the document (menus render in a portal). */
const byText = (text: string | RegExp): HTMLButtonElement | undefined =>
  Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find((b) => {
    const said = b.textContent?.trim() ?? ''
    return typeof text === 'string' ? said === text : text.test(said)
  })

async function click(find: () => HTMLElement | null | undefined): Promise<void> {
  let el: HTMLElement | null | undefined
  await vi.waitFor(() => {
    el = find()
    expect(el).toBeTruthy()
  })
  el!.click()
}

/** Says yes to the confirmation the action asks for. */
async function confirm(): Promise<void> {
  await vi.waitFor(() => {
    expect(confirmRequests()).toHaveLength(1)
  })
  resolveConfirm(confirmRequests()[0]!.id, true)
}

/** The page said `message` as an error, and nothing else as one. */
async function saidOnly(message: string): Promise<void> {
  await vi.waitFor(() => {
    expect(
      toasts()
        .filter((t) => t.type === 'error')
        .map((t) => t.message)
    ).toEqual([message])
  })
}

/** The page said `message` as information, and said nothing else. */
async function toldOnly(message: string): Promise<void> {
  await vi.waitFor(() => {
    expect(toasts().map((t) => [t.type, t.message])).toEqual([['info', message]])
  })
}

describe('Goals, when an action fails', () => {
  const goalShown = () => host.querySelectorAll('[data-test-id="goal-card"]').length === 1
  const deleteGoal = async () => {
    await click(() => button('button[aria-label="Delete goal"]'))
    await confirm()
  }

  it('says why the goals did not load', async () => {
    answerInstead('GET', '/api/savings-goals', bare(502))
    await mount('goals', () => button('[data-test-id="add-goal-btn"]') !== null)

    await saidOnly(statusMessage(502))
  })

  it('says a plain sentence when loading fails with no words of its own', async () => {
    answerInstead('GET', '/api/savings-goals', bug)
    await mount('goals', () => button('[data-test-id="add-goal-btn"]') !== null)

    await saidOnly("Couldn't load your goals. Reload to try again.")
  })

  // Gone is what was asked, so the page says so, as Bills does, and drops the card. It said the
  // answer's words as an error, and the cloud's were "Not found".
  it('drops a goal deleted elsewhere first, and says it was already deleted', async () => {
    await mount('goals', goalShown)
    await elsewhere('goals', SAVINGS, null)
    await deleteGoal()

    await toldOnly('That goal was already deleted.')
    await vi.waitFor(() => {
      expect(host.querySelectorAll('[data-test-id="goal-card"]')).toHaveLength(0)
    })
  })

  it('says a plain sentence when deleting fails with no words of its own', async () => {
    await mount('goals', goalShown)
    answerInstead('DELETE', `/api/savings-goals/${SAVINGS}`, bug)
    await deleteGoal()

    await saidOnly("Couldn't delete the goal. Try again.")
  })

  it('never shows what a delete threw in local-first', async () => {
    await mount('goals', goalShown)
    // What IndexedDB throws when the connection closes under a write.
    vi.spyOn(localHandlers, 'goalsDelete').mockRejectedValue(
      new TypeError("Failed to execute 'transaction' on 'IDBDatabase': The database is closing.")
    )
    await deleteGoal()

    await saidOnly(GENERIC_ERROR)
    expect(toasts().map((t) => t.message)).not.toContainEqual(expect.stringContaining('IDB'))
  })
})

describe('Bills, when an action fails', () => {
  const billsShown = () => host.querySelectorAll('[data-test-id="bill-card"]').length > 0
  const deleteOffered = () => button('[data-test-id="bill-delete-btn"] button') !== null
  const subscriptionMenu = async (item: 'Pause' | 'Resume') => {
    await click(() => button('[data-test-id="bills-tab-subscriptions"]'))
    // A paused subscription is listed under the Paused filter only.
    if (item === 'Resume') {
      await click(() =>
        Array.from(host.querySelectorAll<HTMLButtonElement>('button[aria-pressed]')).find((b) =>
          b.textContent?.trim().startsWith('Paused')
        )
      )
    }
    await click(() => button('button[aria-label="More actions for Gym"]'))
    await click(() => byText(item))
  }
  const markRentPaid = () =>
    click(() =>
      Array.from(host.querySelectorAll<HTMLElement>('[data-test-id="bill-card"]'))
        .find((c) => c.textContent?.includes('Rent'))
        ?.querySelector<HTMLButtonElement>('[data-test-id="bill-mark-paid-btn"]')
    )
  const deleteRent = async () => {
    await click(() => button('[data-test-id="bill-delete-btn"] button'))
    await confirm()
  }
  /** Opens Rent's day, the 15th, on the calendar tab. */
  const openRentsDay = async () => {
    await click(() => byText('Calendar'))
    await click(() =>
      Array.from(host.querySelectorAll<HTMLElement>('[role="button"]')).find(
        (cell) => cell.querySelector('span')?.textContent === '15'
      )
    )
  }
  const payFromCalendar = () =>
    click(() =>
      Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(
        (b) =>
          b.textContent?.trim() === 'Pay' &&
          b.parentElement?.parentElement?.textContent?.includes('Rent')
      )
    )

  it('says a subscription deleted elsewhere first is not there, on pausing it', async () => {
    await mount('bills', billsShown)
    await elsewhere('bills', GYM, null)
    await subscriptionMenu('Pause')

    await saidOnly('Bill not found')
  })

  it('says a plain sentence when pausing fails with no words of its own', async () => {
    await mount('bills', billsShown)
    answerInstead('PUT', `/api/bills/${GYM}`, bug)
    await subscriptionMenu('Pause')

    await saidOnly("Couldn't pause the subscription. Try again.")
  })

  it('says a subscription deleted elsewhere first is not there, on resuming it', async () => {
    await elsewhere('bills', GYM, { is_active: 0 })
    await mount('bills', billsShown)
    await elsewhere('bills', GYM, null)
    await subscriptionMenu('Resume')

    await saidOnly('Bill not found')
  })

  it('says a plain sentence when resuming fails with no words of its own', async () => {
    await elsewhere('bills', GYM, { is_active: 0 })
    await mount('bills', billsShown)
    answerInstead('PUT', `/api/bills/${GYM}`, bug)
    await subscriptionMenu('Resume')

    await saidOnly("Couldn't resume the subscription. Try again.")
  })

  it('says a bill paid elsewhere first is paid already', async () => {
    await mount('bills', billsShown)
    await elsewhere('bills', RENT, { last_paid_date: localToday() })
    await markRentPaid()

    await saidOnly('Bill already paid for current period')
  })

  it('says a plain sentence when marking paid fails with no words of its own', async () => {
    await mount('bills', billsShown)
    answerInstead('POST', `/api/bills/${RENT}/mark-paid`, bug)
    await markRentPaid()

    await saidOnly("Couldn't mark the bill paid. Try again.")
  })

  it('says a bill paid elsewhere first is paid already, from the calendar', async () => {
    await mount('bills', billsShown)
    await openRentsDay()
    await elsewhere('bills', RENT, { last_paid_date: localToday() })
    await payFromCalendar()

    await saidOnly('Bill already paid for current period')
  })

  it('says a plain sentence when paying from the calendar fails with no words of its own', async () => {
    await mount('bills', billsShown)
    await openRentsDay()
    answerInstead('POST', `/api/bills/${RENT}/mark-paid`, bug)
    await payFromCalendar()

    await saidOnly("Couldn't mark the bill paid. Try again.")
  })

  it("says the server's words when deleting a bill fails", async () => {
    // Paid, so its card offers Delete.
    await elsewhere('bills', RENT, { last_paid_date: localToday() })
    await mount('bills', deleteOffered)
    answerInstead('DELETE', `/api/bills/${RENT}`, saying(503, RETRY_SHORTLY))
    await deleteRent()

    await saidOnly(RETRY_SHORTLY)
  })

  it('says a plain sentence when deleting fails with no words of its own', async () => {
    await elsewhere('bills', RENT, { last_paid_date: localToday() })
    await mount('bills', deleteOffered)
    answerInstead('DELETE', `/api/bills/${RENT}`, bug)
    await deleteRent()

    await saidOnly("Couldn't delete the bill. Try again.")
  })
})

describe('Budgets, when an action fails', () => {
  const budgetsShown = () =>
    host.textContent.includes('Groceries') &&
    button('[data-test-id="budgets-add-allocation-btn"]')?.disabled === false
  const copyLastMonth = () => click(() => byText(/^Copy .+ Budgets$/))
  const backfill = async () => {
    await click(() => byText('Backfill from Spending'))
    await confirm()
  }
  const deleteCategory = async () => {
    await click(() => button('button[aria-label="Delete category"]'))
    await confirm()
  }

  it("says the server's words when copying last month's budgets fails", async () => {
    await mount('budgets', budgetsShown)
    answerInstead('POST', '/api/budgets/duplicate-last', saying(503, RETRY_SHORTLY))
    await copyLastMonth()

    await saidOnly(RETRY_SHORTLY)
  })

  it('says a plain sentence when copying fails with no words of its own', async () => {
    await mount('budgets', budgetsShown)
    answerInstead('POST', '/api/budgets/duplicate-last', bug)
    await copyLastMonth()

    await saidOnly("Couldn't copy last month's budgets. Try again.")
  })

  it('says the network is down when backfilling cannot reach the server', async () => {
    await mount('budgets', budgetsShown)
    answerInstead('POST', '/api/budgets/backfill-from-spending', unreachable)
    await backfill()

    await saidOnly(UNREACHABLE)
  })

  it('says a plain sentence when backfilling fails with no words of its own', async () => {
    await mount('budgets', budgetsShown)
    answerInstead('POST', '/api/budgets/backfill-from-spending', bug)
    await backfill()

    await saidOnly("Couldn't backfill budgets from your spending. Try again.")
  })

  // Gone is what was asked, so the page says so and drops the row, as Bills does for a bill. It
  // said the answer's words as an error, and the cloud's are a bare "Not found".
  it('drops a category deleted elsewhere first, and says it was already deleted', async () => {
    await mount('budgets', budgetsShown)
    await elsewhere('categories', GROCERIES, null)
    await deleteCategory()

    await toldOnly('That category was already deleted.')
    await vi.waitFor(() => {
      expect(button('button[aria-label="Delete category"]')).toBeNull()
    })
  })

  it("never shows the cloud's bare words for a category deleted elsewhere", async () => {
    await mount('budgets', budgetsShown)
    answerInstead('DELETE', `/api/categories/${GROCERIES}`, saying(404, 'Not found'))
    await deleteCategory()

    await toldOnly('That category was already deleted.')
  })

  it('says a plain sentence when deleting a category fails with no words of its own', async () => {
    await mount('budgets', budgetsShown)
    answerInstead('DELETE', `/api/categories/${GROCERIES}`, bug)
    await deleteCategory()

    await saidOnly("Couldn't delete the category. Try again.")
  })
})

describe('Categories, when deleting one fails', () => {
  const categoriesShown = () => host.textContent.includes('Groceries')
  const deleteCategory = async () => {
    await click(() => button('button[aria-label="Delete category"]'))
    await confirm()
  }

  it('drops a category deleted elsewhere first, and says it was already deleted', async () => {
    await mount('categories', categoriesShown)
    await elsewhere('categories', GROCERIES, null)
    await deleteCategory()

    await toldOnly('That category was already deleted.')
    await vi.waitFor(() => {
      expect(button('button[aria-label="Delete category"]')).toBeNull()
    })
  })

  it("never shows the cloud's bare words for a category deleted elsewhere", async () => {
    await mount('categories', categoriesShown)
    answerInstead('DELETE', `/api/categories/${GROCERIES}`, saying(404, 'Not found'))
    await deleteCategory()

    await toldOnly('That category was already deleted.')
  })

  it('says a plain sentence when deleting fails with no words of its own', async () => {
    await mount('categories', categoriesShown)
    answerInstead('DELETE', `/api/categories/${GROCERIES}`, bug)
    await deleteCategory()

    await saidOnly("Couldn't delete the category. Try again.")
  })
})
