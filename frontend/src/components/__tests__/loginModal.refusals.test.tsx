/**
 * The sign-in dialog's password form (LoginModal), against the real client: the same form as the
 * sign-in screen's (signInForm.ts), so a field that is wrong is marked and focused before anything
 * is sent, a field the Worker names is marked, and a wrong address or password is one message for
 * the whole form. The captcha's widget shows in the dialog; the send waits for its token.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SIGN_IN_MESSAGES as SAY } from '../../../../shared/signInSchema'
import type * as TurnstileModule from '../Turnstile'

let host: HTMLDivElement
let dispose: (() => void) | undefined
let sent: { url: string; body: Record<string, unknown> }[]
let answers: Record<string, () => Response>
let reloads: number
let releaseToken: (token: string) => void

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

async function mount(captcha = false) {
  vi.resetModules()
  vi.doMock('../../core/apiFetch', () => ({
    apiFetch: (url: string, init?: RequestInit) => {
      sent.push({ url, body: typeof init?.body === 'string' ? JSON.parse(init.body) : {} })
      const answer = answers[url]
      if (!answer) throw new Error(`nothing answers ${url} here`)
      return Promise.resolve(answer())
    },
  }))
  const token = new Promise<string>((resolve) => {
    releaseToken = resolve
  })
  vi.doMock('../Turnstile', async () => ({
    ...(await vi.importActual<typeof TurnstileModule>('../Turnstile')),
    default: () => null,
    turnstileEnabled: captcha,
    resetTurnstile: () => undefined,
    waitForTurnstileToken: () => token,
  }))
  vi.doMock('../../core/webauthn', () => ({
    markPasskeyNudgeAfterLogin: () => undefined,
    passkeysSupported: () => false,
    signInWithPasskey: () => Promise.resolve({ ok: false, error: 'x', aborted: true }),
  }))
  vi.doMock('../EmailCodeLogin', () => ({ default: () => null }))
  vi.doMock('../TwofaChallenge', () => ({ default: () => null }))
  const { default: LoginModal } = await import('../LoginModal')
  host = document.createElement('div')
  document.body.appendChild(host)
  dispose = render(() => <LoginModal onClose={() => undefined} onSuccess={() => undefined} />, host)
  await settle()
}

const settle = async () => {
  for (let i = 0; i < 8; i += 1) await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

const email = () => host.querySelector<HTMLInputElement>('#login-modal-email')!
const password = () => host.querySelector<HTMLInputElement>('#login-modal-password')!
const notice = () => host.querySelector('[data-test-id="login-error"]')!.textContent ?? ''
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

async function createOne() {
  ;[...host.querySelectorAll('a')].find((a) => a.textContent === 'Create one')!.click()
  await settle()
}

beforeEach(() => {
  sent = []
  answers = {}
  reloads = 0
  vi.stubGlobal('location', {
    reload: () => {
      reloads += 1
    },
    href: 'https://app.example.com/',
  } as unknown as Location)
})

afterEach(() => {
  dispose?.()
  host.remove()
  vi.unstubAllGlobals()
})

describe('the sign-in dialog', () => {
  it('labels both fields', async () => {
    await mount()
    expect(host.querySelector('label[for="login-modal-email"]')?.textContent).toBe('Email address')
    expect(host.querySelector('label[for="login-modal-password"]')?.textContent).toBe('Password')
  })

  it('marks and focuses a field that is wrong, and sends nothing', async () => {
    await mount()
    await submit()

    expect(describedBy(email())).toEqual([SAY.email])
    expect(describedBy(password())).toEqual([SAY.password])
    expect(document.activeElement).toBe(email())
    expect(sent).toEqual([])
  })

  it('says a wrong address or password once, with no field marked', async () => {
    answers['/api/auth/login'] = () =>
      json({ error: 'Invalid email or password', fields: { password: 'Wrong password.' } }, 401)
    await mount()
    type(email(), 'name@example.com')
    type(password(), 'not-the-password')
    await submit()

    expect(notice()).toBe('Invalid email or password')
    expect(marked(email())).toBe(false)
    expect(marked(password())).toBe(false)
    expect(reloads).toBe(0)
  })

  it('marks a field the Worker names when creating an account', async () => {
    answers['/api/auth/register'] = () =>
      json({ error: SAY.newPassword, fields: { password: SAY.newPassword } }, 400)
    await mount()
    await createOne()
    type(email(), 'name@example.com')
    type(password(), 'a-new-password')
    await submit()

    expect(describedBy(password())).toEqual([SAY.newPassword])
    expect(document.activeElement).toBe(password())
  })

  it('signs in after creating an account without saying the account was created', async () => {
    answers['/api/auth/register'] = () => json({ ok: true })
    answers['/api/auth/login'] = () => new Promise<Response>(() => {}) as unknown as Response
    await mount()
    await createOne()
    type(email(), 'name@example.com')
    type(password(), 'a-new-password')
    await submit()
    await settle()

    // The answer is the same whether or not the address had an account.
    expect(host.textContent).toContain('Signing you in…')
    expect(host.textContent).not.toContain('Account created')
  })
})

describe('the sign-in dialog with the captcha on', () => {
  it('keeps the button usable before a token exists, and the send waits for one', async () => {
    answers['/api/auth/login'] = () => json({ twofaRequired: true })
    await mount(true)
    expect(submitButton().disabled).toBe(false)
    type(email(), 'name@example.com')
    type(password(), 'the-password')
    await submit()

    expect(sent).toEqual([])
    expect(submitButton().getAttribute('aria-disabled')).toBe('true')

    releaseToken('a-token')
    await settle()
    expect(sent.map((s) => s.body.turnstileToken)).toEqual(['a-token'])
  })
})
