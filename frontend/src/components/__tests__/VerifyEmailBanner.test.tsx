/**
 * VerifyEmailBanner — who sees it, and what the two buttons do.
 *
 * The soft gate only works if the banner is honest about when it has nothing to say: a verified
 * address, a Google account, no session, or a backend with no opinion all mean silence. A banner
 * that shows anyway is a permanent nag with a button that cannot help.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { VerificationStatus } from '../../core/emailVerification'

let host: HTMLDivElement
let dispose: (() => void) | undefined

const toasts: { message: string; type: string }[] = []
let status: VerificationStatus | null = null
let authenticated = true
let bootResult: { ok: true } | { ok: false; error: string } | null = null
let resend: () => Promise<void> = () => Promise.resolve()

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
    fetchVerificationStatus: () => Promise.resolve(status),
    resendVerificationEmail: () => resend(),
    takeEmailVerifyResult: () => {
      const r = bootResult
      bootResult = null
      return r
    },
  }))
  const { VerifyEmailBanner } = await import('../VerifyEmailBanner')
  host = document.createElement('div')
  document.body.appendChild(host)
  dispose = render(() => <VerifyEmailBanner />, host)
  // The status check is a promise; let it settle before asserting on the DOM.
  await Promise.resolve()
  await Promise.resolve()
}

const banner = () => host.querySelector('[data-testid="verify-email-banner"]')
const button = (name: string) =>
  host.querySelector<HTMLButtonElement>(`[data-testid="verify-email-${name}"]`)

beforeEach(() => {
  toasts.length = 0
  status = { email: 'someone@example.com', verified: false, provider: 'password' }
  authenticated = true
  bootResult = null
  resend = () => Promise.resolve()
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

describe('who sees it', () => {
  it('shows for an unverified password account, naming the address', async () => {
    await mount()

    expect(banner()).not.toBeNull()
    expect(banner()!.textContent).toContain('someone@example.com')
  })

  it('stays away once the address is confirmed', async () => {
    status = { email: 'someone@example.com', verified: true, provider: 'password' }
    await mount()

    expect(banner()).toBeNull()
  })

  it('stays away for a Google account, which Google verified', async () => {
    status = { email: 'someone@example.com', verified: false, provider: 'google' }
    await mount()

    expect(banner()).toBeNull()
  })

  it('stays away when the server has no opinion on the address', async () => {
    status = null
    await mount()

    expect(banner()).toBeNull()
  })

  it('stays away with no session', async () => {
    authenticated = false
    await mount()

    expect(banner()).toBeNull()
  })
})

describe('resend', () => {
  it('reports that the mail went, rather than leaving the button looking untouched', async () => {
    await mount()

    button('resend')!.click()
    await Promise.resolve()
    await Promise.resolve()

    expect(button('resend')).toBeNull()
    expect(banner()!.textContent).toContain('check your inbox')
  })

  it('says what went wrong and lets the user try again', async () => {
    resend = () => Promise.reject(new Error('Too many requests — try again a little later'))
    await mount()

    button('resend')!.click()
    await Promise.resolve()
    await Promise.resolve()

    expect(toasts).toContainEqual({
      message: 'Too many requests — try again a little later',
      type: 'error',
    })
    // Back to idle: a failed send that disables its own button strands the user.
    expect(button('resend')).not.toBeNull()
    expect(button('resend')!.disabled).toBe(false)
  })
})

describe('dismiss', () => {
  it('hides the banner and keeps it hidden for the tab', async () => {
    await mount()

    button('dismiss')!.click()
    expect(banner()).toBeNull()

    dispose?.()
    host.remove()
    await mount()
    expect(banner()).toBeNull()
  })

  it('comes back in a fresh tab, because the address is still unconfirmed', async () => {
    await mount()
    button('dismiss')!.click()

    sessionStorage.clear() // a new tab starts empty
    dispose?.()
    host.remove()
    await mount()

    expect(banner()).not.toBeNull()
  })
})

describe('the confirm link’s outcome', () => {
  it('says so when the address was confirmed', async () => {
    bootResult = { ok: true }
    status = { email: 'someone@example.com', verified: true, provider: 'password' }
    await mount()

    expect(toasts).toContainEqual({
      message: 'Email confirmed — your account is all set',
      type: 'success',
    })
  })

  it('points an expired link at the Resend button', async () => {
    bootResult = { ok: false, error: 'expired' }
    await mount()

    expect(toasts[0].type).toBe('error')
    expect(toasts[0].message).toMatch(/expired/i)
    expect(toasts[0].message).toMatch(/resend/i)
  })

  it('does not guess at a reason it was not given', async () => {
    bootResult = { ok: false, error: 'invalid_or_used' }
    await mount()

    expect(toasts[0].message).toBe('That confirmation link is no longer valid')
  })

  it('says nothing when the user simply opened the app', async () => {
    await mount()

    expect(toasts).toEqual([])
  })
})
