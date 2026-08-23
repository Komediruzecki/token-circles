/**
 * bootRecovery — recognising the "a chunk that used to exist is now gone" family of errors.
 *
 * The reload those errors trigger is `reloadToLatest` from @komediruzecki/pwa-kit, and its own
 * suite covers the ladder it climbs (adopt the waiting worker, else unregister, else reload
 * plainly). What is left here is the classifier, which is the half that decides whether any of
 * that happens at all — and which has to stay wide, because each browser words the same failure
 * differently.
 */
import { describe, expect, it } from 'vitest'
import { isChunkLoadError } from '../bootRecovery'

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
