import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api, apiGet, apiHouseholdGet } from '../api'
import { apiFetch } from '../apiFetch'
import { activeProfileId, householdProfileIds, profileRequestHeaders } from '../apiProfileScope'

vi.mock('../apiFetch', () => ({ apiFetch: vi.fn() }))
const apiFetchMock = vi.mocked(apiFetch)

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function headersForCall(index: number): Headers {
  const init = apiFetchMock.mock.calls[index]?.[1]
  return new Headers(init?.headers)
}

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('currentProfileId', '2')
  localStorage.setItem('selectedProfileIds', '[2,3]')
  apiFetchMock.mockReset()
  apiFetchMock.mockResolvedValue(jsonResponse({}))
})

describe('profile request scopes', () => {
  it('sanitizes stored profile ids and falls back to the active profile', () => {
    expect(activeProfileId()).toBe(2)
    expect(householdProfileIds()).toEqual([2, 3])

    localStorage.setItem('selectedProfileIds', '[3,"3",0,-1,"bad"]')
    expect(householdProfileIds()).toEqual([3])

    localStorage.setItem('selectedProfileIds', 'not-json')
    expect(householdProfileIds()).toEqual([2])
  })

  it('keeps active writes free of household headers', () => {
    expect(profileRequestHeaders('active')).toEqual({ 'X-Profile-Id': '2' })
    expect(profileRequestHeaders('household')).toEqual({
      'X-Profile-Id': '2',
      'X-Profile-Ids': '[2,3]',
    })
    expect(profileRequestHeaders('none')).toEqual({})
  })

  it('makes standalone read scope explicit', async () => {
    apiFetchMock.mockResolvedValueOnce(jsonResponse([])).mockResolvedValueOnce(jsonResponse([]))

    await apiGet('/api/categories')
    await apiHouseholdGet('/api/categories')

    expect(headersForCall(0).get('X-Profile-Id')).toBe('2')
    expect(headersForCall(0).has('X-Profile-Ids')).toBe(false)
    expect(headersForCall(1).get('X-Profile-Ids')).toBe('[2,3]')
  })

  it('uses immutable household snapshots for aggregates and active scope for mutations', async () => {
    apiFetchMock
      .mockResolvedValueOnce(jsonResponse({}))
      .mockResolvedValueOnce(jsonResponse({ id: 41 }))
      .mockResolvedValueOnce(
        jsonResponse({
          reconciled_count: 0,
          unreconciled_count: 0,
          reconciled_total: 0,
          unreconciled_total: 0,
        })
      )

    await api.getDashboard()
    localStorage.setItem('currentProfileId', '3')
    localStorage.setItem('selectedProfileIds', '[3]')
    await api.createAccount({
      name: 'Cash',
      type: 'cash',
      currency: 'EUR',
      balance: 0,
    } as Parameters<typeof api.createAccount>[0])
    await api.getReconciliationSummary()

    expect(headersForCall(0).get('X-Profile-Id')).toBe('2')
    expect(headersForCall(0).get('X-Profile-Ids')).toBe('[2,3]')
    expect(headersForCall(1).get('X-Profile-Id')).toBe('3')
    expect(headersForCall(1).has('X-Profile-Ids')).toBe(false)
    expect(headersForCall(2).get('X-Profile-Id')).toBe('3')
    expect(headersForCall(2).has('X-Profile-Ids')).toBe(false)
  })
})
