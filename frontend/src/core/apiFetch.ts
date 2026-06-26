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

/**
 * Replacement for window.fetch that intercepts /api/* calls in serverless mode.
 * In self-hosted mode, passes through to the real fetch.
 */
export async function apiFetch(url: string, init?: RequestInit): Promise<Response> {
  const mode: StorageMode = getStorageMode()

  // Self-hosted: real fetch. Resolve bare `/api/*` paths against VITE_API_URL — in deployed
  // server builds the API lives on a sibling subdomain (api.<domain>), not the SPA's own
  // origin. Default credentials to 'include' so the session cookie rides along cross-origin.
  if (mode === 'self-hosted') {
    if (url.startsWith('/api')) {
      return fetch(`${import.meta.env.VITE_API_URL ?? ''}${url}`, {
        credentials: 'include',
        ...init,
      })
    }
    return fetch(url, init)
  }

  // Serverless: intercept /api/* calls
  if (url.startsWith('/api')) {
    const router = await getLocalRouter()
    return router(url, init)
  }

  // Non-API calls (CDN, external) pass through
  return fetch(url, init)
}
