/**
 * Test helpers for Playwright tests
 */

import { expect } from '@playwright/test'
import { E2E_BASE, E2E_PROFILE } from './e2e-constants'

export { E2E_BASE }

/**
 * Navigate to a hash route in serverless/demo mode and wait until the app shell is ready.
 *
 * Serverless mode auto-seeds a large demo dataset (transactions from 2000 → present) into
 * IndexedDB on first load. Until that resolves the app renders a full-screen "Loading…" gate
 * and no page — not even the unconditional page header — is mounted. A fixed `waitForTimeout`
 * races that seed: under parallel CI load the seed can take well over 10s, which is exactly why
 * the analytics/mobile specs flaked. Gate on a stable readiness `data-test-id` with a generous
 * timeout instead of a magic sleep, so the wait is exactly as long as the seed needs and no more.
 */
export async function gotoServerless(page: any, route: string, readyTestId: string) {
  await page.addInitScript(() => {
    localStorage.setItem('finance_storage_mode', 'serverless')
  })
  await page.goto(`${E2E_BASE}/#${route}`, {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  })
  await expect(page.getByTestId(readyTestId)).toBeVisible({ timeout: 30000 })
}

/**
 * Navigate in serverless mode with a genuinely EMPTY workspace: setting
 * `finance_had_profiles` suppresses the first-run demo seed, so the app boots
 * with zero profiles, accounts, and transactions — the state a brand-new
 * signup sees, and the one that auto-opens the onboarding wizard. Gate on a
 * test-id that exists in that empty state (e.g. `onboarding-wizard`).
 */
export async function gotoServerlessZeroState(page: any, route: string, readyTestId: string) {
  await page.addInitScript(() => {
    localStorage.setItem('finance_storage_mode', 'serverless')
    localStorage.setItem('finance_had_profiles', '1')
  })
  await page.goto(`${E2E_BASE}/#${route}`, {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  })
  await expect(page.getByTestId(readyTestId)).toBeVisible({ timeout: 30000 })
}

/**
 * Open the app already signed in.
 *
 * There is no request here any more. `global.setup.ts` signs in once and Playwright hands every
 * context that session — cookie and the localStorage keys that put the app in server mode — via
 * `storageState`. Each context signing in for itself is what spent the login rate limit on a
 * machine with enough cores to run a context per CPU.
 */
export async function login(page: any) {
  await page.goto(`${E2E_BASE}/`, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {})
}

/**
 * Navigate to a hash route and wait for content to load
 */
export async function navigateToRoute(page: any, route: string) {
  await page.goto(`${E2E_BASE}/#${route}`, {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  })
  await page.waitForTimeout(500)
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {})
}

/**
 * Helper to find elements by data-test-id
 * Uses data-test-id attribute (matches source code)
 */
export function getByTestId(page: any, testId: string, options: any = {}) {
  return page.locator(`[data-test-id="${testId}"]`, options)
}

/**
 * Helper to find multiple elements by data-test-id
 */
export function getByTestIdMulti(page: any, testId: string, options: any = {}) {
  return page.locator(`[data-test-id="${testId}"]`, options)
}

/**
 * The id of the seeded fixture profile.
 *
 * Specs used to hardcode `X-Profile-Id: '1'`, which held only because the Express server's seeded
 * database always produced it. The profile is created through the API now, so its id is whatever
 * the database hands out — and specs that create their own leave others behind it in the list.
 */
export async function firstProfileId(ctx: any): Promise<number> {
  const res = await ctx.request.get(`${E2E_BASE}/api/profiles`)
  expect(res.ok(), `could not read profiles: ${res.status()}`).toBeTruthy()
  const body = await res.json()
  const profiles = Array.isArray(body) ? body : body.profiles
  const fixture = profiles?.find((p: { name: string }) => p.name === E2E_PROFILE)
  expect(fixture, `no "${E2E_PROFILE}" profile — did the setup project run?`).toBeTruthy()
  return fixture.id as number
}
