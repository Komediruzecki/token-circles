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

  // Self-hosted: use real fetch
  if (mode === 'self-hosted') {
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
