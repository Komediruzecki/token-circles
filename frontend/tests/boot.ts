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
import { onboardingDecided } from './onboarding-decided'
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

/** The id of the account at `email`, or null when there is none yet. */
function accountIdOf(email: string): number | null {
  const [account] = sqlRows<{ id: number }>(`SELECT id FROM users WHERE email = '${email}'`)
  return account?.id ?? null
}

/**
 * Boot every page of `context` this way. `email` picks the profile a 'server' boot opens on, and
 * the account whose setup wizard is marked decided besides local-first's.
 */
export async function bootApp(context: BrowserContext, boot: Boot, email?: string): Promise<void> {
  const pid = boot === 'server' && email ? String(profileIdOf(email)) : ''
  const account = email ? accountIdOf(email) : null
  const decided = onboardingDecided(account === null ? ['local'] : ['local', account])
  await context.addInitScript(
    ({ server, profile, decided }) => {
      if (server) localStorage.setItem('finance_storage_mode', 'self-hosted')
      if (profile) localStorage.setItem('currentProfileId', profile)
      localStorage.setItem('darkMode', 'false')
      for (const [key, value] of decided) localStorage.setItem(key, value)
    },
    { server: boot === 'server', profile: pid, decided }
  )
}

/**
 * Mark the setup wizard decided for the account at `email` too, on every page `context` loads from
 * now on: for a spec that signs in to an account other than the one it booted as, or to one it
 * made after booting. The wizard opens a moment after a sign-in to an account that has not decided
 * it, and hides the app while it is open.
 */
export async function markSetupDecided(context: BrowserContext, email: string): Promise<void> {
  const account = accountIdOf(email)
  expect(account, `an account at ${email}`).not.toBeNull()
  await context.addInitScript(
    (decided) => {
      for (const [key, value] of decided) localStorage.setItem(key, value)
    },
    onboardingDecided([account as number])
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
