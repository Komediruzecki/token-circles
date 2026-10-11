/**
 * Signed in, the guided tours a person finished belong to the account (`tours` in
 * `/api/account/state`), so the tour menu shows them as done on every device. Local-first keeps
 * them in this browser, as before.
 *
 * Against a stand-in for the Worker that reads and stores the list with the Worker's own rules
 * (shared/accountState.ts, readUserStateValue and applyUserStateWrite), because that is the network.
 */
import { createMemo, createRoot } from 'solid-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  applyUserStateWrite,
  readUserStateValue,
  sqliteDateTime,
} from '../../../../shared/accountState'
import { __resetAccountStateForTest, setAccountStateOwner } from '../accountState'
import {
  endSpotlight,
  getCompletedCount,
  isTourCompleted,
  loadAccountTours,
  resetAllTours,
  SPOTLIGHT_TOURS,
  startFullTour,
  startTour,
  toursWriteSettled,
} from '../spotlightStore'

const BROWSER_TOURS = 'finance_spotlight_tours'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/**
 * The Worker: the signed-in account's stored list, and every request it was sent. The list is
 * what the row holds, which another build may have written in a shape this one reads in part or
 * not at all.
 */
const worker = {
  tours: null as { seen: unknown } | null,
  failRead: false,
  sent: [] as string[],
}

/** The row's text, as the Worker reads it. */
const stored = (): string | null => (worker.tours === null ? null : JSON.stringify(worker.tours))

function workerStandIn() {
  return async (url: string, init: RequestInit = {}) => {
    const path = new URL(url, 'http://localhost').pathname
    const method = (init.method ?? 'GET').toUpperCase()
    const body = typeof init.body === 'string' ? init.body : ''
    worker.sent.push(`${method} ${path}${body ? ` ${body}` : ''}`)
    if (path === '/api/account/state' && method === 'GET') {
      if (worker.failRead) return json({ error: 'Something went wrong on our side.' }, 500)
      return json({
        onboarding: null,
        tours: readUserStateValue('tours', stored()),
        getting_started: null,
      })
    }
    if (path === '/api/account/state/tours' && method === 'PUT') {
      const write = applyUserStateWrite(
        'tours',
        JSON.parse(body) as unknown,
        stored(),
        sqliteDateTime(new Date())
      )
      if (!write.ok && 'unreadable' in write) return json({ error: 'Left as it is.' }, 409)
      if (!write.ok) return json({ error: 'Check the fields.', fields: write.fields }, 400)
      if (write.changed) worker.tours = write.value
      return json({ tours: write.value })
    }
    return json([])
  }
}

const tourPuts = () => worker.sent.filter((r) => r.startsWith('PUT /api/account/state/tours'))

/** A page load signed in as an account: nothing read yet. */
function signedIn(): void {
  __resetAccountStateForTest()
  setAccountStateOwner('account-5')
}

function finish(tourId: string): void {
  startTour(tourId)
  endSpotlight()
}

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('finance_storage_mode', 'self-hosted')
  worker.tours = null
  worker.failRead = false
  worker.sent.length = 0
  vi.stubGlobal('fetch', workerStandIn())
  signedIn()
})

afterEach(async () => {
  await toursWriteSettled()
  vi.unstubAllGlobals()
  __resetAccountStateForTest()
  localStorage.clear()
})

