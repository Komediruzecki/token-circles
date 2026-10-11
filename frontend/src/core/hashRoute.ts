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
 * Pages whose fragment can name a view below the page, as a path: `#loans/12/compare` is the
 * Loans page showing loan 12. The page reads the rest of the path itself.
 */
const PAGES_WITH_PATHS = new Set<string>(['loans'])

/** The route a fragment names, with or without its '#' and query: `#reset-password?token=…`. */
export function hashRouteName(rawHash: string): string {
  return rawHash.replace(/^#/, '').split('?')[0]
}

/**
 * Opens the sign-in screen on the form that sends a reset link (LoginScreen). The "already has an
 * account" mail's Reset password button links here.
 */
export const FORGOT_PASSWORD = 'forgot-password'

/**
 * Fragments handled outside the page router entirely, so the active page must be left alone and
 * the period stays off them (periodStore). `reset-password` is rendered by App as a full-screen
 * route before the shell mounts; `forgot-password` is read by the sign-in screen, and a signed-in
 * app just stays where it is.
 */
const NON_PAGE_ROUTES = new Set(['reset-password', FORGOT_PASSWORD])

/** Whether a route is one of the fragments above, which name no page. */
export function isNonPageRoute(name: string): boolean {
  return NON_PAGE_ROUTES.has(name)
}

/** The page name a hash fragment selects, or `null` to leave the active page unchanged. */
export function resolvePageFromHash(
  rawHash: string,
  isPage: (name: string) => boolean
): PageName | null {
  // Accepts the fragment with or without '#', and ignores a query suffix (`#transactions?tag=3`).
  const name = hashRouteName(rawHash)
  if (!name) return 'dashboard'
  if (isPage(name)) return name as PageName
  const page = name.split('/')[0]
  if (page !== name && PAGES_WITH_PATHS.has(page) && isPage(page)) return page as PageName
  const alias = HASH_ALIASES[name]
  if (alias) return alias
  if (isNonPageRoute(name)) return null
  return 'notFound'
}
