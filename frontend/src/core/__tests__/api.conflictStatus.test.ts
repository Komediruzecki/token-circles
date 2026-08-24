/**
 * A refusal the caller can act on.
 *
 * The Worker answers a stale edit or delete with 409 and a message saying the row moved. Thrown
 * as a bare Error, that is indistinguishable from any other failure, so the only thing a caller
 * could do with it was log it — which is what the transactions form did, leaving Save looking
 * like it had done nothing. The status rides along on the error now, so "someone else changed
 * this, catch up" can be told apart from "that did not work".
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, apiPut, errorStatus } from '../api'
import { apiFetch } from '../apiFetch'

vi.mock('../apiFetch', () => ({ apiFetch: vi.fn() }))
const apiFetchMock = vi.mocked(apiFetch)

afterEach(() => {
  apiFetchMock.mockReset()
})

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const CONFLICT = 'This transaction was changed on another device. Reload and try again.'

describe('a 409 from the API', () => {
  it('reaches the caller with its status and the server’s wording', async () => {
    apiFetchMock.mockResolvedValue(jsonResponse({ error: CONFLICT }, 409))

    const error = await api.updateTransaction(1, { amount: 5 }).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe(CONFLICT)
    expect(errorStatus(error)).toBe(409)
  })

  it('is distinguishable from an ordinary failure', async () => {
    apiFetchMock.mockResolvedValue(jsonResponse({ error: 'Not found' }, 404))

    const error = await api.deleteTransaction(1).catch((e: unknown) => e)

    expect(errorStatus(error)).toBe(404)
    expect(errorStatus(error)).not.toBe(409)
  })

  it('carries the status through the plain helpers too', async () => {
    apiFetchMock.mockResolvedValue(jsonResponse({ error: CONFLICT }, 409))

    const error = await apiPut('/api/transactions/1', { amount: 5 }).catch((e: unknown) => e)

    expect(errorStatus(error)).toBe(409)
    expect((error as Error).message).toBe(CONFLICT)
  })

  it('reports nothing for an error that never came from a response', () => {
    expect(errorStatus(new Error('offline'))).toBeUndefined()
    expect(errorStatus(null)).toBeUndefined()
  })
})
