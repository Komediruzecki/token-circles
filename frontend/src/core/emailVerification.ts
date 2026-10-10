/**
 * Email verification — the client half of the confirm-your-address flow.
 *
 * A password signup gets a link that routes through the worker
 * (`GET /api/auth/verify-email`), which does the whole job and bounces the browser back here
 * with `#everified=1` or `#everified_error=<reason>`. There is no page to render: the fragment
 * is read once at boot and turned into a notification.
 *
 * The link that moves an account to a new address (asked for in Settings) goes through the same
 * route, and its answer adds `&change=1`, so the message can talk about the change instead.
 *
 * Either link is spent only where its account is signed in. Opened anywhere else, the worker
 * leaves it unspent, answers `signin_required`, and gives this browser a marker that scripts
 * cannot read. Once the link's account signs in here, finishEmailLink asks the worker to spend
 * it. Until then a note says a link is waiting (linkWaiting): the sign-in screen says what
 * signing in will do, and the note outlasts the reload every sign-in ends in. A password sign-in
 * spends a confirm link itself, and says so (noteAddressConfirmed).
 */
import { apiFetch } from './apiFetch'
import { getStorageMode, setStorageMode } from './storage/storageFactory'

/** `change` is set when the link was the one that moves the account to a new address. */
export type EmailVerifyResult =
  { ok: true; change?: true } | { ok: false; error: string; change?: true }

let pending: EmailVerifyResult | null = null

/**
 * Read the `#everified…` fragment the worker sent us back with, and strip it.
 *
 * Called from index.tsx before render, for two reasons: the fragment is not a page, so the hash
 * router would resolve it to a 404, and a fragment left in the address bar re-announces the
 * outcome on every reload.
 *
 * A link that needs a sign-in is noted as waiting, and the device moves to account mode, because
 * local-first mode has no sign-in screen. The switch is the one Sign In makes from local-first
 * mode (App.handleLogin): data kept on the device is not touched, and choosing local-first again
 * (Settings, or the sign-in screen's way in without an account) brings it back. Being early is
 * what makes it cheap: the app reads the mode on the way in, so it comes up on the sign-in screen.
 */
export function consumeEmailVerifyRedirect(): void {
  const hash = window.location.hash
  if (!hash.startsWith('#everified')) return
  const params = new URLSearchParams(hash.slice(1))
  const change = params.get('change') === '1'
  history.replaceState(null, '', window.location.pathname + window.location.search)
  if (params.get('everified') !== '1' && params.get('everified_error') === 'signin_required') {
    noteLinkWaiting(change)
    if (getStorageMode() !== 'self-hosted') setStorageMode('self-hosted')
    return
  }
  const changed = change ? ({ change: true } as const) : {}
  pending =
    params.get('everified') === '1'
      ? { ok: true, ...changed }
      : { ok: false, error: params.get('everified_error') ?? 'unknown', ...changed }
}

// ── A link waiting for a sign-in ──────────────────────────────────────────────────────────────

const WAITING_KEY = 'tc:email-link-waiting'

/** As long as the worker's marker lasts (worker/src/email-link.ts). */
export const LINK_WAITING_MS = 30 * 60 * 1000

function noteLinkWaiting(change: boolean): void {
  try {
    localStorage.setItem(
      WAITING_KEY,
      JSON.stringify({ change, until: Date.now() + LINK_WAITING_MS })
    )
  } catch {
    // No storage: the marker still finishes the link at the next sign-in that asks for it.
  }
}

/** The link this browser opened before signing in, while it can still finish; null otherwise. */
export function linkWaiting(): { change: boolean } | null {
  try {
    const raw = localStorage.getItem(WAITING_KEY)
    if (raw === null) return null
    const note = JSON.parse(raw) as { change?: unknown; until?: unknown }
    if (typeof note.until !== 'number' || note.until <= Date.now()) {
      localStorage.removeItem(WAITING_KEY)
      return null
    }
    return { change: note.change === true }
  } catch {
    return null
  }
}

export function clearLinkWaiting(): void {
  try {
    localStorage.removeItem(WAITING_KEY)
  } catch {
    /* nothing to clear */
  }
}

/** What finishing the waiting link did (POST /api/auth/email-link/finish). */
export type LinkFinish = {
  outcome: 'confirmed' | 'changed' | 'email_taken' | 'server_error' | 'other_account' | 'none'
  change: boolean
}

const OUTCOMES = new Set<string>([
  'confirmed',
  'changed',
  'email_taken',
  'server_error',
  'other_account',
  'none',
])

/**
 * Ask the worker to finish the link this browser opened before signing in. Null when there was
 * no answer to act on (offline, signed out, rate-limited): the note stays, and the next sign-in
 * or load asks again.
 */
export async function finishEmailLink(): Promise<LinkFinish | null> {
  try {
    const res = await apiFetch('/api/auth/email-link/finish', {
      method: 'POST',
      credentials: 'include',
    })
    if (!res.ok) return null
    const body = (await res.json()) as { outcome?: unknown; change?: unknown }
    if (typeof body.outcome !== 'string' || !OUTCOMES.has(body.outcome)) return null
    return { outcome: body.outcome as LinkFinish['outcome'], change: body.change === true }
  } catch {
    return null
  }
}

// ── An address confirmed on the way into the app ──────────────────────────────────────────────

const CONFIRMED_KEY = 'tc:email-confirmed'

/**
 * The address was just confirmed in this browser, by a password sign-in that spent the link this
 * browser opened (signInForm.ts). Said once the app has loaded: a sign-in ends in a reload, and
 * the second factor may come first. The link is no longer waiting.
 */
export function noteAddressConfirmed(): void {
  clearLinkWaiting()
  try {
    sessionStorage.setItem(CONFIRMED_KEY, '1')
  } catch {
    // No storage: the address is confirmed all the same, only unannounced.
  }
}

function takeAddressConfirmed(): EmailVerifyResult | null {
  try {
    if (sessionStorage.getItem(CONFIRMED_KEY) !== '1') return null
    sessionStorage.removeItem(CONFIRMED_KEY)
    return { ok: true }
  } catch {
    return null
  }
}

/** The outcome of the confirm link, once. Returns null when there was nothing to report. */
export function takeEmailVerifyResult(): EmailVerifyResult | null {
  const result = pending ?? takeAddressConfirmed()
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
