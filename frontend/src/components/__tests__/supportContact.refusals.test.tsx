/**
 * The support form says what is wrong where it is wrong. It posts with `fetch` itself (it has to
 * work in any storage mode, signed out too), so only the network is answered here.
 *
 * An address that is missing or not an address, and a message that is too short, are marked under
 * their fields and focused before anything is sent. A field the Worker names is marked the same
 * way. A limit reached, a request the captcha stopped and a captcha that cannot run are said in
 * the notice, and mark no field. None of it is a toast.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { refusalOf } from '../../../../shared/refusal'
import { SIGN_IN_MESSAGES as SAY } from '../../../../shared/signInSchema'
import { UNREACHABLE } from '../../core/apiError'
import { CAPTCHA_REFUSED } from '../captchaGate'
import type * as TurnstileModule from '../Turnstile'
import type { TurnstileStatus } from '../Turnstile'

interface Captcha {
  /** What the widget reports. */
  status?: TurnstileStatus
  /** A token the widget hands over as soon as it renders. */
  issued?: string
  /** The token the wait on submit ends with; undefined: no token comes. */
  token?: string
}

let host: HTMLDivElement
let dispose: (() => void) | undefined
let sent: Record<string, unknown>[]
let answer: () => Response | Promise<Response>
let toasts: () => unknown[]

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

/** The form as a page mounts it, opened, with the captcha off unless `captcha` turns it on. */
async function open(captcha?: Captcha) {
  vi.resetModules()
  vi.doMock('../Turnstile', async () => ({
    ...(await vi.importActual<typeof TurnstileModule>('../Turnstile')),
    default: (props: {
      onStatus?: (status: TurnstileStatus) => void
      onToken?: (token: string) => void
    }) => {
      if (captcha?.status) props.onStatus?.(captcha.status)
      if (captcha?.issued) props.onToken?.(captcha.issued)
      return null
    },
    turnstileEnabled: captcha !== undefined,
    resetTurnstile: () => undefined,
    waitForTurnstileToken: () =>
      captcha?.token === undefined
        ? Promise.reject(new Error('Verification timed out'))
        : Promise.resolve(captcha.token),
  }))
  const { default: SupportContact } = await import('../SupportContact')
  toasts = (await import('../../core/toastStore')).toasts
  host = document.createElement('div')
  document.body.appendChild(host)
  dispose = render(() => <SupportContact />, host)
  ;[...host.querySelectorAll('a')].find((a) => a.textContent?.includes('Contact support'))!.click()
  await settle()
}

const settle = async () => {
  for (let i = 0; i < 8; i += 1) await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

/** The control a visible label names. */
function labelled(text: string): HTMLInputElement | HTMLTextAreaElement {
  const label = [...host.querySelectorAll('label')].find((l) => l.textContent?.trim() === text)
  if (!label) throw new Error(`no field labelled "${text}"`)
  const control = document.getElementById(label.htmlFor)
  if (!(control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement)) {
    throw new Error(`"${text}" labels no input`)
  }
  return control
}

const address = () => labelled('Your email address')
const message = () => labelled('Message')
const notice = () => host.querySelector('[data-test-id="support-error"]')?.textContent ?? ''
const describedBy = (el: HTMLElement): string[] =>
  (el.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent ?? `(missing #${id})`)
const marked = (el: HTMLElement) => el.getAttribute('aria-invalid') === 'true'

function type(control: HTMLInputElement | HTMLTextAreaElement, value: string) {
  control.value = value
  control.dispatchEvent(new Event('input', { bubbles: true }))
}

async function send(email: string, text: string) {
  type(address(), email)
  type(message(), text)
  host.querySelector('form')!.requestSubmit()
  await settle()
}

beforeEach(() => {
  sent = []
  answer = () => json({ ok: true, ticketId: 'TC-1A2B3C4D' })
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {}
    sent.push({ url, ...(body as Record<string, unknown>) })
    return Promise.resolve(answer())
  })
})

afterEach(() => {
  dispose?.()
  host.remove()
  vi.unstubAllGlobals()
})

