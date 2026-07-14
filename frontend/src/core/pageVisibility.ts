/**
 * pageVisibility — gate reactive refetches by page visibility for the keep-alive
 * page host (PR #317).
 *
 * Since #317, every visited page stays mounted and is merely hidden with CSS
 * (`display:none`) instead of unmounted. That makes navigation instant, but it
 * also means a single global change — a profile switch (`bumpProfileVersion`) or a
 * focus-period step (`periodStore`) — would refetch EVERY mounted page at once, a
 * fan-out of concurrent api.<domain> calls in cloud/self-hosted mode.
 *
 * These helpers keep the visible page eager and make hidden pages lazy: the active
 * page refetches immediately, while a hidden page only records that its data went
 * stale and refetches once — the next time it becomes visible ("on show"). Net
 * effect: the same instant-nav / no-blank behavior #317 delivered, without the
 * background fan-out.
 *
 * Two entry points, one for each refetch style the feature pages use:
 *   - refetchOnActive — imperative loaders driven by createEffect
 *   - gatedSource     — declarative createResource sources
 */
import { createEffect, createSignal, untrack } from 'solid-js'
import { getPage } from './appStore'
import type { PageName } from '../types/models'

/** Reactive accessor: is `name` the currently visible (active) page? */
export function usePageActive(name: PageName): () => boolean {
  return () => getPage() === name
}

/**
 * Gate an imperative refetch (createEffect-style pages) by visibility.
 *
 *   refetchOnActive('goals', () => { void state.profileVersion }, () => {
 *     loadGoals()
 *     loadCategories()
 *   })
 *
 * `track` reads the reactive deps (profile version, focus period, …); `run` performs
 * the fetch. When a dep changes and the page is visible, `run` fires now; when hidden,
 * the page is flagged stale and `run` fires once on the next show. The deps effect
 * also runs on mount (a page mounts only while active), performing the initial load —
 * so this replaces the old `onMount(run)` + `createEffect(deps → run)` pair, which
 * double-fetched on mount.
 */
export function refetchOnActive(name: PageName, track: () => void, run: () => void): void {
  const isActive = usePageActive(name)
  const [stale, setStale] = createSignal(false)
  // Deps effect: re-runs only when a tracked dep changes (isActive is read untracked,
  // so navigating to/away from the page never re-runs this). Visible → fetch now;
  // hidden → remember the page needs a refetch.
  createEffect(() => {
    track()
    if (untrack(isActive)) untrack(run)
    else setStale(true)
  })
  // Visibility effect: fires on the hidden→visible edge; if data went stale while
  // hidden, refetch exactly once. A plain revisit (not stale) does nothing, so
  // instant nav with no refetch is preserved.
  createEffect(() => {
    if (isActive() && untrack(stale)) {
      setStale(false)
      untrack(run)
    }
  })
}

/**
 * Gate a `createResource` source by visibility. Wrap the resource's source function:
 *
 *   const [data] = createResource(
 *     gatedSource('accounts', () => state.profileVersion),
 *     fetcher,
 *   )
 *
 * The resource still self-loads once on mount off the seed value. Afterwards a dep
 * change refetches immediately while visible, or is deferred (data marked stale) while
 * hidden and flushed once on the next show. The wrapped source returns exactly what the
 * inner source produced, so the fetcher is unchanged.
 */
export function gatedSource<T>(name: PageName, source: () => T): () => T {
  const isActive = usePageActive(name)
  // `held` is what the resource actually tracks. Seeded from the current source so the
  // resource's own initial fetch fires with correct deps.
  const [held, setHeld] = createSignal<T>(untrack(source))
  const [stale, setStale] = createSignal(false)
  let primed = false
  // Deps effect: while visible, mirror source → held (a new value drives the refetch);
  // while hidden, just mark stale. Skip the very first run — the resource already
  // fetched off the seed, so re-pushing it would double-fetch on mount.
  createEffect(() => {
    const v = source()
    if (!primed) {
      primed = true
      return
    }
    if (untrack(isActive)) setHeld(() => v)
    else setStale(true)
  })
  // Visibility effect: on becoming visible with stale data, push the current source
  // once → a single refetch with fresh deps.
  createEffect(() => {
    if (isActive() && untrack(stale)) {
      setStale(false)
      setHeld(() => untrack(source))
    }
  })
  return held
}
