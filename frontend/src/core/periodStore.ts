/**
 * periodStore — the app's single global "focus period".
 *
 * One `Period` (see utils/period.ts) is shared by every page: flip the month on
 * the Dashboard and Transactions/Budgets/Bills are already on that month when you
 * switch to them. Pages read what they need from the one period — month pages use
 * `toYYYYMM`, range pages use `toRange`, Analytics reads `.year` — while keeping
 * any genuinely chart-local selectors of their own.
 *
 * Persistence: the period is mirrored into the current page's URL-hash query
 * (`#budgets?period=2026-07`, `#transactions?from=…&to=…`) so refreshes and shared
 * links restore the view. Writes use history.replaceState (no history spam, no
 * hashchange loop); sidebar navigation wipes the query, so on every `hashchange`
 * we re-stamp the in-memory period back onto the new page's hash.
 */
import { createSignal } from 'solid-js'
import * as periodUtils from '../utils/period'
import type { Period } from '../utils/period'

const [period, setPeriodRaw] = createSignal<Period>(periodUtils.defaultPeriod())

export { period }

/** True while the PeriodOrbit popup is open — the global ←/→ + swipe handlers check this. */
export const [orbitOpen, setOrbitOpen] = createSignal(false)

// ── Hash plumbing ────────────────────────────────────────────────────────────

const PERIOD_KEYS = ['period', 'from', 'to']

function readHash(): { page: string; params: URLSearchParams } {
  const raw = window.location.hash.slice(1)
  const q = raw.indexOf('?')
  if (q < 0) return { page: raw, params: new URLSearchParams() }
  return { page: raw.slice(0, q), params: new URLSearchParams(raw.slice(q + 1)) }
}

function buildHash(page: string, params: URLSearchParams): string {
  const query = params.toString()
  return query ? `#${page}?${query}` : `#${page}`
}

/** Merge the period into the current page's hash, preserving page + other params. */
function writePeriodToHash(p: Period): void {
  const { page, params } = readHash()
  if (!page || page === 'reset-password') return
  for (const k of PERIOD_KEYS) params.delete(k)
  for (const [k, v] of Object.entries(periodUtils.serializePeriod(p))) params.set(k, v)
  const next = buildHash(page, params)
  if (next === window.location.hash) return
  // replaceState avoids a history entry AND avoids firing hashchange (no loop).
  history.replaceState(history.state, '', next)
}

// ── Public API ───────────────────────────────────────────────────────────────

export function setPeriod(p: Period): void {
  setPeriodRaw(p)
  writePeriodToHash(p)
}

export function stepPeriod(dir: -1 | 1): void {
  setPeriod(periodUtils.shift(period(), dir))
}

/**
 * Reactive accessor bundle for pages. Global for now (per the "one focus period"
 * decision); the signature leaves room for future per-page overrides.
 */
export function usePeriod() {
  return {
    period,
    setPeriod,
    step: stepPeriod,
    helpers: periodUtils,
  }
}

/**
 * Wire hash ↔ period. Call once from App (inside onMount); returns a disposer.
 * - On start: adopt a period from the initial hash, else stamp the default in.
 * - On hashchange: adopt a period the new hash carries (back/forward, deep links),
 *   or re-stamp the in-memory period when navigation dropped it.
 */
export function initPeriodSync(): () => void {
  const { params } = readHash()
  const flat = Object.fromEntries(params.entries())
  const initial = periodUtils.parsePeriod(flat)
  if (initial) setPeriodRaw(initial)
  else writePeriodToHash(period())

  const onHashChange = () => {
    const parts = readHash()
    if (!parts.page || parts.page === 'reset-password') return
    const parsed = periodUtils.parsePeriod(Object.fromEntries(parts.params.entries()))
    if (parsed) {
      // Only adopt if it actually differs, to avoid needless re-renders.
      if (!periodUtils.periodsEqual(parsed, period())) setPeriodRaw(parsed)
    } else {
      // Navigation wiped the query — put the global period back on the URL.
      writePeriodToHash(period())
    }
  }

  window.addEventListener('hashchange', onHashChange)
  return () => {
    window.removeEventListener('hashchange', onHashChange)
  }
}
