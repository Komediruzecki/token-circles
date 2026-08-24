/**
 * uiPrefs — small, per-device display preferences.
 *
 * Deliberately localStorage and not the account: these describe how this screen should behave,
 * not what the account contains. A phone wanting the period bar pinned says nothing about what a
 * desktop should do, and a preference that syncs would make one device's choice the other's
 * surprise. Nothing here is worth a network round-trip on boot either.
 *
 * Every read and write is guarded. Private windows, cleared site data and browsers set to block
 * storage all throw on access rather than returning null, and a display preference must never be
 * the thing that stops the app rendering.
 */
import { createSignal } from 'solid-js'

const STICKY_PERIOD_KEY = 'finance-sticky-period-bar'

function readBool(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(key)
    if (raw === null) return fallback
    // Only the two values this module writes mean anything; anything else is treated as unset
    // rather than being read as one of them by accident.
    if (raw === 'true') return true
    if (raw === 'false') return false
    return fallback
  } catch {
    return fallback
  }
}

function writeBool(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, String(value))
  } catch {
    /* A preference that cannot be remembered still applies for this session. */
  }
}

/**
 * Whether the period bar stays in view while the page scrolls.
 *
 * Off by default. The bar is how you change month, and on a long page — Budgets especially — it
 * scrolls away exactly when the numbers you are reading make you want to change month, so this is
 * worth having. It is off out of the box because it costs a line of screen on every page that has
 * one, which is the more conservative default for something that changes how every page behaves.
 * Settings > Appearance turns it on.
 */
const STICKY_PERIOD_DEFAULT = false

const [stickyPeriodBar, setStickyPeriodBarSignal] = createSignal(
  readBool(STICKY_PERIOD_KEY, STICKY_PERIOD_DEFAULT)
)

export { stickyPeriodBar }

export function setStickyPeriodBar(on: boolean): void {
  setStickyPeriodBarSignal(on)
  writeBool(STICKY_PERIOD_KEY, on)
}

/** Test seam: drop any stored value and go back to the default. */
export function resetUiPrefs(): void {
  try {
    localStorage.removeItem(STICKY_PERIOD_KEY)
  } catch {
    /* nothing stored to remove */
  }
  setStickyPeriodBarSignal(STICKY_PERIOD_DEFAULT)
}
