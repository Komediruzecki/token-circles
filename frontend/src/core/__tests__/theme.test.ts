/**
 * Theme resolution: explicit user choice → system preference → dark default.
 *
 * The defect these pin down: the system-preference listener applied changes through `setTheme`,
 * which persists. The first OS switch therefore wrote that value to localStorage, and every later
 * resolution read it back as an explicit choice — so "follow my system" tracked the OS exactly
 * once and was then pinned forever, with no way for the user to tell why.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ThemeStore } from '../theme'

const KEY = 'finance-theme'

/** A controllable prefers-color-scheme, matching the shape the store queries. */
function installMatchMedia(prefersLight: boolean) {
  const listeners: Array<() => void> = []
  const mql = {
    matches: prefersLight,
    addEventListener: (_: string, fn: () => void) => listeners.push(fn),
    removeEventListener: () => {},
  }
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => {
      expect(query).toBe('(prefers-color-scheme: light)')
      return mql
    })
  )
  return {
    /** Flip the OS preference and fire the change, as a real browser would. */
    set(light: boolean) {
      mql.matches = light
      for (const fn of [...listeners]) fn()
    },
  }
}

const activeTheme = () => document.documentElement.getAttribute('data-theme')

beforeEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ThemeStore resolution', () => {
  it('uses an explicit stored choice over the system preference', () => {
    localStorage.setItem(KEY, 'dark')
    installMatchMedia(true) // system says light
    new ThemeStore().init()
    expect(activeTheme()).toBe('dark')
  })

  it('follows the system preference when nothing is stored', () => {
    installMatchMedia(true)
    new ThemeStore().init()
    expect(activeTheme()).toBe('light')
  })

  it('falls back to dark when the system prefers dark', () => {
    installMatchMedia(false)
    new ThemeStore().init()
    expect(activeTheme()).toBe('dark')
  })

  it('falls back to dark when matchMedia is unavailable', () => {
    vi.stubGlobal('matchMedia', undefined)
    new ThemeStore().init()
    expect(activeTheme()).toBe('dark')
  })

  it('ignores a stored value that is not a registered theme', () => {
    localStorage.setItem(KEY, 'solarized')
    installMatchMedia(true)
    new ThemeStore().init()
    expect(activeTheme()).toBe('light') // system, not the junk value
  })
})

describe('ThemeStore following the system', () => {
  it('keeps following across repeated OS changes', () => {
    const mm = installMatchMedia(false)
    new ThemeStore().init()
    expect(activeTheme()).toBe('dark')

    mm.set(true)
    expect(activeTheme()).toBe('light')

    // The regression lived here: the first change used to persist, so this second one was ignored
    // and the theme stayed light forever.
    mm.set(false)
    expect(activeTheme()).toBe('dark')

    mm.set(true)
    expect(activeTheme()).toBe('light')
  })

  it('never persists a system-derived theme', () => {
    const mm = installMatchMedia(false)
    new ThemeStore().init()
    mm.set(true)
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it('stops following once the user picks a theme', () => {
    const mm = installMatchMedia(false)
    const store = new ThemeStore()
    store.init()

    store.setTheme('light')
    expect(localStorage.getItem(KEY)).toBe('light')

    mm.set(false) // OS goes dark; the explicit choice wins
    expect(activeTheme()).toBe('light')
  })
})
