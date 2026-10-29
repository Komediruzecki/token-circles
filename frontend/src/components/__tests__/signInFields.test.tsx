/**
 * The sign-in screens' fields, ported from MercuryPitch's sign-in sheet: the address and password
 * labels sit inside their boxes and move up once a field has focus or a value, and every password
 * field has a button that shows the password.
 *
 * The label is the field's name the whole time, and signing in does what it did: the same request
 * goes out, a reveal sends nothing, and the password goes back to hidden when the form is sent.
 * The address comes back with its label up after Back to sign in, and on the emailed-code step.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { JSX } from 'solid-js'
import type * as TurnstileModule from '../Turnstile'

interface Sent {
  url: string
  body: Record<string, unknown>
}

let host: HTMLDivElement
let dispose: (() => void) | undefined
let sent: Sent[]
let answers: Record<string, () => Response>

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const settle = async () => {
  for (let i = 0; i < 8; i += 1) await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

/** The network, the captcha (off) and passkeys (none), as every screen here meets them. */
function mockTheWorld() {
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
    default: () => null,
    turnstileEnabled: false,
    resetTurnstile: () => undefined,
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
  vi.doMock('../TwofaChallenge', () => ({ default: () => null }))
}

async function show(view: () => JSX.Element) {
  host = document.createElement('div')
  document.body.appendChild(host)
  dispose = render(view, host)
  await settle()
}

const mountLoginScreen = async () => {
  mockTheWorld()
  const { default: LoginScreen } = await import('../LoginScreen')
  await show(() => <LoginScreen />)
}

const mountLoginModal = async () => {
  mockTheWorld()
  const { default: LoginModal } = await import('../LoginModal')
  await show(() => <LoginModal onClose={() => undefined} onSuccess={() => undefined} />)
}

const mountResetPassword = async () => {
  mockTheWorld()
  const { default: ResetPassword } = await import('../ResetPassword')
  await show(() => <ResetPassword />)
}

beforeEach(() => {
  sessionStorage.clear()
  sent = []
  answers = {}
  vi.stubGlobal('location', {
    reload: () => undefined,
    href: 'https://app.example.com/',
    pathname: '/',
    search: '',
    hash: '#reset-password?token=abc',
  } as unknown as Location)
})

afterEach(() => {
  dispose?.()
  host.remove()
  vi.unstubAllGlobals()
})

const byId = (id: string) => document.getElementById(id) as HTMLInputElement
const labelOf = (input: HTMLInputElement) =>
  host.querySelector<HTMLLabelElement>(`label[for="${input.id}"]`)!
const revealOf = (input: HTMLInputElement) =>
  host.querySelector<HTMLButtonElement>(`button[aria-controls="${input.id}"]`)
/** The label rests at the box's middle (`top: 50%`); every floated rule moves it to the top. */
const floated = (input: HTMLInputElement) => window.getComputedStyle(labelOf(input)).top !== '50%'

