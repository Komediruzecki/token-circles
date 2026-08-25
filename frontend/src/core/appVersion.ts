/**
 * appVersion — detect a new deployment and get the user onto it safely.
 *
 * The build stamps its commit into `__GIT_SHA__` and emits a matching /version.json (served
 * no-cache). We poll that file on focus / a slow interval; when the server's sha no longer
 * matches this running build, a deploy has happened. We then update the service worker and
 * reload at a SAFE moment — the user's next in-app navigation (a hashchange) — so a mid-session
 * deploy never strands them on a dead lazy chunk ("Unexpected token '<'") and never yanks the
 * page from under an active view. A toast with a Reload action is the visible affordance: the
 * user can take the update immediately, and a user who parks on one page and never navigates
 * still has a button instead of a message that expires on them.
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
import { reloadToLatest } from '@pwa-kit'
import { createSignal } from 'solid-js'
import { toast } from './api'
import { hasToastOnChannel, removeToastsByChannel } from './toastStore'

export interface VersionInfo {
  version?: string
  gitSha?: string
  builtAt?: string
}

const POLL_INTERVAL_MS = 5 * 60 * 1000 // 5 minutes
const FIRST_CHECK_DELAY_MS = 15 * 1000 // let the app settle before the first probe
/** One toast per category: a re-announcement replaces the previous notice, never stacks. */
const UPDATE_TOAST_CHANNEL = 'app-update'
/** Longer than a normal toast because it asks for a decision, but not sticky: ignoring it is a
 *  valid answer — the next in-app navigation applies the update anyway. */
const UPDATE_TOAST_DURATION_MS = 60 * 1000
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

/** Input types whose focus is a resting state, not an entry in progress. A checkbox or a
 *  toggle keeps focus long after the click; treating that as "mid-entry" would veto the
 *  auto-reload forever. */
const NON_ENTRY_INPUT_TYPES = new Set([
  'button',
  'checkbox',
  'color',
  'file',
  'image',
  'radio',
  'range',
  'reset',
  'submit',
])

/**
 * True while the user is visibly in the middle of something a reload would eat: a text-entry
 * control holds focus, or a modal dialog is OPEN. The hashchange reload defers to the NEXT
 * navigation instead — losing a half-typed form to an update we chose the timing of is exactly
 * what the "safe moment" contract promises never happens.
 *
 * "Open" is decided by computed pointer-events, not mere presence: CommandBar and GuidedOrbit
 * keep their `role="dialog"` nodes mounted permanently and hide them with `pointer-events:
 * none` + opacity, so a presence check would be true on every page and quietly kill the
 * auto-reload (found in review). Conditionally-rendered dialogs compute `auto` and count.
 */
export function userIsMidEntry(doc: Document = document): boolean {
  const el = doc.activeElement
  if (el instanceof HTMLInputElement && !NON_ENTRY_INPUT_TYPES.has(el.type)) return true
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true
  if (el instanceof HTMLElement && el.isContentEditable) return true

  const view = doc.defaultView
  for (const dialog of doc.querySelectorAll('[role="dialog"], [role="alertdialog"]')) {
    const style = view?.getComputedStyle(dialog)
    if (!style) continue
    if (style.display === 'none' || style.visibility === 'hidden') continue
    // pointer-events is inherited, so a dialog inside a closed overlay computes 'none'.
    if (style.pointerEvents === 'none') continue
    return true
  }
  return false
}

/**
 * The one visible notice: what is ready, and a Reload button that takes it now. Channelled, so a
 * re-announcement (SW signal first, poll later) replaces the toast instead of stacking it.
 */
function announceUpdate(): void {
  const server = serverVersion()
  toast(
    server ? `Token Circles v${server} is ready.` : 'A new version of Token Circles is ready.',
    'info',
    {
      title: 'Update',
      channel: UPDATE_TOAST_CHANNEL,
      durationMs: UPDATE_TOAST_DURATION_MS,
      action: {
        // `reloadToLatest`, not `location.reload()` — see reloadForUpdate. A user click skips the
        // auto-reload guards on purpose: an explicit request must always work, and the kit's own
        // once-guard absorbs a racing hashchange reload.
        onClick: () => void reloadToLatest(),
        label: 'Reload',
      },
    }
  )
}

/** Reload to pick up `serverSha`; guarded against loops. */
function reloadForUpdate(serverSha: string): void {
  const now = Date.now()
  if (!shouldAutoReload(serverSha, now)) return
  recordAutoReload(serverSha, now)
  // `reloadToLatest`, not `location.reload()`. The worker answers navigations from its own
  // precache, so a plain reload lands right back on the build we are trying to leave; this adopts
  // the waiting worker when there is one and unregisters first when there is not. The guard is
  // already recorded, so a second hashchange while it works cannot queue another reload.
  void reloadToLatest()
}

/**
 * The service worker's own signal that a deploy landed: a new worker installed and is waiting.
 *
 * It arrives earlier and more reliably than the version.json poll — the browser found it, we did
 * not have to ask — but it means exactly the same thing, so it lands in the same state and waits
 * for the same safe moment. The `applyUpdate` the kit offers is deliberately unused:
 * `reloadForUpdate` goes through `reloadToLatest`, which does the same adoption and adds the
 * fallback for a worker that never takes control.
 */
export function noteWaitingBuild(): void {
  if (!updateAvailable()) {
    setUpdateAvailable(true)
    announceUpdate()
  }
  pendingReload = true
  // No sha to key the guard on: the browser told us there is a newer worker, not which commit it
  // came from. The rolling cap still applies, and adopting a waiting worker cannot loop the way a
  // plain reload can — after it takes control there is no longer a waiting worker to announce.
  latestServerSha = latestServerSha ?? 'sw-waiting'
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
    // An update notice that was on screen is now a lie (rollback) — take it down.
    removeToastsByChannel(UPDATE_TOAST_CHANNEL)
    return
  }

  latestServerSha = verdict.serverSha
  setServerVersion(verdict.serverVersion)
  if (!updateAvailable()) {
    setUpdateAvailable(true)
    announceUpdate()
  } else if (!hasToastOnChannel(UPDATE_TOAST_CHANNEL)) {
    // The earlier notice expired (or came from the SW signal with no version to name). Each
    // poll re-raises it — now with the server's version — so a user who missed one 60-second
    // toast is not stranded with no visible affordance. A notice still on screen is left
    // alone; re-announcing over it would restart its animation and its clock.
    announceUpdate()
  }
  pendingReload = true
}

/**
 * Start watching for deployments. Call once (from App's onMount) and dispose on cleanup.
 * Reloads on the next navigation after an update is detected; polls on interval + tab focus.
 */
export function initVersionWatch(): () => void {
  const onHashChange = () => {
    // A hashchange normally means the old page is gone, but focus can survive it (a global
    // search box, a filter bar) and modals with in-page navigation exist; when it does, wait
    // for a later navigation rather than yanking a form out from under the user.
    if (pendingReload && latestServerSha && !userIsMidEntry()) reloadForUpdate(latestServerSha)
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
