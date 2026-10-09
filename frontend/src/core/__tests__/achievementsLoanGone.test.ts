/**
 * Achievements list the profile's loans, then read each one for its rate periods and extra
 * payments. A loan deleted in between, in another tab or by another E2E test on the same account,
 * answers that read with a 404. It was never counted, but the typed client logged the 404 as an
 * API error, so the page's console showed one, and loan-form-errors.spec.ts failed on it now and
 * then. A loan that is gone while counting is simply not counted, and its 404 is no error.
 *
 * The real ApiClient, against the real local-first router on fake-indexeddb.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { refreshAchievements, unlocks } from '../achievementsStore'
import { api } from '../api'
import { ApiError } from '../apiError'
import * as fetching from '../apiFetch'
import { getDB } from '../storage/idb'

const LOAN = 7

beforeAll(async () => {
  // The router `apiFetch` loads on the first request is a heavy import: paid here, not inside the
  // first test's timeout.
  await import('../storage/localApiRouter')
}, 120_000)

beforeEach(async () => {
  localStorage.clear()
  localStorage.setItem('finance_storage_mode', 'serverless')
  localStorage.setItem('currentProfileId', '1')
  const db = await getDB()
  for (const store of Array.from(db.objectStoreNames)) await db.clear(store)
  await db.add('profiles', { id: 1, name: 'Me', created_at: '2026-01-01T00:00:00.000Z' })
  // Paid off long ago, so counted it earns "debt free".
  await db.add('loans', {
    id: LOAN,
    profile_id: 1,
    name: 'Car',
    principal: 12000,
    interest_rate: 5,
    start_date: '2020-01-01',
    term_months: 24,
    rate_periods: [],
    prepayments: [],
  } as never)
})

afterEach(() => {
  vi.restoreAllMocks()
})

/** Deletes the loan once the list that names it has been read, as another tab would. */
function deleteTheLoanAfterTheList(): void {
  const real = fetching.apiFetch
  vi.spyOn(fetching, 'apiFetch').mockImplementation(async (url, init) => {
    const answer = await real(url, init)
    if ((init?.method ?? 'GET') === 'GET' && url.split('?')[0] === '/api/loans') {
      await (await getDB()).delete('loans', LOAN)
    }
    return answer
  })
}

describe('achievements, with a loan deleted while they count', () => {
  it('do not count it, and log no error for it', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    deleteTheLoanAfterTheList()

    await refreshAchievements()

    expect(unlocks().map((u) => u.id)).not.toContain('debt-free')
    const said = errors.mock.calls.map((call) =>
      call.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' ')
    )
    expect(said).toEqual([])
  })

  it('count it while it is there', async () => {
    await refreshAchievements()

    expect(unlocks().map((u) => u.id)).toContain('debt-free')
  })
})

// The quiet is only for the status a read names, on the read that names it. A test that only
// counts what is not logged passes as well when nothing at all is logged.
describe('a read that expects a 404', () => {
  /** Answers every request with `status` and `error`, in place of the router. */
  const answering = (status: number, error: string) =>
    vi.spyOn(fetching, 'apiFetch').mockImplementation(
      async () =>
        new Response(JSON.stringify({ error }), {
          status,
          headers: { 'content-type': 'application/json' },
        })
    )

  /** The typed client's error lines in the console. */
  function apiErrorsLogged(): string[] {
    const errors = vi.mocked(console.error).mock.calls
    return errors.map((call) => call.map(String).join(' ')).filter((l) => l.includes('API Error'))
  }

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('still logs a server error', async () => {
    answering(500, 'Something went wrong on our side. Try again in a moment.')

    await expect(api.getLoan(LOAN, { expectedStatuses: [404] })).rejects.toBeInstanceOf(ApiError)

    expect(apiErrorsLogged()).toHaveLength(1)
  })

  it('is the only read whose 404 is not logged', async () => {
    answering(404, 'Loan not found')

    await expect(api.getLoan(LOAN)).rejects.toBeInstanceOf(ApiError)

    expect(apiErrorsLogged()).toHaveLength(1)
  })
})
