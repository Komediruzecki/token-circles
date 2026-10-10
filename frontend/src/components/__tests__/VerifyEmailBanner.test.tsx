/**
 * VerifyEmailBanner: what it says about the account's address once someone is in the app. The
 * outcome of an emailed link, what a sign-in that confirmed the address cleared, and a link this
 * browser opened before signing in, which it finishes. Asking an account to confirm its address
 * is the Confirm your email screen's job, which shows instead of the app.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EmailVerifyResult, LinkFinish } from '../../core/emailVerification'

let host: HTMLDivElement
let dispose: (() => void) | undefined

const toasts: { message: string; type: string }[] = []
let authenticated = true
let bootResult: EmailVerifyResult | null = null
let waiting: { change: boolean } | null = null
let finishAnswer: LinkFinish | null = null
let finishCalls = 0

async function mount() {
  vi.resetModules()
  vi.doMock('../../core/appStore', () => ({
    useAppState: () => ({
      get isAuthenticated() {
        return authenticated
      },
    }),
  }))
  vi.doMock('../../core/api', () => ({
    toast: (message: string, type = 'info') => toasts.push({ message, type }),
  }))
  vi.doMock('../../core/emailVerification', () => ({
    takeEmailVerifyResult: () => {
      const r = bootResult
      bootResult = null
      return r
    },
    linkWaiting: () => waiting,
    clearLinkWaiting: () => {
      waiting = null
    },
    finishEmailLink: () => {
      finishCalls += 1
      return Promise.resolve(finishAnswer)
    },
  }))
  const { VerifyEmailBanner } = await import('../VerifyEmailBanner')
  host = document.createElement('div')
  document.body.appendChild(host)
  dispose = render(() => <VerifyEmailBanner />, host)
  await Promise.resolve()
  await Promise.resolve()
}

beforeEach(() => {
  toasts.length = 0
  authenticated = true
  bootResult = null
  waiting = null
  finishAnswer = null
  finishCalls = 0
  sessionStorage.clear()
})

afterEach(() => {
  dispose?.()
  dispose = undefined
  host?.remove()
  vi.doUnmock('../../core/appStore')
  vi.doUnmock('../../core/api')
  vi.doUnmock('../../core/emailVerification')
  vi.resetModules()
})

describe('the confirm link’s outcome', () => {
  it('says so when the address was confirmed', async () => {
    bootResult = { ok: true }
    await mount()

    expect(toasts).toContainEqual({
      message: 'Email confirmed. Your account is all set.',
      type: 'success',
    })
  })

  it('says an expired link has expired, and points at no Resend button, which the app no longer has', async () => {
    bootResult = { ok: false, error: 'expired' }
    await mount()

    expect(toasts).toEqual([{ message: 'That confirmation link has expired.', type: 'error' }])
  })

  it('does not guess at a reason it was not given', async () => {
    bootResult = { ok: false, error: 'invalid_or_used' }
    await mount()

    expect(toasts[0].message).toBe('That confirmation link is no longer valid')
  })

  it('answers a reason it does not know with its own fixed words', async () => {
    bootResult = { ok: false, error: 'a_reason_added_later' }
    await mount()

    expect(toasts).toEqual([
      { message: 'That confirmation link is no longer valid', type: 'error' },
    ])
  })

  it('says nothing when the user simply opened the app', async () => {
    await mount()

    expect(toasts).toEqual([])
  })
})

describe('after a sign-in that confirmed the address and cleared the account', () => {
  const notice = () => host.querySelector('[data-testid="access-cleared-notice"]')

  it('says what went and what to do, once', async () => {
    sessionStorage.setItem('tc:access-cleared', 'sign-in')
    await mount()

    expect(notice()?.textContent).toContain(
      'Confirming your email removed what was set up before it'
    )
    expect(sessionStorage.getItem('tc:access-cleared')).toBeNull()
  })

  it('goes away when dismissed', async () => {
    sessionStorage.setItem('tc:access-cleared', 'sign-in')
    await mount()

    host.querySelector<HTMLButtonElement>('[data-testid="access-cleared-dismiss"]')!.click()

    expect(notice()).toBeNull()
  })

  it('is not shown for a reset, whose words are on the sign-in screen', async () => {
    sessionStorage.setItem('tc:access-cleared', 'reset')
    await mount()

    expect(notice()).toBeNull()
    expect(sessionStorage.getItem('tc:access-cleared')).toBe('reset')
  })

  it('is not shown after an ordinary sign-in', async () => {
    await mount()

    expect(notice()).toBeNull()
  })
})

/** Let the finish call settle. */
async function settle(): Promise<void> {
  for (let i = 0; i < 6; i++) await Promise.resolve()
}

