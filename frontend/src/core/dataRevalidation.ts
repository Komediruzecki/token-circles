/**
 * dataRevalidation — refresh the client's data when the app comes back from the background.
 *
 * WHY THIS EXISTS (audit finding F-03). The app had no resume revalidation of any kind. The only
 * `visibilitychange` listener was `core/appVersion.ts`, which checks for a new *build*, not for
 * data, and `Settings.tsx`'s `pageshow` handler only resets a billing spinner. So a tab left open
 * overnight in cloud mode showed yesterday's numbers indefinitely, and edits made on another
 * device — or by the scheduled importer — never arrived until the user happened to write
 * something or reload.
 *
 * THIS IS THE MOBILE-PORT BLOCKER. A browser tab is usually left open and focused; a native app is
 * backgrounded and resumed constantly. Without this, every resume of the Android/iOS shell shows
 * stale data. It is deliberately shipped for the web first, where it is merely a nice-to-have, so
 * the native shell inherits correct behaviour rather than discovering it later.
 *
 * WHAT IT DOES. On resume it bumps every tracked entity counter (core/dataVersions.ts). The
 * visible page refetches; every hidden page is deferred by `pageVisibility.ts` and flushes once
 * when it is next shown. That is the same path a write already takes, so nothing new has to
 * understand resume — a page that follows writes follows resumes for free.
 *
 * THE WINDOW. Revalidating on every alt-tab would be a request storm for no benefit, so a resume
 * only counts when the app was away for at least `AWAY_THRESHOLD_MS`. Flicking to another window
 * and back is free; coming back to the tab after lunch is not.
 *
 * CAPACITOR. `visibilitychange` and the OS app-state event disagree exactly where it matters: a
 * WebView can keep reporting `visible` while the OS has backgrounded the app. MercuryPitch's
 * `native-shell.ts` listens to the OS event for this reason. `initDataRevalidation` therefore
 * takes its triggers as an argument — the native shell passes `App.addListener('appStateChange')`
 * instead of touching this file.
 */
import { invalidateAllEntities } from './dataVersions'

/**
 * How long the app must have been away before a resume revalidates. Long enough that alt-tabbing
 * is free, short enough that coming back to a tab after a meeting shows current numbers.
 */
export const AWAY_THRESHOLD_MS = 60_000

/** Subscribe to one resume signal. Returns its unsubscribe. */
export type ResumeSource = (onResume: () => void) => () => void

/** Subscribe to one "the app went away" signal. Returns its unsubscribe. */
export type SuspendSource = (onSuspend: () => void) => () => void

export interface RevalidationOptions {
  /** Defaults to the browser's visibility and focus events. Subject to the away window. */
  resumeSources?: ResumeSource[]
  suspendSources?: SuspendSource[]
  /** Defaults to the browser's `online` event. Revalidates unconditionally. */
  reconnectSources?: ResumeSource[]
  /** Injectable for tests. Defaults to `Date.now`. */
  now?: () => number
  awayThresholdMs?: number
}

function browserResumeSources(): ResumeSource[] {
  return [
    (onResume) => {
      const handler = () => {
        if (document.visibilityState === 'visible') onResume()
      }
      document.addEventListener('visibilitychange', handler)
      return () => {
        document.removeEventListener('visibilitychange', handler)
      }
    },
    (onResume) => {
      window.addEventListener('focus', onResume)
      return () => {
        window.removeEventListener('focus', onResume)
      }
    },
  ]
}

/**
 * Reconnecting revalidates unconditionally, and does not go through the away-window check at all.
 * Losing the network fires no suspend event, so there is no "away since" to measure; and the
 * duration would be the wrong question anyway, since whatever changed while offline was never
 * seen and any write attempted in that window failed.
 */
function browserReconnectSources(): ResumeSource[] {
  return [
    (onReconnect) => {
      window.addEventListener('online', onReconnect)
      return () => {
        window.removeEventListener('online', onReconnect)
      }
    },
  ]
}

function browserSuspendSources(): SuspendSource[] {
  return [
    (onSuspend) => {
      const handler = () => {
        if (document.visibilityState === 'hidden') onSuspend()
      }
      document.addEventListener('visibilitychange', handler)
      return () => {
        document.removeEventListener('visibilitychange', handler)
      }
    },
    (onSuspend) => {
      window.addEventListener('blur', onSuspend)
      return () => {
        window.removeEventListener('blur', onSuspend)
      }
    },
  ]
}

/**
 * Start watching for resumes. Returns a disposer that removes every listener.
 *
 * Mirrors `initVersionWatch` so App.tsx wires both the same way.
 */
export function initDataRevalidation(options: RevalidationOptions = {}): () => void {
  const now = options.now ?? (() => Date.now())
  const threshold = options.awayThresholdMs ?? AWAY_THRESHOLD_MS
  const resumeSources = options.resumeSources ?? browserResumeSources()
  const suspendSources = options.suspendSources ?? browserSuspendSources()
  const reconnectSources = options.reconnectSources ?? browserReconnectSources()

  // `null` means "not currently away". Starting here is what stops the very first focus event
  // after load — browsers fire one — from refetching data the app just fetched.
  let awaySince: number | null = null

  const onSuspend = () => {
    if (awaySince === null) awaySince = now()
  }

  const onResume = () => {
    const since = awaySince
    awaySince = null
    if (since === null) return
    if (now() - since < threshold) return
    invalidateAllEntities()
  }

  const teardowns = [
    ...suspendSources.map((subscribe) => subscribe(onSuspend)),
    ...resumeSources.map((subscribe) => subscribe(onResume)),
    ...reconnectSources.map((subscribe) => subscribe(revalidateNow)),
  ]

  return () => {
    for (const teardown of teardowns) teardown()
  }
}

/**
 * Force a revalidation regardless of how long the app was away. The `online` path uses this: a
 * reconnect always revalidates, because nothing that happened while offline was ever seen.
 */
export function revalidateNow(): void {
  invalidateAllEntities()
}
