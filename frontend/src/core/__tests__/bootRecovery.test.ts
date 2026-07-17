/**
 * bootRecovery — stale-chunk detection and the pre-reload service-worker refresh.
 *
 * activateUpdatedServiceWorker is exercised against a minimal fake of the ServiceWorker
 * container API (jsdom ships none): the helper must trigger an update check, wait — bounded —
 * for the new worker's takeover (skipWaiting + clientsClaim fire `controllerchange`), and
 * never throw or hang regardless of SW availability. The full SW lifecycle itself can only be
 * verified manually in a browser — see docs/deploy-update-pipeline.md.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { activateUpdatedServiceWorker, isChunkLoadError } from '../bootRecovery'

interface FakeRegistration {
  installing: object | null
  waiting: object | null
  update: () => Promise<void>
}

class FakeSWContainer extends EventTarget {
  controller: object | null = null
  registration: FakeRegistration | undefined
  async getRegistration(): Promise<FakeRegistration | undefined> {
    return this.registration
  }
}

function installFakeContainer(): FakeSWContainer {
  const container = new FakeSWContainer()
  Object.defineProperty(window.navigator, 'serviceWorker', {
    value: container,
    configurable: true,
  })
  return container
}

afterEach(() => {
  delete (window.navigator as { serviceWorker?: unknown }).serviceWorker
})

describe('isChunkLoadError', () => {
  it('matches the failed-dynamic-import error family', () => {
    const messages = [
      'Failed to fetch dynamically imported module: https://x/assets/a-1.js',
      'error loading dynamically imported module',
      'Importing a module script failed.',
      "Failed to load module script: expected a JavaScript module but got MIME type 'text/html'",
      "Unexpected token '<'",
      'ChunkLoadError: Loading chunk 5 failed',
    ]
    for (const msg of messages) {
      expect(isChunkLoadError(new Error(msg))).toBe(true)
      expect(isChunkLoadError(msg)).toBe(true)
    }
  })

  it('rejects unrelated errors and empty input', () => {
    expect(isChunkLoadError(new Error('Cannot read properties of undefined'))).toBe(false)
    expect(isChunkLoadError('')).toBe(false)
    expect(isChunkLoadError(undefined)).toBe(false)
    expect(isChunkLoadError(42)).toBe(false)
  })
})

describe('activateUpdatedServiceWorker', () => {
  it('resolves false when the browser has no service worker support', async () => {
    // jsdom's navigator has no serviceWorker property unless we install the fake.
    await expect(activateUpdatedServiceWorker(50)).resolves.toBe(false)
  })

  it('resolves false when nothing is registered', async () => {
    const container = installFakeContainer()
    container.registration = undefined
    await expect(activateUpdatedServiceWorker(50)).resolves.toBe(false)
  })

  it('resolves false when the update check finds no new worker', async () => {
    const container = installFakeContainer()
    container.controller = {}
    const update = vi.fn(async () => undefined)
    container.registration = { installing: null, waiting: null, update }
    await expect(activateUpdatedServiceWorker(50)).resolves.toBe(false)
    expect(update).toHaveBeenCalledTimes(1)
  })

  it('resolves false for an uncontrolled page even when a new worker is incoming', async () => {
    // No controller → no takeover event will ever fire; the caller just reloads.
    const container = installFakeContainer()
    container.controller = null
    const reg: FakeRegistration = {
      installing: null,
      waiting: null,
      update: async () => {
        reg.waiting = {}
      },
    }
    container.registration = reg
    await expect(activateUpdatedServiceWorker(50)).resolves.toBe(false)
  })

  it('resolves true when the updated worker takes control', async () => {
    const container = installFakeContainer()
    container.controller = {}
    container.registration = {
      installing: null,
      waiting: null,
      update: async () => {
        // The update check found a new sw.js: it installs, and (skipWaiting + clientsClaim)
        // claims the page shortly after.
        container.registration!.installing = {}
        setTimeout(() => container.dispatchEvent(new Event('controllerchange')), 10)
      },
    }
    await expect(activateUpdatedServiceWorker(1000)).resolves.toBe(true)
  })

  it('gives up after the bounded wait when the takeover never happens', async () => {
    const container = installFakeContainer()
    container.controller = {}
    container.registration = {
      installing: { stuck: true },
      waiting: null,
      update: async () => undefined,
    }
    await expect(activateUpdatedServiceWorker(30)).resolves.toBe(false)
  })

  it('resolves false instead of throwing when the container API rejects', async () => {
    const container = installFakeContainer()
    container.getRegistration = async () => {
      throw new Error('boom')
    }
    await expect(activateUpdatedServiceWorker(50)).resolves.toBe(false)
  })
})
