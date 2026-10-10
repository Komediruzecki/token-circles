/**
 * Confirm your email (ConfirmEmailScreen), against the real client with only the network answered
 * here: what a signed-in password account sees instead of the app until its address is confirmed.
 *
 * It names the address, sends the link again through the signed-in route, and signs out. An
 * account with a billing account can open the billing portal from it, to manage or cancel its
 * subscription. It lets
 * the account in, by reloading, once the address is confirmed: by the link this browser opened
 * before signing in, which it finishes, or elsewhere, which it asks about when the person comes
 * back to the tab. Anything else keeps it where it is.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as EmailVerification from '../../core/emailVerification'

interface Sent {
  url: string
  method: string
}

let host: HTMLDivElement
let dispose: (() => void) | undefined
let sent: Sent[]
let answers: Record<string, () => Response>
let reloads: number
let signOuts: number

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const WAITING_KEY = 'tc:email-link-waiting'

/** The screen for `email`, after `before` has run against the same modules it uses. */
async function mount(
  email = 'waiting@example.com',
  before?: (verification: typeof EmailVerification) => void,
  billingAccount = false
) {
  vi.resetModules()
  vi.doMock('../../core/apiFetch', () => ({
    apiFetch: (url: string, init?: RequestInit) => {
      sent.push({ url, method: init?.method ?? 'GET' })
      const answer = answers[url]
      if (!answer) throw new Error(`nothing answers ${url} here`)
      return Promise.resolve(answer())
    },
  }))
  vi.doMock('../../core/appVersion', () => ({ displayVersion: () => '9.9.9' }))
  vi.doMock('../SupportContact', () => ({ default: () => null }))
  before?.(await import('../../core/emailVerification'))
  const { default: ConfirmEmailScreen } = await import('../ConfirmEmailScreen')
  host = document.createElement('div')
  document.body.appendChild(host)
  dispose = render(
    () => (
      <ConfirmEmailScreen
        email={email}
        billingAccount={billingAccount}
        onSignOut={() => {
          signOuts += 1
        }}
      />
    ),
    host
  )
  await settle()
}

const settle = async () => {
  for (let i = 0; i < 8; i += 1) await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

const byTestId = (id: string) => host.querySelector<HTMLElement>(`[data-test-id="${id}"]`)
const said = () => byTestId('confirm-email-said')?.textContent ?? ''

/** The page's address, with `hash`; a reload is counted, not made. */
function stubLocation(hash = '') {
  vi.stubGlobal('location', {
    reload: () => {
      reloads += 1
    },
    href: `https://app.example.com/${hash}`,
    pathname: '/',
    search: '',
    hash,
  } as unknown as Location)
}

function linkWaitingHere(change = false) {
  localStorage.setItem(WAITING_KEY, JSON.stringify({ change, until: Date.now() + 60_000 }))
}

beforeEach(() => {
  sent = []
  answers = {}
  reloads = 0
  signOuts = 0
  localStorage.clear()
  sessionStorage.clear()
  stubLocation()
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => 'visible',
  })
})

afterEach(() => {
  dispose?.()
  dispose = undefined
  host.remove()
  vi.unstubAllGlobals()
  delete (document as unknown as { visibilityState?: unknown }).visibilityState
  vi.doUnmock('../../core/apiFetch')
  vi.doUnmock('../../core/appVersion')
  vi.doUnmock('../SupportContact')
  vi.resetModules()
})

