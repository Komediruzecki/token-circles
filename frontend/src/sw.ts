/**
 * sw.ts — the Token Circles service worker.
 *
 * Built by vite-plugin-pwa's `injectManifest` strategy and emitted as dist/sw.js, at the site
 * root, so its scope is the whole origin. It exists first to make the app installable (Chrome
 * will not offer "Install app" without a service worker that handles `fetch`) and second to make
 * the installed app open offline and stay on one build across a deploy.
 *
 * This file is only the wiring: the worker globals, and which runtime call each event maps to.
 * Every caching rule — and the reasoning behind it — lives in @komediruzecki/pwa-kit's
 * sw-runtime, where it is tested against a fake CacheStorage instead of only in a browser.
 */

/// <reference lib="webworker" />

// Forces module scope, which is what lets `self` below be re-declared as the worker global
// instead of colliding with lib.dom's `Window`. Rollup drops it from the IIFE bundle.
export {}

import { BUILD_ID_MESSAGE, createServiceWorkerRuntime, UNKNOWN_BUILD_ID } from '@pwa-kit'
import type { SwPrecacheEntry, SwStaleBuildNotice } from '@pwa-kit'

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: SwPrecacheEntry[]
}

/**
 * Paths that are their own HTML document, not the app shell. The export templates are opened in
 * their own window and carry their own scripts; substituting the shell for one of them would
 * silently render the app in place of the export the user asked to print.
 */
const STANDALONE_DOCUMENTS = ['/export.html', '/export-monthly.html']

/**
 * Small, stable files the installed app needs that index.html does not name as a script.
 * theme-init.js is NOT here — index.html loads it with a <script src>, so it is part of the
 * first-paint set read straight out of the shipped HTML.
 */
const STABLE_SHELL_ASSETS = ['/manifest.webmanifest', '/icon-192.png', '/favicon.svg']

/**
 * Tell every open page that what it just asked for is gone. core/bootRecovery.ts turns that into
 * an update check, which turns into the reload — the only thing that can actually fix a page
 * whose build is no longer on the origin.
 */
async function broadcast(message: SwStaleBuildNotice): Promise<void> {
  const clients = await self.clients.matchAll({ type: 'window' })
  for (const client of clients) client.postMessage(message)
}

const runtime = createServiceWorkerRuntime({
  manifest: self.__WB_MANIFEST,
  // Guarded rather than read directly: if this build ever reaches the worker without Vite's
  // define applied, an unknown build id costs one redundant update prompt, while a ReferenceError
  // costs the whole worker.
  buildId: typeof __GIT_SHA__ !== 'undefined' ? __GIT_SHA__ : UNKNOWN_BUILD_ID,
  baseUrl: self.location.href,
  cachePrefix: 'tokencircles-assets-',
  standaloneDocumentPaths: STANDALONE_DOCUMENTS,
  stableShellAssets: STABLE_SHELL_ASSETS,
  env: {
    caches: self.caches,
    fetch: (input, init) => fetch(input, init),
    notifyClients: (message) => {
      void broadcast(message)
    },
  },
})

self.addEventListener('install', (event) => {
  // No skipWaiting(): a worker that took over mid-session would pair its own chunk map with the
  // page's already-loaded HTML. That pairing is what the multi-reload deploy loop was made of.
  // The waiting worker is adopted only when the page decides to move.
  //
  // install() rejects if it cannot assemble one complete build. That is the point: a worker that
  // fails to install never activates, so the visitor keeps the build they already have and the
  // browser retries on the next check.
  event.waitUntil(runtime.install())
})

self.addEventListener('activate', (event) => {
  // No clients.claim() either, for the same reason. An open page keeps the worker it started with
  // and picks up the new one on its next navigation.
  event.waitUntil(runtime.activate())
})

self.addEventListener('message', (event) => {
  const action = runtime.handleMessage(event.data)
  if (action === undefined) return
  if (action.kind === 'skip-waiting') {
    void self.skipWaiting()
    return
  }
  // The page asks over a MessageChannel so the answer cannot be confused with any other message
  // it receives.
  const port = event.ports[0]
  if (port !== undefined) {
    port.postMessage({ type: BUILD_ID_MESSAGE, buildId: action.buildId })
  }
})

self.addEventListener('fetch', (event) => {
  const response = runtime.handleFetch(event.request)
  // `undefined` is "not this worker's business": the browser performs the request itself, exactly
  // as it would with no worker installed.
  if (response !== undefined) event.respondWith(response)
})
