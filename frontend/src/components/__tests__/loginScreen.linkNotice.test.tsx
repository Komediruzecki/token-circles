/**
 * The sign-in screen's one-line notices that arrive from elsewhere.
 *
 * An email link opened before signing in is left unspent by the worker, which sends the browser
 * back with #everified_error=signin_required, and the app notes the link as waiting. The sign-in
 * screen is what the person sees then, so it says what signing in here does: it finishes the link.
 * A confirm link opens the screen on Finish signing up instead (finishSignUp.test.tsx), and the
 * notice is what the form says when the Worker cannot say which address the link waits for.
 *
 * A reset that confirmed the address and cleared the account ends here too, so its words do.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let waiting: { change: boolean } | null = null
/** What the Worker says the opened confirm link waits for; a rejection is no answer. */
let waitingFor: () => Promise<{ masked: string } | null> = () =>
  Promise.reject(new Error('no answer'))

vi.mock('../../core/emailVerification', () => ({
  linkWaiting: () => waiting,
  takeConfirmLinkProblem: () => null,
  clearLinkWaiting: () => undefined,
  noteAddressConfirmed: () => undefined,
}))
vi.mock('../../core/api', () => ({
  api: {
    loginWithPassword: vi.fn(),
    register: vi.fn(),
    forgotPassword: vi.fn(),
    loginWithGoogle: vi.fn(),
    confirmLinkWaiting: () => waitingFor(),
  },
}))
vi.mock('../Turnstile', () => ({
  default: () => null,
  captchaIsStuck: () => false,
  captchaStatusMessage: () => '',
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
  waitingFor = () => Promise.reject(new Error('no answer'))
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
  it('opens on Finish signing up for a confirm link whose address the Worker names', async () => {
    waiting = { change: false }
    waitingFor = () => Promise.resolve({ masked: 'n•••@example.com' })
    await mount()

    expect(host.querySelector('[data-test-id="finish-signup-address"]')?.textContent).toBe(
      'n•••@example.com'
    )
    expect(notice()).toBeNull()
  })

  it('says signing in confirms the address when the Worker cannot say what the link waits for', async () => {
    waiting = { change: false }
    await mount()

    expect(host.querySelector('[data-test-id="finish-signup"]')).toBeNull()
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
  it('says the new password is set and names what else went', async () => {
    sessionStorage.setItem('tc:access-cleared', 'reset:passkeys,api-tokens')
    await mount()

    expect(notice()).toBe(
      'Resetting your password confirmed your email, so your passkeys and API tokens no longer work. Sign in, then set them up again in Settings.'
    )
    expect(sessionStorage.getItem('tc:access-cleared')).toBeNull()
  })

  it('leaves the notice of a sign-in for the app', async () => {
    sessionStorage.setItem('tc:access-cleared', 'google:password')
    await mount()

    expect(notice()).toBeNull()
    expect(sessionStorage.getItem('tc:access-cleared')).toBe('google:password')
  })
})
