/**
 * The sign-in screen's one-line notices that arrive from elsewhere.
 *
 * An email link opened before signing in is left unspent by the worker, which sends the browser
 * back with #everified_error=signin_required, and the app notes the link as waiting. The sign-in
 * screen is what the person sees then, so it says what signing in here does: it finishes the link.
 *
 * A reset that confirmed the address and cleared the account ends here too, so its words do.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let waiting: { change: boolean } | null = null

vi.mock('../../core/emailVerification', () => ({
  linkWaiting: () => waiting,
}))
vi.mock('../../core/api', () => ({
  api: {
    loginWithPassword: vi.fn(),
    register: vi.fn(),
    forgotPassword: vi.fn(),
    loginWithGoogle: vi.fn(),
  },
}))
vi.mock('../Turnstile', () => ({
  default: () => null,
  captchaIsStuck: () => false,
  captchaStatusMessage: () => '',
  resetTurnstile: vi.fn(),
  turnstileEnabled: false,
  waitForTurnstileToken: () => Promise.resolve(''),
}))
vi.mock('../../core/webauthn', () => ({
  conditionalMediationAvailable: () => Promise.resolve(false),
  markPasskeyNudgeAfterLogin: vi.fn(),
  passkeysSupported: () => false,
  signInWithPasskey: vi.fn(),
}))
vi.mock('../../core/appVersion', () => ({ displayVersion: () => '9.9.9' }))
vi.mock('../../core/storage/storageFactory', () => ({ setStorageMode: vi.fn() }))
vi.mock('../SupportContact', () => ({ default: () => null }))
vi.mock('../EmailCodeLogin', () => ({ default: () => null }))
vi.mock('../TwofaChallenge', () => ({ default: () => null }))

let host: HTMLDivElement
let dispose: (() => void) | undefined

beforeEach(() => {
  waiting = null
  sessionStorage.clear()
  host = document.createElement('div')
  document.body.appendChild(host)
})

afterEach(() => {
  dispose?.()
  host.remove()
})

async function mount() {
  const { default: LoginScreen } = await import('../LoginScreen')
  dispose = render(() => <LoginScreen />, host)
  await new Promise((r) => setTimeout(r, 0))
}

const notice = () => host.querySelector('[data-test-id="auth-notice"]')?.textContent ?? null

describe('the sign-in screen after an email link was opened signed out', () => {
  it('says signing in confirms the address', async () => {
    waiting = { change: false }
    await mount()

    expect(notice()).toBe('Sign in to confirm your address.')
  })

  it('says signing in finishes the change of address', async () => {
    waiting = { change: true }
    await mount()

    expect(notice()).toBe('Sign in to finish changing your address.')
  })

  it('says it again after a reload, while the link still waits', async () => {
    waiting = { change: false }
    await mount()
    dispose?.()
    host.remove()
    host = document.createElement('div')
    document.body.appendChild(host)

    await mount()

    expect(notice()).toBe('Sign in to confirm your address.')
  })

  it('says nothing when no link was opened', async () => {
    await mount()

    expect(notice()).toBeNull()
  })
})

describe('the sign-in screen after a reset that cleared the account', () => {
  it('says the new password is set and what else went', async () => {
    sessionStorage.setItem('tc:access-cleared', 'reset')
    await mount()

    expect(notice()).toBe(
      'Your new password is set. Confirming your email removed what was set up before it: passkeys, two-factor authentication, API tokens and sign-ins on other devices. Sign in, then add what you need again in Settings.'
    )
    expect(sessionStorage.getItem('tc:access-cleared')).toBeNull()
  })

  it('leaves the notice of a sign-in for the app', async () => {
    sessionStorage.setItem('tc:access-cleared', 'sign-in')
    await mount()

    expect(notice()).toBeNull()
    expect(sessionStorage.getItem('tc:access-cleared')).toBe('sign-in')
  })
})
