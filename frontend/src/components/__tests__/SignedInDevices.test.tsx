/**
 * SignedInDevices — the list is the whole truth (you are in it, flagged), one row ends exactly
 * one session, and the timestamps are read as the UTC the server actually wrote.
 */
/* eslint-disable sonarjs/no-hardcoded-ip -- fixture addresses, nothing connects to them */
import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let host: HTMLDivElement
let dispose: (() => void) | undefined
const toasts: { message: string; type: string }[] = []
const requests: { url: string; method: string }[] = []
let confirmAnswer = true
let sessionsResponse: () => Promise<Response> = () => Promise.resolve(json({ sessions: [] }))
let mutationResponse: () => Promise<Response> = () => Promise.resolve(json({ ok: true }))
let reloads = 0

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const LAPTOP = {
  id: 'sid-laptop',
  device: 'Chrome on Linux',
  provider: 'password',
  ip: '1.2.3.4',
  created_at: '2026-08-20 09:00:00',
  last_seen_at: '2026-08-24 01:00:00',
  current: true,
}
const PHONE = {
  id: 'sid-phone',
  device: 'Safari on iPhone',
  provider: 'google',
  ip: '5.6.7.8',
  created_at: '2026-08-21 09:00:00',
  last_seen_at: '2026-08-23 22:00:00',
  current: false,
}

async function mount() {
  vi.resetModules()
  vi.doMock('../../core/api', () => ({
    toast: (message: string, type = 'info') => toasts.push({ message, type }),
  }))
  vi.doMock('../../core/apiFetch', () => ({
    apiFetch: (url: string, init?: RequestInit) => {
      requests.push({ url, method: init?.method ?? 'GET' })
      return url === '/api/auth/sessions' && (init?.method ?? 'GET') === 'GET'
        ? sessionsResponse()
        : mutationResponse()
    },
  }))
  vi.doMock('../../core/confirmStore', () => ({
    showConfirm: () => Promise.resolve(confirmAnswer),
  }))
  const { SignedInDevices } = await import('../SignedInDevices')
  host = document.createElement('div')
  document.body.appendChild(host)
  dispose = render(() => <SignedInDevices />, host)
  await flush()
}

// A fixed number of microtask ticks was enough on this machine and not on CI's, where the retry
// test went red at "expected 1 row, got 0" — the second fetch simply had not resolved yet. Drain
// the microtask queue AND yield a macrotask, and let the assertions that follow a round-trip use
// vi.waitFor rather than assuming a tick count.
const flush = async () => {
  for (let i = 0; i < 6; i += 1) await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
}
const rows = () => [...host.querySelectorAll('[data-test-id="device-row"]')]
const signOutButtons = () => [
  ...host.querySelectorAll<HTMLButtonElement>('[data-test-id="device-signout"]'),
]

beforeEach(() => {
  toasts.length = 0
  requests.length = 0
  confirmAnswer = true
  reloads = 0
  sessionsResponse = () => Promise.resolve(json({ sessions: [LAPTOP, PHONE] }))
  mutationResponse = () => Promise.resolve(json({ ok: true }))
  vi.stubGlobal('location', { reload: () => (reloads += 1) } as unknown as Location)
})

