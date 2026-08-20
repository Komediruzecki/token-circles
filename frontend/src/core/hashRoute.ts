/**
 * Hash-route resolution — which page a `#…` fragment selects.
 *
 * Extracted from App.tsx, where the same three lines appeared twice (initial parse and the
 * hashchange listener) and had already drifted: the initial parse sent an empty hash to the
 * dashboard while the listener silently ignored it, so clearing the hash left you wherever you
 * were.
 *
 * The part that needs care is the 404 fallback. Not every hash this app writes names a page:
 * Settings drives its diagnostics panel from `#logs`, and the password-reset screen owns
 * `#reset-password`. Treating "not in the router map" as "not found" turns both into a 404 —
 * the Settings "View Logs" button lands on the error page, and finishing a password reset
 * (which clears the hash) leaves the user staring at one. Those routes are declared here so the
 * catch-all only catches genuinely unknown fragments.
 */
import type { PageName } from '../types/models.js'

/**
 * Fragments that are sub-views of a page rather than pages of their own. They select the page
 * that renders them; the page reads the fragment itself to decide what to show.
 */
const HASH_ALIASES: Record<string, PageName> = {
  logs: 'settings',
}

/**
 * Fragments handled outside the page router entirely. `reset-password` is rendered by App as a
 * full-screen route before the shell mounts, so the active page must be left alone.
 */
const NON_PAGE_ROUTES = new Set(['reset-password'])

/** The page name a hash fragment selects, or `null` to leave the active page unchanged. */
export function resolvePageFromHash(
  rawHash: string,
  isPage: (name: string) => boolean
): PageName | null {
  // Accepts the fragment with or without '#', and ignores a query suffix (`#transactions?tag=3`).
  const name = rawHash.replace(/^#/, '').split('?')[0]
  if (!name) return 'dashboard'
  if (isPage(name)) return name as PageName
  const alias = HASH_ALIASES[name]
  if (alias) return alias
  if (NON_PAGE_ROUTES.has(name)) return null
  return 'notFound'
}
