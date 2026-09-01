/**
 * A passkey that cannot be used here must SAY so.
 *
 * The platform reports "you cancelled", "no credential matches this site" and "the prompt timed
 * out" as the same `NotAllowedError` — deliberately, so a site cannot probe which passkeys you
 * hold. We treated every one of them as a silent cancel, so pressing "Sign in with a passkey"
 * with only another domain's passkey saved did visibly nothing at all.
 *
 * An explicit press therefore always comes back with something to show. The background autofill
 * request stays silent — nobody asked for it, so it must never paint the form.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const apiFetch = vi.fn()
vi.mock('../apiFetch', () => ({ apiFetch: (...a: unknown[]) => apiFetch(...(a as [string])) }))

const credentialsGet = vi.fn()

beforeEach(() => {
  apiFetch.mockReset()
  credentialsGet.mockReset()
  vi.resetModules()
  // The options fetch succeeds; the ceremony is what fails.
  apiFetch.mockResolvedValue(
    new Response(JSON.stringify({ challenge: 'AAAA', allowCredentials: [] }), { status: 200 })
  )
  vi.stubGlobal('navigator', { credentials: { get: credentialsGet } })
  // passkeysSupported() only checks that this global exists; a plain object is enough.
  const publicKeyCredential = function PublicKeyCredential() {
    /* stub */
  }
  publicKeyCredential.isConditionalMediationAvailable = () => Promise.resolve(false)
  vi.stubGlobal('PublicKeyCredential', publicKeyCredential)
})

const notAllowed = () => new DOMException('The operation is not allowed', 'NotAllowedError')

describe('a passkey that cannot be used on this site', () => {
  it('gives an explicit press a message to show, not silence', async () => {
    credentialsGet.mockRejectedValue(notAllowed())
    const { signInWithPasskey } = await import('../webauthn')

    const result = await signInWithPasskey()

    expect(result.ok).toBe(false)
    if (result.ok) return
    // The caller hides `aborted` results, so this one must not claim to be an abort...
    expect(result.aborted).toBeFalsy()
    // ...and must explain the likeliest cause a user can act on.
    expect(result.error).toMatch(/passkey/i)
    expect(result.error.length).toBeGreaterThan(20)
  })

  it('stays silent for the background autofill request', async () => {
    // Nothing asked for this one; a message here would paint the form on page load.
    credentialsGet.mockRejectedValue(notAllowed())
    const { signInWithPasskey } = await import('../webauthn')

    const result = await signInWithPasskey({ conditional: true })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.aborted).toBe(true)
  })

  it('still reports an unusable authenticator distinctly', async () => {
    credentialsGet.mockRejectedValue(new DOMException('bad', 'NotSupportedError'))
    const { signInWithPasskey } = await import('../webauthn')

    const result = await signInWithPasskey()
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.aborted).toBeFalsy()
  })
})
