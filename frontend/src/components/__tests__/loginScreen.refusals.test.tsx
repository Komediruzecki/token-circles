/**
 * The sign-in screen's password form says what is wrong where it is wrong, against the real
 * client (the typed `api`, `ApiError`) with only the network answered here.
 *
 * A field that is wrong is marked and focused before anything is sent. A field the Worker names
 * is marked the same way. A wrong address or password is one message for the whole form and marks
 * neither field, whatever the answer carries. A limit reached and a request the captcha stopped are
 * said in words of their own, and mark no field. None of it is a toast.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SIGN_IN_MESSAGES as SAY } from '../../../../shared/signInSchema'
import type * as TurnstileModule from '../Turnstile'
import type { TurnstileStatus } from '../Turnstile'

interface Sent {
  url: string
  body: Record<string, unknown>
}

let host: HTMLDivElement
let dispose: (() => void) | undefined
let sent: Sent[]
let answers: Record<string, () => Response>
let reloads: number
let toasts: () => unknown[]
/** What signing in with a passkey answers; undefined: the browser has no passkeys. */
let passkeyAnswer: { ok: boolean; error?: string; aborted?: boolean } | undefined

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

interface Captcha {
  /** What the widget reports. */
  status?: TurnstileStatus
  /** The token the wait on submit ends with; undefined: no token comes. */
  token?: string
}

/** The screen as the app mounts it, with the captcha off unless `captcha` turns it on. */
async function mount(captcha?: Captcha) {
  vi.resetModules()
  vi.doMock('../../core/apiFetch', () => ({
    apiFetch: (url: string, init?: RequestInit) => {
      sent.push({ url, body: typeof init?.body === 'string' ? JSON.parse(init.body) : {} })
      const answer = answers[url]
      if (!answer) throw new Error(`nothing answers ${url} here`)
      return Promise.resolve(answer())
    },
  }))
  vi.doMock('../Turnstile', async () => ({
    ...(await vi.importActual<typeof TurnstileModule>('../Turnstile')),
    default: (props: { onStatus?: (status: TurnstileStatus) => void }) => {
      if (captcha?.status) props.onStatus?.(captcha.status)
      return null
    },
    turnstileEnabled: captcha !== undefined,
    resetTurnstile: () => undefined,
    waitForTurnstileToken: () =>
      captcha?.token === undefined
        ? Promise.reject(new Error('Verification timed out'))
        : Promise.resolve(captcha.token),
  }))
  vi.doMock('../../core/webauthn', () => ({
    conditionalMediationAvailable: () => Promise.resolve(false),
    markPasskeyNudgeAfterLogin: () => undefined,
    passkeysSupported: () => passkeyAnswer !== undefined,
    signInWithPasskey: () =>
      Promise.resolve(passkeyAnswer ?? { ok: false, error: 'x', aborted: true }),
  }))
  vi.doMock('../../core/appVersion', () => ({ displayVersion: () => '9.9.9' }))
  vi.doMock('../../core/storage/storageFactory', () => ({ setStorageMode: () => undefined }))
  vi.doMock('../SupportContact', () => ({ default: () => null }))
  vi.doMock('../EmailCodeLogin', () => ({ default: () => null }))
  vi.doMock('../TwofaChallenge', () => ({
    default: () => <p data-test-id="second-factor">Second factor</p>,
  }))
  const { default: LoginScreen } = await import('../LoginScreen')
  toasts = (await import('../../core/toastStore')).toasts
  host = document.createElement('div')
  document.body.appendChild(host)
  dispose = render(() => <LoginScreen />, host)
  await settle()
}

