/**
 * appVersion — detect a new deployment and get the user onto it safely.
 *
 * The build stamps its commit into `__GIT_SHA__` and emits a matching /version.json (served
 * no-cache). We poll that file on focus / a slow interval; when the server's sha no longer
 * matches this running build, a deploy has happened. We then update the service worker and
 * reload at a SAFE moment — the user's next in-app navigation (a hashchange) — so a mid-session
 * deploy never strands them on a dead lazy chunk ("Unexpected token '<'") and never yanks the
 * page from under an active view. A toast is the visible fallback for a user who parks on one
 * page and never navigates.
 *
 * Reload discipline (the deploy-transition audit): at most one auto-reload per server sha AND
 * a rolling cap across shas, so back-to-back releases each get their one reload while a
 * misbehaving pipeline can never spin a tab. Before reloading we ask the still-controlling
 * service worker to update first (skipWaiting + clientsClaim promote it immediately), so the
 * single reload lands on the new build instead of being re-served stale caches.
 *
 * Version truth (`displayVersion`): the label shown in the UI is the EXECUTING bundle's
 * version — except when version.json reports the SAME commit with a DIFFERENT version string,
 * which means this bundle's compiled stamp is wrong (e.g. a non-tag build); then the network
 * stamp wins. While an update is pending, `serverVersion` exposes what the server is running
 * so the UI can say "vNEW available" without lying about what is currently executing.
 */
import { createSignal } from 'solid-js'
import { toast } from './api'
import { activateUpdatedServiceWorker } from './bootRecovery'

export interface VersionInfo {
  version?: string
  gitSha?: string
  builtAt?: string
}

const POLL_INTERVAL_MS = 5 * 60 * 1000 // 5 minutes
const FIRST_CHECK_DELAY_MS = 15 * 1000 // let the app settle before the first probe
const RELOAD_GUARD_KEY = 'tc-version-reload'
const RELOAD_HISTORY_KEY = 'tc-version-reload-times'
/** Rolling cap: at most this many auto-reloads per window, across ALL shas. */
const MAX_RELOADS_PER_WINDOW = 3
const RELOAD_WINDOW_MS = 10 * 60 * 1000

const [updateAvailable, setUpdateAvailable] = createSignal(false)
const [displayVersion, setDisplayVersion] = createSignal(buildVersion())
const [serverVersion, setServerVersion] = createSignal<string | null>(null)
/** True once a newer build is live on the server (drives an optional "reload" affordance). */
export { updateAvailable }
/** The version to show in UI (login footer, About, crash modal) — see module docs. */
export { displayVersion }
/** The server's version while it differs from the running build, else null. */
export { serverVersion }

let pendingReload = false
let latestServerSha: string | null = null

function buildVersion(): string {
  return typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'unknown'
}

function buildSha(): string {
  return typeof __GIT_SHA__ !== 'undefined' ? __GIT_SHA__ : ''
}

async function fetchServerVersion(): Promise<VersionInfo | null> {
  try {
    const res = await fetch('/version.json', { cache: 'no-store' })
    if (!res.ok) return null
    return (await res.json()) as VersionInfo
  } catch {
    return null // offline, missing (local dev), or non-JSON — treat as "no update info"
  }
}

export type VersionAssessment =
  /** No usable server info, or a local/dev build — do nothing, never nag. */
  | { kind: 'no-info' }
  /** Server runs OUR commit. `correctedLabel` is set when its version string disagrees. */
  | { kind: 'current'; correctedLabel: string | null }
  /** Server runs a different commit — a deploy happened. */
  | { kind: 'update'; serverSha: string; serverVersion: string | null }

/** Pure decision core of the version check (unit-tested in isolation). */
export function assessVersion(
  build: { version: string; sha: string },
  info: VersionInfo | null
): VersionAssessment {
  if (!info?.gitSha) return { kind: 'no-info' }
  if (!build.sha || build.sha === 'unknown') return { kind: 'no-info' }
  if (info.gitSha === build.sha) {
    const correctedLabel = info.version && info.version !== build.version ? info.version : null
    return { kind: 'current', correctedLabel }
  }
  return { kind: 'update', serverSha: info.gitSha, serverVersion: info.version ?? null }
}

