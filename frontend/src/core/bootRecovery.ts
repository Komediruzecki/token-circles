/**
 * bootRecovery — the runtime half of the deploy-safety net (see index.html for the pre-JS half).
 *
 * After a deploy deletes the previous build's hashed chunks, a still-open client that navigates
 * to a lazy-loaded route tries to import a chunk that now 404s. Vite raises `vite:preloadError`;
 * left unhandled it surfaces as a blank route or an "Unexpected token '<'" parse error. We
 * recover by reloading ONCE to pick up the fresh index.html + chunk graph — the "auto-reload at
 * a safe moment" behavior — guarded by a session flag so a genuinely broken build can't loop.
 *
 * Ordering: install this BEFORE the app renders so it wins the race against the ErrorBoundary's
 * own unhandledrejection handler — a quiet reload beats a crash modal for a stale chunk. If we've
 * already reloaded this session and it still fails, we stand down and let the ErrorBoundary show
 * its recovery screen.
 */

declare global {
  interface Window {
    __APP_BOOTED__?: boolean
  }
}

const RELOAD_GUARD_KEY = 'tc-chunk-reloaded'

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
  window.location.reload()
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
  // rethrowing; we reload to fetch the current chunk graph.
  window.addEventListener('vite:preloadError', (event) => {
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
