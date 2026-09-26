import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '../api'
import { apiFetch } from '../apiFetch'

/**
 * Saving a new transaction reads the tags it was stored with before sending the form's, so a tag
 * an auto-apply rule attached on create is not replaced away. The page's tests mock this client,
 * so only the wire can show the read going to the wrong place — and a wrong URL would fail the
 * tags of every new row. Both runtimes serve GET /api/transactions/:id/tags for the active
 * profile, the one the row was written to.
 */

vi.mock('../apiFetch', () => ({ apiFetch: vi.fn() }))
const apiFetchMock = vi.mocked(apiFetch)

afterEach(() => {
  apiFetchMock.mockReset()
  localStorage.clear()
})

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })

describe("api.getTransactionTags — a row's stored tags", () => {
  it('reads GET /api/transactions/:id/tags for the active profile, and returns the tags', async () => {
    // Household view: reads may span profiles, but the row lives where writes go.
    localStorage.setItem('currentProfileId', '3')
    localStorage.setItem('selectedProfileIds', '[3,4]')
    apiFetchMock.mockResolvedValue(json([{ id: 8, name: 'Groceries', color: '#22c55e' }]))

    const tags = await api.getTransactionTags(12)

    expect(tags).toEqual([{ id: 8, name: 'Groceries', color: '#22c55e' }])
    const [url, init] = apiFetchMock.mock.calls[0]!
    expect(new URL(url, 'http://localhost').pathname).toBe('/api/transactions/12/tags')
    expect(init?.method).toBe('GET')
    const headers = init?.headers as Record<string, string>
    expect(headers['X-Profile-Id']).toBe('3')
    expect(headers['X-Profile-Ids']).toBeUndefined()
  })
})
