/**
 * "Start on Advanced" from the marketing site.
 *
 * about.tokencircles.com prices four tiers and links here as `?plan=advanced`. Acting on that
 * is not a redirect, for two reasons worth stating:
 *
 * 1. **A first-time visitor has no account.** Production ships
 *    `VITE_DEFAULT_STORAGE=dexie`, so the app opens in serverless (local) mode — and
 *    `isTabVisible('billing', 'serverless')` is false, because a plan means nothing without an
 *    account on our server. Landing such a visitor on Settings would show them a page with no
 *    Billing tab at all.
 * 2. **Reaching an account reloads the page.** Switching to server mode is the only route to
 *    the sign-in gate and it goes through `window.location.reload()` — as does sign-in itself.
 *    A query parameter cannot survive that, so the intent is parked in localStorage and
 *    consumed on the far side.
 *
 * The switch happens before render (see index.tsx), mirroring `applyDemoModeFromUrl`, which
 * makes the same move in the opposite direction for `?demo=`.
 */
import { createSignal } from 'solid-js'
import { getStorageMode, setStorageMode } from './storage/storageFactory'

const KEY = 'plan_intent'

/** Paid tiers only: `free` needs no billing page, it is what an account already is. */
const PAID = new Set(['basic', 'advanced', 'ultimate'])

export type PlanIntent = 'basic' | 'advanced' | 'ultimate'

/** Read `?plan=` from a URL (search or the hash's own query). Pure — inject a location for tests. */
export function parsePlanParam(
  loc: { search: string; hash: string } = window.location
): PlanIntent | null {
  const fromSearch = new URLSearchParams(loc.search).get('plan')
  const hash = loc.hash.replace(/^#/, '')
  const q = hash.indexOf('?')
  const fromHash = new URLSearchParams(q >= 0 ? hash.slice(q + 1) : hash).get('plan')
  const raw = (fromSearch ?? fromHash ?? '').trim().toLowerCase()
  return PAID.has(raw) ? (raw as PlanIntent) : null
}

function store(plan: PlanIntent): void {
  try {
    localStorage.setItem(KEY, plan)
  } catch {
    /* private mode: the intent is a convenience, never a requirement */
  }
}

export function storedPlanIntent(): PlanIntent | null {
  try {
    const v = localStorage.getItem(KEY)
    return v !== null && PAID.has(v) ? (v as PlanIntent) : null
  } catch {
    return null
  }
}

export function clearPlanIntent(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* nothing to clear */
  }
}

/** Drop `plan=` from the address bar so a refresh cannot re-fire an intent already acted on. */
function stripParam(): void {
  try {
    const url = new URL(window.location.href)
    if (!url.searchParams.has('plan')) return
    url.searchParams.delete('plan')
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
  } catch {
    /* no history API: the param stays, and consuming the intent still clears the storage */
  }
}

/**
 * Called before render. Parks a `?plan=` intent and, when the app is in local mode, switches to
 * server mode and reloads into the sign-in gate — the intent is read back after the reload.
 *
 * Returns true when it triggered a reload, so the caller knows not to bother rendering.
 */
export function applyPlanIntentFromUrl(): boolean {
  const plan = parsePlanParam()
  if (!plan) return false
  store(plan)
  stripParam()
  if (getStorageMode() !== 'self-hosted') {
    setStorageMode('self-hosted')
    window.location.reload()
    return true
  }
  return false
}

/**
 * The tier the visitor actually clicked, for the billing page to scroll to and ring once.
 * Landing on Billing is most of the job; landing on *Advanced* is the rest of it.
 */
export const [highlightedPlan, setHighlightedPlan] = createSignal<PlanIntent | null>(null)