describe('Confirm your email', () => {
  it('names the address, and asks the Worker for nothing until someone acts', async () => {
    await mount('waiting@example.com')

    expect(byTestId('confirm-email-screen')?.querySelector('h1')?.textContent).toBe(
      'Confirm your email'
    )
    expect(byTestId('confirm-email-address')?.textContent).toBe('waiting@example.com')
    expect(sent).toEqual([])
    expect(reloads).toBe(0)
  })

  it('says that the link lets the account in from this browser, and that on another device a password sign-in there comes first', async () => {
    await mount('waiting@example.com')

    expect(byTestId('confirm-email-lead')?.textContent).toBe(
      "Open the link we sent to waiting@example.com in this browser and you're in, or send it again. Opening it on another device? Sign in there with your password, then come back to this tab."
    )
  })

  it('offers to send the link again in its first sentence', async () => {
    await mount()

    const lead = byTestId('confirm-email-lead')!
    const [firstSentence] = lead.textContent!.split(/(?<=[.?])\s/)
    expect(firstSentence).toBe(
      "Open the link we sent to waiting@example.com in this browser and you're in, or send it again."
    )
    expect(lead.querySelector('button')).toBe(byTestId('confirm-email-resend'))
  })

  it('sends the link again through the signed-in resend, and says it went', async () => {
    answers['/api/auth/resend-verification'] = () => json({ ok: true })
    await mount()

    byTestId('confirm-email-resend')!.click()
    await settle()

    expect(sent).toEqual([{ url: '/api/auth/resend-verification', method: 'POST' }])
    expect(byTestId('confirm-email-sent')?.textContent?.trim()).toBe(
      'Sent. Open the newest email: the links before it no longer work.'
    )
  })

  it('clears the note that the link went after SENT_SHOWN_MS, and keeps the button', async () => {
    answers['/api/auth/resend-verification'] = () => json({ ok: true })
    await mount()
    const { SENT_SHOWN_MS } = await import('../ConfirmEmailScreen')
    vi.useFakeTimers()
    try {
      byTestId('confirm-email-resend')!.click()
      await vi.advanceTimersByTimeAsync(SENT_SHOWN_MS - 1)
      expect(byTestId('confirm-email-sent')).not.toBeNull()

      await vi.advanceTimersByTimeAsync(1)

      expect(byTestId('confirm-email-sent')).toBeNull()
      expect(byTestId('confirm-email-resend')?.hasAttribute('disabled')).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('clears the note at the next press, and says it again once that link went', async () => {
    answers['/api/auth/resend-verification'] = () => json({ ok: true })
    await mount()
    byTestId('confirm-email-resend')!.click()
    await settle()
    expect(byTestId('confirm-email-sent')).not.toBeNull()

    byTestId('confirm-email-resend')!.click()
    const atThePress = byTestId('confirm-email-sent')
    await settle()

    expect(atThePress).toBeNull()
    expect(byTestId('confirm-email-sent')).not.toBeNull()
    expect(sent).toHaveLength(2)
  })

  it("says the Worker's words when the link is not sent, and shows no note that it went", async () => {
    answers['/api/auth/resend-verification'] = () =>
      json({ error: 'Too many attempts. Please try again in about 40 minutes.' }, 429)
    await mount()
    const { toasts } = await import('../../core/toastStore')

    byTestId('confirm-email-resend')!.click()
    await settle()

    expect(toasts().map(({ message, type }) => ({ message, type }))).toEqual([
      { message: 'Too many attempts. Please try again in about 40 minutes.', type: 'error' },
    ])
    expect(byTestId('confirm-email-sent')).toBeNull()
    expect(byTestId('confirm-email-resend')?.hasAttribute('disabled')).toBe(false)
  })

  it("says words of its own for a failure that brought none, never the error's", async () => {
    await mount()
    const { toasts } = await import('../../core/toastStore')

    byTestId('confirm-email-resend')!.click()
    await settle()

    expect(toasts().map(({ message, type }) => ({ message, type }))).toEqual([
      { message: "Couldn't send the link. Try again in a moment.", type: 'error' },
    ])
  })

  it('signs out from Sign out', async () => {
    await mount()

    byTestId('confirm-email-sign-out')!.click()

    expect(signOuts).toBe(1)
  })
})

describe('an account with a billing account', () => {
  const PORTAL = 'https://billing.stripe.com/p/session/test_portal'

  it('opens the billing portal from Manage or cancel your subscription', async () => {
    answers['/api/billing/portal'] = () => json({ url: PORTAL })
    await mount('waiting@example.com', undefined, true)

    byTestId('confirm-email-billing')!.click()
    await settle()

    expect(sent).toEqual([{ url: '/api/billing/portal', method: 'POST' }])
    expect(window.location.href).toBe(PORTAL)
  })

  it('says why when the portal does not open, and offers the button again', async () => {
    answers['/api/billing/portal'] = () => json({ error: 'Billing is not configured' }, 501)
    await mount('waiting@example.com', undefined, true)

    byTestId('confirm-email-billing')!.click()
    await settle()

    expect(byTestId('confirm-email-billing-problem')?.textContent).toBe('Billing is not configured')
    expect(byTestId('confirm-email-billing')?.hasAttribute('disabled')).toBe(false)
    expect(window.location.href).toBe('https://app.example.com/')
  })
})

describe('an account with no billing account', () => {
  it('is not offered the billing portal', async () => {
    await mount()

    expect(byTestId('confirm-email-billing')).toBeNull()
  })
})

describe('a link this browser opened before signing in', () => {
  it('is finished here, and the app reloads, saying so once it has loaded', async () => {
    linkWaitingHere()
    answers['/api/auth/email-link/finish'] = () => json({ outcome: 'confirmed', change: false })
    await mount()

    expect(sent).toEqual([{ url: '/api/auth/email-link/finish', method: 'POST' }])
    expect(reloads).toBe(1)
    expect(sessionStorage.getItem('tc:email-confirmed')).toBe('1')
    expect(localStorage.getItem(WAITING_KEY)).toBeNull()
  })

  it("says when it is another account's, keeps it waiting for that account, and stays", async () => {
    linkWaitingHere()
    answers['/api/auth/email-link/finish'] = () => json({ outcome: 'other_account', change: false })
    await mount()

    expect(said()).toBe(
      'That link is for another account. Sign out, then sign in to that account, and its address is confirmed as soon as you do.'
    )
    expect(localStorage.getItem(WAITING_KEY)).not.toBeNull()
    expect(reloads).toBe(0)
  })

  it('stays, and keeps the link waiting, when the Worker gives no answer', async () => {
    linkWaitingHere()
    answers['/api/auth/email-link/finish'] = () => json({ error: 'Too many requests' }, 429)
    await mount()

    expect(localStorage.getItem(WAITING_KEY)).not.toBeNull()
    expect(reloads).toBe(0)
  })
})

describe('coming back to the tab', () => {
  it('asks the Worker again, and reloads into the app once the address is confirmed', async () => {
    answers['/api/auth/me'] = () =>
      json({ email: 'waiting@example.com', email_verified: 1, auth_provider: 'password' })
    await mount()

    window.dispatchEvent(new Event('focus'))
    await settle()

    expect(sent).toEqual([{ url: '/api/auth/me', method: 'GET' }])
    expect(reloads).toBe(1)
  })

  it('stays while the address still waits for its link', async () => {
    answers['/api/auth/me'] = () =>
      json({ email: 'waiting@example.com', email_verified: 0, auth_provider: 'password' })
    await mount()

    document.dispatchEvent(new Event('visibilitychange'))
    await settle()

    expect(sent).toEqual([{ url: '/api/auth/me', method: 'GET' }])
    expect(reloads).toBe(0)
  })

  it('stays when the Worker cannot be asked', async () => {
    answers['/api/auth/me'] = () => json({ error: 'Service unavailable' }, 503)
    await mount()

    window.dispatchEvent(new Event('focus'))
    await settle()

    expect(reloads).toBe(0)
  })
})

describe('a confirm link that did not confirm', () => {
  it('says an expired link has expired, and what to do', async () => {
    await mount('waiting@example.com', (verification) => {
      stubLocation('#everified_error=expired')
      verification.consumeEmailVerifyRedirect()
    })

    expect(said()).toBe('That link has expired. Send the link again for a fresh one.')
  })

  it('says a used or unknown link no longer works, and what to do', async () => {
    await mount('waiting@example.com', (verification) => {
      stubLocation('#everified_error=invalid_or_used')
      verification.consumeEmailVerifyRedirect()
    })

    expect(said()).toBe("That link doesn't work anymore. Send the link again for a fresh one.")
  })
})