describe('before anything is sent', () => {
  it('marks an empty form at both fields and focuses the address', async () => {
    await open()
    await send('', '')

    expect(describedBy(address())).toContain(SAY.email)
    expect(describedBy(message())).toContain(SAY.supportMessage)
    expect(document.activeElement).toBe(address())
    expect(sent).toEqual([])
  })

  it('marks an address that is not one', async () => {
    await open()
    await send('name-at-example.com', 'I cannot sign in.')

    expect(marked(address())).toBe(true)
    expect(describedBy(address())).toContain(SAY.emailFormat)
    expect(marked(message())).toBe(false)
    expect(sent).toEqual([])
  })

  it('marks a message shorter than 5 characters and focuses it', async () => {
    await open()
    await send('name@example.com', 'Hi')

    expect(marked(message())).toBe(true)
    expect(describedBy(message())).toContain(SAY.supportMessage)
    expect(document.activeElement).toBe(message())
    expect(sent).toEqual([])
  })
})

describe('what the Worker answers', () => {
  it('sends the address and the message, and shows the reference number', async () => {
    await open()
    await send(' name@example.com ', ' I cannot sign in. ')

    expect(sent).toEqual([
      {
        url: '/api/support/contact',
        email: 'name@example.com',
        message: 'I cannot sign in.',
        turnstileToken: '',
      },
    ])
    expect(host.textContent).toContain('Your reference number: TC-1A2B3C4D')
  })

  it('marks a field the Worker names, in its words, and focuses it', async () => {
    answer = () => json(refusalOf({ message: 'Write the message in plain text.' }), 400)
    await open()
    await send('name@example.com', 'I cannot sign in.')

    expect(marked(message())).toBe(true)
    expect(describedBy(message())).toContain('Write the message in plain text.')
    expect(document.activeElement).toBe(message())
    expect(toasts()).toEqual([])
  })

  it('says to wait, and for how long, when the limit is reached, and marks no field', async () => {
    answer = () =>
      json({ error: 'Too many attempts. Please try again in 1 hour.' }, 429, {
        'Retry-After': '3600',
      })
    await open()
    await send('name@example.com', 'I cannot sign in.')

    expect(notice()).toBe('Too many attempts. Please try again in 1 hour.')
    expect(marked(address())).toBe(false)
    expect(marked(message())).toBe(false)
    expect(toasts()).toEqual([])
  })

  it('says the message did not leave the device when nothing answers', async () => {
    answer = () => Promise.reject(new TypeError('Failed to fetch'))
    await open()
    await send('name@example.com', 'I cannot sign in.')

    expect(notice()).toBe(UNREACHABLE)
    expect(marked(address())).toBe(false)
    expect(marked(message())).toBe(false)
  })
})

describe('the captcha', () => {
  it('sends the token the widget handed over', async () => {
    await open({ status: 'solved', issued: 'turnstile-token' })
    await send('name@example.com', 'I cannot sign in.')

    expect(sent.map((s) => s.turnstileToken)).toEqual(['turnstile-token'])
  })

  it('uses a token for one request, and waits for a new one for the next', async () => {
    answer = () => json({ error: 'Too many attempts. Please try again in 1 hour.' }, 429)
    await open({ status: 'solved', issued: 'first-token', token: 'next-token' })
    await send('name@example.com', 'I cannot sign in.')
    answer = () => json({ ok: true, ticketId: 'TC-1A2B3C4D' })
    host.querySelector('form')!.requestSubmit()
    await settle()

    expect(sent.map((s) => s.turnstileToken)).toEqual(['first-token', 'next-token'])
    expect(host.textContent).toContain('Your reference number: TC-1A2B3C4D')
  })

  it('says to try again, and to complete the check, when the Worker refuses the token', async () => {
    answer = () => json({ error: 'Captcha verification failed. Please try again.' }, 403)
    await open({ status: 'solved', token: 'turnstile-token' })
    await send('name@example.com', 'I cannot sign in.')

    expect(notice()).toBe(CAPTCHA_REFUSED)
    expect(marked(address())).toBe(false)
    expect(marked(message())).toBe(false)
  })

  it('says what to fix, and sends nothing, when the check cannot run', async () => {
    const { captchaStatusMessage } = await vi.importActual<typeof TurnstileModule>('../Turnstile')
    await open({ status: 'unreachable' })
    await send('name@example.com', 'I cannot sign in.')

    expect(notice()).toBe(captchaStatusMessage('unreachable'))
    expect(marked(address())).toBe(false)
    expect(sent).toEqual([])
  })
})
