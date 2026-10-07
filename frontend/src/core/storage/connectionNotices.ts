/**
 * What a tab says when IndexedDB makes it wait for, or give way to, another tab.
 *
 * A new build that raises the database version cannot upgrade while another tab still holds a
 * connection at the old version, and a reset cannot delete the database while one is open. Without
 * a word from either side, the waiting tab hung with nothing on screen and the tab in the way never
 * learned it was.
 */
import { reloadToLatest } from '@pwa-kit'
import {
  addToast,
  hasToastOnChannel,
  removeToastsByChannel,
  UPDATE_TOAST_CHANNEL,
} from '../toastStore'

/** The waiting tab's notice. */
export const UPGRADE_BLOCKED_CHANNEL = 'db-upgrade-blocked'
/** As long as the deploy notice: both ask for something. Not sticky; getDB raises them again. */
const NOTICE_DURATION_MS = 60 * 1000

/**
 * This tab gave its connection up: `upgrade` when another tab runs a newer build, `reset` when
 * the database is being deleted (the crash screen's "clear local data" does that, from any tab,
 * this one included). This build cannot open the database again either way, so the notice asks
 * for a reload. `reloadToLatest`, as the deploy notice uses, so the reload lands on the new build
 * rather than on this one again from the service worker's cache.
 *
 * `replace` puts it up even over a notice already on the channel, for the moment it happens. A
 * later call re-raises it only once the last one has expired.
 */
export function announceConnectionReleased(reason: 'upgrade' | 'reset', replace = false): void {
  if (!replace && hasToastOnChannel(UPDATE_TOAST_CHANNEL)) return
  addToast(
    reason === 'upgrade'
      ? 'A newer Token Circles is open in another tab. Reload this tab to keep working.'
      : 'Token Circles data was reset. Reload this tab to keep working.',
    'info',
    {
      title: reason === 'upgrade' ? 'Update' : undefined,
      channel: UPDATE_TOAST_CHANNEL,
      durationMs: NOTICE_DURATION_MS,
      action: { label: 'Reload', onClick: () => void reloadToLatest() },
    }
  )
}

/** This tab's upgrade waits for another tab to let the database go. */
export function announceUpgradeBlocked(): void {
  if (hasToastOnChannel(UPGRADE_BLOCKED_CHANNEL)) return
  addToast('Close your other Token Circles tabs to finish updating this one.', 'warning', {
    title: 'Update',
    channel: UPGRADE_BLOCKED_CHANNEL,
    durationMs: NOTICE_DURATION_MS,
  })
}

/** The upgrade went ahead. */
export function clearUpgradeBlocked(): void {
  removeToastsByChannel(UPGRADE_BLOCKED_CHANNEL)
}
