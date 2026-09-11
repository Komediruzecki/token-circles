/**
 * Which navigations the service worker leaves to the network rather than answering with the app
 * shell. Kept out of sw.ts so a test can hand them to the real runtime: sw.ts itself only runs
 * inside a service worker.
 */

/**
 * Paths that are their own HTML document, not the app shell. The export templates are opened in
 * their own window and carry their own scripts; substituting the shell for one of them would
 * silently render the app in place of the export the user asked to print.
 */
export const STANDALONE_DOCUMENTS = ['/export.html', '/export-monthly.html']

/**
 * Prefixes under which no navigation is ever the app. /api/ is the runtime's own default, restated
 * because giving the option replaces it. /.well-known/ holds files that people and programs fetch
 * by name — security.txt (RFC 9116) first: an installed app must not answer a security researcher
 * with its sign-in page.
 */
export const BYPASS_PATH_PREFIXES = ['/api/', '/.well-known/']
