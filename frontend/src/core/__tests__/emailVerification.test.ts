/**
 * The client half of the confirm-your-email flow.
 *
 * The fragment handling matters more than it looks: `#everified=1` is not a page, so leaving it
 * in the address bar hands the hash router something it resolves to a 404, and re-announces the
 * outcome on every reload. An address confirmed on the way into the app (noteAddressConfirmed)
 * has to outlast the reload that follows, and be said once.
 */
import { openDB } from 'idb'
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

/** A record in a database on the device, to show the landing leaves it where it was. */
const PROBE_DB = 'finance-manager-probe'

async function putLocalRecord(): Promise<void> {
  const db = await openDB(PROBE_DB, 1, {
    upgrade: (upgrading) => {
      upgrading.createObjectStore('kept')
    },
  })
  await db.put('kept', 'groceries', 'entry')
  db.close()
}

async function readLocalRecord(): Promise<unknown> {
  const db = await openDB(PROBE_DB, 1)
  const value: unknown = await db.get('kept', 'entry')
  db.close()
  return value
}

describe('a link that needs a sign-in first', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('is noted as waiting, so the sign-in screen and the app after it know', async () => {
    history.replaceState(null, '', '/#everified_error=signin_required')
    const { consumeEmailVerifyRedirect, linkWaiting, takeEmailVerifyResult } = await load()
    consumeEmailVerifyRedirect()

    expect(linkWaiting()).toEqual({ change: false })
    // Still there for the next reader: a sign-in ends in a reload.
    expect(linkWaiting()).toEqual({ change: false })
    expect(takeEmailVerifyResult()).toBeNull()
    expect(window.location.hash).toBe('')
  })

  it('says when it is the link that changes the address', async () => {
    history.replaceState(null, '', '/#everified_error=signin_required&change=1')
    const { consumeEmailVerifyRedirect, linkWaiting } = await load()
    consumeEmailVerifyRedirect()

    expect(linkWaiting()).toEqual({ change: true })
  })

  it('outlasts a reload of the page', async () => {
    history.replaceState(null, '', '/#everified_error=signin_required')
    const first = await load()
    first.consumeEmailVerifyRedirect()

    const { linkWaiting } = await load()

    expect(linkWaiting()).toEqual({ change: false })
  })

  it('waits as long as the marker lasts, 30 minutes', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      history.replaceState(null, '', '/#everified_error=signin_required')
      const { consumeEmailVerifyRedirect, linkWaiting } = await load()
      consumeEmailVerifyRedirect()

      vi.setSystemTime(Date.now() + 29 * 60_000)
      expect(linkWaiting()).toEqual({ change: false })
      vi.setSystemTime(Date.now() + 2 * 60_000)
      expect(linkWaiting()).toBeNull()
      expect(localStorage.getItem('tc:email-link-waiting')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('is gone once cleared', async () => {
    history.replaceState(null, '', '/#everified_error=signin_required')
    const { consumeEmailVerifyRedirect, linkWaiting, clearLinkWaiting } = await load()
    consumeEmailVerifyRedirect()

    clearLinkWaiting()

    expect(linkWaiting()).toBeNull()
  })

  it('moves a local-first device to account mode, so it opens on the sign-in screen', async () => {
    localStorage.setItem('finance_storage_mode', 'serverless')
    history.replaceState(null, '', '/#everified_error=signin_required')
    const { consumeEmailVerifyRedirect } = await load()

    consumeEmailVerifyRedirect()

    expect(localStorage.getItem('finance_storage_mode')).toBe('self-hosted')
  })

  it('does the same on a fresh device, which starts local-first', async () => {
    // frontend/.env, which the tests read, sets VITE_DEFAULT_STORAGE=dexie, as production does.
    history.replaceState(null, '', '/#everified_error=signin_required')
    const { consumeEmailVerifyRedirect } = await load()
    const { getStorageMode } = await import('../storage/storageFactory')
    expect(getStorageMode()).toBe('serverless')

    consumeEmailVerifyRedirect()

    expect(localStorage.getItem('finance_storage_mode')).toBe('self-hosted')
  })

  it("leaves the device's local data where it is", async () => {
    localStorage.setItem('finance_storage_mode', 'serverless')
    await putLocalRecord()
    const deleteDatabase = vi.spyOn(window.indexedDB, 'deleteDatabase')
    history.replaceState(null, '', '/#everified_error=signin_required')
    const { consumeEmailVerifyRedirect } = await load()

    consumeEmailVerifyRedirect()

    expect(deleteDatabase).not.toHaveBeenCalled()
    expect(await readLocalRecord()).toBe('groceries')
    deleteDatabase.mockRestore()
  })

  it('leaves a confirmed address for the banner, and the mode as it was', async () => {
    localStorage.setItem('finance_storage_mode', 'serverless')
    history.replaceState(null, '', '/#everified=1')
    const { consumeEmailVerifyRedirect, linkWaiting, takeEmailVerifyResult } = await load()

    consumeEmailVerifyRedirect()

    expect(linkWaiting()).toBeNull()
    expect(takeEmailVerifyResult()).toEqual({ ok: true })
    expect(localStorage.getItem('finance_storage_mode')).toBe('serverless')
  })

  it('leaves a change of address that did not finish for the banner, and the mode as it was', async () => {
    localStorage.setItem('finance_storage_mode', 'serverless')
    history.replaceState(null, '', '/#everified_error=expired&change=1')
    const { consumeEmailVerifyRedirect, takeConfirmLinkProblem, takeEmailVerifyResult } =
      await load()

    consumeEmailVerifyRedirect()

    expect(takeConfirmLinkProblem()).toBeNull()
    expect(takeEmailVerifyResult()).toEqual({ ok: false, error: 'expired', change: true })
    expect(localStorage.getItem('finance_storage_mode')).toBe('serverless')
  })
})

describe('a confirm link that did not confirm, opened in a fresh browser', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  for (const [error, words] of [
    ['expired', 'That link has expired. Send the link again for a fresh one.'],
    ['invalid_or_used', "That link doesn't work anymore. Send the link again for a fresh one."],
  ] as const) {
    it(`moves the device to account mode, and keeps why for the sign-in screen (${error})`, async () => {
      // frontend/.env, which the tests read, sets VITE_DEFAULT_STORAGE=dexie, as production does.
      history.replaceState(null, '', `/#everified_error=${error}`)
      const { consumeEmailVerifyRedirect, linkWaiting, takeConfirmLinkProblem } = await load()
      const { getStorageMode } = await import('../storage/storageFactory')
      expect(localStorage.getItem('finance_storage_mode')).toBeNull()
      expect(getStorageMode()).toBe('serverless')

      consumeEmailVerifyRedirect()

      expect(localStorage.getItem('finance_storage_mode')).toBe('self-hosted')
      expect(linkWaiting()).toBeNull()
      expect(takeConfirmLinkProblem()).toBe(words)
    })
  }
})

