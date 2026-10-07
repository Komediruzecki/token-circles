/**
 * Profile helpers for the release suite: the Settings > Data > Household view, arranging data in
 * a profile that is not the active one, and a local-first browser built by the case itself when
 * the `local` fixture's demo is not the starting point the case needs.
 */
import { devices } from '@playwright/test'
import { E2E_BASE } from '../e2e-constants'
import { EMPTY_STATE, expect, KNOWN_LOCAL_CONSOLE, ProfileApi } from './release-fixtures'
import { goPage, profileButton, storedSelection, switchProfile } from './release-helpers'
import type { Browser, BrowserContext, Page } from '@playwright/test'
import type { ApiInit, Mode, Profile } from './release-fixtures'

// ---------------------------------------------------------------------------------------------
// Settings > Data > Household view
// ---------------------------------------------------------------------------------------------

export async function openHousehold(page: Page): Promise<void> {
  await goPage(page, 'settings', 'settings-header')
  await page.getByTestId('settings-tab-exports').click()
  // The card loads the profile list on mount; the rows are there once it has.
  await expect(page.locator('[data-test-id^="household-profile-"]').first()).toBeVisible({
    timeout: 20_000,
  })
}

export function householdCheckbox(page: Page, id: number) {
  return page.getByTestId(`household-profile-${id}`).locator('input[type="checkbox"]')
}

/** Tick or untick a profile's household checkbox, and wait for the box to show it. */
export async function setHousehold(page: Page, id: number, ticked: boolean): Promise<void> {
  const box = householdCheckbox(page, id)
  if ((await box.isChecked()) !== ticked) await box.click()
  await expect(box).toBeChecked({ checked: ticked })
}

/** The household row carrying the Active lock. */
export async function householdActiveId(page: Page): Promise<number> {
  const row = page.locator('[data-test-id^="household-profile-"]', {
    has: page.getByTestId('household-active-badge'),
  })
  await expect(row).toHaveCount(1)
  return Number((await row.getAttribute('data-test-id'))?.replace('household-profile-', ''))
}

// ---------------------------------------------------------------------------------------------
// Arranging data in another profile
// ---------------------------------------------------------------------------------------------

export type ApiCall = <T = Record<string, unknown>>(path: string, init?: ApiInit) => Promise<T>

/**
 * Run `work` with an API client whose writes land in `profile`, then leave the active profile as
 * it was. Cloud: a request client with that profile's `X-Profile-Id`, no switch needed. Local-
 * first: the local router writes to the ACTIVE profile, so the sidebar switches to `profile` and
 * back, as a person arranging the same data would. Do this before ticking a household: a switch
 * resets the selection to the one profile switched to.
 */
export async function inProfile<R>(
  m: Mode,
  profile: Profile,
  work: (api: ApiCall) => Promise<R>
): Promise<R> {
  if (m.kind === 'cloud') {
    const client = new ProfileApi(m.page.request, profile)
    const api: ApiCall = async <T>(path: string, init?: ApiInit) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET') return client.get<T>(path)
      if (method === 'POST') return client.post<T>(path, init?.body ?? {})
      if (method === 'PUT' || method === 'PATCH') return client.put<T>(path, init?.body ?? {})
      await client.del(path)
      return null as T
    }
    return work(api)
  }
  const back = (await storedSelection(m.page)).current
  const backProfile = (await m.profiles()).find((p) => p.id === back)
  await switchTo(m.page, profile)
  try {
    return await work((path, init) => m.api(path, init))
  } finally {
    if (backProfile) await switchTo(m.page, backProfile)
  }
}

/** Switch from the sidebar and wait until both the header and the stored selection agree. */
export async function switchTo(page: Page, profile: Profile): Promise<void> {
  await switchProfile(page, profile.id)
  await expect(profileButton(page)).toContainText(profile.name)
  await expect
    .poll(async () => storedSelection(page), { message: `switched to ${profile.name}` })
    .toEqual({ current: profile.id, selected: [profile.id] })
}

// ---------------------------------------------------------------------------------------------
// A local-first browser of the case's own
// ---------------------------------------------------------------------------------------------

export interface FreshLocal {
  context: BrowserContext
  page: Page
  /** `Validation failed`, `VersionError` and page errors seen, as the `local` fixture gathers them. */
  problems: string[]
}

/**
 * A browser with nothing in it, on the sign-in screen a deployed build shows a new visitor, with
 * the same console gate as the `local` fixture. `init` scripts run before the app on every load
 * (a toast recorder, say), which a fixture-made page that has already booted cannot offer. With
 * `noDemo`, the browser is one that has had profiles before, so local-first starts empty and the
 * setup wizard opens instead of the demo seed (`finance_had_profiles`, idb.ts).
 */
export async function freshLocalBrowser(
  browser: Browser,
  opts: { init?: (() => void)[]; noDemo?: boolean } = {}
): Promise<FreshLocal> {
  const context = await browser.newContext({
    ...devices['Desktop Chrome'],
    baseURL: E2E_BASE,
    storageState: EMPTY_STATE,
  })
  for (const script of opts.init ?? []) await context.addInitScript(script)
  const page = await context.newPage()
  const problems: string[] = []
  const allowed = KNOWN_LOCAL_CONSOLE.map((k) => k.pattern)
  const watch = (p: Page) => {
    p.on('console', (msg) => {
      const text = msg.text()
      if (/Validation failed|VersionError/.test(text) && !allowed.some((a) => a.test(text))) {
        problems.push(text)
      }
    })
    p.on('pageerror', (err) => {
      if (!allowed.some((a) => a.test(err.message))) problems.push(`pageerror: ${err.message}`)
    })
  }
  watch(page)
  context.on('page', watch)

  await page.goto(`${E2E_BASE}/robots.txt`)
  await page.evaluate((noDemo) => {
    // A deployed build's default: a new browser lands on the sign-in screen.
    localStorage.setItem('finance_storage_mode', 'self-hosted')
    if (noDemo) localStorage.setItem('finance_had_profiles', '1')
  }, opts.noDemo === true)
  await page.goto(`${E2E_BASE}/`, { waitUntil: 'domcontentloaded' })
  return { context, page, problems }
}

/** The sign-in screen's "Continue with no account". */
export async function continueWithNoAccount(page: Page): Promise<void> {
  await page.getByTestId('try-no-account').click({ timeout: 60_000 })
}
