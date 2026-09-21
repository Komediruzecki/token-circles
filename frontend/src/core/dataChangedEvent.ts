/**
 * The "something was written" browser event that achievements listens to.
 *
 * WHY THIS MODULE EXISTS. The dispatch used to live inside the typed client's `request()` in
 * api.ts — which meant it fired for `api.createTransaction()` and friends, and for nothing else.
 * The raw helpers (`apiPost`, `apiPut`, `apiDelete`, `apiGet`) call `apiFetch` directly and never
 * pass through `request()`, so **no write made through them ever triggered an achievements
 * evaluation**. Goals, Bills and Budgets write exclusively through the raw helpers, so the badges
 * that depend on their data — `first-budget`, `goal-in-sight`, `goal-reached`, `under-budget-six`
 * — only unlocked by accident, whenever some unrelated typed-client write happened later.
 *
 * Moving it to `apiFetch`, the one function both surfaces share, fixes that the same way
 * dataVersions did for staleness. This is a leaf module with no imports of its own precisely so
 * `apiFetch` can use it: achievementsStore imports the API client, so anything that reaches back
 * from apiFetch into achievementsStore would close a cycle.
 */

/** Listened to by components/AchievementsHost.tsx, which debounces before evaluating. */
export const DATA_CHANGED_EVENT = 'tc:data-changed'

/**
 * Settings writes are excluded because persisting an unlock is itself a settings write — without
 * this, evaluating achievements would schedule another evaluation, forever.
 */
const EXCLUDED_PREFIX = '/api/settings'

/**
 * Announce a completed write. Called by `apiFetch` for both storage modes.
 *
 * Same discrimination as `invalidateForRequest`: reads change nothing, and a rejected write left
 * the server's state alone, so neither can have earned a badge.
 */
export function announceDataChanged(path: string, method: string | undefined, ok: boolean): void {
  if (!ok) return
  const verb = (method ?? 'GET').toUpperCase()
  if (verb === 'GET' || verb === 'HEAD' || verb === 'OPTIONS') return
  if (path.startsWith(EXCLUDED_PREFIX)) return
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(DATA_CHANGED_EVENT, { detail: { endpoint: path } }))
}
