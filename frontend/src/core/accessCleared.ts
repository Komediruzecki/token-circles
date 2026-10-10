/**
 * The notice that confirming an address also removed what was set up on the account before it
 * (worker: clearUnconfirmedAccess, clearedWorthSaying).
 *
 * The route that did it names what went (shared/accessCleared.ts): Google sign-in adds
 * `?cleared=password` to its redirect, and an emailed code and a reset answer
 * `cleared: ['password']`. Each of them ends in a reload, so the names cross it in sessionStorage,
 * the way the passkey nudge does, and the notice is shown once. A sign-in lands in the app, which
 * shows it in a banner (VerifyEmailBanner); a reset lands on the sign-in screen.
 *
 * The notice names only what went, in one sentence, then the one thing to do next. When nothing
 * went that the person would miss, there is no notice.
 */
import { readClearedKinds } from '../../../shared/accessCleared'
import type { ClearedKind } from '../../../shared/accessCleared'

export type { ClearedKind } from '../../../shared/accessCleared'

const KEY = 'tc:access-cleared'

export type ClearedBy = 'sign-in' | 'reset'

/** How the notice names each kind. */
export const CLEARED_NAMES: Record<ClearedKind, string> = {
  password: 'the password you signed up with',
  passkeys: 'your passkeys',
  'two-factor': 'two-factor authentication',
  'api-tokens': 'your API tokens',
}

/** "a", "a and b", "a, b and c". */
function listed(names: string[]): string {
  if (names.length < 2) return names.join('')
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/**
 * The notice for what `by` removed, or null when there is nothing to say. A reset has just set the
 * password, so the password is never named after one.
 */
export function accessClearedNotice(by: ClearedBy, reported: ClearedKind[]): string | null {
  const kinds = readClearedKinds(reported).filter((kind) => by === 'sign-in' || kind !== 'password')
  if (kinds.length === 0) return null
  const removed = listed(kinds.map((kind) => CLEARED_NAMES[kind]))
  const them = kinds.length === 1 && kinds[0] === 'two-factor' ? 'it' : 'them'
  if (by === 'reset') {
    return `Your new password is set, and confirming your email removed ${removed}. Sign in, then add ${them} again in Settings.`
  }
  if (kinds.includes('password')) {
    return `Confirming your email removed ${removed}. To set a new password, choose Forgot password on the sign-in screen.`
  }
  return `Confirming your email removed ${removed}. Add ${them} again in Settings.`
}

/** Keep what `by` removed for the screen after the reload. Nothing removed, nothing kept. */
export function markAccessCleared(by: ClearedBy, reported: ClearedKind[]): void {
  const kinds = readClearedKinds(reported)
  if (kinds.length === 0) return
  try {
    sessionStorage.setItem(KEY, `${by}:${kinds.join(',')}`)
  } catch {
    // No storage, no notice: the sign-in itself must never notice.
  }
}

/**
 * What `by` removed, once, when a notice is waiting for its screen; otherwise nothing. Another
 * screen's notice stays.
 */
export function takeAccessCleared(by: ClearedBy): ClearedKind[] {
  try {
    const kept = sessionStorage.getItem(KEY)
    if (kept === null || !kept.startsWith(`${by}:`)) return []
    sessionStorage.removeItem(KEY)
    return readClearedKinds(kept.slice(by.length + 1))
  } catch {
    return []
  }
}

/**
 * Read the `?cleared=` Google sign-in adds to its redirect, and strip it, so a reload does not
 * announce it again. Called from index.tsx before render.
 */
export function consumeAccessClearedRedirect(): void {
  const params = new URLSearchParams(window.location.search)
  const reported = params.get('cleared')
  if (reported === null) return
  markAccessCleared('sign-in', readClearedKinds(reported))
  params.delete('cleared')
  const query = params.toString()
  history.replaceState(
    null,
    '',
    window.location.pathname + (query ? `?${query}` : '') + window.location.hash
  )
}
