/**
 * Badge helpers for the release suite: a recorder for every toast the page raises, the badge
 * record a profile has stored, and the Progress page's count of earned badges.
 */
import { expect, ProfileApi } from './release-fixtures'
import type { Page } from '@playwright/test'
import type { Mode } from './release-fixtures'

/** What a badge announcement says (core/achievementsStore.ts `announce`). */
export const BADGE_TOAST = /Badge unlocked: |badges earned from your history so far\./

export interface ToastSeen {
  text: string
  at: number
}

/**
 * Record the text of every toast added to the Notifications region, however briefly it stayed.
 * Badge toasts share one channel, so a second one evicts the first at once: watching the screen
 * for "N toasts" would only ever show the last. A MutationObserver sees each insertion.
 *
 * Plain JavaScript with no closure, so it can go to `context.addInitScript` (installed before
 * the app boots, on every load) as well as to `page.evaluate` (installed now).
 */
export function installToastRecorder(): void {
  const w = window as unknown as { __tcToasts?: ToastSeen[]; __tcToastObserver?: MutationObserver }
  if (w.__tcToastObserver) return
  const seen: ToastSeen[] = []
  w.__tcToasts = seen
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      const parent = record.target as Element
      if (!parent.matches?.('[role="region"][aria-label="Notifications"]')) continue
      record.addedNodes.forEach((node) => {
        if (!(node instanceof HTMLElement)) return
        const role = node.getAttribute('role')
        if (role !== 'status' && role !== 'alert') return
        seen.push({ text: (node.textContent || '').trim(), at: Date.now() })
      })
    }
  })
  observer.observe(document.documentElement, { childList: true, subtree: true })
  w.__tcToastObserver = observer
}

export async function recordToasts(page: Page): Promise<void> {
  await page.evaluate(installToastRecorder)
}

export async function toastsSeen(page: Page): Promise<ToastSeen[]> {
  return page.evaluate(() => (window as unknown as { __tcToasts?: ToastSeen[] }).__tcToasts ?? [])
}

/** Badge toasts recorded from index `from` on. */
export async function badgeToastsSince(page: Page, from = 0): Promise<string[]> {
  return (await toastsSeen(page))
    .slice(from)
    .map((t) => t.text)
    .filter((t) => BADGE_TOAST.test(t))
}

/**
 * The badge ids a profile has stored. Cloud keeps them in the profile's own settings under
 * `achievements`; local-first keeps one settings store per device and puts the profile in the
 * key (`achievementsStore.recordKey`).
 */
export async function storedBadgeIds(m: Mode, profileId: number): Promise<string[]> {
  const settings =
    m.kind === 'cloud'
      ? await new ProfileApi(m.page.request, { id: profileId, name: '' }).get<
          Record<string, unknown>
        >('/api/settings')
      : await m.api('/api/settings')
  const raw = settings[m.kind === 'cloud' ? 'achievements' : `achievements:${profileId}`]
  if (typeof raw !== 'string' || raw === '') return []
  const parsed = JSON.parse(raw) as { unlocks?: { id: string }[] }
  return (parsed.unlocks ?? []).map((u) => u.id).sort()
}

/** True once a profile has a stored badge record at all (its first evaluation has finished). */
export async function hasBadgeRecord(m: Mode, profileId: number): Promise<boolean> {
  const settings =
    m.kind === 'cloud'
      ? await new ProfileApi(m.page.request, { id: profileId, name: '' }).get<
          Record<string, unknown>
        >('/api/settings')
      : await m.api('/api/settings')
  const raw = settings[m.kind === 'cloud' ? 'achievements' : `achievements:${profileId}`]
  return typeof raw === 'string' && raw !== ''
}

/** Progress page: "What you have earned", N of M. */
export async function progressEarnedCount(page: Page): Promise<number> {
  const text = await page.getByTestId('progress-divider-earned').innerText()
  const match = /(\d+)\s+of\s+\d+/.exec(text)
  expect(match, `"N of M" in "${text}"`).toBeTruthy()
  return Number((match as RegExpExecArray)[1])
}