describe('finishEmailLink', () => {
  it('asks the worker to finish the link, with the session and the marker', async () => {
    const { finishEmailLink, calls } = await load(() =>
      json({ outcome: 'confirmed', change: false })
    )

    expect(await finishEmailLink()).toEqual({ outcome: 'confirmed', change: false })
    expect(calls[0].url).toBe('/api/auth/email-link/finish')
    expect(calls[0].init?.method).toBe('POST')
    expect(calls[0].init?.credentials).toBe('include')
  })

  it.each(['changed', 'email_taken', 'server_error', 'other_account', 'none'])(
    'passes on %s',
    async (outcome) => {
      const { finishEmailLink } = await load(() => json({ outcome, change: true }))

      expect(await finishEmailLink()).toEqual({ outcome, change: true })
    }
  )

  it.each([
    ['without a session', () => json({ error: 'Unauthorized' }, 401)],
    ['when the answer is a refusal, whatever its body says', () => json({ outcome: 'none' }, 409)],
    ['when rate-limited', () => Promise.resolve(new Response('', { status: 429 }))],
    ['offline', () => Promise.reject(new Error('offline'))],
    ['for an answer it does not know', () => json({ outcome: 'a_later_outcome' })],
  ])('has no answer %s', async (_, answer) => {
    const { finishEmailLink } = await load(answer)

    expect(await finishEmailLink()).toBeNull()
  })
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

  it('marks a change of address, so the message can say the address moved', async () => {
    history.replaceState(null, '', '/#everified=1&change=1')
    const { consumeEmailVerifyRedirect, takeEmailVerifyResult } = await load()

    consumeEmailVerifyRedirect()

    expect(takeEmailVerifyResult()).toEqual({ ok: true, change: true })
    expect(window.location.hash).toBe('')
  })

  it('marks a change of address that was refused, with its reason', async () => {
    history.replaceState(null, '', '/#everified_error=email_taken&change=1')
    const { consumeEmailVerifyRedirect, takeEmailVerifyResult } = await load()

    consumeEmailVerifyRedirect()

    expect(takeEmailVerifyResult()).toEqual({ ok: false, error: 'email_taken', change: true })
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

describe('noteAddressConfirmed', () => {
  beforeEach(() => {
    sessionStorage.clear()
    localStorage.clear()
  })

  it('is said once, by the next takeEmailVerifyResult, as a confirmed address', async () => {
    const { noteAddressConfirmed, takeEmailVerifyResult } = await load()

    noteAddressConfirmed()

    expect(takeEmailVerifyResult()).toEqual({ ok: true })
    expect(takeEmailVerifyResult()).toBeNull()
  })

  it('outlasts the reload that follows: a fresh load of the module still says it', async () => {
    const before = await load()
    before.noteAddressConfirmed()

    const after = await load()

    expect(after.takeEmailVerifyResult()).toEqual({ ok: true })
  })

  it('stops the link this browser opened from waiting', async () => {
    localStorage.setItem(
      'tc:email-link-waiting',
      JSON.stringify({ change: false, until: Date.now() + 60_000 })
    )
    const { noteAddressConfirmed, linkWaiting } = await load()
    expect(linkWaiting()).toEqual({ change: false })

    noteAddressConfirmed()

    expect(linkWaiting()).toBeNull()
  })

  it('says nothing when nothing was noted', async () => {
    const { takeEmailVerifyResult } = await load()

    expect(takeEmailVerifyResult()).toBeNull()
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

  it('throws an ApiError with the status and the server’s message', async () => {
    const { resendVerificationEmail } = await load(() =>
      json({ error: 'Too many attempts. Please try again in about 40 minutes.' }, 429)
    )

    await expect(resendVerificationEmail()).rejects.toMatchObject({
      name: 'ApiError',
      status: 429,
      message: 'Too many attempts. Please try again in about 40 minutes.',
    })
  })

  it('explains a rate limit in words, since the endpoint answers 429 with no body', async () => {
    const { resendVerificationEmail } = await load(() =>
      Promise.resolve(new Response('', { status: 429 }))
    )

    await expect(resendVerificationEmail()).rejects.toThrow(
      'Too many requests. Try again a little later.'
    )
  })
})