/** The label names the input, and sits after it in the same box, where it can float. */
function expectFloatingLabel(input: HTMLInputElement, text: string) {
  const label = labelOf(input)
  expect(label.textContent).toBe(text)
  expect(input.labels?.[0]).toBe(label)
  expect(label.parentElement).toBe(input.parentElement)
  expect(input.compareDocumentPosition(label) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
}

function type(input: HTMLInputElement, value: string) {
  input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

function button(text: string): HTMLButtonElement {
  const found = [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)
  if (!found) throw new Error(`no button "${text}"`)
  return found
}

interface Recorded {
  calls: unknown[][]
  contexts: unknown[]
  invocationCallOrder: number[]
}

/**
 * How many submit listeners the page's forms hold in the capture phase, where only a password's
 * hide-on-submit listens. Worked out from every add and remove the DOM was asked for, in order,
 * by the DOM's own rule: a remove takes a listener off only when the function and the capture
 * flag both match, so a remove that leaves the flag out leaves the listener listening.
 */
function captureSubmitListeners() {
  const adds = vi.spyOn(EventTarget.prototype, 'addEventListener')
  const removes = vi.spyOn(EventTarget.prototype, 'removeEventListener')
  const capturing = (options: unknown) =>
    options === true ||
    (typeof options === 'object' &&
      options !== null &&
      (options as EventListenerOptions).capture === true)
  const listed = ({ calls, contexts, invocationCallOrder }: Recorded, adding: boolean) =>
    calls.map((call, i) => ({ adding, call, target: contexts[i], at: invocationCallOrder[i] ?? 0 }))
  return {
    on() {
      const held = new Set<unknown>()
      const all = [...listed(adds.mock, true), ...listed(removes.mock, false)]
      for (const { adding, call, target } of all.sort((a, b) => a.at - b.at)) {
        const [type, listener, options] = call
        if (!(target instanceof HTMLFormElement) || type !== 'submit' || !capturing(options)) {
          continue
        }
        if (adding) held.add(listener)
        else held.delete(listener)
      }
      return held.size
    },
    restore() {
      adds.mockRestore()
      removes.mockRestore()
    },
  }
}

describe('the sign-in screen', () => {
  const email = () => byId('login-email')
  const password = () => byId('login-password')

  it('puts the address and password labels inside their boxes, still naming the fields', async () => {
    await mountLoginScreen()
    expectFloatingLabel(email(), 'Email address')
    expectFloatingLabel(password(), 'Password')
    expect(floated(email())).toBe(false)
    expect(floated(password())).toBe(false)
    // Passkeys still come through the address field's autofill.
    expect(email().getAttribute('autocomplete')).toBe('username webauthn')
  })

  it('shows the password and hides it again, and signs in to nothing', async () => {
    await mountLoginScreen()
    type(email(), 'name@example.com')
    type(password(), 'a-long-password')
    const reveal = revealOf(password())!
    expect(reveal.getAttribute('aria-label')).toBe('Show password')
    expect(password().type).toBe('password')

    reveal.click()
    await settle()
    expect(password().type).toBe('text')
    expect(reveal.getAttribute('aria-label')).toBe('Hide password')
    // The name is the state. A pressed state as well would read as a double negative.
    expect(reveal.hasAttribute('aria-pressed')).toBe(false)

    reveal.click()
    await settle()
    expect(password().type).toBe('password')
    expect(reveal.getAttribute('aria-label')).toBe('Show password')
    expect(sent).toEqual([])
    // The address has no reveal button.
    expect(revealOf(email())).toBeNull()
  })

  it('keeps current-password for signing in and new-password for a new account', async () => {
    await mountLoginScreen()
    revealOf(password())!.click()
    expect(password().getAttribute('autocomplete')).toBe('current-password')

    button('Create one').click()
    await settle()
    expect(password().getAttribute('autocomplete')).toBe('new-password')
  })

  it('sends the password it shows, and hides it again once the form is sent', async () => {
    answers['/api/auth/login'] = () => json({ error: 'Invalid email or password' }, 401)
    await mountLoginScreen()
    type(email(), 'name@example.com')
    type(password(), 'a-long-password')
    revealOf(password())!.click()

    host.querySelector('form')!.requestSubmit()
    await settle()

    expect(sent.map((s) => [s.url, s.body.password])).toEqual([
      ['/api/auth/login', 'a-long-password'],
    ])
    expect(password().type).toBe('password')
    expect(revealOf(password())!.getAttribute('aria-label')).toBe('Show password')
  })

  it('takes the hide-on-submit listener away with the password field, so Back and one submit hide it once', async () => {
    answers['/api/auth/login'] = () => json({ error: 'Invalid email or password' }, 401)
    const listeners = captureSubmitListeners()
    try {
      await mountLoginScreen()
      expect(listeners.on()).toBe(1)

      // Forgot password? takes the password field away, and its listener with it.
      button('Forgot password?').click()
      await settle()
      expect(host.querySelector('#login-password')).toBeNull()
      expect(listeners.on()).toBe(0)

      // Back brings a new password field, which adds a listener of its own.
      button('Back to sign in').click()
      await settle()
      expect(listeners.on()).toBe(1)

      type(email(), 'name@example.com')
      type(password(), 'a-long-password')
      revealOf(password())!.click()
      await settle()
      expect(password().type).toBe('text')

      const flips: string[] = []
      const watching = new MutationObserver((records) => {
        for (const record of records) {
          flips.push(`${record.oldValue} to ${(record.target as HTMLInputElement).type}`)
        }
      })
      watching.observe(password(), {
        attributes: true,
        attributeFilter: ['type'],
        attributeOldValue: true,
      })
      host.querySelector('form')!.requestSubmit()
      await settle()
      watching.disconnect()

      expect(flips).toEqual(['text to password'])
      expect(sent.map((s) => [s.url, s.body.password])).toEqual([
        ['/api/auth/login', 'a-long-password'],
      ])
    } finally {
      listeners.restore()
    }
  })

  it('puts Forgot password? under the password field, and it still opens the reset form', async () => {
    await mountLoginScreen()
    const forgot = button('Forgot password?')
    expect(
      password().compareDocumentPosition(forgot) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(labelOf(password()).contains(forgot)).toBe(false)

    forgot.click()
    await settle()
    expect(host.querySelector('#login-password')).toBeNull()
    expect(host.querySelector('button[type="submit"]')?.textContent).toBe('Send reset link')
    expectFloatingLabel(email(), 'Email address')
  })

  it('has the address label up when Back to sign in brings the address back', async () => {
    answers['/api/auth/register'] = () => json({ ok: true })
    await mountLoginScreen()
    button('Create one').click()
    await settle()
    type(email(), 'name@example.com')
    type(password(), 'a-new-password')
    host.querySelector('form')!.requestSubmit()
    await settle()
    host.querySelector<HTMLButtonElement>('[data-test-id="check-inbox-back"]')!.click()
    await settle()

    expect(email().value).toBe('name@example.com')
    expect(floated(email())).toBe(true)
    expect(password().value).toBe('')
    expect(floated(password())).toBe(false)
  })

  it('has the address label up on the emailed-code step, for the address the form had', async () => {
    await mountLoginScreen()
    type(email(), 'name@example.com')
    host.querySelector<HTMLButtonElement>('[data-test-id="emailcode-open"]')!.click()
    await settle()

    const address = host.querySelector<HTMLInputElement>('[data-test-id="emailcode-email"]')!
    expect(address.value).toBe('name@example.com')
    expectFloatingLabel(address, 'Email address')
    expect(floated(address)).toBe(true)
  })
})

describe('the sign-in dialog', () => {
  it('floats its labels and shows the password on request, sending nothing', async () => {
    await mountLoginModal()
    const email = byId('login-modal-email')
    const password = byId('login-modal-password')
    expectFloatingLabel(email, 'Email address')
    expectFloatingLabel(password, 'Password')

    type(password, 'a-long-password')
    revealOf(password)!.click()
    await settle()

    expect(password.type).toBe('text')
    expect(revealOf(password)!.getAttribute('aria-label')).toBe('Hide password')
    expect(password.getAttribute('autocomplete')).toBe('current-password')
    expect(sent).toEqual([])
  })
})

describe('the new-password screen', () => {
  it('gives each new password a label in its box and a reveal button of its own', async () => {
    answers['/api/auth/reset-password?token=abc'] = () => json({ valid: true })
    await mountResetPassword()
    const labelled = (text: string) =>
      byId([...host.querySelectorAll('label')].find((l) => l.textContent === text)!.htmlFor)
    const first = labelled('New password')
    const second = labelled('Confirm new password')
    expectFloatingLabel(first, 'New password')
    expectFloatingLabel(second, 'Confirm new password')

    revealOf(first)!.click()
    await settle()
    expect(first.type).toBe('text')
    expect(second.type).toBe('password')
    expect(first.getAttribute('autocomplete')).toBe('new-password')
    expect(second.getAttribute('autocomplete')).toBe('new-password')

    revealOf(second)!.click()
    await settle()
    expect(second.type).toBe('text')
    expect(sent.map((s) => s.url)).toEqual(['/api/auth/reset-password?token=abc'])
  })
})
