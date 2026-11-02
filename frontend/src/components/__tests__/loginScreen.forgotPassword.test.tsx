/**
 * #forgot-password: the sign-in screen opens on the form that sends a reset link.
 *
 * It is where the Reset password button of the "already has an account" mail goes
 * (renderAccountExists in worker/src/emailTemplates.ts), so someone who forgot their password
 * lands on the form that fixes it rather than on Sign in.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../core/emailVerification', () => ({
  linkWaiting: () => null,
  takeConfirmLinkProblem: () => null,
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

/** Put `hash` on the address as a page load with it does: without a hashchange. */
const loadAt = (hash: string) => {
  history.replaceState(null, '', `/${hash}`)
}

beforeEach(() => {
  loadAt('')
  host = document.createElement('div')
  document.body.appendChild(host)
})

afterEach(() => {
  dispose?.()
  dispose = undefined
  host.remove()
  loadAt('')
})

const settle = () => new Promise((r) => setTimeout(r, 0))

async function mount() {
  const { default: LoginScreen } = await import('../LoginScreen')
  dispose = render(() => <LoginScreen />, host)
  await settle()
}

const submitLabel = () => host.querySelector('button[type="submit"]')?.textContent
const passwordField = () => host.querySelector('#login-password')
const button = (label: string) =>
  [...host.querySelectorAll('button')].find((b) => b.textContent === label)

describe('the sign-in screen at #forgot-password', () => {
  it('opens on the form that sends a reset link', async () => {
    loadAt('#forgot-password')
    await mount()

    expect(host.textContent).toContain('Reset your password.')
    expect(submitLabel()).toBe('Send reset link')
    expect(passwordField()).toBeNull()
  })

  it('opens on Sign in without it', async () => {
    await mount()

    expect(submitLabel()).toBe('Sign in')
    expect(passwordField()).not.toBeNull()
  })

  it('opens the form when the address changes to #forgot-password while the screen is open', async () => {
    await mount()
    expect(submitLabel()).toBe('Sign in')

    const changed = new Promise((r) => {
      window.addEventListener('hashchange', r, { once: true })
    })
    window.location.hash = '#forgot-password'
    await changed
    await settle()

    expect(submitLabel()).toBe('Send reset link')
  })

  it('takes #forgot-password off the address on the way back to signing in', async () => {
    // Otherwise a reload, or the app after signing in, would open the reset form again.
    loadAt('#forgot-password')
    await mount()

    button('Back to sign in')!.click()
    await settle()

    expect(submitLabel()).toBe('Sign in')
    expect(window.location.hash).toBe('')
  })
})
