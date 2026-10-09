/**
 * The two ways the sign-in specs boot the app.
 *
 * 'server' is how dev boots, and how most specs do: the stored mode says account mode, so the app
 * opens on the sign-in screen or the signed-in app.
 *
 * 'prod' is a fresh browser on production: nothing is stored, so the mode comes from
 * VITE_DEFAULT_STORAGE, which is `dexie` in frontend/.env.production and in frontend/.env, the
 * file the E2E dev server reads. That app starts local-first, on the sample profiles, and Manage
 * Account in the profile menu is the way to the sign-in screen.
 *
 * Both skip the onboarding wizard and pick the light theme, as every spec does.
 */
import { expect } from '@playwright/test'
import { sqlRows } from './db'
import type { BrowserContext, Page } from '@playwright/test'

export type Boot = 'server' | 'prod'
export const BOOTS: readonly Boot[] = ['server', 'prod']

/** The account's first profile, which a 'server' boot opens on. */
export function profileIdOf(email: string): number {
  const [profile] = sqlRows<{ id: number }>(
    `SELECT profiles.id FROM profiles JOIN users ON users.id = profiles.user_id
     WHERE users.email = '${email}' ORDER BY profiles.id LIMIT 1`
  )
  expect(profile, `a profile for ${email}`).toBeTruthy()
  return profile.id
}

/** Boot every page of `context` this way. `email` picks the profile a 'server' boot opens on. */
export async function bootApp(context: BrowserContext, boot: Boot, email?: string): Promise<void> {
  const pid = boot === 'server' && email ? String(profileIdOf(email)) : ''
  await context.addInitScript(
    ({ server, profile }) => {
      if (server) localStorage.setItem('finance_storage_mode', 'self-hosted')
      if (profile) localStorage.setItem('currentProfileId', profile)
      localStorage.setItem('darkMode', 'false')
      localStorage.setItem('finance_onboarding', 'skipped')
    },
    { server: boot === 'server', profile: pid }
  )
}

/** The mode the page's app stored, or null when it stored none (a fresh browser). */
export const storedMode = (page: Page) =>
  page.evaluate(() => localStorage.getItem('finance_storage_mode'))

/** Open the sign-in screen the way this boot reaches it. */
export async function openSignIn(page: Page, boot: Boot, base: string): Promise<void> {
  await page.goto(`${base}/`)
  if (boot === 'prod') {
    // A fresh browser: local-first, until Manage Account moves the device to account mode and
    // reloads.
    expect(await storedMode(page)).toBeNull()
    await page.getByTestId('profile-dropdown-btn').click()
    await page.getByText('Manage Account', { exact: true }).click()
  }
  await expect(page.locator('#login-email')).toBeVisible({ timeout: 30_000 })
}

/** Sign in with a password through the sign-in screen, and wait for the signed-in app. */
export async function signInWithPassword(page: Page, email: string, password: string) {
  await page.locator('#login-email').fill(email)
  await page.locator('#login-password').fill(password)
  await page.locator('button[type="submit"]').click()
  await expect(page.getByRole('button', { name: 'Logout' })).toBeVisible({ timeout: 30_000 })
}
