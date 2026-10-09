/**
 * The notice that confirming an address also removed what was set up on the account before it
 * (worker: clearUnconfirmedAccess, clearedWorthSaying).
 *
 * The route that did it says so: Google sign-in adds `?cleared=1` to its redirect, and an emailed
 * code and a reset answer `cleared: true`. Each of them ends in a reload, so the news crosses it
 * in sessionStorage, the way the passkey nudge does, and is shown once. A sign-in lands in the
 * app, which shows it in a banner (VerifyEmailBanner); a reset lands on the sign-in screen, whose
 * words leave out the password that was just set.
 */

const KEY = 'tc:access-cleared'

export type ClearedBy = 'sign-in' | 'reset'

/** Fixed words, one notice per screen. */
export const ACCESS_CLEARED_NOTICE: Record<ClearedBy, string> = {
  'sign-in':
    'Confirming your email removed what was set up before it: the old password, passkeys, two-factor authentication, API tokens and sign-ins on other devices. Add what you need again in Settings. To use a password again, choose Forgot password on the sign-in screen.',
  reset:
    'Your new password is set. Confirming your email removed what was set up before it: passkeys, two-factor authentication, API tokens and sign-ins on other devices. Sign in, then add what you need again in Settings.',
}

export function markAccessCleared(by: ClearedBy): void {
  try {
    sessionStorage.setItem(KEY, by)
  } catch {
    // No storage, no notice: the sign-in itself must never notice.
  }
}

/** True once when a notice is waiting for `by`'s screen. Another screen's notice stays. */
export function takeAccessCleared(by: ClearedBy): boolean {
  try {
    if (sessionStorage.getItem(KEY) !== by) return false
    sessionStorage.removeItem(KEY)
    return true
  } catch {
    return false
  }
}

/**
 * Read the `?cleared=1` Google sign-in adds to its redirect, and strip it, so a reload does not
 * announce it again. Called from index.tsx before render.
 */
export function consumeAccessClearedRedirect(): void {
  const params = new URLSearchParams(window.location.search)
  if (params.get('cleared') !== '1') return
  markAccessCleared('sign-in')
  params.delete('cleared')
  const query = params.toString()
  history.replaceState(
    null,
    '',
    window.location.pathname + (query ? `?${query}` : '') + window.location.hash
  )
}
