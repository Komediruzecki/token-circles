/**
 * The sign-in screen's password form says what is wrong where it is wrong, against the real
 * client (the typed `api`, `ApiError`) with only the network answered here.
 *
 * A field that is wrong is marked and focused before anything is sent. A field the Worker names
 * is marked the same way. A refused sign-in is one message for the whole form and marks neither
 * field, whatever the answer carries: the Worker answers a wrong password and an address not
 * confirmed yet the same, so the message covers both and offers the confirm link again. A limit
 * reached and a request the captcha stopped are said in words of their own, and mark no field.
 * None of it is a toast. Creating an account, or asking for the confirm link again, ends on Check
 * your inbox, never in the app.
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

/**
 * The screen as the app mounts it, with the captcha off unless `captcha` turns it on. `opened` is
 * the fragment a confirm link sent this browser back with, read at boot as index.tsx reads it.
 */
async function mount(captcha?: Captcha, opened?: string) {
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
  if (opened !== undefined) {
    window.location.hash = opened
    ;(await import('../../core/emailVerification')).consumeEmailVerifyRedirect()
  }
  const { default: LoginScreen } = await import('../LoginScreen')
  toasts = (await import('../../core/toastStore')).toasts
  host = document.createElement('div')
  document.body.appendChild(host)
  dispose = render(() => <LoginScreen />, host)
  await settle()
}

/** What a refused password sign-in says, for a wrong password and an address not confirmed yet. */
const REFUSED =
  "That email and password don't match, or the email isn't confirmed yet. Just signed up? Open the link we emailed you in this browser, then sign in. Opened it in another browser or on another device? Sign in there first."

