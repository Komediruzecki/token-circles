/**
 * UI helpers for the release suite. Each one is a thing the manual scope tells a person to do:
 * open the profile menu, tick a profile, go to a page without reloading, count the requests a
 * write causes, leave the tab and come back.
 */
import { expect } from '@playwright/test'
import type { Locator, Page, Request } from '@playwright/test'

// ---------------------------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------------------------

/**
 * Go to a page the way the sidebar does: a hash change, no reload. Pages stay mounted after
 * their first visit (App.tsx keep-alive), which is exactly what the "follows writes" cases
 * depend on, so a `page.goto` here would test something else: a fresh load always shows fresh data.
 */
export async function goPage(page: Page, name: string, readyTestId?: string): Promise<void> {
  await page.evaluate((h) => {
    window.location.hash = h
  }, name)
  if (readyTestId) await expect(page.getByTestId(readyTestId)).toBeVisible({ timeout: 20_000 })
}

/** A full load of a route, for the start of a case. */
export async function openApp(page: Page, route = 'dashboard', readyTestId?: string) {
  await page.goto(`/#${route}`, { waitUntil: 'domcontentloaded' })
  await expect(page.getByTestId('profile-dropdown-btn')).toBeVisible({ timeout: 30_000 })
  await dismissOnboardingIfOpen(page)
  if (readyTestId) await expect(page.getByTestId(readyTestId)).toBeVisible({ timeout: 20_000 })
}

/** The setup wizard opens by itself over a pristine profile. Cases that are not about it skip it. */
export async function dismissOnboardingIfOpen(page: Page): Promise<void> {
  const wizard = page.getByTestId('onboarding-wizard')
  if (await wizard.isVisible().catch(() => false)) {
    await page.getByTestId('onboarding-skip').click()
    await expect(wizard).toBeHidden()
  }
}

// ---------------------------------------------------------------------------------------------
// The sidebar profile menu
// ---------------------------------------------------------------------------------------------

export function profileButton(page: Page): Locator {
  return page.getByTestId('profile-dropdown-btn')
}

/** The menu row for one profile (`data-profile-id` is a stable attribute, not copy). */
export function profileRow(page: Page, id: number): Locator {
  return page.locator(`[data-profile-id="${id}"]`)
}

export async function openProfileMenu(page: Page): Promise<void> {
  const create = page.getByTestId('profile-create-item')
  if (!(await create.isVisible().catch(() => false))) await profileButton(page).click()
  await expect(create).toBeVisible()
}

/**
 * Close the menu by clicking somewhere that is not the menu: the page header area. Several fixed
 * bugs (#577, #587's cb3bcbd0) lived exactly in this path, where the click-outside handler wrote
 * an older selection back.
 */
export async function clickOutsideProfileMenu(page: Page): Promise<void> {
  await page.mouse.click(900, 30)
  await expect(page.getByTestId('profile-create-item')).toBeHidden()
}

/** Make a profile the primary one: click its name in the menu. */
export async function switchProfile(page: Page, id: number): Promise<void> {
  await openProfileMenu(page)
  await profileRow(page, id).locator('span').first().click()
}

/** Tick or untick a profile for the household view, from the menu's checkbox. */
export async function tickProfile(page: Page, id: number): Promise<void> {
  await openProfileMenu(page)
  await profileRow(page, id).locator('input[type="checkbox"]').click()
}

export async function isTicked(page: Page, id: number): Promise<boolean> {
  await openProfileMenu(page)
  return profileRow(page, id).locator('input[type="checkbox"]').isChecked()
}

/** Sidebar menu > Create Profile, submitted with the button or with Enter. */
export async function createProfileFromSidebar(
  page: Page,
  name: string,
  submit: 'button' | 'enter' = 'button'
): Promise<void> {
  await openProfileMenu(page)
  await page.getByTestId('profile-create-item').click()
  await expect(page.getByTestId('profile-modal')).toBeVisible()
  const input = page.getByTestId('profile-name-input')
  await input.fill(name)
  if (submit === 'enter') await input.press('Enter')
  else await page.getByTestId('profile-create-submit').click()
  await expect(page.getByTestId('profile-modal')).toBeHidden({ timeout: 15_000 })
}

