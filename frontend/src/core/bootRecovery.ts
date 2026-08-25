/**
 * bootRecovery — the runtime half of the deploy-safety net (see index.html for the pre-JS half).
 *
 * After a deploy deletes the previous build's hashed chunks, a still-open client that navigates
 * to a lazy-loaded route tries to import a chunk that now 404s. Vite raises `vite:preloadError`;
 * left unhandled it surfaces as a blank route or an "Unexpected token '<'" parse error. We
 * recover by reloading ONCE, through `reloadToLatest` so the reload is guaranteed to land on the
 * build the origin actually serves rather than on the controlling worker's own precache — guarded
 * by a session flag so a genuinely broken build can't loop.
 *
 * Ordering: install this BEFORE the app renders so it wins the race against the ErrorBoundary's
 * own unhandledrejection handler — a quiet reload beats a crash modal for a stale chunk. If we've
 * already reloaded this session and it still fails, we stand down and let the ErrorBoundary show
 * its recovery screen.
 */

import { reloadToLatest } from '@pwa-kit'
import { createSignal } from 'solid-js'

declare global {
  interface Window {
    __APP_BOOTED__?: boolean
  }
}

const RELOAD_GUARD_KEY = 'tc-chunk-reloaded'

/**
 * How long the ErrorBoundary suppression may outlive the reload request. reloadToLatest's
 * slowest path is bounded (~4s waiting for controllerchange before it falls back), so a page
 * still alive this much later is NOT reloading — the flag must release, or every later failure
 * would be swallowed silently for the life of the page.
 */
const RECOVERY_IN_FLIGHT_MAX_MS = 10_000

/**
 * True from the moment a quiet chunk-failure reload has been initiated until the page actually
 * goes (or the deadline above passes). The ErrorBoundary consults this so the same failure that
 * triggered the reload does not also raise the crash modal — a flash of "App Crashed" over a
 * page that is about to recover. A signal, not a boolean: the boundary's fallback renders
 * nothing while this is true and must re-render the modal if the reload never lands.
 */
const [recoveryInFlight, setRecoveryInFlight] = createSignal(false)

export function isChunkRecoveryInFlight(): boolean {
  return recoveryInFlight()
}

function hasReloadedThisSession(): boolean {
  try {
    return sessionStorage.getItem(RELOAD_GUARD_KEY) === '1'
  } catch {
    return false
  }
}

function markReloaded(): void {
  try {
    sessionStorage.setItem(RELOAD_GUARD_KEY, '1')
  } catch {
    /* private mode / storage disabled — fall through, worst case one extra reload */
  }
}

/** Reload once to pick up the new build; if we already tried this session, give up (no loop). */
function reloadForNewBuild(): void {
  if (hasReloadedThisSession()) return
  markReloaded()
  setRecoveryInFlight(true)
  window.setTimeout(() => setRecoveryInFlight(false), RECOVERY_IN_FLIGHT_MAX_MS)
  // `reloadToLatest`, never `location.reload()`. The worker serves navigations from its own
  // precache, so a plain reload after the origin has dropped this build's chunks re-serves the
  // same dead shell and fails identically, forever. It adopts a waiting worker if there is one,
  // and unregisters first if there is not. The guard is already set, so extra chunk failures
  // arriving while it works cannot queue another reload.
  void reloadToLatest()
}

/** True for the "a chunk/module that used to exist is now gone" family of errors. */
export function isChunkLoadError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : typeof err === 'string' ? err : ''
  if (!msg) return false
  return (
    /Failed to fetch dynamically imported module/i.test(msg) ||
    /error loading dynamically imported module/i.test(msg) ||
    /Importing a module script failed/i.test(msg) ||
    /Failed to load module script/i.test(msg) ||
    /'text\/html'/i.test(msg) ||
    /Unexpected token '<'/i.test(msg) ||
    /ChunkLoadError/i.test(msg)
  )
}

/**
 * A successful reload clears the guard so a LATER deploy in the same long-lived session can
 * auto-recover again. Called once the app has booted and settled.
 */
function clearReloadGuard(): void {
  try {
    sessionStorage.removeItem(RELOAD_GUARD_KEY)
  } catch {
    /* ignore */
  }
}

/** Install the runtime recovery listeners. Call once, as early as possible. */
export function installBootRecovery(): void {
  // Vite's signal for a failed dynamic import (lazy routes/components). preventDefault stops it
  // rethrowing; we reload to fetch the current chunk graph. Only prevented when we WILL reload:
  // a prevented event makes Vite resolve the import as `undefined`, which surfaces later as a
  // generic TypeError ("reading 'default'") that nothing can classify as a stale chunk. When
  // recovery has stood down, the original error must rethrow so the ErrorBoundary can show its
  // update-flavoured modal instead of a bare crash.
  window.addEventListener('vite:preloadError', (event) => {
    if (hasReloadedThisSession()) return
    event.preventDefault()
    reloadForNewBuild()
  })

  // Belt-and-suspenders: a rejection that looks like a stale-chunk import (some browsers surface
  // the failure this way rather than via vite:preloadError).
  window.addEventListener('unhandledrejection', (event) => {
    if (isChunkLoadError(event.reason)) {
      reloadForNewBuild()
    }
  })
}

/**
 * Signal a successful boot so the pre-JS watchdog in index.html stands down, and release the
 * chunk-reload guard once we're clearly healthy (a short delay avoids clearing it if the very
 * first post-boot navigation immediately fails again).
 */
export function markBooted(): void {
  window.__APP_BOOTED__ = true
  window.setTimeout(clearReloadGuard, 10_000)
}