const settle = async () => {
  for (let i = 0; i < 8; i += 1) await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

const email = () => host.querySelector<HTMLInputElement>('#login-email')!
const password = () => host.querySelector<HTMLInputElement>('#login-password')!
const notice = () => host.querySelector('[data-test-id="login-error"]')!.textContent ?? ''
const authNotice = () => host.querySelector('[data-test-id="auth-notice"]')?.textContent ?? ''
const sendConfirmLink = () =>
  host.querySelector<HTMLButtonElement>('[data-test-id="send-confirm-link"]')
const inboxAddress = () =>
  host.querySelector('[data-test-id="check-inbox-address"]')?.textContent ?? null
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
  sessionStorage.clear()
  sent = []
  answers = {}
  reloads = 0
  passkeyAnswer = undefined
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

  it('says a refused sign-in once, for the whole form, as a wrong password or an address not confirmed yet, with no field marked', async () => {
    answers['/api/auth/login'] = () => json({ error: 'Invalid email or password' }, 401)
    await mount()
    type(email(), 'name@example.com')
    type(password(), 'not-the-password')
    await submit()

    expect(notice()).toBe(REFUSED)
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

    expect(notice()).toBe(REFUSED)
    expect(marked(email())).toBe(false)
    expect(marked(password())).toBe(false)
  })

  it('offers to send the confirm link again under a refused sign-in, and not under a limit reached', async () => {
    answers['/api/auth/login'] = () => json({ error: 'Invalid email or password' }, 401)
    await mount()
    type(email(), 'name@example.com')
    type(password(), 'the-password')
    await submit()
    expect(sendConfirmLink()?.textContent).toBe('Send the link again')

    answers['/api/auth/login'] = () =>
      json({ error: 'Too many attempts. Please try again in about 15 minutes.' }, 429)
    await submit()
    expect(sendConfirmLink()).toBeNull()
  })

  it('sends the confirm link for the address in the form from a refused sign-in, and shows Check your inbox for it', async () => {
    answers['/api/auth/login'] = () => json({ error: 'Invalid email or password' }, 401)
    answers['/api/auth/verify-email/resend'] = () => json({ ok: true })
    await mount()
    type(email(), ' name@example.com ')
    type(password(), 'the-password')
    await submit()
    sendConfirmLink()!.click()
    await settle()

    expect(sent.slice(1)).toEqual([
      {
        url: '/api/auth/verify-email/resend',
        body: { email: 'name@example.com', turnstileToken: '' },
      },
    ])
    expect(inboxAddress()).toBe('name@example.com')
    expect(reloads).toBe(0)
  })

  it('notes a sign-in that also confirmed the address, for the app to say once it has loaded', async () => {
    answers['/api/auth/login'] = () =>
      json({ id: 7, email: 'name@example.com', emailConfirmed: true })
    await mount()
    type(email(), 'name@example.com')
    type(password(), 'the-password')
    await submit()

    expect(reloads).toBe(1)
    expect(sessionStorage.getItem('tc:email-confirmed')).toBe('1')
  })

  it('notes nothing for a sign-in that did not confirm the address', async () => {
    answers['/api/auth/login'] = () => json({ id: 7, email: 'name@example.com' })
    await mount()
    type(email(), 'name@example.com')
    type(password(), 'the-password')
    await submit()

    expect(reloads).toBe(1)
    expect(sessionStorage.getItem('tc:email-confirmed')).toBeNull()
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

  it('says on Check your inbox to sign in with the password in the browser that opens the link', async () => {
    answers['/api/auth/register'] = () => json({ ok: true })
    await mount()
    button('Create one').click()
    await settle()
    type(email(), 'name@example.com')
    type(password(), 'a-new-password')
    await submit()

    expect(host.querySelector('[data-test-id="check-inbox-lead"]')?.textContent).toBe(
      'We sent a link to name@example.com. Open it in this browser, then sign in with your password. Opening it in another browser or on another device? Sign in there first.'
    )
  })

  it('says on Check your inbox to look in spam, or to create the account again with the same password', async () => {
    answers['/api/auth/register'] = () => json({ ok: true })
    await mount()
    button('Create one').click()
    await settle()
    type(email(), 'name@example.com')
    type(password(), 'a-new-password')
    await submit()

    expect(host.querySelector('[data-test-id="check-inbox-no-mail"]')?.textContent?.trim()).toBe(
      'No mail after a few minutes? Check your spam folder, or create the account again with the same password.'
    )
  })

  it('shows Check your inbox for the address, and signs in to nothing', async () => {
    answers['/api/auth/register'] = () => json({ ok: true })
    await mount()
    button('Create one').click()
    await settle()
    type(email(), 'name@example.com')
    type(password(), 'a-new-password')
    await submit()

    expect(sent.map((s) => s.url)).toEqual(['/api/auth/register'])
    expect(inboxAddress()).toBe('name@example.com')
    expect(host.querySelector('#login-password')).toBeNull()
    expect(reloads).toBe(0)
  })

  it('sends the link again from Check your inbox, for the same address, and says one is on its way', async () => {
    answers['/api/auth/register'] = () => json({ ok: true })
    answers['/api/auth/verify-email/resend'] = () => json({ ok: true })
    await mount()
    button('Create one').click()
    await settle()
    type(email(), 'name@example.com')
    type(password(), 'a-new-password')
    await submit()
    host.querySelector<HTMLButtonElement>('[data-test-id="check-inbox-resend"]')!.click()
    await settle()

    expect(sent.slice(1)).toEqual([
      {
        url: '/api/auth/verify-email/resend',
        body: { email: 'name@example.com', turnstileToken: '' },
      },
    ])
    expect(host.querySelector('[data-test-id="check-inbox-sent"]')?.textContent).toBe(
      'If name@example.com still needs confirming, a fresh link is on its way. Only the newest link works.'
    )
  })

  it('goes back from Check your inbox to signing in, with the address kept and no password', async () => {
    answers['/api/auth/register'] = () => json({ ok: true })
    await mount()
    button('Create one').click()
    await settle()
    type(email(), 'name@example.com')
    type(password(), 'a-new-password')
    await submit()
    host.querySelector<HTMLButtonElement>('[data-test-id="check-inbox-back"]')!.click()
    await settle()

    expect(inboxAddress()).toBeNull()
    expect(submitButton().textContent).toBe('Sign in')
    expect(email().value).toBe('name@example.com')
    expect(password().value).toBe('')
    expect(notice()).toBe('')
  })
})

describe('the sign-in screen after a confirm link that did not confirm', () => {
  const problem = () => host.querySelector('[data-test-id="link-problem"]')
  const resend = () => host.querySelector<HTMLButtonElement>('[data-test-id="link-problem-resend"]')

  it('says the link has expired, with Send the link again', async () => {
    await mount(undefined, '#everified_error=expired')

    expect(problem()?.querySelector('p')?.textContent).toBe(
      'That link has expired. Send the link again for a fresh one.'
    )
    expect(resend()?.textContent?.trim()).toBe('Send the link again')
  })

  it('says a used or replaced link does not work anymore, with Send the link again', async () => {
    await mount(undefined, '#everified_error=invalid_or_used')

    expect(problem()?.querySelector('p')?.textContent).toBe(
      "That link doesn't work anymore. Send the link again for a fresh one."
    )
    expect(resend()?.textContent?.trim()).toBe('Send the link again')
  })

  it('opens the form that sends the link, and sends it for the address typed', async () => {
    answers['/api/auth/verify-email/resend'] = () => json({ ok: true })
    await mount(undefined, '#everified_error=expired')
    resend()!.click()
    await settle()
    expect(problem()).toBeNull()
    expect(submitButton().textContent).toBe('Send the link again')
    type(email(), 'name@example.com')
    await submit()

    expect(sent).toEqual([
      {
        url: '/api/auth/verify-email/resend',
        body: { email: 'name@example.com', turnstileToken: '' },
      },
    ])
    expect(inboxAddress()).toBe('name@example.com')
  })

  it('leaves an address confirmed on the way in for the app to say, and shows no problem', async () => {
    sessionStorage.setItem('tc:email-confirmed', '1')
    await mount()

    expect(problem()).toBeNull()
    expect(sessionStorage.getItem('tc:email-confirmed')).toBe('1')
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
