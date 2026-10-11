/**
 * State that follows the signed-in account rather than this browser: the setup wizard's record,
 * the tours finished, whether the Getting started card is hidden. The Worker keeps it in
 * `user_state` (`GET /api/account/state`, `PUT /api/account/state/:key`); the keys and their rules
 * are shared/accountStateKeys.ts and shared/accountState.ts.
 *
 * Cloud mode only. Local-first has no account on a server: it keeps the same things in
 * localStorage, and nothing here calls the route for it.
 *
 * The state is read once per signed-in account and kept for the session; each write answers the
 * stored value, which replaces the copy. A read that fails leaves the copy unknown (null), and the
 * callers then act on nothing: no wizard, and no write made on the strength of state they could
 * not read. The next call reads again.
 */
import { createRoot, createSignal } from 'solid-js'
import { readUserState } from '../../../shared/accountState'
import { USER_STATE_PATH } from '../../../shared/accountStateKeys'
import { apiGet, apiPut } from './api'
import { LOCAL_ONBOARDING_OWNER } from './onboardingFlag'
import type { UserState, UserStateValues } from '../../../shared/accountState'
import type { UserStateKey } from '../../../shared/accountStateKeys'

/** Whose state is kept: `account-<id>`, `local`, or nobody (onboardingFlag.ts names them). */
let owner: string | null = null

/** The read in flight or done for `owner`; null before the first read and after a failed one. */
let reading: Promise<UserState | null> | null = null

const store = createRoot(() => {
  const [state, setState] = createSignal<UserState | null>(null)
  return { state, setState }
})

/** The signed-in account's state as last read or written; null until a read has succeeded. */
export const accountState = store.state

/** True for a signed-in account, whose state is on the server; false for local-first or nobody. */
export function isServerAccount(of: string | null): of is string {
  return of !== null && of !== LOCAL_ONBOARDING_OWNER
}

/** The owner whose state is kept. */
export function accountStateOwner(): string | null {
  return owner
}

/**
 * Keep `next`'s state from now on. Another owner's copy is dropped, so nothing read for one
 * account is ever shown or acted on for another. Set with the onboarding owner
 * (onboardingStore.ts, setOnboardingOwner), at start, after a sign-in and at sign-out.
 */
export function setAccountStateOwner(next: string | null): void {
  if (next === owner) return
  owner = next
  reading = null
  store.setState(null)
}

/**
 * The signed-in account's state, read from the Worker once per account, with every write since
 * applied. Null for local-first or nobody, and when the read failed.
 */
export function readAccountState(): Promise<UserState | null> {
  const of = owner
  if (!isServerAccount(of)) return Promise.resolve(null)
  if (reading === null) {
    const attempt: Promise<UserState | null> = apiGet(USER_STATE_PATH).then(
      (answer) => readUserState(answer),
      () => null
    )
    reading = attempt
    void attempt.then((state) => {
      // A newer owner, or a newer read, has taken over: this answer is not theirs.
      if (owner !== of || reading !== attempt) return
      if (state === null) reading = null
      else store.setState(state)
    })
  }
  // The copy, not the first answer: a write made since the read is in the copy.
  return reading.then((read) => (read !== null && owner === of ? (store.state() ?? read) : read))
}

/**
 * Store `body` under `key` for the signed-in account, and keep the value the Worker answers.
 * Resolves to that value; rejects when the write fails. Local-first and nobody write nothing and
 * resolve to null.
 */
export async function writeAccountState<K extends UserStateKey>(
  key: K,
  body: unknown
): Promise<UserStateValues[K] | null> {
  const of = owner
  if (!isServerAccount(of)) return null
  const answer = await apiPut(`${USER_STATE_PATH}/${key}`, body)
  const read = readUserState(answer)
  const value = (read?.[key] ?? null) as UserStateValues[K] | null
  const current = store.state()
  if (owner === of && current !== null && value !== null) {
    store.setState({ ...current, [key]: value })
  }
  return value
}

/** Test-only: forget the owner and the copy, as a fresh page load does. */
export function __resetAccountStateForTest(): void {
  owner = null
  reading = null
  store.setState(null)
}
