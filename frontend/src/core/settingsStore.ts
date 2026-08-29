import { createSignal } from 'solid-js'
import type { StorageMode } from './storage/storageFactory'

/**
 * Cross-component request to open the Settings page on a specific tab.
 *
 * A `null` value means "no pending request". Settings.tsx honors a non-null value via an
 * effect (switching its active tab) and then clears it back to `null` so the request is
 * consumed once. ProfileModal sets it to `'billing'` when a profile create is blocked by the
 * plan cap, sending the user straight to the upgrade options.
 */
export type SettingsTab = 'general' | 'exports' | 'api' | 'billing' | 'about'

export const [settingsTab, setSettingsTab] = createSignal<SettingsTab | null>(null)

/**
 * Tabs that only mean anything when a real backend is being talked to.
 *
 * Billing has no meaning without an account, and API tokens authenticate against the Worker —
 * in serverless mode `apiFetch` answers from IndexedDB and never reaches one, so a token could
 * be created and would authenticate nothing.
 */
const SERVER_ONLY_TABS = new Set<SettingsTab>(['billing', 'api'])

export function isTabVisible(tab: SettingsTab, mode: StorageMode): boolean {
  return !SERVER_ONLY_TABS.has(tab) || mode === 'self-hosted'
}
