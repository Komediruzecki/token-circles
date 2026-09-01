/**
 * The captcha is invisible until Cloudflare asks for a click, so nothing on screen can explain a
 * disabled submit button any more. The button therefore stays live and the token is awaited on
 * submit instead — but the request must still carry one, or hiding the widget would have quietly
 * removed the protection rather than moved it.
 *
 * Also pins the labels: they replaced placeholders, which vanish the moment you type.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const loginWithPassword = vi.fn()
const register = vi.fn()
const forgotPassword = vi.fn()

vi.mock('../../core/api', () => ({
  api: {
    loginWithPassword: (...a: unknown[]) => loginWithPassword(...a),
    register: (...a: unknown[]) => register(...a),
    forgotPassword: (...a: unknown[]) => forgotPassword(...a),
    loginWithGoogle: vi.fn(),
  },
}))

/** Resolved by the test when it wants the challenge to "pass". */
let releaseToken: (token: string) => void = () => {}
let tokenPromise: Promise<string>

vi.mock('../Turnstile', () => ({
  default: () => null,
  captchaIsStuck: () => false,
  captchaStatusMessage: () => 'Checking your browser…',
  resetTurnstile: vi.fn(),
  turnstileEnabled: true,
  waitForTurnstileToken: () => tokenPromise,
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
  loginWithPassword.mockReset()
  register.mockReset()
  forgotPassword.mockReset()
  tokenPromise = new Promise<string>((res) => {
    releaseToken = res
  })
  host = document.createElement('div')
  document.body.appendChild(host)
})

afterEach(() => {
  dispose?.()
  host.remove()
})

const flush = () => new Promise((r) => setTimeout(r, 0))

async function waitFor(predicate: () => boolean, label: string, turns = 60) {
  for (let i = 0; i < turns; i++) {
    if (predicate()) return
    await flush()
  }
  throw new Error(`timed out waiting for: ${label}`)
}

async function mount() {
  const { default: LoginScreen } = await import('../LoginScreen')
  dispose = render(() => <LoginScreen />, host)
  await flush()
}

const submitBtn = () => host.querySelector<HTMLButtonElement>('button[type="submit"]')!
const emailInput = () => host.querySelector<HTMLInputElement>('#login-email')!
const passwordInput = () => host.querySelector<HTMLInputElement>('#login-password')!

function type(input: HTMLInputElement, value: string) {
  input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('the sign-in form while the captcha is invisible', () => {
  it('leaves the submit button usable before any token exists', async () => {
    await mount()
    // Nothing has resolved the challenge yet. The old form disabled the button here, which with a
    // hidden widget would be a dead button and no stated reason.
    expect(submitBtn().disabled).toBe(false)
  })

  it('still sends a captcha token with the sign-in, waiting for one if needed', async () => {
    loginWithPassword.mockResolvedValue({ twofaRequired: true }) // avoids a reload
    await mount()

    type(emailInput(), 'someone@example.com')
    type(passwordInput(), 'a-long-enough-password')
    submitBtn().click()
    await flush()

    // The submit is parked on the token, so no request has gone out yet.
    expect(loginWithPassword).not.toHaveBeenCalled()

    releaseToken('token-from-cloudflare')
    await waitFor(() => loginWithPassword.mock.calls.length > 0, 'the sign-in request')

    expect(loginWithPassword).toHaveBeenCalledWith(
      'someone@example.com',
      'a-long-enough-password',
      'token-from-cloudflare'
    )
  })

  it('explains the wait only once a submit is actually blocked on it', async () => {
    loginWithPassword.mockResolvedValue({ twofaRequired: true })
    await mount()
    const hint = () => host.querySelector('[data-test-id="captcha-hint"]')

    expect(hint(), 'an idle form has nothing to explain').toBeNull()

    type(emailInput(), 'someone@example.com')
    type(passwordInput(), 'a-long-enough-password')
    submitBtn().click()
    await waitFor(() => hint() !== null, 'the captcha hint once submit is waiting')

    releaseToken('token-from-cloudflare')
    await waitFor(() => loginWithPassword.mock.calls.length > 0, 'the sign-in request')
  })
})

describe('the sign-in form labels', () => {
  it('labels both fields, and binds each label to its input', async () => {
    await mount()
    const labels = Array.from(host.querySelectorAll('label'))
    const texts = labels.map((l) => l.textContent?.trim())

    expect(texts).toEqual(['Email address', 'Password'])
    // A label that is not bound announces nothing and does not focus its field when clicked.
    expect(labels.map((l) => l.getAttribute('for'))).toEqual(['login-email', 'login-password'])
    expect(emailInput().id).toBe('login-email')
    expect(passwordInput().id).toBe('login-password')
  })

  it('offers both no-account routes below the alternatives, not above them', async () => {
    await mount()
    const text = host.textContent ?? ''
    expect(text).toContain("Don't have an account?")
    expect(text).toContain('Create one')
    // "Demo" is jargon for what is really just using the app without signing up.
    expect(text).toContain('Continue with no account')
    expect(text).not.toMatch(/demo/i)

    // The account line must come after the passkey/Google alternatives in document order.
    const html = host.innerHTML
    expect(html.indexOf('Continue with Google')).toBeLessThan(html.indexOf('Create one'))
  })
})
