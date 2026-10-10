/**
 * The notice that the step a person took confirmed their address and removed what was set up on
 * the account before it (worker: clearUnconfirmedAccess, clearedWorthSaying).
 *
 * The route names what went (shared/accessCleared.ts): Google sign-in adds `?cleared=password` to
 * its redirect, and an emailed code and a reset answer `cleared: ['password']`. Each ends in a
 * reload, so the step and the names cross it in sessionStorage, the way the passkey nudge does,
 * and the notice is shown once. A sign-in lands in the app, which shows it in a banner
 * (VerifyEmailBanner); a reset lands on the sign-in screen.
 *
 * The notice names the step, then only what went, in one sentence, then the one next step that
 * fits where the person is. When nothing went that they would miss, there is no notice.
 */
import { readClearedKinds } from '../../../shared/accessCleared'
import type { ClearedKind } from '../../../shared/accessCleared'

export type { ClearedKind } from '../../../shared/accessCleared'

const KEY = 'tc:access-cleared'

/** The step that confirmed the address. */
export type ClearedBy = 'google' | 'email-code' | 'reset'

/** Where a notice is shown: the app after a sign-in, the sign-in screen after a reset. */
export type ClearedScreen = 'app' | 'sign-in-screen'

const SCREEN_OF: Record<ClearedBy, ClearedScreen> = {
  google: 'app',
  'email-code': 'app',
  reset: 'sign-in-screen',
}

const STEP_WORDS: Record<ClearedBy, string> = {
  google: 'Signing in with Google',
  'email-code': 'Signing in with an emailed code',
  reset: 'Resetting your password',
}

/** How the notice names each kind. */
export const CLEARED_NAMES: Record<ClearedKind, string> = {
  password: 'password',
  passkeys: 'passkeys',
  'two-factor': 'two-factor authentication',
  'api-tokens': 'API tokens',
}

/** "a", "a and b", "a, b and c". */
function listed(names: string[]): string {
  if (names.length < 2) return names.join('')
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/** What no longer works and what is off, as the end of one sentence. */
function whatWent(kinds: ClearedKind[]): string {
  const stopped = kinds.filter((kind) => kind !== 'two-factor')
  const parts: string[] = []
  if (stopped.length > 0) {
    const works = stopped.length === 1 && stopped[0] === 'password' ? 'works' : 'work'
    parts.push(`your ${listed(stopped.map((kind) => CLEARED_NAMES[kind]))} no longer ${works}`)
  }
  if (kinds.includes('two-factor')) parts.push(`${CLEARED_NAMES['two-factor']} is off`)
  return parts.join(', and ')
}

/**
 * The notice for what `by` removed, or null when there is nothing to say. A reset has just set the
 * password, so the password is never named after one.
 */
export function accessClearedNotice(by: ClearedBy, reported: ClearedKind[]): string | null {
  const kinds = readClearedKinds(reported).filter((kind) => by !== 'reset' || kind !== 'password')
  if (kinds.length === 0) return null
  const happened = `${STEP_WORDS[by]} confirmed your email, so ${whatWent(kinds)}.`
  const them = kinds.length === 1 && kinds[0] === 'two-factor' ? 'it' : 'them'
  let next: string
  if (by === 'reset') next = `Sign in, then set ${them} up again in Settings.`
  else if (kinds.includes('password')) {
    const one = kinds.length === 1 ? 'one' : 'password'
    next = `To set a new ${one}, sign out and choose Forgot password.`
  } else next = `Set ${them} up again in Settings.`
  return `${happened} ${next}`
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

const isStep = (raw: string): raw is ClearedBy => raw in SCREEN_OF

/**
 * The step and what it removed, once, when a notice is waiting for `screen`; otherwise null. A
 * notice for the other screen stays; a kept value that names no step or no kind is removed.
 */
export function takeAccessCleared(
  screen: ClearedScreen
): { by: ClearedBy; kinds: ClearedKind[] } | null {
  try {
    const kept = sessionStorage.getItem(KEY)
    if (kept === null) return null
    const [by = '', names = ''] = kept.split(':')
    const kinds = readClearedKinds(names)
    if (!isStep(by) || kinds.length === 0) {
      sessionStorage.removeItem(KEY)
      return null
    }
    if (SCREEN_OF[by] !== screen) return null
    sessionStorage.removeItem(KEY)
    return { by, kinds }
  } catch {
    return null
  }
}

/** The notice waiting for `screen`, taken once, or null. */
export function takeAccessClearedNotice(screen: ClearedScreen): string | null {
  const waiting = takeAccessCleared(screen)
  return waiting === null ? null : accessClearedNotice(waiting.by, waiting.kinds)
}

/**
 * Read the `?cleared=` Google sign-in adds to its redirect, and strip it, so a reload does not
 * announce it again. Called from index.tsx before render.
 */
export function consumeAccessClearedRedirect(): void {
  const params = new URLSearchParams(window.location.search)
  const reported = params.get('cleared')
  if (reported === null) return
  markAccessCleared('google', readClearedKinds(reported))
  params.delete('cleared')
  const query = params.toString()
  history.replaceState(
    null,
    '',
    window.location.pathname + (query ? `?${query}` : '') + window.location.hash
  )
}
