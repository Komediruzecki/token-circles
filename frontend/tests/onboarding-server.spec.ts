/**
 * Server-mode onboarding trigger (the real signup/login path, not serverless).
 *
 * The other onboarding specs boot serverless zero-state; this proves the
 * SERVER path — a logged-in session whose active profile is pristine (no
 * accounts / transactions / bills) auto-opens the wizard on load. This is the
 * path that a real email/Google signup takes, and the one that was silently
 * broken: the server's /api/transactions returns `{ rows, total }`, not a
 * bare array, so the pristine check's `Array.isArray` was always false.
 *
 * Isolation-safe: it creates a FRESH profile (default categories only) and
 * activates that, so it never wipes the shared seeded profile other specs use.
 * It logs in inline (rather than via the login() helper) so it can point the
 * app at the pristine profile instead of the helper's pinned profile 1.
 */
import { expect, test } from '@playwright/test'
import { E2E_BASE } from './test-helpers'

test.describe('onboarding — server mode @smoke', () => {
  test('auto-opens for a logged-in user whose active profile is pristine', async ({ page }) => {
    const ctx = page.context()

    // Real backend session (cookie lands in the context jar), skipping the rate limiter.
    const auth = await ctx.request.post(`${E2E_BASE}/api/auth/login`, {
      // eslint-disable-next-line sonarjs/no-hardcoded-passwords
      data: { username: 'person', password: 'something-like-this' },
      headers: { 'x-skip-ratelimit': 'true' },
    })
    expect(auth.ok()).toBeTruthy()

    // A brand-new profile: the worker/backend seeds default categories only —
    // zero accounts/transactions/bills — the pristine state a fresh signup has.
    const res = await ctx.request.post(`${E2E_BASE}/api/profiles`, {
      headers: { 'Content-Type': 'application/json', 'X-Profile-Id': '1' },
      data: { name: `Onboarding Probe ${Date.now()}` },
    })
    expect(res.ok()).toBeTruthy()
    const created = (await res.json()) as { id: number }
    expect(created.id).toBeGreaterThan(0)

    await ctx.addInitScript((pid: number) => {
      localStorage.setItem('finance_storage_mode', 'self-hosted')
      localStorage.setItem('darkMode', 'false')
      localStorage.setItem('currentProfileId', String(pid))
      localStorage.setItem('selectedProfileIds', JSON.stringify([pid]))
      localStorage.removeItem('finance_onboarding')
    }, created.id)
    await page.goto(`${E2E_BASE}/#dashboard`, { waitUntil: 'domcontentloaded', timeout: 30000 })

    await expect(page.getByTestId('onboarding-wizard')).toBeVisible({ timeout: 30000 })
    await expect(page.getByTestId('onboarding-step-welcome')).toBeVisible()

    // And it does NOT re-open once the decision is recorded (skip persists).
    await page.getByTestId('onboarding-skip').click()
    await page.getByTestId('confirm-accept').click()
    await expect(page.getByTestId('onboarding-wizard')).toHaveCount(0)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId('dashboard-header')).toBeVisible({ timeout: 30000 })
    await page.waitForTimeout(1200)
    await expect(page.getByTestId('onboarding-wizard')).toHaveCount(0)
  })
})
