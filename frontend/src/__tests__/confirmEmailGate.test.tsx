/**
 * A password account whose address is not confirmed sees Confirm your email instead of the app.
 *
 * The Worker refuses that account's session almost everything (403 EMAIL_UNCONFIRMED), so the app
 * has nothing to show it but the way to its confirm link. The app finds out at boot, from GET
 * /api/auth/me, and from any request the Worker refuses that way. A confirmed account and a Google
 * account get the app as before, and local-first has no account to confirm.
 *
 * Against the real App, with a stand-in for the Worker, because that is the network.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  setCurrentProfile,
  setIsAuthenticated,
  setIsLoginModalOpen,
  setProfiles,
  setShowDropdown,
} from '../core/appStore'
import type { StorageMode } from '../core/storage/storageFactory'

// The pages are not under test, and the real Dashboard would cost more to load than all of this.
vi.mock('../router', () => ({ pages: { dashboard: () => null } }))

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const UNCONFIRMED = { error: 'Confirm your email address.', code: 'EMAIL_UNCONFIRMED' }
const WAITING = {
  id: 1,
  email: 'waiting@example.com',
  email_verified: 0,
  auth_provider: 'password',
}
const CONFIRMED = { ...WAITING, email: 'confirmed@example.com', email_verified: 1 }
const GOOGLE = { ...WAITING, email: 'google@example.com', auth_provider: 'google' }

/** The Worker: who /me says is signed in, and what it does with everything else. */
const worker = vi.hoisted(() => ({
  me: null as Record<string, unknown> | null,
  sent: [] as string[],
}))

function workerStandIn() {
  return async (url: string, init: RequestInit = {}) => {
    const path = new URL(url, 'http://localhost').pathname
    const method = init.method ?? 'GET'
    if (path.startsWith('/api/')) worker.sent.push(`${method} ${path}`)
    const me = worker.me
    if (path === '/api/auth/me') return me ? json(me) : json({ error: 'Unauthorized' }, 401)
    if (path === '/api/auth/logout') {
      worker.me = null
      return json({ ok: true })
    }
    if (me && me.auth_provider === 'password' && !me.email_verified) return json(UNCONFIRMED, 403)
    if (path === '/api/profiles') return json([{ id: 1, name: 'Personal', created_at: '' }])
    return json([])
  }
}

const byTestId = (id: string) => document.querySelector<HTMLElement>(`[data-test-id="${id}"]`)
const waitLong = { timeout: 10_000 }
const apiSent = () => worker.sent.filter((r) => !r.startsWith('GET /api/auth/me'))

let host: HTMLDivElement
let dispose: (() => void) | undefined

beforeAll(async () => {
  // Pay for the App import once, outside any one test's time budget.
  await import('../App')
}, 120_000)

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  worker.me = null
  worker.sent.length = 0
  setIsAuthenticated(false)
  setIsLoginModalOpen(false)
  setShowDropdown(false)
  setProfiles([])
  setCurrentProfile(null)
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
  host = document.createElement('div')
  document.body.appendChild(host)
})

afterEach(() => {
  dispose?.()
  dispose = undefined
  host.remove()
  vi.unstubAllGlobals()
  localStorage.clear()
})

async function mountApp(mode: StorageMode = 'self-hosted') {
  localStorage.setItem('finance_storage_mode', mode)
  localStorage.setItem('finance_onboarding', 'skipped')
  if (mode === 'self-hosted') vi.stubGlobal('fetch', workerStandIn())
  const { App } = await import('../App')
  dispose = render(() => <App />, host)
}

const appShown = () => byTestId('profile-dropdown-btn') !== null
const gateShown = () => byTestId('confirm-email-screen') !== null
const signInShown = () => document.getElementById('login-email') !== null

describe('a password account whose address is not confirmed', () => {
  it('sees Confirm your email with its address, not the app or the sign-in screen, and the app asks the Worker for nothing else', async () => {
    worker.me = WAITING
    await mountApp()

    await vi.waitFor(() => {
      expect(gateShown()).toBe(true)
    }, waitLong)
    expect(byTestId('confirm-email-address')?.textContent).toBe('waiting@example.com')
    expect(appShown()).toBe(false)
    expect(signInShown()).toBe(false)
    expect(apiSent()).toEqual([])
  })

  it('goes to the sign-in screen from Sign out', async () => {
    worker.me = WAITING
    await mountApp()
    await vi.waitFor(() => {
      expect(gateShown()).toBe(true)
    }, waitLong)

    byTestId('confirm-email-sign-out')!.click()

    await vi.waitFor(() => {
      expect(signInShown()).toBe(true)
    }, waitLong)
    expect(gateShown()).toBe(false)
    expect(apiSent()).toEqual(['POST /api/auth/logout'])
  })
})

describe('an account the Worker lets in', () => {
  it.each([
    ['a confirmed password account', CONFIRMED],
    ['a Google account, whatever its address says', GOOGLE],
  ])('%s sees the app', async (_who, me) => {
    worker.me = me
    await mountApp()

    await vi.waitFor(() => {
      expect(appShown()).toBe(true)
    }, waitLong)
    expect(gateShown()).toBe(false)
  })

  it('sees Confirm your email once the Worker refuses a request because the address is not confirmed', async () => {
    worker.me = CONFIRMED
    await mountApp()
    await vi.waitFor(() => {
      expect(appShown()).toBe(true)
    }, waitLong)

    worker.me = { ...CONFIRMED, email_verified: 0 }
    const { apiFetch } = await import('../core/apiFetch')
    await apiFetch('/api/profiles')

    await vi.waitFor(() => {
      expect(gateShown()).toBe(true)
    }, waitLong)
    expect(byTestId('confirm-email-address')?.textContent).toBe('confirmed@example.com')
    expect(appShown()).toBe(false)
  })
})

describe('local-first', () => {
  it('never shows Confirm your email: there is no account to confirm', async () => {
    await mountApp('serverless')

    await vi.waitFor(() => {
      expect(appShown()).toBe(true)
    }, waitLong)
    expect(gateShown()).toBe(false)
  })
})