afterEach(() => {
  dispose?.()
  dispose = undefined
  host?.remove()
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('the device list', () => {
  it('shows every session, with the one you are using marked', async () => {
    await mount()

    expect(rows()).toHaveLength(2)
    expect(host.textContent).toContain('Chrome on Linux')
    expect(host.textContent).toContain('Safari on iPhone')
    expect(host.querySelectorAll('[data-test-id="device-current"]')).toHaveLength(1)
    expect(rows()[0]!.textContent).toContain('This device')
  })

  it('says the provider and address, so a row you do not recognise is identifiable', async () => {
    await mount()

    expect(rows()[1]!.textContent).toContain('Google account')
    expect(rows()[1]!.textContent).toContain('5.6.7.8')
  })

  it('offers a retry instead of an empty list when the fetch fails', async () => {
    sessionsResponse = () => Promise.resolve(json({ error: 'nope' }, 500))
    await mount()

    expect(host.querySelector('[data-test-id="devices-error"]')).not.toBeNull()
    expect(rows()).toHaveLength(0)

    sessionsResponse = () => Promise.resolve(json({ sessions: [LAPTOP] }))
    host.querySelector<HTMLButtonElement>('button')!.click()

    await vi.waitFor(() => {
      expect(rows()).toHaveLength(1)
    })
  })

  it('explains an empty list rather than implying you are signed in nowhere', async () => {
    sessionsResponse = () => Promise.resolve(json({ sessions: [] }))
    await mount()

    expect(host.querySelector('[data-test-id="devices-empty"]')).not.toBeNull()
  })
})

describe('ending one device', () => {
  it('deletes only that session and leaves the rest of the list standing', async () => {
    await mount()

    signOutButtons()[1]!.click()
    await flush()

    expect(requests).toContainEqual({ url: '/api/auth/sessions/sid-phone', method: 'DELETE' })
    expect(rows()).toHaveLength(1)
    expect(host.textContent).not.toContain('Safari on iPhone')
    expect(reloads).toBe(0)
  })

  it('does nothing at all when the confirm is declined', async () => {
    confirmAnswer = false
    await mount()

    signOutButtons()[1]!.click()
    await flush()

    expect(requests.filter((r) => r.method === 'DELETE')).toHaveLength(0)
    expect(rows()).toHaveLength(2)
  })

  it('reloads when you end the session you are using, since the cookie went with it', async () => {
    await mount()

    signOutButtons()[0]!.click()
    await flush()

    expect(reloads).toBe(1)
    // and nothing else: the page is on its way out, so quietly rewriting the list underneath it
    // and toasting "signed out of Chrome on Linux" at someone who is being sent to the login
    // screen is a flash of wrong UI, not feedback.
    expect(rows()).toHaveLength(2)
    expect(toasts).toEqual([])
  })

  it('keeps the row and says so when the server refuses', async () => {
    mutationResponse = () => Promise.resolve(json({ error: 'Session not found' }, 404))
    await mount()

    signOutButtons()[1]!.click()
    await flush()

    expect(rows()).toHaveLength(2)
    expect(toasts).toEqual([{ message: 'Could not sign out that device', type: 'error' }])
  })
})

describe('signing out everywhere', () => {
  it('is a separate, deliberate action from ending one device', async () => {
    await mount()

    host.querySelector<HTMLButtonElement>('[data-test-id="settings-logout-all"]')!.click()
    await flush()

    expect(requests).toContainEqual({ url: '/api/auth/logout-all', method: 'POST' })
    expect(reloads).toBe(1)
  })

  it('gives the button back when it fails, rather than stranding it disabled', async () => {
    mutationResponse = () => Promise.reject(new Error('offline'))
    await mount()

    const button = host.querySelector<HTMLButtonElement>('[data-test-id="settings-logout-all"]')!
    button.click()
    await flush()

    expect(button.disabled).toBe(false)
    expect(reloads).toBe(0)
    expect(toasts).toEqual([{ message: 'Could not sign out everywhere', type: 'error' }])
  })
})

describe('timeAgo', () => {
  it('reads the naive server stamp as UTC, not as local time', async () => {
    const { timeAgo, parseServerTime } = await import('../SignedInDevices')

    expect(parseServerTime('2026-08-24 01:00:00').toISOString()).toBe('2026-08-24T01:00:00.000Z')
    // Same instant, one hour later. Without the Z this reads as local and drifts by the offset.
    expect(timeAgo('2026-08-24 01:00:00', new Date('2026-08-24T02:00:00Z'))).toBe('1 hour ago')
  })

  it('clamps a stamp in the future to "just now" instead of counting up', async () => {
    const { timeAgo } = await import('../SignedInDevices')

    expect(timeAgo('2026-08-24T02:00:03Z', new Date('2026-08-24T02:00:00Z'))).toBe('just now')
  })

  it('steps through minutes, hours and days', async () => {
    const { timeAgo } = await import('../SignedInDevices')
    const now = new Date('2026-08-24T12:00:00Z')

    expect(timeAgo('2026-08-24T11:59:30Z', now)).toBe('just now')
    expect(timeAgo('2026-08-24T11:59:00Z', now)).toBe('1 minute ago')
    expect(timeAgo('2026-08-24T11:30:00Z', now)).toBe('30 minutes ago')
    expect(timeAgo('2026-08-24T09:00:00Z', now)).toBe('3 hours ago')
    expect(timeAgo('2026-08-22T12:00:00Z', now)).toBe('2 days ago')
  })

  it('falls back to a date once "days ago" stops being useful', async () => {
    const { timeAgo } = await import('../SignedInDevices')

    expect(timeAgo('2026-07-01T12:00:00Z', new Date('2026-08-24T12:00:00Z'))).toMatch(/\d/)
    expect(timeAgo('2026-07-01T12:00:00Z', new Date('2026-08-24T12:00:00Z'))).not.toContain('ago')
  })

  it('says unknown for a stamp it cannot read, rather than NaN', async () => {
    const { timeAgo } = await import('../SignedInDevices')

    expect(timeAgo('not a date')).toBe('unknown')
  })
})
