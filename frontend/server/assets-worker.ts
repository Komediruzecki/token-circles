/**
 * Front Worker for the static-asset (SPA) deployment on Cloudflare Workers Static Assets.
 *
 * WHY THIS EXISTS
 * Static Assets with `not_found_handling: "single-page-application"` serves `index.html`
 * (HTTP 200, `text/html`) for ANY unmatched path — including a missing `/assets/*.js` after
 * a redeploy deletes the old hashed chunks. A returning user whose cached/old `index.html`
 * still references `index-OLDHASH.js` then gets HTML where a module was expected:
 *   "Failed to load module script: expected a JavaScript module but got MIME type text/html"
 * → white screen, unrecoverable by a normal reload.
 *
 * FIX
 * Put a Worker in front of the assets binding configured with `not_found_handling: "none"`:
 *   - a matched asset is served by the platform directly (this Worker is not even invoked);
 *   - a miss on a real file path returns the asset system's clean 404, so a stale chunk fails
 *     honestly and the app's runtime recovery (vite:preloadError → guarded reload) takes over;
 *   - a navigation (an HTML-document request) falls back to `index.html` so the hash-routed
 *     SPA still boots on any path, and that shell is returned with `Cache-Control: no-cache`
 *     so the entry document is never served stale.
 */

interface AssetsBinding {
  fetch(request: Request): Promise<Response>
}

interface Env {
  ASSETS: AssetsBinding
}

/**
 * A navigation is a top-level document load (the browser wants HTML), not a fetch for a
 * hashed asset. Prefer the explicit Fetch Metadata signal; fall back to an Accept check for
 * an extensionless path so clients that omit `Sec-Fetch-Mode` still route correctly.
 */
function isNavigationRequest(request: Request): boolean {
  if (request.method !== 'GET' && request.method !== 'HEAD') return false
  if (request.headers.get('sec-fetch-mode') === 'navigate') return true
  const accept = request.headers.get('accept') || ''
  if (!accept.includes('text/html')) return false
  const path = new URL(request.url).pathname
  const lastSegment = path.slice(path.lastIndexOf('/') + 1)
  return !lastSegment.includes('.') // no file extension → a route, not an asset file
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const assetResponse = await env.ASSETS.fetch(request)

    // Anything the asset layer resolved (a real file, or a non-404) passes straight through.
    if (assetResponse.status !== 404) return assetResponse

    // A 404 on a navigation → serve the SPA shell so any path boots the hash router.
    if (isNavigationRequest(request)) {
      const url = new URL(request.url)
      const indexResponse = await env.ASSETS.fetch(new Request(new URL('/', url.origin), request))
      if (indexResponse.status === 404) return assetResponse // no shell to serve
      const headers = new Headers(indexResponse.headers)
      // The entry document must never be cached hard, so a deploy is picked up on next load.
      headers.set('Cache-Control', 'no-cache')
      return new Response(indexResponse.body, {
        status: 200,
        statusText: 'OK',
        headers,
      })
    }

    // A 404 on an asset/file path → return it. Do NOT serve index.html: a stale chunk must
    // fail as a 404, not as a 200 text/html that poisons the module loader.
    return assetResponse
  },
}
