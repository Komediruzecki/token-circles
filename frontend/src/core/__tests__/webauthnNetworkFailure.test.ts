/**
 * A passkey call that cannot reach the API must RESOLVE with ok:false, never reject.
 *
 * `postJson` awaited `apiFetch` bare, so a network-layer failure (offline, DNS, a CORS
 * preflight the browser blocks) rejected with `TypeError: Failed to fetch`. The login screen's
 * conditional-mediation autofill fires that on mount as `void signInWithPasskey(...).then(...)`
 * — a `.then` with no `.catch` — so the rejection went unhandled and the app's global handler
 * painted "App Crashed" over a login screen that was otherwise perfectly usable.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const apiFetch = vi.fn()
vi.mock('../apiFetch', () => ({ apiFetch: (...a: unknown[]) => apiFetch(...(a as [string])) }))

beforeEach(() => {
  apiFetch.mockReset()
  vi.resetModules()
})

describe('passkey sign-in when the API is unreachable', () => {
  it('resolves ok:false instead of rejecting', async () => {
    apiFetch.mockRejectedValue(new TypeError('Failed to fetch'))
    const { signInWithPasskey } = await import('../webauthn')

    const result = await signInWithPasskey()

    expect(result.ok).toBe(false)
    // Narrow, then assert the caller has something to show.
    if (!result.ok) expect(result.error).toBeTruthy()
  })

  it('resolves ok:false for the background autofill request too', async () => {
    // This is the one that crashed the app: nothing awaits it, so a rejection is unhandled.
    apiFetch.mockRejectedValue(new TypeError('Failed to fetch'))
    const { signInWithPasskey } = await import('../webauthn')

    await expect(signInWithPasskey({ conditional: true })).resolves.toMatchObject({ ok: false })
  })

  it('still reports a server-side error normally', async () => {
    apiFetch.mockResolvedValue(
      new Response(JSON.stringify({ error: 'No passkeys registered' }), { status: 400 })
    )
    const { signInWithPasskey } = await import('../webauthn')

    const result = await signInWithPasskey()
    expect(result).toMatchObject({ ok: false, error: 'No passkeys registered' })
  })
})