const settle = async () => {
  for (let i = 0; i < 8; i += 1) await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

const email = () => host.querySelector<HTMLInputElement>('#login-email')!
const password = () => host.querySelector<HTMLInputElement>('#login-password')!
const notice = () => host.querySelector('[data-test-id="login-error"]')!.textContent ?? ''
const authNotice = () => host.querySelector('[data-test-id="auth-notice"]')?.textContent ?? ''
const submitButton = () => host.querySelector<HTMLButtonElement>('button[type="submit"]')!
const describedBy = (el: HTMLElement): string[] =>
  (el.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent ?? `(missing #${id})`)
const marked = (el: HTMLElement) => el.getAttribute('aria-invalid') === 'true'

function type(input: HTMLInputElement, value: string) {
  input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

async function submit() {
  host.querySelector('form')!.requestSubmit()
  await settle()
}

function button(text: string): HTMLButtonElement {
  const found = [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)
  if (!found) throw new Error(`no button "${text}"`)
  return found
}

beforeEach(() => {
  sent = []
  answers = {}
  reloads = 0
  passkeyAnswer = undefined
  vi.stubGlobal('location', {
    reload: () => {
      reloads += 1
    },
    href: 'https://app.example.com/',
    search: '',
    hash: '',
  } as unknown as Location)
})

afterEach(() => {
  dispose?.()
  host.remove()
  vi.unstubAllGlobals()
})

describe('signing in', () => {
  it('marks and focuses a field that is wrong, and sends nothing', async () => {
    await mount()
    type(email(), 'name@example')
    await submit()

    expect(marked(email())).toBe(true)
    expect(describedBy(email())).toEqual([SAY.emailFormat])
    expect(marked(password())).toBe(true)
    expect(describedBy(password())).toEqual([SAY.password])
    expect(document.activeElement).toBe(email())
    expect(sent).toEqual([])
  })

  it('sends the address trimmed, and reloads into the app with the button still busy', async () => {
    answers['/api/auth/login'] = () => json({ id: 7, email: 'name@example.com' })
    await mount()
    type(email(), '  name@example.com ')
    type(password(), 'the-password')
    await submit()

    expect(sent).toEqual([
      {
        url: '/api/auth/login',
        body: { email: 'name@example.com', password: 'the-password', turnstileToken: '' },
      },
    ])
    expect(reloads).toBe(1)
    expect(submitButton().getAttribute('aria-disabled')).toBe('true')
    expect(submitButton().textContent).toBe('Signing in…')
  })

  it('says a wrong address or password once, for the whole form, with no field marked', async () => {
    answers['/api/auth/login'] = () => json({ error: 'Invalid email or password' }, 401)
    await mount()
    type(email(), 'name@example.com')
    type(password(), 'not-the-password')
    await submit()

    expect(notice()).toBe('Invalid email or password')
    expect(marked(email())).toBe(false)
    expect(marked(password())).toBe(false)
    expect(toasts()).toEqual([])
    expect(reloads).toBe(0)
  })

  it('marks neither field for a wrong address or password, whatever the answer names', async () => {
    answers['/api/auth/login'] = () =>
      json(
        {
          error: 'Invalid email or password',
          fields: { email: 'No account here.', password: 'Wrong password.' },
        },
        401
      )
    await mount()
    type(email(), 'name@example.com')
    type(password(), 'not-the-password')
    await submit()

    expect(notice()).toBe('Invalid email or password')
    expect(marked(email())).toBe(false)
    expect(marked(password())).toBe(false)
  })

  it('says when to try again once the limit is reached, with no field marked', async () => {
    answers['/api/auth/login'] = () =>
      json({ error: 'Too many attempts. Please try again in about 15 minutes.' }, 429)
    await mount()
    type(email(), 'name@example.com')
    type(password(), 'not-the-password')
    await submit()

    expect(notice()).toBe('Too many attempts. Please try again in about 15 minutes.')
    expect(marked(email())).toBe(false)
    expect(marked(password())).toBe(false)
    expect(toasts()).toEqual([])
  })

  it('opens the second factor when the password was right and the account has one', async () => {
    answers['/api/auth/login'] = () => json({ twofaRequired: true })
    await mount()
    type(email(), 'name@example.com')
    type(password(), 'the-password')
    await submit()

    expect(host.querySelector('[data-test-id="second-factor"]')).not.toBeNull()
    expect(reloads).toBe(0)
  })
})

describe('the captcha', () => {
  it('says what to do when the Worker refuses the token, with no field marked', async () => {
    answers['/api/auth/login'] = () =>
      json({ error: 'Captcha verification failed. Please try again.' }, 403)
    await mount({ token: 'a-token' })
    type(email(), 'name@example.com')
    type(password(), 'the-password')
    await submit()

    expect(sent[0]!.body.turnstileToken).toBe('a-token')
    expect(notice()).toBe(
      "Verification didn't go through. Try again, and complete the check if one appears."
    )
    expect(marked(email())).toBe(false)
    expect(marked(password())).toBe(false)
    expect(toasts()).toEqual([])
  })

  it('says the same when no token comes, and sends nothing', async () => {
    await mount({})
    type(email(), 'name@example.com')
    type(password(), 'the-password')
    await submit()

    expect(sent).toEqual([])
    expect(notice()).toBe(
      "Verification didn't go through. Try again, and complete the check if one appears."
    )
  })

  it('says what to fix when the widget cannot load, before anything is sent', async () => {
    await mount({ status: 'unreachable' })
    type(email(), 'name@example.com')
    type(password(), 'the-password')
    await submit()

    expect(sent).toEqual([])
    expect(notice()).toContain('The verification step could not load.')
    expect(marked(email())).toBe(false)
  })
})

describe('creating an account', () => {
  it('marks a field the Worker names, and focuses it', async () => {
    answers['/api/auth/register'] = () =>
      json({ error: SAY.emailFormat, fields: { email: SAY.emailFormat } }, 400)
    await mount()
    button('Create one').click()
    await settle()
    type(email(), 'name@example.com')
    type(password(), 'a-new-password')
    await submit()

    expect(marked(email())).toBe(true)
    expect(describedBy(email())).toEqual([SAY.emailFormat])
    expect(document.activeElement).toBe(email())
    expect(notice()).toBe('')
  })

  it('checks the password length the Worker checks', async () => {
    await mount()
    button('Create one').click()
    await settle()
    type(email(), 'name@example.com')
    type(password(), 'short')
    await submit()

    expect(describedBy(password())).toEqual([SAY.newPassword])
    expect(document.activeElement).toBe(password())
    expect(sent).toEqual([])
  })

  it('hands over to signing in by hand when the new password does not sign in', async () => {
    answers['/api/auth/register'] = () => json({ ok: true })
    answers['/api/auth/login'] = () => json({ error: 'Invalid email or password' }, 401)
    await mount()
    button('Create one').click()
    await settle()
    type(email(), 'name@example.com')
    type(password(), 'a-new-password')
    await submit()
    await settle()

    expect(sent.map((s) => s.url)).toEqual(['/api/auth/register', '/api/auth/login'])
    expect(authNotice()).toBe('Almost done — sign in with your password below.')
    expect(submitButton().textContent).toBe('Sign in')
    expect(email().value).toBe('name@example.com')
    expect(password().value).toBe('')
    expect(notice()).toBe('')
    expect(marked(email())).toBe(false)
  })
})

describe('asking for a reset link', () => {
  it('says the same thing for every address the Worker takes', async () => {
    answers['/api/auth/forgot-password'] = () => json({ ok: true })
    await mount()
    button('Forgot password?').click()
    await settle()
    type(email(), 'name@example.com')
    await submit()

    expect(sent).toEqual([
      {
        url: '/api/auth/forgot-password',
        body: { email: 'name@example.com', turnstileToken: '' },
      },
    ])
    expect(authNotice()).toBe(
      'If an account exists for that email, a reset link is on its way. Check your inbox.'
    )
    expect(notice()).toBe('')
  })

  it('marks an address that is not one, and sends nothing', async () => {
    await mount()
    button('Forgot password?').click()
    await settle()
    type(email(), 'name example.com')
    await submit()

    expect(describedBy(email())).toEqual([SAY.emailFormat])
    expect(document.activeElement).toBe(email())
    expect(sent).toEqual([])
  })
})

describe('a passkey', () => {
  it('says a passkey that did not sign in under its button, and marks no field', async () => {
    passkeyAnswer = { ok: false, error: 'This device could not sign in with a passkey.' }
    await mount()
    button('Sign in with a passkey').click()
    await settle()

    expect(host.querySelector('[data-test-id="passkey-error"]')?.textContent).toBe(
      'This device could not sign in with a passkey.'
    )
    expect(notice()).toBe('')
    expect(marked(email())).toBe(false)
    expect(marked(password())).toBe(false)
    expect(toasts()).toEqual([])
  })

  it('says nothing when the person closed the passkey prompt', async () => {
    passkeyAnswer = { ok: false, error: 'Passkey sign-in was cancelled', aborted: true }
    await mount()
    button('Sign in with a passkey').click()
    await settle()

    expect(host.querySelector('[data-test-id="passkey-error"]')?.textContent).toBe('')
    expect(notice()).toBe('')
  })

  it('reloads into the app when the passkey signs in', async () => {
    passkeyAnswer = { ok: true }
    await mount()
    button('Sign in with a passkey').click()
    await settle()

    expect(reloads).toBe(1)
    expect(sent).toEqual([])
  })
})
