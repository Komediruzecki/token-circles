/**
 * uiPrefs — a display preference must never be the thing that stops the app rendering.
 *
 * The interesting cases are all storage refusing to co-operate. A private window, cleared site
 * data, or a browser set to block site data does not return null from `localStorage` — it
 * *throws*, on the getter itself. Code that reads a preference without guarding takes the whole
 * page down with it, and only for the people least able to report why.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const KEY = 'finance-sticky-period-bar'

/** Fresh module each time: the signal's initial value is read once, at import. */
async function load() {
  vi.resetModules()
  return import('../uiPrefs')
}

const realStorage = globalThis.localStorage

function useStorage(impl: Partial<Storage>) {
  Object.defineProperty(globalThis, 'localStorage', {
    value: impl as Storage,
    configurable: true,
    writable: true,
  })
}

beforeEach(() => {
  useStorage(realStorage)
  localStorage.clear()
})

afterEach(() => {
  useStorage(realStorage)
  vi.restoreAllMocks()
})

describe('the sticky period bar preference', () => {
  it('is off when nothing has been stored', async () => {
    // The conservative default: it costs a line of screen on every page that has a period bar,
    // so someone who wants it asks for it.
    const { stickyPeriodBar } = await load()
    expect(stickyPeriodBar()).toBe(false)
  })

  it('remembers being turned on', async () => {
    const { setStickyPeriodBar } = await load()
    setStickyPeriodBar(true)
    expect(localStorage.getItem(KEY)).toBe('true')

    // A reload reads it back rather than falling to the default.
    const reloaded = await load()
    expect(reloaded.stickyPeriodBar()).toBe(true)
  })

  it('remembers being turned back off', async () => {
    localStorage.setItem(KEY, 'true')
    const { setStickyPeriodBar, stickyPeriodBar } = await load()
    expect(stickyPeriodBar()).toBe(true)

    setStickyPeriodBar(false)
    expect(stickyPeriodBar()).toBe(false)
    expect((await load()).stickyPeriodBar()).toBe(false)
  })

  it('treats a value it did not write as the default', async () => {
    // Garbage must not switch the feature on by accident, and must not be read as a deliberate
    // "off" either — only the two strings this module writes mean anything.
    localStorage.setItem(KEY, 'yes please')
    expect((await load()).stickyPeriodBar()).toBe(false)
    localStorage.setItem(KEY, 'true')
    expect((await load()).stickyPeriodBar()).toBe(true)
    localStorage.setItem(KEY, 'false')
    expect((await load()).stickyPeriodBar()).toBe(false)
  })

  it('falls back to the default when reading storage throws', async () => {
    useStorage({
      getItem: () => {
        throw new Error('The operation is insecure.')
      },
      setItem: () => undefined,
      removeItem: () => undefined,
    })
    const { stickyPeriodBar } = await load()
    expect(stickyPeriodBar()).toBe(false)
  })

  it('still applies the choice for this session when writing throws', async () => {
    let written = 0
    useStorage({
      getItem: () => null,
      setItem: () => {
        written += 1
        throw new Error('QuotaExceededError')
      },
      removeItem: () => undefined,
    })
    const { setStickyPeriodBar, stickyPeriodBar } = await load()

    expect(() => {
      setStickyPeriodBar(true)
    }).not.toThrow()
    expect(written).toBe(1)
    // The bar pins now, even though nothing will remember it next time.
    expect(stickyPeriodBar()).toBe(true)
  })

  it('resets to the default', async () => {
    const { resetUiPrefs, setStickyPeriodBar, stickyPeriodBar } = await load()
    setStickyPeriodBar(true)
    resetUiPrefs()
    expect(stickyPeriodBar()).toBe(false)
    expect(localStorage.getItem(KEY)).toBeNull()
  })
})
