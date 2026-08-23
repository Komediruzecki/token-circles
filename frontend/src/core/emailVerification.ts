/**
 * Email verification — the client half of the confirm-your-address flow.
 *
 * A password signup gets a link that routes through the worker
 * (`GET /api/auth/verify-email`), which does the whole job and bounces the browser back here
 * with `#everified=1` or `#everified_error=<reason>`. There is no page to render: the fragment
 * is read once at boot and turned into a notification.
 *
 * The gate is soft by design. The account works unverified; the only consequence is the banner
 * in <VerifyEmailBanner/>. Nothing here blocks anything.
 */
import { apiFetch } from './apiFetch'

export type EmailVerifyResult = { ok: true } | { ok: false; error: string }

let pending: EmailVerifyResult | null = null

/**
 * Read the `#everified…` fragment the worker sent us back with, and strip it.
 *
 * Called from index.tsx before render, for two reasons: the fragment is not a page, so the hash
 * router would resolve it to a 404, and a fragment left in the address bar re-announces the
 * outcome on every reload.
 */
export function consumeEmailVerifyRedirect(): void {
  const hash = window.location.hash
  if (!hash.startsWith('#everified')) return
  const params = new URLSearchParams(hash.slice(1))
  pending =
    params.get('everified') === '1'
      ? { ok: true }
      : { ok: false, error: params.get('everified_error') ?? 'unknown' }
  history.replaceState(null, '', window.location.pathname + window.location.search)
}

/** The outcome of the confirm link, once. Returns null when there was nothing to report. */
export function takeEmailVerifyResult(): EmailVerifyResult | null {
  const result = pending
  pending = null
  return result
}

/** What the banner needs to decide whether to show itself. */
export interface VerificationStatus {
  email: string
  verified: boolean
  provider: string | null
}

/**
 * Ask the server about the signed-in account. Returns null whenever there is nothing to nudge
 * about — no session, no email, a Google account (already verified by Google), or a backend
 * that does not report the field at all, which is how the legacy self-hosted server answers.
 */
export async function fetchVerificationStatus(): Promise<VerificationStatus | null> {
  try {
    const res = await apiFetch('/api/auth/me', { credentials: 'include' })
    if (!res.ok) return null
    const user = (await res.json()) as {
      email?: string | null
      email_verified?: number | boolean | null
      auth_provider?: string | null
    }
    if (typeof user?.email !== 'string' || user.email === '') return null
    // Absent means "this server has no opinion" — treat it as verified so no banner appears.
    if (user.email_verified === undefined || user.email_verified === null) return null
    return {
      email: user.email,
      verified: Boolean(user.email_verified),
      provider: user.auth_provider ?? null,
    }
  } catch {
    return null
  }
}

/** Ask for the confirm link again. Throws with the server's message so the caller can show it. */
export async function resendVerificationEmail(): Promise<void> {
  const res = await apiFetch('/api/auth/resend-verification', {
    method: 'POST',
    credentials: 'include',
  })
  if (res.ok) return
  const detail = (await res.json().catch(() => ({}))) as { error?: string }
  throw new Error(
    detail.error ??
      (res.status === 429
        ? 'Too many requests — try again a little later'
        : `Could not resend the email (${res.status})`)
  )
}
