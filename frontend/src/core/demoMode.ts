/**
 * Shareable demo links.
 *
 * A link like `https://tokencircles.com/?demo=high` (or `#demo=high`) drops a
 * visitor straight into the client-only demo with a chosen sample profile, so
 * you can hand people a URL to try the app — no sign-up, no real data.
 *
 * The app already runs in serverless (client-only) mode by default and seeds
 * three sample profiles — "Example Low / Mid / High Income" (see idb.ts). This
 * module just (a) forces serverless mode in case the browser was previously
 * switched to a real account, and (b) records which income tier to open, which
 * App.tsx selects once the profiles have loaded.
 */
import { setStorageMode } from './storage/storageFactory'

export type DemoTier = 'low' | 'mid' | 'high'

/** Tier → the seeded profile name it maps to (must match DEMO_PROFILES in idb.ts). */
export const DEMO_PROFILE_NAME: Record<DemoTier, string> = {
  low: 'Example Low Income',
  mid: 'Example Mid Income',
  high: 'Example High Income',
}

/** Tier used when `?demo` is present but empty or unrecognized. */
const DEFAULT_TIER: DemoTier = 'mid'

// Parsed once at startup (applyDemoModeFromUrl) and read later in App's boot.
let pendingTier: DemoTier | null = null

function normalizeTier(raw: string | null): DemoTier | null {
  if (raw === null) return null // no `demo` key at all → not a demo link
  const v = raw.trim().toLowerCase()
  if (v === 'low' || v === 'l' || v === '1') return 'low'
  if (v === 'high' || v === 'h' || v === '3') return 'high'
  if (v === 'mid' || v === 'medium' || v === 'm' || v === '2') return 'mid'
  // Present but empty ("?demo") or unknown ("?demo=xyz") → still a demo link,
  // just fall back to the default tier.
  return DEFAULT_TIER
}

function readDemoRaw(loc: { search: string; hash: string }): string | null {
  const fromSearch = new URLSearchParams(loc.search).get('demo')
  if (fromSearch !== null) return fromSearch
  // Support the hash form too: "#demo=high", "#page?demo=high", "#page?x=1&demo=high".
  const hash = loc.hash.replace(/^#/, '')
  const q = hash.indexOf('?')
  const hashQuery = q >= 0 ? hash.slice(q + 1) : hash
  return new URLSearchParams(hashQuery).get('demo')
}

/**
 * Read the requested demo tier from a URL (search `?demo=` or hash `#demo=`).
 * Returns null when there's no `demo` param. Pure — inject a location for tests.
 */
export function parseDemoTier(
  loc: { search: string; hash: string } = window.location
): DemoTier | null {
  return normalizeTier(readDemoRaw(loc))
}

/**
 * Return `href` with the `demo` param removed — from the query string and/or the
 * hash (`?demo=`, `#demo=`, `#page?demo=`). The page/route and any other params
 * are preserved. Pure, so it's unit-testable.
 */
export function stripDemoParam(href: string): string {
  const url = new URL(href)
  url.searchParams.delete('demo')

  const rawHash = url.hash.replace(/^#/, '')
  const qi = rawHash.indexOf('?')
  // A bare "#demo=high" carries the param in the page slot; "#page?demo=high"
  // carries it in the ?query part.
  const bareIsQuery = qi < 0 && new URLSearchParams(rawHash).has('demo')
  const page = bareIsQuery ? '' : qi >= 0 ? rawHash.slice(0, qi) : rawHash
  const query = bareIsQuery ? rawHash : qi >= 0 ? rawHash.slice(qi + 1) : ''
  if (query) {
    const hp = new URLSearchParams(query)
    if (hp.has('demo')) {
      hp.delete('demo')
      const q = hp.toString()
      url.hash = page || q ? `${page}${q ? `?${q}` : ''}` : ''
    }
  }
  return url.pathname + url.search + url.hash
}

/** Drop `demo` from the address bar via replaceState — no reload/navigation. */
function cleanDemoFromUrl(): void {
  try {
    const current = window.location.pathname + window.location.search + window.location.hash
    const cleaned = stripDemoParam(window.location.href)
    if (cleaned !== current) {
      window.history.replaceState(window.history.state, '', cleaned)
    }
  } catch {
    // Leave the URL untouched if the URL/History APIs misbehave.
  }
}

/**
 * If the current URL requests a demo, force client-only (serverless) mode and
 * remember the tier. Call once before the app renders, so getStorageMode() is
 * already 'serverless' when App reads it. Returns the tier (or null).
 */
export function applyDemoModeFromUrl(): DemoTier | null {
  const tier = parseDemoTier()
  if (tier) {
    // Overrides a persisted 'self-hosted' choice from a previous sign-in.
    setStorageMode('serverless')
    pendingTier = tier
    // The tier is captured above; drop ?demo= from the address bar so it doesn't
    // linger on every URL (demo mode + the chosen profile persist in localStorage).
    cleanDemoFromUrl()
  }
  return tier
}

/** The demo tier requested for this page load, if any. */
export function getDemoTier(): DemoTier | null {
  return pendingTier
}