describe('signed in, the tours finished', () => {
  it('are kept on the account, and show as done on another browser', async () => {
    await loadAccountTours()
    finish('dashboard')
    finish('loans')
    await toursWriteSettled()

    expect(worker.tours).toEqual({ seen: ['dashboard', 'loans'] })
    expect(localStorage.getItem(BROWSER_TOURS)).toBeNull()

    // Another browser: nothing stored here but the mode, the same account.
    localStorage.clear()
    localStorage.setItem('finance_storage_mode', 'self-hosted')
    signedIn()
    expect(isTourCompleted('dashboard')).toBe(false)
    await loadAccountTours()
    expect(isTourCompleted('dashboard')).toBe(true)
    expect(isTourCompleted('loans')).toBe(true)
    expect(isTourCompleted('budgets')).toBe(false)
    expect(getCompletedCount()).toBe(2)
  })

  it('are all of them after the full tour', async () => {
    startFullTour()
    endSpotlight()
    await toursWriteSettled()

    expect(worker.tours?.seen).toEqual(SPOTLIGHT_TOURS.map((tour) => tour.id))
    expect(getCompletedCount()).toBe(SPOTLIGHT_TOURS.length)
  })

  it('are none after Reset All Tours', async () => {
    worker.tours = { seen: ['dashboard', 'import'] }
    await loadAccountTours()

    resetAllTours()
    await toursWriteSettled()

    expect(worker.tours).toEqual({ seen: [] })
    expect(getCompletedCount()).toBe(0)
  })

  it('keep a tour finished before the list was read', async () => {
    // Ended before anything asked for the list: the write reads it first.
    worker.tours = { seen: ['import'] }
    finish('dashboard')
    await toursWriteSettled()

    expect(worker.tours).toEqual({ seen: ['import', 'dashboard'] })
  })

  it('update the tour menu as the list arrives', async () => {
    worker.tours = { seen: ['dashboard', 'import', 'loans'] }
    await createRoot(async (dispose) => {
      const count = createMemo(() => getCompletedCount())
      expect(count()).toBe(0)
      await loadAccountTours()
      expect(count()).toBe(3)
      dispose()
    })
  })
})

describe("this browser's own list", () => {
  it('goes to an account that has none yet, once, and stays for local-first', async () => {
    // With a key no tour has, and a tour not finished: neither goes.
    const here = { dashboard: true, 'Old Tour': true, budgets: false, loans: true }
    localStorage.setItem(BROWSER_TOURS, JSON.stringify(here))

    await loadAccountTours()
    await toursWriteSettled()
    expect(tourPuts()).toEqual(['PUT /api/account/state/tours {"seen":["dashboard","loans"]}'])
    expect(isTourCompleted('loans')).toBe(true)

    signedIn()
    await loadAccountTours()
    await toursWriteSettled()
    expect(tourPuts()).toHaveLength(1)
    expect(localStorage.getItem(BROWSER_TOURS)).toBe(JSON.stringify(here))
  })

  it('is not read for an account that has a list of its own', async () => {
    worker.tours = { seen: ['import'] }
    localStorage.setItem(BROWSER_TOURS, JSON.stringify({ dashboard: true }))

    await loadAccountTours()
    await toursWriteSettled()

    expect(tourPuts()).toEqual([])
    expect(isTourCompleted('dashboard')).toBe(false)
    expect(isTourCompleted('import')).toBe(true)
  })
})

describe('when the list cannot be read', () => {
  it('sends nothing, and shows no tour as done', async () => {
    worker.failRead = true
    localStorage.setItem(BROWSER_TOURS, JSON.stringify({ dashboard: true }))

    await loadAccountTours()
    finish('loans')
    await toursWriteSettled()

    expect(tourPuts()).toEqual([])
    expect(isTourCompleted('dashboard')).toBe(false)
  })
})

describe('a list another build wrote', () => {
  it('keeps the tours it can read when one id is not well formed', async () => {
    // One id longer than this build's rule allows.
    worker.tours = { seen: ['dashboard', 'a-tour-id-that-is-longer-than-forty-characters'] }
    await loadAccountTours()
    expect(isTourCompleted('dashboard')).toBe(true)

    finish('loans')
    await toursWriteSettled()
    expect(worker.tours).toEqual({ seen: ['dashboard', 'loans'] })
  })

  it('is never replaced when it cannot be read: the writes are refused, and nothing shows as done', async () => {
    worker.tours = { seen: 'dashboard' }
    localStorage.setItem(BROWSER_TOURS, JSON.stringify({ import: true }))

    await loadAccountTours()
    finish('loans')
    await toursWriteSettled()

    expect(worker.tours).toEqual({ seen: 'dashboard' })
    expect(isTourCompleted('loans')).toBe(false)
    expect(isTourCompleted('import')).toBe(false)
  })
})

describe('local-first', () => {
  it('keeps the tours in this browser and never calls the route', async () => {
    __resetAccountStateForTest()
    setAccountStateOwner('local')

    await loadAccountTours()
    finish('dashboard')
    await toursWriteSettled()
    expect(isTourCompleted('dashboard')).toBe(true)
    expect(JSON.parse(localStorage.getItem(BROWSER_TOURS) ?? '{}')).toEqual({ dashboard: true })

    resetAllTours()
    expect(localStorage.getItem(BROWSER_TOURS)).toBeNull()
    expect(worker.sent.filter((r) => r.includes('/api/account/state'))).toEqual([])
  })
})
