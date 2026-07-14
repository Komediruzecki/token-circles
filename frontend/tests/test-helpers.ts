/**
 * Test helpers for Playwright tests
 */

import { expect } from '@playwright/test'

// Track whether the context has been authenticated already
const contextAuthSetup = new WeakMap<any, boolean>()

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
  await page.goto(`http://localhost:3800/#${route}`, {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  })
  await expect(page.getByTestId(readyTestId)).toBeVisible({ timeout: 30000 })
}

/**
 * Login to the application
 * Creates a real backend session via API login, then sets localStorage.
 * Skips the backend rate limiter for tests and reuses auth state.
 */
export async function login(page: any) {
  const ctx = page.context()
  try {
    // Skip re-login if this context already has authentication + localStorage set up
    if (contextAuthSetup.has(ctx) && contextAuthSetup.get(ctx)) {
      await page.goto('http://127.0.0.1:3800/', { waitUntil: 'domcontentloaded', timeout: 30000 })
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {})
      return
    }

    // Authenticate with backend, skipping rate limiter (header is recognized by test/dev backend)
    const loginRes = await ctx.request.post('http://127.0.0.1:3800/api/auth/login', {
      // eslint-disable-next-line sonarjs/no-hardcoded-passwords
      data: { username: 'person', password: 'something-like-this' },
      headers: { 'x-skip-ratelimit': 'true' },
    })
    if (!loginRes.ok()) {
      console.error('Login failed:', loginRes.status(), await loginRes.text())
      throw new Error(`Login returned ${loginRes.status()}`)
    }
    // addInitScript must be called BEFORE navigation so localStorage is set when app initializes
    await ctx.addInitScript(() => {
      localStorage.setItem('currentProfileId', '1')
      localStorage.setItem('darkMode', 'false')
      localStorage.setItem('finance_storage_mode', 'self-hosted')
    })
    contextAuthSetup.set(ctx, true)
    await page.goto('http://127.0.0.1:3800/', { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {})
  } catch (error) {
    console.error('Login failed:', error)
    throw error
  }
}

/**
 * Navigate to a hash route and wait for content to load
 */
export async function navigateToRoute(page: any, route: string) {
  await page.goto(`http://127.0.0.1:3800/#${route}`, {
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
