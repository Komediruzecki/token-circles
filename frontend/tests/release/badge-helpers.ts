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
 * the app boots, on every load) as well as to `page.evaluate` (installed now). It observes the
 * document itself, because an init script can run before there is a `documentElement`, and it
 * also looks inside inserted subtrees, in case the region mounts with a toast already in it.
 */
export function installToastRecorder(): void {
  const w = window as unknown as { __tcToasts?: ToastSeen[]; __tcToastObserver?: MutationObserver }
  if (w.__tcToastObserver) return
  const seen: ToastSeen[] = []
  w.__tcToasts = seen
  const region = '[role="region"][aria-label="Notifications"]'
  const note = (el: Element) => {
    seen.push({ text: (el.textContent || '').trim(), at: Date.now() })
  }
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      record.addedNodes.forEach((node) => {
        if (!(node instanceof Element)) return
        const role = node.getAttribute('role')
        if ((role === 'status' || role === 'alert') && node.parentElement?.matches(region)) {
          note(node)
          return
        }
        node
          .querySelectorAll(`${region} > [role="status"], ${region} > [role="alert"]`)
          .forEach(note)
      })
    }
  })
  observer.observe(document, { childList: true, subtree: true })
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

/** Wait for a profile's first evaluation to have stored its record. */
export async function waitForBadgeRecord(m: Mode, profileId: number): Promise<void> {
  await expect
    .poll(() => hasBadgeRecord(m, profileId), {
      message: `badge record of profile ${profileId}`,
      timeout: 30_000,
    })
    .toBe(true)
}

/**
 * The app's own answer to "is this the user's own server" (core/achievementsStore.ts). The cloud
 * pass runs against a Worker on localhost, which counts, so every cloud profile here earns
 * "Own the stack" on its first evaluation, data or none. On dev and prod it does not.
 */
export async function appIsSelfHosted(page: Page): Promise<boolean> {
  return page.evaluate(async () => {
    // A variable specifier: vite serves the source module, and the browser hands back the
    // instance the app already loaded.
    const spec = '/src/core/achievementsStore.ts'
    const store = (await import(/* @vite-ignore */ spec)) as { isSelfHosted: () => boolean }
    return store.isSelfHosted()
  })
}

/** The badges the test environment alone earns a profile (see `appIsSelfHosted`). */
export async function environmentBadges(page: Page): Promise<string[]> {
  return (await appIsSelfHosted(page)) ? ['own-the-stack'] : []
}

/**
 * Let the badge evaluations a case has set off finish: wait out AchievementsHost's 1.2 s
 * debounce, then wait for the active profile's run, which `refreshAchievements` joins when one is
 * in flight. Only for arranging and for after-the-fact checks: an announcement under test must
 * come from the app's own trigger, never from this call.
 */
export async function settleBadges(page: Page): Promise<void> {
  await page.waitForTimeout(1_500)
  await page.evaluate(async () => {
    const spec = '/src/core/achievementsStore.ts'
    const store = (await import(/* @vite-ignore */ spec)) as {
      refreshAchievements: () => Promise<unknown>
    }
    await store.refreshAchievements()
  })
}
