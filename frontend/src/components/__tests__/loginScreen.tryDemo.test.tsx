/**
 * Continue with no account, on the sign-in screen: client-only mode, and the demo.
 *
 * A signed-in account that chose "Keep my data in this browser only" leaves a marker that opens
 * setup over the demo's example profiles on the next load (onboardingStore.ts). When the person
 * gets back to the account another way (a `?plan=` link, a confirm link, Sign in) and then asks for
 * the demo here, the demo is what opens: the marker goes with the request.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { localSetupPending, markLocalSetupPending } from '../../core/onboardingFlag'
import { historySettled } from './historySettled'

const modes = vi.hoisted(() => [] as string[])

vi.mock('../../core/emailVerification', () => ({
  linkWaiting: () => null,
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
    confirmLinkWaiting: () => Promise.reject(new Error('no answer')),
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
vi.mock('../../core/storage/storageFactory', () => ({
  getStorageMode: () => 'self-hosted',
  setStorageMode: (mode: string) => {
    modes.push(mode)
  },
}))
vi.mock('../SupportContact', () => ({ default: () => null }))
vi.mock('../EmailCodeLogin', () => ({ default: () => null }))
vi.mock('../TwofaChallenge', () => ({ default: () => null }))

let host: HTMLDivElement
let dispose: (() => void) | undefined
let reloads = 0

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  modes.length = 0
  reloads = 0
  vi.stubGlobal('location', {
    reload: () => {
      reloads += 1
    },
    href: 'https://app.example.com/',
    pathname: '/',
    search: '',
    hash: '',
  } as unknown as Location)
  host = document.createElement('div')
  document.body.appendChild(host)
})

afterEach(async () => {
  dispose?.()
  host.remove()
  await historySettled()
  vi.unstubAllGlobals()
  localStorage.clear()
})

it('drops a pending local-only setup, so the demo opens as the demo', async () => {
  markLocalSetupPending()
  const { default: LoginScreen } = await import('../LoginScreen')
  dispose = render(() => <LoginScreen />, host)
  await new Promise((r) => setTimeout(r, 0))

  host.querySelector<HTMLButtonElement>('[data-test-id="try-no-account"]')!.click()

  expect(modes).toEqual(['serverless'])
  expect(localSetupPending()).toBe(false)
  await vi.waitFor(() => {
    expect(reloads).toBe(1)
  })
})
