/**
 * EmailCodeLogin — passwordless sign-in: request a mailed 6-digit code, verify it. Success
 * reloads like every login path; a 2FA account hands off to the challenge step instead.
 *
 * Against the real client (the typed `api`, `ApiError`), with only the network answered here: an
 * address or a code that is wrong is marked under its field and focused, and nothing is sent; a
 * code the Worker does not take is marked at the code field; a limit reached and a request the
 * captcha stopped are said in the form's notice, with no field marked and no toast.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SIGN_IN_MESSAGES as SAY } from '../../../../shared/signInSchema'
import type * as TurnstileModule from '../Turnstile'

let host: HTMLDivElement
let dispose: (() => void) | undefined
const requests: { url: string; body: unknown }[] = []
let requestResponse: () => Promise<Response> = () => Promise.resolve(json({ ok: true }))
let verifyResponse: () => Promise<Response> = () => Promise.resolve(json({ id: 1 }))
let reloads = 0
let twofaHandoffs = 0
let toasts: () => unknown[]

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

interface Captcha {
  status?: string
  /** The token the send waits for; undefined: it waits until the test is over. */
  token?: string
}

async function mount(email = 'user@example.com', captcha?: Captcha) {
  vi.resetModules()
  vi.doMock('../../core/apiFetch', () => ({
    apiFetch: (url: string, init?: RequestInit) => {
      requests.push({
        url,
        body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      })
      return url === '/api/auth/email-code/request' ? requestResponse() : verifyResponse()
    },
  }))
  vi.doMock('../Turnstile', async () => ({
    ...(await vi.importActual<typeof TurnstileModule>('../Turnstile')),
    default: (props: { onStatus?: (s: string) => void }) => {
      if (captcha?.status) props.onStatus?.(captcha.status)
      return null
    },
    turnstileEnabled: captcha !== undefined,
    resetTurnstile: () => undefined,
    waitForTurnstileToken: () =>
      captcha?.token === undefined ? new Promise(() => {}) : Promise.resolve(captcha.token),
  }))
  const { default: EmailCodeLogin } = await import('../EmailCodeLogin')
  toasts = (await import('../../core/toastStore')).toasts
  host = document.createElement('div')
  document.body.appendChild(host)
  dispose = render(
    () => (
      <EmailCodeLogin
        email={email}
        onBack={() => undefined}
        onTwofa={() => {
          twofaHandoffs += 1
        }}
      />
    ),
    host
  )
  await flush()
}

