/**
 * Local-first answers a failure nobody wrote words for as the Worker does: with the generic
 * sentence (shared/genericError.ts), and the original in the console.
 *
 * The router answered a handler that threw with the exception's own text, and many handlers
 * answer their own catch with it, so a toast read "Failed to execute 'transaction' on
 * 'IDBDatabase': The database connection is closing." The Worker never sends such text
 * (worker/src/error-response.ts). A refusal meant for a person is a 4xx, and passes as it is.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GENERIC_ERROR } from '../../../../../shared/genericError'
import { routeApiRequest } from '../localApiRouter'
import * as handlers from '../localHandlers'

const IDB_CLOSING =
  "Failed to execute 'transaction' on 'IDBDatabase': The database connection is closing."

const answer = (status: number, error: string) =>
  new Response(JSON.stringify({ error }), {
    status,
    headers: { 'content-type': 'application/json' },
  })

/** Makes the goal delete handler do `act` in place of its work. */
function goalsDeleteDoes(act: () => Promise<Response>) {
  vi.spyOn(handlers, 'goalsDelete').mockImplementation(act)
}

const deleteGoal = () =>
  routeApiRequest('http://localhost/api/savings-goals/7', { method: 'DELETE' })

let logged: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  localStorage.setItem('finance_storage_mode', 'serverless')
  logged = vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
})

/** Every console.error call, its arguments as one line. */
const lines = () =>
  logged.mock.calls.map((call: unknown[]) =>
    call.map((arg) => (arg instanceof Error ? String(arg) : JSON.stringify(arg))).join(' ')
  )

describe('a failure nobody wrote words for, in local-first', () => {
  it('a handler that throws answers 500 and the generic sentence, and logs what it threw', async () => {
    goalsDeleteDoes(() => Promise.reject(new TypeError(IDB_CLOSING)))

    const res = await deleteGoal()

    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: GENERIC_ERROR })
    expect(lines()).toHaveLength(1)
    expect(lines()[0]).toContain('DELETE')
    expect(lines()[0]).toContain('/api/savings-goals/7')
    expect(lines()[0]).toContain(IDB_CLOSING)
  })

  it("a handler's own 500 with an exception's text answers the generic sentence", async () => {
    goalsDeleteDoes(() =>
      Promise.resolve(answer(500, "Cannot read properties of undefined (reading 'profile_id')"))
    )

    const res = await deleteGoal()

    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: GENERIC_ERROR })
    expect(lines()).toHaveLength(1)
    expect(lines()[0]).toContain('/api/savings-goals/7')
    expect(lines()[0]).toContain("reading 'profile_id'")
  })

  it('any status from 500 up keeps its status and says the generic sentence', async () => {
    goalsDeleteDoes(() => Promise.resolve(answer(502, 'Failed to fetch')))

    const res = await deleteGoal()

    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: GENERIC_ERROR })
  })

  it('a refusal meant for a person passes as it is, and is not logged', async () => {
    goalsDeleteDoes(() => Promise.resolve(answer(404, 'Goal not found')))

    const res = await deleteGoal()

    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Goal not found' })
    expect(lines()).toEqual([])
  })
})
