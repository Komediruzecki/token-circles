import { createSignal } from 'solid-js'

/**
 * Cross-component request to open the Settings page on a specific tab.
 *
 * A `null` value means "no pending request". Settings.tsx honors a non-null value via an
 * effect (switching its active tab) and then clears it back to `null` so the request is
 * consumed once. ProfileModal sets it to `'billing'` when a profile create is blocked by the
 * plan cap, sending the user straight to the upgrade options.
 */
export type SettingsTab = 'general' | 'exports' | 'billing' | 'about'

export const [settingsTab, setSettingsTab] = createSignal<SettingsTab | null>(null)
