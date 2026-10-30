/**
 * Finish signing up: the sign-in screen's step for a confirm link opened signed out, in a browser
 * the link did not sign in by itself (FinishSignUp).
 *
 * The real screen and the real client (the typed `api`, `ApiError`), with only the network
 * answered here. The link is opened as index.tsx reads it at boot: the Worker's
 * #everified_error=signin_required, which notes the link as waiting. The step asks the Worker which
 * address the link waits for, names it, and sends that address and the password typed to the
 * ordinary sign-in, which spends the link. It says a password that did not work for the whole
 * form, says the link can't finish here once it stops waiting, and sends nothing from a page left
 * open longer than the link waits.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SIGN_IN_MESSAGES as SAY } from '../../../../shared/signInSchema'
import { historySettled } from './historySettled'
import type * as TurnstileModule from '../Turnstile'

interface Sent {
  url: string
  method: string
  body: Record<string, unknown>
}

let host: HTMLDivElement
let dispose: (() => void) | undefined
let sent: Sent[]
let answers: Record<string, () => Response>
let reloads: number

const ADDRESS = 'name@example.com'
const WAITING_KEY = 'tc:email-link-waiting'
const REFUSED = "That password didn't work. Try again, or reset it."
const GONE =
  "This link can't finish here anymore. Open the newest link in your email, or send a fresh one."

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const waits = () => json({ waiting: 'confirm', email: ADDRESS })
const nothingWaits = () => json({ waiting: null })

/** The screen as the app mounts it, after the link `opened` sent this browser back. */
async function mount(opened = '#everified_error=signin_required') {
  vi.resetModules()
  vi.doMock('../../core/apiFetch', () => ({
    apiFetch: (url: string, init?: RequestInit) => {
      sent.push({
        url,
        method: init?.method ?? 'GET',
        body: typeof init?.body === 'string' ? JSON.parse(init.body) : {},
      })
      const answer = answers[url]
      if (!answer) throw new Error(`nothing answers ${url} here`)
      return Promise.resolve(answer())
    },
  }))
  vi.doMock('../Turnstile', async () => ({
    ...(await vi.importActual<typeof TurnstileModule>('../Turnstile')),
    default: () => null,
    turnstileEnabled: false,
  }))
  vi.doMock('../../core/webauthn', () => ({
    conditionalMediationAvailable: () => Promise.resolve(false),
    markPasskeyNudgeAfterLogin: () => undefined,
    passkeysSupported: () => false,
    signInWithPasskey: () => Promise.resolve({ ok: false, error: 'x', aborted: true }),
  }))
  vi.doMock('../../core/appVersion', () => ({ displayVersion: () => '9.9.9' }))
  vi.doMock('../../core/storage/storageFactory', () => ({
    getStorageMode: () => 'self-hosted',
    setStorageMode: () => undefined,
  }))
  vi.doMock('../SupportContact', () => ({ default: () => null }))
  vi.doMock('../EmailCodeLogin', () => ({ default: () => null }))
  vi.doMock('../TwofaChallenge', () => ({
    default: () => <p data-test-id="second-factor">Second factor</p>,
  }))
  window.location.hash = opened
  ;(await import('../../core/emailVerification')).consumeEmailVerifyRedirect()
  const { default: LoginScreen } = await import('../LoginScreen')
  host = document.createElement('div')
  document.body.appendChild(host)
  dispose = render(() => <LoginScreen />, host)
  await settle()
}

