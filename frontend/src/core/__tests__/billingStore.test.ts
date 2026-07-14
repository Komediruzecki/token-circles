import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiFetch } from '../apiFetch'
import { emailAlertsLocked, loadBillingPlan, receiptsLocked, setCurrentPlan } from '../billingStore'

vi.mock('../apiFetch', () => ({ apiFetch: vi.fn() }))
const apiFetchMock = vi.mocked(apiFetch)

afterEach(() => {
  apiFetchMock.mockReset()
  setCurrentPlan(null) // reset to "unknown" between tests
})

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('billingStore gating', () => {
  it('fails open: locks nothing while the plan is unknown', () => {
    setCurrentPlan(null)
    expect(receiptsLocked()).toBe(false)
    expect(emailAlertsLocked()).toBe(false)
  })

  it('locks premium controls only when the plan is known Free', () => {
    setCurrentPlan('free')
    expect(receiptsLocked()).toBe(true)
    expect(emailAlertsLocked()).toBe(true)
  })

  it('never locks a paid tier (incl. the legacy "premium" alias)', () => {
    for (const paid of ['basic', 'advanced', 'ultimate', 'premium']) {
      setCurrentPlan(paid)
      expect(receiptsLocked()).toBe(false)
      expect(emailAlertsLocked()).toBe(false)
    }
  })

  it('loadBillingPlan locks when the server reports Free', async () => {
    apiFetchMock.mockResolvedValue(jsonResponse({ plan: 'free' }))
    await loadBillingPlan()
    expect(receiptsLocked()).toBe(true)
  })

  it('loadBillingPlan leaves the plan unknown on a failed request (fail open)', async () => {
    apiFetchMock.mockResolvedValue(jsonResponse({ error: 'unauthorized' }, 401))
    await loadBillingPlan()
    expect(receiptsLocked()).toBe(false)
    expect(emailAlertsLocked()).toBe(false)
  })
})
