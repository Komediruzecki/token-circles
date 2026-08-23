/**
 * The client half of the confirm-your-email flow.
 *
 * The fragment handling matters more than it looks: `#everified=1` is not a page, so leaving it
 * in the address bar hands the hash router something it resolves to a 404, and re-announces the
 * outcome on every reload. And `fetchVerificationStatus` has to stay silent on a backend that
 * does not report the field at all — the legacy self-hosted server — rather than reading its
 * absence as "unverified" and nagging every user of it forever.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

async function load(fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>) {
  vi.resetModules()
  const calls: { url: string; init?: RequestInit }[] = []
  vi.doMock('../apiFetch', () => ({
    apiFetch: (url: string, init?: RequestInit) => {
      calls.push({ url, init })
      return fetchImpl ? fetchImpl(url, init) : Promise.resolve(new Response('{}', { status: 200 }))
    },
  }))
  const mod = await import('../emailVerification')
  return { ...mod, calls }
}

const json = (body: unknown, status = 200) =>
  Promise.resolve(
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  )

beforeEach(() => {
  history.replaceState(null, '', '/')
})

afterEach(() => {
  vi.doUnmock('../apiFetch')
  vi.resetModules()
})

describe('consumeEmailVerifyRedirect', () => {
  it('reads a successful confirmation and clears the fragment', async () => {
    history.replaceState(null, '', '/#everified=1')
    const { consumeEmailVerifyRedirect, takeEmailVerifyResult } = await load()

    consumeEmailVerifyRedirect()

    expect(takeEmailVerifyResult()).toEqual({ ok: true })
    expect(window.location.hash).toBe('')
  })

  it('reads the failure reason so the message can name it', async () => {
    history.replaceState(null, '', '/#everified_error=expired')
    const { consumeEmailVerifyRedirect, takeEmailVerifyResult } = await load()

    consumeEmailVerifyRedirect()

    expect(takeEmailVerifyResult()).toEqual({ ok: false, error: 'expired' })
  })

  it('keeps the query string while dropping the fragment', async () => {
    history.replaceState(null, '', '/?demo=high#everified=1')
    const { consumeEmailVerifyRedirect } = await load()

    consumeEmailVerifyRedirect()

    expect(window.location.search).toBe('?demo=high')
    expect(window.location.hash).toBe('')
  })

  it('leaves an unrelated fragment alone — it belongs to the router', async () => {
    history.replaceState(null, '', '/#transactions')
    const { consumeEmailVerifyRedirect, takeEmailVerifyResult } = await load()

    consumeEmailVerifyRedirect()

    expect(window.location.hash).toBe('#transactions')
    expect(takeEmailVerifyResult()).toBeNull()
  })

  it('reports the outcome once, so a later mount does not re-announce it', async () => {
    history.replaceState(null, '', '/#everified=1')
    const { consumeEmailVerifyRedirect, takeEmailVerifyResult } = await load()

    consumeEmailVerifyRedirect()

    expect(takeEmailVerifyResult()).toEqual({ ok: true })
    expect(takeEmailVerifyResult()).toBeNull()
  })
})

describe('fetchVerificationStatus', () => {
  it('reports an unverified password account', async () => {
    const { fetchVerificationStatus } = await load(() =>
      json({ email: 'a@b.com', email_verified: 0, auth_provider: 'password' })
    )

    expect(await fetchVerificationStatus()).toEqual({
      email: 'a@b.com',
      verified: false,
      provider: 'password',
    })
  })

  it('says nothing when the server does not report the field', async () => {
    // The legacy self-hosted backend's /me has no email_verified. Reading that as "unverified"
    // would show every one of its users a banner whose Resend button its API cannot answer.
    const { fetchVerificationStatus } = await load(() =>
      json({ email: 'a@b.com', auth_provider: 'password' })
    )

    expect(await fetchVerificationStatus()).toBeNull()
  })

  it('says nothing without a session', async () => {
    const { fetchVerificationStatus } = await load(() => json({ error: 'Unauthorized' }, 401))

    expect(await fetchVerificationStatus()).toBeNull()
  })

  it('says nothing for an account with no address', async () => {
    const { fetchVerificationStatus } = await load(() =>
      json({ email: null, email_verified: 0, auth_provider: 'google' })
    )

    expect(await fetchVerificationStatus()).toBeNull()
  })

  it('swallows a network failure rather than surfacing it as a banner', async () => {
    const { fetchVerificationStatus } = await load(() => Promise.reject(new Error('offline')))

    expect(await fetchVerificationStatus()).toBeNull()
  })
})

describe('resendVerificationEmail', () => {
  it('posts to the resend endpoint with the session', async () => {
    const { resendVerificationEmail, calls } = await load(() => json({ ok: true }))

    await resendVerificationEmail()

    expect(calls[0].url).toBe('/api/auth/resend-verification')
    expect(calls[0].init?.method).toBe('POST')
    expect(calls[0].init?.credentials).toBe('include')
  })

  it('throws the server’s own message', async () => {
    const { resendVerificationEmail } = await load(() =>
      json({ error: 'This account has no email address' }, 400)
    )

    await expect(resendVerificationEmail()).rejects.toThrow('This account has no email address')
  })

  it('explains a rate limit in words, since the endpoint answers 429 with no body', async () => {
    const { resendVerificationEmail } = await load(() =>
      Promise.resolve(new Response('', { status: 429 }))
    )

    await expect(resendVerificationEmail()).rejects.toThrow(/try again/i)
  })
})