const otherNotice = () => host.querySelector('[data-testid="email-link-other-account"]')

describe('a link opened in this browser before signing in', () => {
  it('is finished once signed in, and says the address is confirmed', async () => {
    waiting = { change: false }
    finishAnswer = { outcome: 'confirmed', change: false }
    await mount()
    await settle()

    expect(finishCalls).toBe(1)
    expect(toasts).toEqual([
      { message: 'Email confirmed. Your account is all set.', type: 'success' },
    ])
    expect(waiting).toBeNull()
  })

  it('says the account moved, for the link that changes the address', async () => {
    waiting = { change: true }
    finishAnswer = { outcome: 'changed', change: true }
    await mount()
    await settle()

    expect(toasts).toEqual([
      { message: 'Email changed. Your account uses the new address from now on.', type: 'success' },
    ])
    expect(waiting).toBeNull()
  })

  it('says another account has the address now', async () => {
    waiting = { change: true }
    finishAnswer = { outcome: 'email_taken', change: true }
    await mount()
    await settle()

    expect(toasts).toEqual([
      {
        message: 'Another account uses that address now, so your email stays as it was.',
        type: 'error',
      },
    ])
  })

  it.each([
    [{ change: false }, 'its address is confirmed as soon as you do.'],
    [{ change: true }, 'the change is made as soon as you do.'],
  ])(
    'says whose link it is when another account is signed in (%o), and keeps it waiting',
    async (kind, ending) => {
      waiting = kind
      finishAnswer = { outcome: 'other_account', change: kind.change }
      await mount()
      await settle()

      expect(otherNotice()?.textContent).toBe(
        `That link is for another account. Sign out, then sign in to that account, and ${ending}`
      )
      expect(toasts).toEqual([])
      expect(waiting).toEqual(kind)
    }
  )

  it('hides that notice when dismissed', async () => {
    waiting = { change: false }
    finishAnswer = { outcome: 'other_account', change: false }
    await mount()
    await settle()

    host
      .querySelector<HTMLButtonElement>('[data-testid="email-link-other-account-dismiss"]')!
      .click()

    expect(otherNotice()).toBeNull()
  })

  it('says nothing, and stops waiting, when the link can no longer finish', async () => {
    waiting = { change: false }
    finishAnswer = { outcome: 'none', change: false }
    await mount()
    await settle()

    expect(toasts).toEqual([])
    expect(otherNotice()).toBeNull()
    expect(waiting).toBeNull()
  })

  it('keeps waiting when the worker gave no answer', async () => {
    waiting = { change: false }
    finishAnswer = null
    await mount()
    await settle()

    expect(toasts).toEqual([])
    expect(waiting).toEqual({ change: false })
  })

  it('is not asked about without a waiting link', async () => {
    await mount()
    await settle()

    expect(finishCalls).toBe(0)
  })

  it('is not asked about before anyone is signed in', async () => {
    authenticated = false
    waiting = { change: false }
    finishAnswer = { outcome: 'confirmed', change: false }
    await mount()
    await settle()

    expect(finishCalls).toBe(0)
    expect(waiting).toEqual({ change: false })
  })

  it('tells nobody the link is for another account when the page opens signed out', async () => {
    // The landing's own answer never reaches the banner (it is a waiting note), so a page that
    // is not signed in shows no notice about accounts at all.
    authenticated = false
    bootResult = null
    waiting = { change: false }
    await mount()
    await settle()

    expect(otherNotice()).toBeNull()
    expect(toasts).toEqual([])
  })
})

describe('the email change link’s outcome', () => {
  it('says the account moved to the new address', async () => {
    bootResult = { ok: true, change: true }
    await mount()

    expect(toasts).toEqual([
      { message: 'Email changed. Your account uses the new address from now on.', type: 'success' },
    ])
  })

  it('sends an expired change link back to Settings, where Resend cannot help', async () => {
    bootResult = { ok: false, error: 'expired', change: true }
    await mount()

    expect(toasts).toEqual([
      {
        message:
          'That email change link has expired. Save the new address in Settings to get a fresh one.',
        type: 'error',
      },
    ])
  })

  it('says another account has the address now, and nothing changed', async () => {
    bootResult = { ok: false, error: 'email_taken', change: true }
    await mount()

    expect(toasts).toEqual([
      {
        message: 'Another account uses that address now, so your email stays as it was.',
        type: 'error',
      },
    ])
  })

  it('answers a reason it does not know with its own fixed words', async () => {
    bootResult = { ok: false, error: 'a_reason_added_later', change: true }
    await mount()

    expect(toasts).toEqual([
      { message: 'That confirmation link is no longer valid', type: 'error' },
    ])
  })
})
