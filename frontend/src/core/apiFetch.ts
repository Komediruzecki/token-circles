/**
 * API Fetch Interceptor
 * Routes API calls to either the real backend (self-hosted) or IndexedDB (serverless)
 */
import { getStorageMode } from './storage/storageFactory'
import type { StorageMode } from './storage/storageFactory'

// We lazy-import to avoid circular deps and to only load IndexedDB when needed
let _localApiRouter: ((url: string, init?: RequestInit) => Promise<Response>) | null = null

async function getLocalRouter(): Promise<(url: string, init?: RequestInit) => Promise<Response>> {
  if (!_localApiRouter) {
    const mod = await import('./storage/localApiRouter')
    _localApiRouter = mod.routeApiRequest
  }
  return _localApiRouter
}

// Deployed builds set VITE_API_URL (e.g. https://api.dev.<domain>); ApiClient then builds
// ABSOLUTE request URLs. Interception must recognize those too — matching only relative
// `/api/*` made serverless/demo mode silently bypass IndexedDB on deployed builds and hit
// the real API with no session (401s, and the local DB never initialized).
const API_ORIGIN = (import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '')

/**
 * Return the app-API path (`/api/...`, incl. query) when `url` targets our API — either a
 * relative `/api/*` path or an absolute `${VITE_API_URL}/api/*` URL. Null for anything else
 * (CDN, external services), which must always pass through to the network.
 */
function toApiPath(url: string): string | null {
  if (url.startsWith('/api')) return url
  if (API_ORIGIN && url.startsWith(`${API_ORIGIN}/api`)) return url.slice(API_ORIGIN.length)
  return null
}

/**
 * Replacement for window.fetch that intercepts app-API calls in serverless mode.
 * In self-hosted mode, passes through to the real fetch.
 */
export async function apiFetch(url: string, init?: RequestInit): Promise<Response> {
  const mode: StorageMode = getStorageMode()
  const apiPath = toApiPath(url)

  // Self-hosted: real fetch. Resolve app-API paths against VITE_API_URL — in deployed
  // server builds the API lives on a sibling subdomain (api.<domain>), not the SPA's own
  // origin. Default credentials to 'include' so the session cookie rides along cross-origin.
  if (mode === 'self-hosted') {
    if (apiPath) {
      return fetch(`${API_ORIGIN}${apiPath}`, {
        ...init,
        // Pin credentials last so a caller's own `init.credentials` can't override it
        // and silently drop the cross-origin session cookie.
        credentials: 'include',
      })
    }
    return fetch(url, init)
  }

  // Serverless: route app-API calls to the IndexedDB-backed local router
  if (apiPath) {
    const router = await getLocalRouter()
    return router(apiPath, init)
  }

  // Non-API calls (CDN, external) pass through
  return fetch(url, init)
}
