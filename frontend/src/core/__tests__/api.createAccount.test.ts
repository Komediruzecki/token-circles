import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '../api'
import { apiFetch } from '../apiFetch'

// Regression guard. ApiClient.request() validates responses with the passed Zod schema.
// POST /accounts returns { id, message } (NOT a full account); validating that against
// AccountSchema threw *after* the row was created, surfacing a false "Failed to create
// account" error while the account existed. The fix validates the real shape.
vi.mock('../apiFetch', () => ({ apiFetch: vi.fn() }))
const apiFetchMock = vi.mocked(apiFetch)

afterEach(() => {
  apiFetchMock.mockReset()
})

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('api.createAccount', () => {
  it('resolves to { id } from a { id, message } response without throwing', async () => {
    apiFetchMock.mockResolvedValue(jsonResponse({ id: 42, message: 'Account created' }))
    const res = await api.createAccount({
      name: 'Cash',
      type: 'cash',
      currency: 'EUR',
      balance: 0,
    } as unknown as Parameters<typeof api.createAccount>[0])
    expect(res).toEqual({ id: 42 })
    expect(apiFetchMock).toHaveBeenCalledOnce()
  })

  it('rejects on a non-2xx response', async () => {
    apiFetchMock.mockResolvedValue(jsonResponse({ error: 'Name is required' }, 400))
    await expect(
      api.createAccount({
        name: '',
        type: 'cash',
        currency: 'EUR',
        balance: 0,
      } as unknown as Parameters<typeof api.createAccount>[0])
    ).rejects.toThrow()
  })
})