/** What the app believes in localStorage: where writes go, and what household reads cover. */
export async function storedSelection(
  page: Page
): Promise<{ current: number; selected: number[] }> {
  return page.evaluate(() => ({
    current: Number(localStorage.getItem('currentProfileId')),
    selected: JSON.parse(localStorage.getItem('selectedProfileIds') || '[]') as number[],
  }))
}

// ---------------------------------------------------------------------------------------------
// Counting requests (cloud only: local-first reads never touch the network)
// ---------------------------------------------------------------------------------------------

export interface ApiCall {
  method: string
  path: string
  at: number
}

/**
 * Records every `/api/*` request the page makes. `mark()` starts a window, `calls(mark)` lists
 * what happened since, and `settle()` waits for the network to go quiet for `quietMs` so a count
 * is final rather than early.
 */
export function trackApi(page: Page) {
  const calls: ApiCall[] = []
  let lastAt = Date.now()
  const onRequest = (req: Request) => {
    const url = new URL(req.url())
    if (!url.pathname.startsWith('/api/')) return
    lastAt = Date.now()
    calls.push({ method: req.method(), path: url.pathname + url.search, at: lastAt })
  }
  page.on('request', onRequest)
  return {
    mark(): number {
      return calls.length
    },
    since(mark: number): ApiCall[] {
      return calls.slice(mark)
    },
    count(mark: number, method: string, path: RegExp): number {
      return calls.slice(mark).filter((c) => c.method === method && path.test(c.path)).length
    },
    async settle(quietMs = 1500, timeoutMs = 20_000): Promise<void> {
      const end = Date.now() + timeoutMs
      while (Date.now() < end) {
        if (Date.now() - lastAt >= quietMs) return
        await page.waitForTimeout(200)
      }
    },
    stop(): void {
      page.off('request', onRequest)
    },
  }
}

// ---------------------------------------------------------------------------------------------
// Away and back
// ---------------------------------------------------------------------------------------------

/**
 * "Tab away for more than 60 s, then come back."
 *
 * The app suspends on `blur` (or `visibilitychange` to hidden) and, on `focus`, refetches
 * everything when `Date.now()` moved by at least AWAY_THRESHOLD_MS (core/dataRevalidation.ts).
 * So this fires the same two events a real tab switch fires, and moves the page's `Date.now`
 * forward by `ms` in between, instead of sleeping for a minute. `during` runs while the tab is
 * away (for the two-tab case: the other tab's writes).
 */
export async function awayAndBack(
  page: Page,
  ms = 61_000,
  during?: () => Promise<void>
): Promise<void> {
  await page.evaluate(() => window.dispatchEvent(new Event('blur')))
  if (during) await during()
  await page.evaluate((shift) => {
    const w = window as unknown as { __tcClockShift?: number; __tcClockPatched?: boolean }
    w.__tcClockShift = (w.__tcClockShift ?? 0) + shift
    if (!w.__tcClockPatched) {
      const realNow = Date.now.bind(Date)
      Date.now = () => realNow() + (w.__tcClockShift ?? 0)
      w.__tcClockPatched = true
    }
  }, ms)
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
}

// ---------------------------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------------------------

/** The toasts on screen (ToastContainer: a Notifications region of status/alert items). */
export function toasts(page: Page): Locator {
  return page
    .getByRole('region', { name: 'Notifications' })
    .locator('[role="status"], [role="alert"]')
}

/** Text of every toast on screen right now. */
export async function toastTexts(page: Page): Promise<string[]> {
  return toasts(page).allInnerTexts()
}
