/**
 * The service worker answers a navigation with the app shell, except under the paths in
 * src/swRoutes.ts, which it must leave to the network. Driven through the real runtime with the
 * same options sw.ts gives it.
 */
import { createServiceWorkerRuntime } from '@pwa-kit'
import { describe, expect, it } from 'vitest'
import { BYPASS_PATH_PREFIXES, STANDALONE_DOCUMENTS } from '../swRoutes'

const ORIGIN = 'https://app.example.test'

/** A navigation, with only the members the runtime reads. */
const navigation = (path: string): Request =>
  ({
    url: `${ORIGIN}${path}`,
    method: 'GET',
    mode: 'navigate',
    headers: new Headers(),
  }) as unknown as Request

const runtime = createServiceWorkerRuntime({
  manifest: [],
  buildId: 'test',
  baseUrl: `${ORIGIN}/sw.js`,
  standaloneDocumentPaths: STANDALONE_DOCUMENTS,
  bypassPathPrefixes: BYPASS_PATH_PREFIXES,
  env: {
    caches: {} as CacheStorage,
    fetch: () => Promise.reject(new Error('no network in this test')),
    notifyClients: () => {},
  },
})

describe('service worker navigations', () => {
  it('leaves security.txt, the API and the export documents to the network', () => {
    for (const path of ['/.well-known/security.txt', '/api/health', '/export.html']) {
      expect(runtime.handleFetch(navigation(path)), path).toBeUndefined()
    }
  })

  it('still answers an app route with the shell', () => {
    const answer = runtime.handleFetch(navigation('/transactions'))
    expect(answer).toBeInstanceOf(Promise)
    // The fake environment has no cache or network, so the answer itself is not the point here.
    void answer?.catch(() => {})
  })
})
