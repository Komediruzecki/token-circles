/**
 * The switch is the part that matters: get it wrong and a visitor who clicked "Start on
 * Advanced" lands on a Settings page with no Billing tab, which is worse than the root.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const getStorageMode = vi.fn(() => 'serverless')
const setStorageMode = vi.fn()
vi.mock('../storage/storageFactory', () => ({
  getStorageMode: () => getStorageMode(),
  setStorageMode: (m: string) => {
    setStorageMode(m)
  },
}))

import { applyPlanIntentFromUrl, clearPlanIntent, storedPlanIntent } from '../planIntent'

const reload = vi.fn()
let replaceState: ReturnType<typeof vi.spyOn>
const at = (href: string): void => {
  const u = new URL(href)
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { href: u.href, search: u.search, hash: u.hash, pathname: u.pathname, reload },
  })
}

beforeEach(() => {
  clearPlanIntent()
  reload.mockClear()
  setStorageMode.mockClear()
  getStorageMode.mockReturnValue('serverless')
  replaceState = vi.spyOn(window.history, 'replaceState').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
  clearPlanIntent()
})

describe('applyPlanIntentFromUrl', () => {
  it('parks the tier and reloads into server mode when the app is local-only', () => {
    at('https://tokencircles.com/?plan=advanced')
    expect(applyPlanIntentFromUrl()).toBe(true)
    expect(setStorageMode).toHaveBeenCalledWith('self-hosted')
    expect(reload).toHaveBeenCalledTimes(1)
    // Parked, because the reload is exactly what a query parameter cannot survive.
    expect(storedPlanIntent()).toBe('advanced')
  })

  it('parks it without reloading when the app already talks to a server', () => {
    getStorageMode.mockReturnValue('self-hosted')
    at('https://tokencircles.com/?plan=ultimate')
    expect(applyPlanIntentFromUrl()).toBe(false)
    expect(setStorageMode).not.toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()
    expect(storedPlanIntent()).toBe('ultimate')
  })

  it('strips the parameter so a refresh cannot re-fire it', () => {
    getStorageMode.mockReturnValue('self-hosted')
    at('https://tokencircles.com/?utm=nav&plan=basic#settings')
    applyPlanIntentFromUrl()
    expect(replaceState.mock.calls[0]).toEqual([null, '', '/?utm=nav#settings'])
  })

  it('does nothing at all without a plan parameter', () => {
    at('https://tokencircles.com/')
    expect(applyPlanIntentFromUrl()).toBe(false)
    expect(setStorageMode).not.toHaveBeenCalled()
    expect(storedPlanIntent()).toBeNull()
  })

  it('does not switch anyone out of local mode over a tier it does not sell', () => {
    at('https://tokencircles.com/?plan=free')
    expect(applyPlanIntentFromUrl()).toBe(false)
    expect(setStorageMode).not.toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()
  })
})
