/**
 * WebAuthn glue: the base64url <-> ArrayBuffer conversions between the worker's JSON options
 * and the browser's credential API, plus the two ceremonies as single calls.
 *
 * Conversions are hand-rolled rather than PublicKeyCredential.parseCreationOptionsFromJSON
 * because that static only reached Safari recently, and this must not break sign-in there.
 */
import { apiFetch } from './apiFetch'

export function bufToB64url(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function b64urlToBuf(s: string): ArrayBuffer {
  const b64 = s
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(s.length / 4) * 4, '=')
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes.buffer
}

export function passkeysSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'PublicKeyCredential' in window &&
    !!window.navigator.credentials
  )
}

interface ServerOptions {
  challenge: string
  user?: { id: string; name?: string; displayName?: string }
  excludeCredentials?: { id: string; type?: string; transports?: string[] }[]
  allowCredentials?: { id: string; type?: string; transports?: string[] }[]
  [key: string]: unknown
}

async function postJson(url: string, body?: unknown): Promise<{ ok: boolean; data: unknown }> {
  const res = await apiFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  })
  return { ok: res.ok, data: (await res.json().catch(() => ({}))) as unknown }
}

const errorOf = (data: unknown, fallback: string) => (data as { error?: string })?.error || fallback

/** The user pressed Escape or the platform sheet timed out — not an error worth red text. */
function isAbort(err: unknown): boolean {
  return (
    err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'AbortError')
  )
}

export type WebauthnResult = { ok: true } | { ok: false; error: string; aborted?: boolean }

/**
 * One-shot flag bridging a login's reload to the "add a passkey?" nudge on the other side.
 * sessionStorage so it never outlives the tab, and try/catch because storage can be blocked.
 */
const NUDGE_KEY = 'fm:offer-passkey'

export function markPasskeyNudgeAfterLogin(): void {
  try {
    sessionStorage.setItem(NUDGE_KEY, '1')
  } catch {
    // No storage, no nudge — sign-in itself must never notice.
  }
}

export function consumePasskeyNudge(): boolean {
  try {
    const set = sessionStorage.getItem(NUDGE_KEY) === '1'
    if (set) sessionStorage.removeItem(NUDGE_KEY)
    return set
  } catch {
    return false
  }
}

export async function registerPasskey(name?: string): Promise<WebauthnResult> {
  const { ok, data } = await postJson('/api/auth/passkeys/register/options')
  if (!ok) return { ok: false, error: errorOf(data, 'Could not start passkey setup') }
  const options = data as ServerOptions
  const publicKey = {
    ...options,
    challenge: b64urlToBuf(options.challenge),
    user: options.user ? { ...options.user, id: b64urlToBuf(options.user.id) } : undefined,
    excludeCredentials: options.excludeCredentials?.map((c) => ({
      ...c,
      type: 'public-key',
      id: b64urlToBuf(c.id),
    })),
  } as unknown as PublicKeyCredentialCreationOptions

  let credential: PublicKeyCredential
  try {
    const created = await window.navigator.credentials.create({ publicKey })
    if (!created) return { ok: false, error: 'The browser returned no passkey' }
    credential = created as PublicKeyCredential
  } catch (err) {
    if (isAbort(err)) return { ok: false, error: 'Passkey setup was cancelled', aborted: true }
    return { ok: false, error: 'This device could not create a passkey' }
  }

  const response = credential.response as AuthenticatorAttestationResponse
  const rawId = bufToB64url(credential.rawId)
  const verify = await postJson('/api/auth/passkeys/register/verify', {
    name,
    response: {
      id: rawId,
      rawId,
      type: 'public-key',
      clientExtensionResults: {},
      response: {
        clientDataJSON: bufToB64url(response.clientDataJSON),
        attestationObject: bufToB64url(response.attestationObject),
        transports: typeof response.getTransports === 'function' ? response.getTransports() : [],
      },
    },
  })
  if (!verify.ok)
    return { ok: false, error: errorOf(verify.data, 'That passkey could not be verified') }
  return { ok: true }
}

export async function signInWithPasskey(): Promise<WebauthnResult> {
  const { ok, data } = await postJson('/api/auth/passkeys/login/options')
  if (!ok) return { ok: false, error: errorOf(data, 'Could not start passkey sign-in') }
  const options = data as ServerOptions
  const publicKey = {
    ...options,
    challenge: b64urlToBuf(options.challenge),
    allowCredentials: options.allowCredentials?.length
      ? options.allowCredentials.map((c) => ({ ...c, type: 'public-key', id: b64urlToBuf(c.id) }))
      : undefined,
  } as unknown as PublicKeyCredentialRequestOptions

  let credential: PublicKeyCredential
  try {
    const got = await window.navigator.credentials.get({ publicKey })
    if (!got) return { ok: false, error: 'The browser returned no passkey' }
    credential = got as PublicKeyCredential
  } catch (err) {
    if (isAbort(err)) return { ok: false, error: 'Passkey sign-in was cancelled', aborted: true }
    return { ok: false, error: 'This device could not use a passkey' }
  }

  const response = credential.response as AuthenticatorAssertionResponse
  const rawId = bufToB64url(credential.rawId)
  const verify = await postJson('/api/auth/passkeys/login/verify', {
    response: {
      id: rawId,
      rawId,
      type: 'public-key',
      clientExtensionResults: {},
      response: {
        clientDataJSON: bufToB64url(response.clientDataJSON),
        authenticatorData: bufToB64url(response.authenticatorData),
        signature: bufToB64url(response.signature),
        userHandle: response.userHandle ? bufToB64url(response.userHandle) : null,
      },
    },
  })
  if (!verify.ok)
    return { ok: false, error: errorOf(verify.data, 'That passkey could not be verified') }
  return { ok: true }
}