function readReloadHistory(): number[] {
  try {
    const raw = sessionStorage.getItem(RELOAD_HISTORY_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((t): t is number => typeof t === 'number') : []
  } catch {
    return []
  }
}

/**
 * May we auto-reload for `sha` right now? One reload per sha (a reload that failed to move us
 * off the old build must not repeat), and at most MAX_RELOADS_PER_WINDOW across all shas (two
 * quick releases each get their reload; a flapping/broken pipeline gets a hard stop and the
 * user keeps the toast as a manual affordance).
 */
export function shouldAutoReload(sha: string, now: number): boolean {
  try {
    if (sessionStorage.getItem(RELOAD_GUARD_KEY) === sha) return false
  } catch {
    /* unreadable storage — fall through to the rolling cap */
  }
  const recent = readReloadHistory().filter((t) => now - t < RELOAD_WINDOW_MS)
  return recent.length < MAX_RELOADS_PER_WINDOW
}

/** Record that we are about to auto-reload for `sha`. */
export function recordAutoReload(sha: string, now: number): void {
  try {
    sessionStorage.setItem(RELOAD_GUARD_KEY, sha)
    const recent = readReloadHistory().filter((t) => now - t < RELOAD_WINDOW_MS)
    recent.push(now)
    sessionStorage.setItem(RELOAD_HISTORY_KEY, JSON.stringify(recent))
  } catch {
    /* ignore — worst case the guard is weaker, the rolling cap still applies */
  }
}

/** Update the SW (bounded), then reload to pick up `serverSha`; guarded against loops. */
function reloadForUpdate(serverSha: string): void {
  const now = Date.now()
  if (!shouldAutoReload(serverSha, now)) return
  recordAutoReload(serverSha, now)
  // Refresh the service worker BEFORE reloading so the reload is served by the new one (or
  // by the network) rather than by the old worker's caches. Guard is already recorded — a
  // second hashchange while we wait cannot queue another reload.
  void activateUpdatedServiceWorker().finally(() => {
    window.location.reload()
  })
}

/** One poll of version.json; updates the signals and arms the safe-moment reload. */
export async function checkForUpdate(): Promise<void> {
  const info = await fetchServerVersion()
  const verdict = assessVersion({ version: buildVersion(), sha: buildSha() }, info)
  if (verdict.kind === 'no-info') return

  if (verdict.kind === 'current') {
    // We ARE the deployed build. Adopt the network's version string if our compiled stamp
    // disagrees (mis-stamped build), and stand down any update state from a previous poll
    // (e.g. a rollback to the sha we are already running).
    if (verdict.correctedLabel) setDisplayVersion(verdict.correctedLabel)
    setServerVersion(null)
    setUpdateAvailable(false)
    pendingReload = false
    latestServerSha = null
    return
  }

  latestServerSha = verdict.serverSha
  setServerVersion(verdict.serverVersion)
  if (!updateAvailable()) {
    setUpdateAvailable(true)
    toast('A new version is available — it will load on your next move.', 'info')
  }
  pendingReload = true
}

/**
 * Start watching for deployments. Call once (from App's onMount) and dispose on cleanup.
 * Reloads on the next navigation after an update is detected; polls on interval + tab focus.
 */
export function initVersionWatch(): () => void {
  const onHashChange = () => {
    if (pendingReload && latestServerSha) reloadForUpdate(latestServerSha)
  }
  const onVisible = () => {
    if (document.visibilityState === 'visible') void checkForUpdate()
  }
  const interval = window.setInterval(() => void checkForUpdate(), POLL_INTERVAL_MS)
  const kickoff = window.setTimeout(() => void checkForUpdate(), FIRST_CHECK_DELAY_MS)
  window.addEventListener('hashchange', onHashChange)
  document.addEventListener('visibilitychange', onVisible)

  return () => {
    window.clearInterval(interval)
    window.clearTimeout(kickoff)
    window.removeEventListener('hashchange', onHashChange)
    document.removeEventListener('visibilitychange', onVisible)
  }
}
