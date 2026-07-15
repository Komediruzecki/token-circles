/**
 * appVersion — detect a new deployment and get the user onto it safely.
 *
 * The build stamps its commit into `__GIT_SHA__` and emits a matching /version.json (served
 * no-cache). We poll that file on focus / a slow interval; when the server's sha no longer
 * matches this running build, a deploy has happened. We then reload at a SAFE moment — the
 * user's next in-app navigation (a hashchange) — so a mid-session deploy never strands them on
 * a dead lazy chunk ("Unexpected token '<'") and never yanks the page from under an active view.
 * A toast is the visible fallback for a user who parks on one page and never navigates.
 */
import { createSignal } from 'solid-js'
import { toast } from './api'

interface VersionInfo {
  version?: string
  gitSha?: string
  builtAt?: string
}

const POLL_INTERVAL_MS = 5 * 60 * 1000 // 5 minutes
const FIRST_CHECK_DELAY_MS = 15 * 1000 // let the app settle before the first probe
const RELOAD_GUARD_KEY = 'tc-version-reload'

const [updateAvailable, setUpdateAvailable] = createSignal(false)
/** True once a newer build is live on the server (drives an optional "reload" affordance). */
export { updateAvailable }

let pendingReload = false
let latestServerSha: string | null = null

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

function alreadyReloadedFor(sha: string): boolean {
  try {
    return sessionStorage.getItem(RELOAD_GUARD_KEY) === sha
  } catch {
    return false
  }
}

function markReloadedFor(sha: string): void {
  try {
    sessionStorage.setItem(RELOAD_GUARD_KEY, sha)
  } catch {
    /* ignore */
  }
}

/** Reload to pick up `serverSha`; guarded so a reload that fails to update can't loop. */
function reloadForUpdate(serverSha: string): void {
  if (alreadyReloadedFor(serverSha)) return
  markReloadedFor(serverSha)
  window.location.reload()
}

async function check(): Promise<void> {
  const info = await fetchServerVersion()
  if (!info?.gitSha) return
  const mine = buildSha()
  if (!mine || mine === 'unknown') return // local/dev build — never nag
  if (info.gitSha === mine) return // up to date

  latestServerSha = info.gitSha
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
    if (document.visibilityState === 'visible') void check()
  }
  const interval = window.setInterval(() => void check(), POLL_INTERVAL_MS)
  const kickoff = window.setTimeout(() => void check(), FIRST_CHECK_DELAY_MS)
  window.addEventListener('hashchange', onHashChange)
  document.addEventListener('visibilitychange', onVisible)

  return () => {
    window.clearInterval(interval)
    window.clearTimeout(kickoff)
    window.removeEventListener('hashchange', onHashChange)
    document.removeEventListener('visibilitychange', onVisible)
  }
}
