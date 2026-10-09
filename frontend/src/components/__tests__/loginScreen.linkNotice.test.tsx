/**
 * The sign-in screen's one-line notices that arrive from elsewhere.
 *
 * A reset that confirmed the address and cleared the account ends here, so its words do.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