const flush = async () => {
  for (let i = 0; i < 6; i += 1) await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

const byTestId = (id: string) => host.querySelector<HTMLElement>(`[data-test-id="${id}"]`)
const notice = () => byTestId('emailcode-error')?.textContent ?? ''
const describedBy = (el: HTMLElement): string[] =>
  (el.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent ?? `(missing #${id})`)
const marked = (el: HTMLElement) => el.getAttribute('aria-invalid') === 'true'

function type(selector: string, value: string) {
  const input = host.querySelector<HTMLInputElement>(selector)!
  input.focus()
  input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

async function requestCode() {
  byTestId('emailcode-send')!.click()
  await flush()
}

async function verifyCode(code: string) {
  type('[data-test-id="emailcode-code"]', code)
  byTestId('emailcode-verify')!.click()
  await flush()
}

beforeEach(() => {
  requests.length = 0
  reloads = 0
  twofaHandoffs = 0
  requestResponse = () => Promise.resolve(json({ ok: true }))
  verifyResponse = () => Promise.resolve(json({ id: 1 }))
  vi.stubGlobal('location', {
    reload: () => (reloads += 1),
    href: 'https://app.example.com/',
  } as unknown as Location)
})

afterEach(() => {
  dispose?.()
  dispose = undefined
  host?.remove()
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('requesting', () => {
  it('prefills the email, posts the request, and advances to the code step', async () => {
    await mount('prefilled@example.com')
    expect((byTestId('emailcode-email') as HTMLInputElement).value).toBe('prefilled@example.com')

    await requestCode()
    expect(requests[0]).toEqual({
      url: '/api/auth/email-code/request',
      body: { email: 'prefilled@example.com', turnstileToken: '' },
    })
    expect(byTestId('emailcode-code')).not.toBeNull()
  })

  it('labels the address field', async () => {
    await mount()
    const input = byTestId('emailcode-email')!
    expect(host.querySelector(`label[for="${input.id}"]`)?.textContent).toBe('Email address')
  })

  it('marks and focuses an address that is not one, and sends nothing', async () => {
    await mount('name@example')
    await requestCode()

    const input = byTestId('emailcode-email')!
    expect(marked(input)).toBe(true)
    expect(describedBy(input)).toEqual([SAY.emailFormat])
    expect(document.activeElement).toBe(input)
    expect(requests).toEqual([])
  })

  it('says when to try again once the limit is reached, with no field marked', async () => {
    requestResponse = () =>
      Promise.resolve(json({ error: 'Too many attempts. Please try again in about 1 hour.' }, 429))
    await mount()
    await requestCode()

    expect(notice()).toBe('Too many attempts. Please try again in about 1 hour.')
    expect(marked(byTestId('emailcode-email')!)).toBe(false)
    expect(byTestId('emailcode-code')).toBeNull()
    expect(toasts()).toEqual([])
  })
})

describe('requesting with the captcha enabled', () => {
  it('keeps the button usable, and the hint says why the send waits', async () => {
    await mount('user@example.com', { status: 'ready' })

    const send = byTestId('emailcode-send') as HTMLButtonElement
    expect(send.disabled).toBe(false)
    expect(byTestId('captcha-hint')?.textContent).toBe(
      'Complete the verification above to continue.'
    )

    await requestCode()
    // Parked on the token: nothing has gone out, and the button says the form is busy.
    expect(requests).toEqual([])
    expect(send.getAttribute('aria-disabled')).toBe('true')
  })

  it('says what to do when the Worker refuses the token, with no field marked', async () => {
    requestResponse = () =>
      Promise.resolve(json({ error: 'Captcha verification failed. Please try again.' }, 403))
    await mount('user@example.com', { token: 'a-token' })
    await requestCode()

    expect(requests[0]!.body).toEqual({ email: 'user@example.com', turnstileToken: 'a-token' })
    expect(notice()).toBe(
      "Verification didn't go through. Try again, and complete the check if one appears."
    )
    expect(marked(byTestId('emailcode-email')!)).toBe(false)
    expect(toasts()).toEqual([])
  })
})

describe('the ways out', () => {
  it('offers "Back to sign in" as a button, so the keyboard reaches it', async () => {
    await mount()

    expect(byTestId('emailcode-back')!.tagName).toBe('BUTTON')
  })

  it('offers "Send another" as a button, so the keyboard reaches it', async () => {
    await mount()
    await requestCode()

    expect(byTestId('emailcode-resend')!.tagName).toBe('BUTTON')
  })
})

describe('verifying', () => {
  it('focuses the code field as soon as the send succeeds', async () => {
    await mount()
    await requestCode()
    expect(document.activeElement).toBe(byTestId('emailcode-code'))
  })

  it('posts email + code and reloads on success', async () => {
    await mount()
    await requestCode()
    await verifyCode('123456')

    expect(requests[1]).toEqual({
      url: '/api/auth/email-code/verify',
      body: { email: 'user@example.com', code: '123456' },
    })
    await vi.waitFor(() => {
      expect(reloads).toBe(1)
    })
  })

  it('keeps the news that confirming cleared the account, for after the reload', async () => {
    verifyResponse = () =>
      Promise.resolve(json({ id: 1, email: 'user@example.com', cleared: true }))
    sessionStorage.clear()
    await mount()
    await requestCode()
    await verifyCode('123456')

    await vi.waitFor(() => {
      expect(reloads).toBe(1)
    })
    expect(sessionStorage.getItem('tc:access-cleared')).toBe('sign-in')
  })

  it('keeps nothing when nothing was cleared', async () => {
    sessionStorage.clear()
    await mount()
    await requestCode()
    await verifyCode('123456')

    await vi.waitFor(() => {
      expect(reloads).toBe(1)
    })
    expect(sessionStorage.getItem('tc:access-cleared')).toBeNull()
  })

  it('hands off to the 2FA step instead of reloading when the account has 2FA', async () => {
    verifyResponse = () => Promise.resolve(json({ twofaRequired: true }))
    await mount()
    await requestCode()
    await verifyCode('123456')

    expect(twofaHandoffs).toBe(1)
    expect(reloads).toBe(0)
  })

  it('marks and focuses an empty code, and sends nothing', async () => {
    await mount()
    await requestCode()
    await verifyCode('   ')

    const input = byTestId('emailcode-code')!
    expect(describedBy(input)).toEqual([SAY.emailCode])
    expect(document.activeElement).toBe(input)
    expect(requests.map((r) => r.url)).toEqual(['/api/auth/email-code/request'])
  })

  it('marks the code the Worker does not take, and stays on the step', async () => {
    verifyResponse = () =>
      Promise.resolve(
        json({ error: SAY.emailCodeRefused, fields: { code: SAY.emailCodeRefused } }, 401)
      )
    await mount()
    await requestCode()
    await verifyCode('000000')

    const input = byTestId('emailcode-code')!
    expect(marked(input)).toBe(true)
    expect(describedBy(input)).toEqual([SAY.emailCodeRefused])
    expect(document.activeElement).toBe(input)
    expect(notice()).toBe('')
    expect(reloads).toBe(0)
    expect(toasts()).toEqual([])
  })
})