const settle = async () => {
  for (let i = 0; i < 8; i += 1) await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

const byTestId = (id: string) => host.querySelector<HTMLElement>(`[data-test-id="${id}"]`)
const text = (id: string) => byTestId(id)?.textContent?.replace(/\s+/g, ' ').trim() ?? null
const subtitle = () => host.querySelector('p[class*="subtitle"]')?.textContent ?? ''
const address = () => host.querySelector<HTMLInputElement>('#finish-signup-email')
const password = () => host.querySelector<HTMLInputElement>('#finish-signup-password')!
const notice = () => text('finish-signup-error') ?? ''
const logins = () => sent.filter((s) => s.url === '/api/auth/login')
const reads = () => sent.filter((s) => s.url === '/api/auth/email-link')
const marked = (el: HTMLElement) => el.getAttribute('aria-invalid') === 'true'
const describedBy = (el: HTMLElement): string[] =>
  (el.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent ?? `(missing #${id})`)

function type(input: HTMLInputElement, value: string) {
  input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

async function submit() {
  host.querySelector('form')!.requestSubmit()
  await settle()
}

function button(label: string): HTMLButtonElement {
  const found = [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === label)
  if (!found) throw new Error(`no button "${label}"`)
  return found
}

beforeEach(() => {
  sessionStorage.clear()
  localStorage.removeItem(WAITING_KEY)
  sent = []
  answers = { '/api/auth/email-link': waits }
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
})

afterEach(async () => {
  dispose?.()
  dispose = undefined
  host?.remove()
  // A screen unmounted on a step takes its entry back: let that land before the next test.
  await historySettled()
  vi.unstubAllGlobals()
  localStorage.removeItem(WAITING_KEY)
})

describe('a confirm link opened in a browser it did not sign in', () => {
  it('names the address the link waits for and asks for its password, with nothing else to choose', async () => {
    await mount()

    expect(reads()).toHaveLength(1)
    expect(subtitle()).toBe('Finish signing up.')
    expect(text('finish-signup-lead')).toBe(
      `Enter the password you chose for ${ADDRESS}. That confirms the address and signs you in.`
    )
    expect(address()!.value).toBe(ADDRESS)
    expect(address()!.readOnly).toBe(true)
    expect(address()!.getAttribute('autocomplete')).toBe('username')
    expect(password().getAttribute('autocomplete')).toBe('current-password')
    expect(text('finish-signup-submit')).toBe('Confirm and sign in')
    expect(text('finish-signup-not-you')).toBe(
      'Not your sign-up? Close this page and nothing changes.'
    )
    // The sign-in form and its other ways in are not on this step.
    expect(host.querySelector('#login-email')).toBeNull()
    expect(byTestId('emailcode-open')).toBeNull()
  })

  it('sends the address and the password to the sign-in, and reloads into the app with the address confirmed', async () => {
    answers['/api/auth/login'] = () => json({ id: 7, email: ADDRESS, emailConfirmed: true })
    await mount()
    type(password(), 'the-password')
    await submit()

    expect(logins()).toEqual([
      {
        url: '/api/auth/login',
        method: 'POST',
        body: { email: ADDRESS, password: 'the-password', turnstileToken: '' },
      },
    ])
    await vi.waitFor(() => {
      expect(reloads).toBe(1)
    })
    expect(sessionStorage.getItem('tc:email-confirmed')).toBe('1')
    expect(localStorage.getItem(WAITING_KEY)).toBeNull()
  })

  it('marks a password left empty, and sends nothing', async () => {
    await mount()
    await submit()

    expect(marked(password())).toBe(true)
    expect(describedBy(password())).toEqual([SAY.password])
    expect(logins()).toEqual([])
  })

  it('says a password that did not work for the whole form, while the link still waits', async () => {
    answers['/api/auth/login'] = () => json({ error: 'Invalid email or password' }, 401)
    await mount()
    type(password(), 'not-the-password')
    await submit()

    expect(notice()).toBe(REFUSED)
    expect(marked(password())).toBe(false)
    // It asked again whether the link waits, before it said so.
    expect(reads()).toHaveLength(2)
    expect(reloads).toBe(0)
  })

  it("says the link can't finish here once it stops waiting, with the way to a fresh one for the address", async () => {
    answers['/api/auth/login'] = () => json({ error: 'Invalid email or password' }, 401)
    answers['/api/auth/verify-email/resend'] = () => json({ ok: true })
    await mount()
    answers['/api/auth/email-link'] = nothingWaits
    type(password(), 'the-password')
    await submit()

    expect(text('finish-signup-gone')).toBe(GONE)
    expect(password()).toBeNull()
    expect(localStorage.getItem(WAITING_KEY)).toBeNull()

    button('Send the link again').click()
    await settle()
    expect(subtitle()).toBe('Send the confirm link again.')
    expect(host.querySelector<HTMLInputElement>('#login-email')!.value).toBe(ADDRESS)
    await submit()
    expect(sent.at(-1)).toEqual({
      url: '/api/auth/verify-email/resend',
      method: 'POST',
      body: { email: ADDRESS, turnstileToken: '' },
    })
  })

  it('sends nothing from a page left open longer than the link waits', async () => {
    answers['/api/auth/login'] = () => json({ id: 7 })
    await mount()
    const note = JSON.parse(localStorage.getItem(WAITING_KEY)!) as { until: number }
    localStorage.setItem(WAITING_KEY, JSON.stringify({ ...note, until: Date.now() - 1 }))
    type(password(), 'the-password')
    await submit()

    expect(logins()).toEqual([])
    expect(text('finish-signup-gone')).toBe(GONE)
  })

  it("says the link can't finish here when it stopped waiting before the page opened", async () => {
    answers['/api/auth/email-link'] = nothingWaits
    await mount()

    expect(text('finish-signup-gone')).toBe(GONE)
    expect(localStorage.getItem(WAITING_KEY)).toBeNull()
  })

  it('takes only a confirm link with an address as one that waits', async () => {
    for (const answer of [
      { waiting: 'change', email: ADDRESS },
      { waiting: 'confirm' },
      { waiting: 'confirm', email: 7 },
    ]) {
      answers['/api/auth/email-link'] = () => json(answer)
      await mount()

      expect(text('finish-signup-gone'), JSON.stringify(answer)).toBe(GONE)
      expect(address()).toBeNull()
      dispose?.()
      dispose = undefined
      host.remove()
      await historySettled()
    }
  })

  it('goes back to the sign-in form, which finishes the link too, when the Worker does not say what waits', async () => {
    answers['/api/auth/email-link'] = () => json({ error: 'Too many attempts.' }, 429)
    await mount()

    expect(byTestId('finish-signup')).toBeNull()
    expect(host.querySelector('#login-email')).not.toBeNull()
    expect(text('auth-notice')).toBe('Sign in to confirm your address.')
  })

  it('opens the second factor when the account has one', async () => {
    answers['/api/auth/login'] = () => json({ twofaRequired: true })
    await mount()
    type(password(), 'the-password')
    await submit()

    expect(byTestId('second-factor')).not.toBeNull()
    expect(reloads).toBe(0)
  })

  it('says a limit reached in the words of the route, without asking again what waits', async () => {
    answers['/api/auth/login'] = () =>
      json({ error: 'Too many attempts. Please try again in 15 minutes.' }, 429)
    await mount()
    type(password(), 'the-password')
    await submit()

    expect(notice()).toBe('Too many attempts. Please try again in 15 minutes.')
    expect(reads()).toHaveLength(1)
  })

  it('opens the reset form for the address from Forgot your password?', async () => {
    await mount()
    button('Forgot your password?').click()
    await settle()

    expect(subtitle()).toBe('Reset your password.')
    expect(host.querySelector<HTMLInputElement>('#login-email')!.value).toBe(ADDRESS)
  })
})

describe('a change-of-address link opened signed out', () => {
  it('keeps the sign-in form, and says signing in finishes the change', async () => {
    await mount('#everified_error=signin_required&change=1')

    expect(byTestId('finish-signup')).toBeNull()
    expect(reads()).toEqual([])
    expect(text('auth-notice')).toBe('Sign in to finish changing your address.')
  })
})

describe('the sign-in form', () => {
  it('asks for nothing about a link when none was opened', async () => {
    await mount('')

    expect(byTestId('finish-signup')).toBeNull()
    expect(reads()).toEqual([])
    expect(host.querySelector('#login-email')).not.toBeNull()
  })
})
