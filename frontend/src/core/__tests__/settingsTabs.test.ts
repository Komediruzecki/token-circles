/**
 * Which Settings tabs a storage mode is allowed to show.
 *
 * The API access tab is the reason this is a unit: a personal access token authenticates
 * against the Worker, and in serverless mode `apiFetch` answers from IndexedDB without ever
 * reaching one. Offering token creation there would hand the user a credential that
 * authenticates nothing.
 */
import { describe, expect, it } from 'vitest'
import { isTabVisible } from '../settingsStore'
import type { SettingsTab } from '../settingsStore'

const ALWAYS: SettingsTab[] = ['general', 'exports', 'about']
const SERVER_ONLY: SettingsTab[] = ['billing', 'api']

describe('Settings tab visibility', () => {
  it('hides the backend-only tabs in serverless mode', () => {
    for (const tab of SERVER_ONLY) {
      expect(isTabVisible(tab, 'serverless'), `${tab} should be hidden`).toBe(false)
    }
  })

  it('shows them once a real backend is in play', () => {
    for (const tab of SERVER_ONLY) {
      expect(isTabVisible(tab, 'self-hosted'), `${tab} should be shown`).toBe(true)
    }
  })

  it('leaves the local-capable tabs visible in both modes', () => {
    for (const tab of ALWAYS) {
      expect(isTabVisible(tab, 'serverless'), `${tab} in serverless`).toBe(true)
      expect(isTabVisible(tab, 'self-hosted'), `${tab} in self-hosted`).toBe(true)
    }
  })
})
