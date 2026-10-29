/**
 * The captcha on every form behind it, with the real widget code (Turnstile.tsx, captchaGate.ts,
 * CaptchaCheck.tsx) and a stand-in for Cloudflare's `window.turnstile` that the test drives: it
 * hands over a token, asks for a tick, or lets a token expire, as Cloudflare's frame would.
 *
 * What maff saw on 5.17.1: the button said "Signing in…" while the line under it said to complete
 * the check, and the check came back after a wrong password and after a reset link was sent. These
 * hold the forms to the fix:
 * - a press before the token says it is checking, not signing in, and sends once the token comes;
 * - while Cloudflare's box waits for a tick, the form waits too: a press sends nothing, clears
 *   nothing, and the button is never busy beside the box;
 * - a refused send starts the next check at once, on the form's own widget, with nothing drawn
 *   for a person Cloudflare passes without a click;
 * - a send that worked starts no new check until the person is back in the form;
 * - a press the person left behind (another mode, another step, a closed dialog) never goes out;
 * - an expired token is never sent, and the one Cloudflare fetches next is.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { JSX } from 'solid-js'

const CHECKING = "Checking you're human…"
const TICK = 'Tick the box above first.'

interface Widget {
  id: string
  opts: Record<string, unknown>
}

let host: HTMLDivElement
let dispose: (() => void) | undefined
let widgets: Widget[]
/** The widget ids `turnstile.reset` was called with; '(none)' for a bare reset(). */
let resets: string[]
let sent: { url: string; body: Record<string, unknown> }[]
/** What answers each request; a request with no answer waits for good. */
let answers: Record<string, () => Response>
/** While set, Cloudflare's script waits here to load, until the test lets it. */
let scriptLoads: (() => void)[] | undefined
let appendSpy: { mockRestore: () => void }

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function answer(url: string, init?: RequestInit): Promise<Response> {
  sent.push({ url, body: typeof init?.body === 'string' ? JSON.parse(init.body) : {} })
  const reply = answers[url]
  return reply ? Promise.resolve(reply()) : new Promise<Response>(() => {})
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** How long Cloudflare's frame takes after a tick before the token comes. */
const AFTER_TICK_MS = 30

/**
 * Long enough for a hold that is still waiting to take a token: a send polls for one every 150 ms
 * (waitForTurnstileToken), so a press left behind would have gone out by then.
 */
const LONG_ENOUGH_MS = 500

/** Cloudflare's frame, as far as a form can tell. */
const cf = {
  widget: () => {
    const last = widgets.at(-1)
    if (!last) throw new Error('no widget was drawn')
    return last
  },
  call: (name: string, ...args: unknown[]) => {
    const fn = cf.widget().opts[name]
    if (typeof fn === 'function') (fn as (...a: unknown[]) => void)(...args)
  },
  /** The check passed without a click. */
  pass: (token: string) => {
    cf.call('callback', token)
  },
  /** The check wants a click: in interaction-only mode the box appears now. */
  ask: () => {
    cf.call('before-interactive-callback')
  },
  /** The box was ticked: the check carries on, and its token comes a moment later. */
  tick: (token: string) => {
    cf.call('after-interactive-callback')
    const widget = cf.widget()
    setTimeout(() => {
      const fn = widget.opts.callback
      if (typeof fn === 'function') (fn as (t: string) => void)(token)
    }, AFTER_TICK_MS)
  },
  expire: () => {
    cf.call('expired-callback')
  },
}

const settle = async () => {
  for (let i = 0; i < 8; i += 1) await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

async function until(check: () => boolean, what: string) {
  const end = Date.now() + 3000
  while (!check()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`)
    await sleep(10)
  }
}

const button = () => host.querySelector<HTMLButtonElement>('button[type="submit"]')!
const hint = () => host.querySelector('[data-test-id="captcha-hint"]')
const hintText = () => hint()?.textContent ?? ''
const byText = (text: string) =>
  [...host.querySelectorAll<HTMLElement>('button, a')].find((b) => b.textContent === text)!
const tokens = (url: string) => sent.filter((s) => s.url === url).map((s) => s.body.turnstileToken)
const urls = () => sent.map((s) => s.url)
const describedBy = (el: HTMLElement): string[] =>
  (el.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent ?? `(missing #${id})`)

function type(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

/** A press on the button, as a person makes it. */
async function press() {
  button().click()
  await settle()
}

/** A submit that does not come through the button (Enter in a field, a password manager). */
async function submitTheForm() {
  button().form!.requestSubmit()
  await settle()
}

/** The one rule this file is about: the button is never busy beside a box waiting for a tick. */
function neverBusyBesideTheBox(idle: string) {
  if (hintText() === '') return
  expect(button().textContent).toBe(idle)
  expect(button().form!.getAttribute('aria-busy')).toBeNull()
}

beforeEach(() => {
  vi.resetModules()
  vi.stubEnv('VITE_TURNSTILE_SITE_KEY', 'test-site-key')
  widgets = []
  resets = []
  sent = []
  answers = {}
  scriptLoads = undefined
  // jsdom runs no remote script: "load" Cloudflare's by installing the stand-in.
  appendSpy = vi.spyOn(document.head, 'appendChild').mockImplementation(((node: Node) => {
    if (node instanceof HTMLScriptElement && node.src.includes('challenges.cloudflare.com')) {
      const load = () => {
        window.turnstile = {
          render: (_el: HTMLElement, opts: Record<string, unknown>) => {
            const id = `widget-${widgets.length + 1}`
            widgets.push({ id, opts })
            return id
          },
          reset: (id?: string) => {
            resets.push(id ?? '(none)')
          },
          remove: () => {},
        }
        node.onload?.(new Event('load'))
      }
      if (scriptLoads) scriptLoads.push(load)
      else queueMicrotask(load)
    }
    return node
  }) as typeof document.head.appendChild)
  vi.doMock('../../core/apiFetch', () => ({ apiFetch: answer }))
  vi.stubGlobal('fetch', answer)
  vi.stubGlobal('location', {
    reload: () => undefined,
    href: 'https://app.example.com/',
    pathname: '/',
    search: '',
    hash: '',
  } as unknown as Location)
  vi.doMock('../../core/webauthn', () => ({
    conditionalMediationAvailable: () => Promise.resolve(false),
    markPasskeyNudgeAfterLogin: () => undefined,
    passkeysSupported: () => false,
    signInWithPasskey: () => Promise.resolve({ ok: false, error: 'x', aborted: true }),
  }))
  vi.doMock('../../core/appVersion', () => ({ displayVersion: () => '9.9.9' }))
  vi.doMock('../../core/storage/storageFactory', () => ({ setStorageMode: () => undefined }))
  vi.doMock('../TwofaChallenge', () => ({ default: () => null }))
  // Stood in for by the screens that hold them; the real ones when they are the screen.
  vi.doUnmock('../SupportContact')
  vi.doUnmock('../EmailCodeLogin')
})

afterEach(() => {
  dispose?.()
  dispose = undefined
  host.remove()
  appendSpy.mockRestore()
  delete window.turnstile
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function show(view: () => JSX.Element) {
  host = document.createElement('div')
  document.body.appendChild(host)
  dispose = render(view, host)
  await settle()
  await until(() => widgets.length > 0, 'the widget to be drawn')
}

const field = (selector: string) =>
  host.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!

/** The sign-in screen in one of its modes, with its own widget only. */
async function signInScreen(
  mode: 'login' | 'register' | 'forgot' = 'login',
  options: { emailCode?: boolean } = {}
) {
  vi.doMock('../SupportContact', () => ({ default: () => null }))
  if (!options.emailCode) vi.doMock('../EmailCodeLogin', () => ({ default: () => null }))
  const { default: LoginScreen } = await import('../LoginScreen')
  await show(() => <LoginScreen />)
  const link = { register: 'Create one', forgot: 'Forgot password?' } as const
  if (mode !== 'login') {
    byText(link[mode]).click()
    await settle()
  }
  type(field('#login-email'), 'someone@example.com')
  if (mode !== 'forgot') type(field('#login-password'), 'a-long-enough-password')
}

async function signInDialog() {
  vi.doMock('../EmailCodeLogin', () => ({ default: () => null }))
  const { default: LoginModal } = await import('../LoginModal')
  await show(() => <LoginModal onClose={() => undefined} onSuccess={() => undefined} />)
  type(field('#login-modal-email'), 'someone@example.com')
  type(field('#login-modal-password'), 'a-long-enough-password')
}

async function supportForm() {
  const { default: SupportContact } = await import('../SupportContact')
  host = document.createElement('div')
  document.body.appendChild(host)
  dispose = render(() => <SupportContact />, host)
  await openSupport()
  type(field('input[type="email"]'), 'someone@example.com')
  type(field('textarea'), 'I cannot sign in.')
}

async function openSupport() {
  const drawn = widgets.length
  ;[...host.querySelectorAll('a')].find((a) => a.textContent?.includes('Contact support'))!.click()
  await settle()
  await until(() => widgets.length > drawn, 'the widget to be drawn')
}

interface Screen {
  name: string
  open: () => Promise<void>
  url: string
  idle: string
  sending: string
}

const screens: Screen[] = [
  {
    name: 'signing in',
    open: () => signInScreen('login'),
    url: '/api/auth/login',
    idle: 'Sign in',
    sending: 'Signing in…',
  },
  {
    name: 'creating an account',
    open: () => signInScreen('register'),
    url: '/api/auth/register',
    idle: 'Create account',
    sending: 'Creating your account…',
  },
  {
    name: 'asking for a reset link',
    open: () => signInScreen('forgot'),
    url: '/api/auth/forgot-password',
    idle: 'Send reset link',
    sending: 'Sending…',
  },
  {
    name: 'sending the confirm link again',
    open: async () => {
      const { default: CheckInbox } = await import('../CheckInbox')
      await show(() => <CheckInbox email="someone@example.com" onBack={() => undefined} />)
    },
    url: '/api/auth/verify-email/resend',
    idle: 'Send the link again',
    sending: 'Sending…',
  },
  {
    name: 'asking for a sign-in code',
    open: async () => {
      const { default: EmailCodeLogin } = await import('../EmailCodeLogin')
      await show(() => (
        <EmailCodeLogin
          email="someone@example.com"
          onBack={() => undefined}
          onTwofa={() => undefined}
        />
      ))
    },
    url: '/api/auth/email-code/request',
    idle: 'Email me a code',
    sending: 'Sending…',
  },
  {
    name: 'signing in from the dialog',
    open: signInDialog,
    url: '/api/auth/login',
    idle: 'Sign in',
    sending: 'Signing in…',
  },
  {
    name: 'writing to support',
    open: supportForm,
    url: '/api/support/contact',
    idle: 'Send message',
    sending: 'Sending…',
  },
]

describe.each(screens)('the captcha when $name', (screen) => {
  it('draws the widget only when Cloudflare wants a click', async () => {
    await screen.open()
    expect(cf.widget().opts.appearance).toBe('interaction-only')
    expect(hintText()).toBe('')
  })

  it('says it is checking, not sending, while a press waits for the token, then sends it', async () => {
    await screen.open()
    await press()

    expect(sent).toEqual([])
    expect(button().textContent).toBe(CHECKING)
    expect(hintText()).toBe('')

    cf.pass('token-1')
    await until(() => sent.length > 0, 'the request')
    expect(tokens(screen.url)).toEqual(['token-1'])
    expect(button().textContent).toBe(screen.sending)
  })

  it('waits for a tick while the box is up: a press sends nothing and the button is not busy', async () => {
    await screen.open()
    // The line is a live region on the page before it says anything: one that appears together
    // with its words is not reliably announced.
    const region = hint()
    expect(region?.getAttribute('role')).toBe('status')
    expect(region?.textContent).toBe('')
    cf.ask()
    await settle()

    expect(hint()).toBe(region)
    expect(hintText()).toBe(TICK)
    expect(button().getAttribute('aria-disabled')).toBe('true')
    expect(describedBy(button())).toEqual([TICK])

    await press()
    await submitTheForm()
    expect(sent).toEqual([])
    expect(button().textContent).toBe(screen.idle)
    neverBusyBesideTheBox(screen.idle)

    // Ticked: the box lets the form go at once, before the token is there.
    cf.tick('token-1')
    await settle()
    expect(hintText()).toBe('')
    expect(button().hasAttribute('aria-disabled')).toBe(false)

    await press()
    expect(button().textContent).toBe(CHECKING)
    await until(() => sent.length > 0, 'the request')
    expect(tokens(screen.url)).toEqual(['token-1'])
  })

  it('steps back from a held press when the box comes up, and is never busy beside it', async () => {
    await screen.open()
    await press()
    expect(button().textContent).toBe(CHECKING)

    cf.ask()
    await settle()
    expect(hintText()).toBe(TICK)
    neverBusyBesideTheBox(screen.idle)
    expect(button().getAttribute('aria-disabled')).toBe('true')
    expect(host.textContent).not.toContain("didn't go through")

    // Ticking does not send on its own: the press that sends is the next one, with what the
    // fields say then.
    cf.tick('token-1')
    await sleep(LONG_ENOUGH_MS)
    expect(sent).toEqual([])
    await press()
    await until(() => sent.length > 0, 'the request')
    expect(tokens(screen.url)).toEqual(['token-1'])
  })
})

describe('the sign-in screen after a send', () => {
  it('starts the next check at once after a refused sign-in, on its own widget', async () => {
    answers['/api/auth/login'] = () => json({ error: 'Invalid email or password' }, 401)
    await signInScreen('login')
    cf.pass('token-1')
    await press()
    await until(() => host.textContent?.includes("don't match") ?? false, 'the refusal')

    // By id: a bare reset() resets one widget, which may be another form's.
    expect(resets).toEqual([cf.widget().id])
    // A person Cloudflare passes without a click sees nothing: no box, nothing to tick.
    expect(hintText()).toBe('')
    expect(button().hasAttribute('aria-disabled')).toBe(false)

    cf.pass('token-2')
    delete answers['/api/auth/login']
    await press()
    await until(() => sent.length === 2, 'the second request')
    expect(tokens('/api/auth/login')).toEqual(['token-1', 'token-2'])
  })

  it('starts no new check after a reset link is sent, until the person is back in the form', async () => {
    answers['/api/auth/forgot-password'] = () => json({ ok: true })
    await signInScreen('forgot')
    cf.pass('token-1')
    await press()
    await until(() => host.textContent?.includes('a reset link is on its way') ?? false, 'sent')

    // Nothing to ask Cloudflare for: a person it asks to click would get a box for nothing.
    expect(resets).toEqual([])

    field('#login-email').focus()
    await settle()
    expect(resets).toEqual([cf.widget().id])
  })

  it('starts no check while a send is out, so no box can come up beside its busy button', async () => {
    await signInScreen('login')
    cf.pass('token-1')
    await press()
    expect(button().textContent).toBe('Signing in…')

    field('#login-email').focus()
    await settle()
    expect(resets).toEqual([])
    expect(button().textContent).toBe('Signing in…')
  })

  it('starts the check on a press after a reset link was sent, and says it is checking', async () => {
    answers['/api/auth/forgot-password'] = () => json({ ok: true })
    await signInScreen('forgot')
    cf.pass('token-1')
    await press()
    await until(() => host.textContent?.includes('a reset link is on its way') ?? false, 'sent')

    await press()
    expect(resets).toEqual([cf.widget().id])
    expect(button().textContent).toBe(CHECKING)
    cf.pass('token-2')
    await until(() => sent.length === 2, 'the second request')
    expect(tokens('/api/auth/forgot-password')).toEqual(['token-1', 'token-2'])
  })

  it('starts the check at once for a sign-in pressed while the reset link is still on its way', async () => {
    await signInScreen('forgot')
    cf.pass('token-1')
    await press()
    await until(() => sent.length === 1, 'the reset link request')

    byText('Back to sign in').click()
    await settle()
    type(field('#login-password'), 'a-long-enough-password')
    await press()
    expect(resets).toEqual([cf.widget().id])
    expect(button().textContent).toBe(CHECKING)

    cf.pass('token-2')
    await until(() => sent.length === 2, 'the sign-in')
    expect(tokens('/api/auth/login')).toEqual(['token-2'])
  })

  it('keeps a token Cloudflare fetched by itself after a reset link was sent', async () => {
    answers['/api/auth/forgot-password'] = () => json({ ok: true })
    await signInScreen('forgot')
    cf.pass('token-1')
    await press()
    await until(() => host.textContent?.includes('a reset link is on its way') ?? false, 'sent')

    // Five minutes on, the token that went out expires in Cloudflare's frame, which fetches
    // the next one by itself.
    cf.expire()
    cf.pass('token-2')
    field('#login-email').focus()
    await settle()
    expect(resets).toEqual([])

    await press()
    await until(() => sent.length === 2, 'the second request')
    expect(tokens('/api/auth/forgot-password')).toEqual(['token-1', 'token-2'])
  })

  it('never sends an expired token, and sends the one Cloudflare fetches next', async () => {
    await signInScreen('login')
    // Cloudflare fetches the next token by itself when one expires unused.
    expect(cf.widget().opts['refresh-expired']).toBe('auto')
    cf.pass('token-1')
    cf.expire()
    await press()

    expect(sent).toEqual([])
    expect(button().textContent).toBe(CHECKING)
    cf.pass('token-2')
    await until(() => sent.length > 0, 'the request')
    expect(tokens('/api/auth/login')).toEqual(['token-2'])
  })
})

describe('a submit while the box waits', () => {
  it('keeps the refusal on screen: the press is no submit, so nothing is cleared', async () => {
    answers['/api/auth/login'] = () => json({ error: 'Invalid email or password' }, 401)
    await signInScreen('login')
    cf.pass('token-1')
    await press()
    await until(() => host.textContent?.includes("don't match") ?? false, 'the refusal')
    const refusal = host.querySelector('[data-test-id="login-error"]')?.textContent

    // The next check wants a click, and the password manager submits the form anyway.
    cf.ask()
    await settle()
    await submitTheForm()
    await press()

    expect(sent).toHaveLength(1)
    expect(host.querySelector('[data-test-id="login-error"]')?.textContent).toBe(refusal)
    expect(button().textContent).toBe('Sign in')
  })

  it('keeps the note that the reset link is on its way', async () => {
    answers['/api/auth/forgot-password'] = () => json({ ok: true })
    await signInScreen('forgot')
    cf.pass('token-1')
    await press()
    await until(() => host.textContent?.includes('a reset link is on its way') ?? false, 'sent')

    field('#login-email').focus()
    await settle()
    cf.ask()
    await settle()
    await submitTheForm()

    expect(sent).toHaveLength(1)
    expect(host.querySelector('[data-test-id="auth-notice"]')?.textContent).toContain(
      'a reset link is on its way'
    )
  })

  it("keeps the dialog's word on the passkey that failed", async () => {
    const noPasskey = 'This device has no passkey for Token Circles.'
    vi.doMock('../../core/webauthn', () => ({
      conditionalMediationAvailable: () => Promise.resolve(false),
      markPasskeyNudgeAfterLogin: () => undefined,
      passkeysSupported: () => true,
      signInWithPasskey: () => Promise.resolve({ ok: false, error: noPasskey, aborted: false }),
    }))
    await signInDialog()
    const said = () => host.querySelector('[data-test-id="passkey-error"]')?.textContent
    host.querySelector<HTMLElement>('[data-test-id="passkey-signin"]')!.click()
    await settle()
    expect(said()).toBe(noPasskey)

    cf.ask()
    await settle()
    await submitTheForm()
    expect(said()).toBe(noPasskey)
    expect(sent).toEqual([])
  })

  it('lets the form go when the box gives up waiting for a tick', async () => {
    await signInScreen('login')
    cf.ask()
    await settle()
    expect(button().getAttribute('aria-disabled')).toBe('true')

    // Cloudflare starts the check over by itself; the form waits for the box no longer.
    cf.call('timeout-callback')
    await settle()
    expect(hintText()).toBe('')
    expect(button().hasAttribute('aria-disabled')).toBe(false)
    await press()
    expect(button().textContent).toBe(CHECKING)
  })
})

describe('a browser Cloudflare cannot run in', () => {
  it('says so, offers no retry that cannot help, and sends nothing', async () => {
    await signInScreen('login')
    cf.call('unsupported-callback')
    await settle()

    const panel = host.querySelector('[data-test-id="captcha-blocked"]')
    expect(panel?.textContent).toContain("This browser can't run Cloudflare's verification")
    expect(host.querySelector('[data-test-id="captcha-retry"]')).toBeNull()
    await press()
    expect(sent).toEqual([])
    expect(host.querySelector('[data-test-id="login-error"]')?.textContent).toContain(
      "This browser can't run Cloudflare's verification"
    )
  })
})

describe('a press left behind', () => {
  it('never goes out when the sign-in screen switches mode, and the newer press steps back for the box', async () => {
    await signInScreen('login')
    await press()
    expect(button().textContent).toBe(CHECKING)

    byText('Forgot password?').click()
    await settle()
    expect(button().textContent).toBe('Send reset link')
    await press()
    expect(button().textContent).toBe(CHECKING)

    cf.ask()
    await settle()
    neverBusyBesideTheBox('Send reset link')
    expect(hintText()).toBe(TICK)

    cf.tick('token-1')
    await sleep(LONG_ENOUGH_MS)
    expect(sent).toEqual([])

    await press()
    await until(() => sent.length > 0, 'the reset link request')
    await sleep(LONG_ENOUGH_MS)
    expect(urls()).toEqual(['/api/auth/forgot-password'])
    expect(tokens('/api/auth/forgot-password')).toEqual(['token-1'])
  })

  it('never goes out when the person switches mode and presses nothing more', async () => {
    await signInScreen('login')
    await press()
    byText('Forgot password?').click()
    await settle()

    cf.pass('token-1')
    await sleep(LONG_ENOUGH_MS)
    expect(sent).toEqual([])
    expect(button().textContent).toBe('Send reset link')
  })

  it('never goes out when the dialog switches mode and nothing more is pressed', async () => {
    await signInDialog()
    await press()
    byText('Create one').click()
    await settle()

    cf.pass('token-1')
    await sleep(LONG_ENOUGH_MS)
    expect(sent).toEqual([])
  })

  it('never goes out when the dialog switches to creating an account', async () => {
    await signInDialog()
    await press()
    expect(button().textContent).toBe(CHECKING)

    byText('Create one').click()
    await settle()
    await press()
    cf.pass('token-1')
    await until(() => sent.length > 0, 'the sign-up')
    await sleep(LONG_ENOUGH_MS)
    expect(urls()).toEqual(['/api/auth/register'])
  })

  it('never goes out after the sign-in code step and back', async () => {
    await signInScreen('login', { emailCode: true })
    const drawn = widgets.length
    await press()
    expect(button().textContent).toBe(CHECKING)

    byText('Email me a sign-in code').click()
    await settle()
    await until(() => widgets.length > drawn, "the code step's widget")
    host.querySelector<HTMLButtonElement>('[data-test-id="emailcode-back"]')!.click()
    await settle()
    await until(() => widgets.length > drawn + 1, "the form's new widget")

    cf.pass('token-new')
    await sleep(LONG_ENOUGH_MS)
    expect(sent).toEqual([])
    expect(button().textContent).toBe('Sign in')
  })

  it('never goes out when the support dialog is closed and opened again', async () => {
    await supportForm()
    await press()
    expect(button().textContent).toBe(CHECKING)

    byText('Cancel').click()
    await settle()
    await openSupport()
    cf.pass('token-1')
    await sleep(LONG_ENOUGH_MS)
    expect(sent).toEqual([])

    type(field('textarea'), 'Second try, from the dialog opened again.')
    await press()
    await until(() => sent.length > 0, 'the message')
    expect(sent.map((s) => [s.body.message, s.body.turnstileToken])).toEqual([
      ['Second try, from the dialog opened again.', 'token-1'],
    ])
  })
})

describe('a widget that goes away', () => {
  it('takes its unused token with it: the next widget brings its own', async () => {
    await supportForm()
    cf.pass('token-1')
    byText('Cancel').click()
    await settle()
    await openSupport()

    await press()
    expect(sent).toEqual([])
    expect(button().textContent).toBe(CHECKING)
    cf.pass('token-2')
    await until(() => sent.length > 0, 'the message')
    expect(tokens('/api/support/contact')).toEqual(['token-2'])
  })

  it('is not drawn when the form is gone before the script loads', async () => {
    scriptLoads = []
    vi.doMock('../SupportContact', () => ({ default: () => null }))
    vi.doMock('../EmailCodeLogin', () => ({ default: () => null }))
    const { default: LoginScreen } = await import('../LoginScreen')
    host = document.createElement('div')
    document.body.appendChild(host)
    dispose = render(() => <LoginScreen />, host)
    await settle()
    expect(scriptLoads).toHaveLength(1)

    dispose()
    dispose = undefined
    scriptLoads[0]!()
    await settle()
    expect(widgets).toEqual([])
  })
})

describe('the sign-in screen with the captcha off', () => {
  it('sends at once with no token, and has nothing to wait for or tick', async () => {
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', '')
    vi.doMock('../SupportContact', () => ({ default: () => null }))
    vi.doMock('../EmailCodeLogin', () => ({ default: () => null }))
    const { default: LoginScreen } = await import('../LoginScreen')
    host = document.createElement('div')
    document.body.appendChild(host)
    dispose = render(() => <LoginScreen />, host)
    await settle()
    type(field('#login-email'), 'someone@example.com')
    type(field('#login-password'), 'a-long-enough-password')
    await press()

    expect(widgets).toEqual([])
    expect(tokens('/api/auth/login')).toEqual([''])
    expect(button().textContent).toBe('Signing in…')
    expect(hint()).toBeNull()
  })
})
