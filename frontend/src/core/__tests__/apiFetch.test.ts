/**
 * apiFetch interception contract.
 *
 * Regression guard: deployed builds set VITE_API_URL, so ApiClient builds ABSOLUTE request
 * URLs. Serverless (demo) mode must intercept those too — matching only relative `/api/*`
 * once let every call on the deployed dev domain bypass IndexedDB and hit the real API
 * unauthenticated (401s, demo DB never initialized).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

const API = 'https://api.example.com'

async function loadApiFetch(mode: 'serverless' | 'self-hosted', apiUrl?: string) {
  vi.resetModules()
  if (apiUrl === undefined) vi.stubEnv('VITE_API_URL', '')
  else vi.stubEnv('VITE_API_URL', apiUrl)

  const routed: string[] = []
  vi.doMock('../storage/storageFactory', () => ({ getStorageMode: () => mode }))
  vi.doMock('../storage/localApiRouter', () => ({
    routeApiRequest: (url: string) => {
      routed.push(url)
      return Promise.resolve(new Response('{}', { status: 200 }))
    },
  }))

  const fetchSpy = vi.fn(() => Promise.resolve(new Response('{}', { status: 200 })))
  vi.stubGlobal('fetch', fetchSpy)

  const { apiFetch } = await import('../apiFetch')
  return { apiFetch, routed, fetchSpy }
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.resetModules()
  vi.doUnmock('../storage/storageFactory')
  vi.doUnmock('../storage/localApiRouter')
})

describe('apiFetch in serverless (demo) mode', () => {
  it('intercepts relative /api/* calls', async () => {
    const { apiFetch, routed, fetchSpy } = await loadApiFetch('serverless', API)
    await apiFetch('/api/profiles')
    expect(routed).toEqual(['/api/profiles'])
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('intercepts ABSOLUTE ${VITE_API_URL}/api/* calls (deployed-build shape)', async () => {
    const { apiFetch, routed, fetchSpy } = await loadApiFetch('serverless', API)
    await apiFetch(`${API}/api/dashboard?month=5&year=2026`)
    expect(routed).toEqual(['/api/dashboard?month=5&year=2026'])
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('lets non-API URLs (CDN/external) pass through to the network', async () => {
    const { apiFetch, routed, fetchSpy } = await loadApiFetch('serverless', API)
    await apiFetch('https://fonts.googleapis.com/css2?family=Inter')
    expect(routed).toEqual([])
    expect(fetchSpy).toHaveBeenCalledOnce()
  })

  it('intercepts relative /api/* even when VITE_API_URL is unset (local dev)', async () => {
    const { apiFetch, routed } = await loadApiFetch('serverless')
    await apiFetch('/api/categories')
    expect(routed).toEqual(['/api/categories'])
  })
})

describe('apiFetch in self-hosted (server) mode', () => {
  it('resolves relative /api/* against VITE_API_URL and pins credentials', async () => {
    const { apiFetch, fetchSpy } = await loadApiFetch('self-hosted', API)
    await apiFetch('/api/profiles', { credentials: 'omit' })
    expect(fetchSpy).toHaveBeenCalledWith(
      `${API}/api/profiles`,
      expect.objectContaining({ credentials: 'include' })
    )
  })

  it('keeps absolute API URLs on the API origin and pins credentials', async () => {
    const { apiFetch, fetchSpy } = await loadApiFetch('self-hosted', API)
    await apiFetch(`${API}/api/receipts/upload`)
    expect(fetchSpy).toHaveBeenCalledWith(
      `${API}/api/receipts/upload`,
      expect.objectContaining({ credentials: 'include' })
    )
  })
})
