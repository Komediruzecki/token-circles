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
 * It sets localStorage itself, rather than going through the login() helper, so
 * it can point the app at the pristine profile instead of the seeded one.
 */
import { expect, test } from '@playwright/test'
import { E2E_BASE, firstProfileId } from './test-helpers'

test.describe('onboarding — server mode @smoke', () => {
  test('auto-opens for a logged-in user whose active profile is pristine', async ({ page }) => {
    const ctx = page.context()

    // No sign-in here: the setup project saved a signed-in storageState and every context starts
    // from it, so ctx.request already carries the session cookie.
    const home = await firstProfileId(ctx)

    // A brand-new profile: the worker/backend seeds default categories only —
    // zero accounts/transactions/bills — the pristine state a fresh signup has.
    const res = await ctx.request.post(`${E2E_BASE}/api/profiles`, {
      headers: { 'Content-Type': 'application/json', 'X-Profile-Id': String(home) },
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
      // Init scripts run on EVERY navigation — including the post-skip reload
      // below. Clear the decision flag only ONCE (sessionStorage survives the
      // reload), or the reload assertion would erase the skip it just made and
      // ride on the settings-KV mirror winning a race (flaked on slow CI).
      if (!sessionStorage.getItem('onb_spec_cleared')) {
        sessionStorage.setItem('onb_spec_cleared', '1')
        localStorage.removeItem('finance_onboarding')
      }
    }, created.id)
    await page.goto(`${E2E_BASE}/#dashboard`, { waitUntil: 'domcontentloaded', timeout: 30000 })

    await expect(page.getByTestId('onboarding-wizard')).toBeVisible({ timeout: 30000 })
    await expect(page.getByTestId('onboarding-step-welcome')).toBeVisible()

    // And it does NOT re-open once the decision is recorded (skip persists).
    // Deterministically await the settings-KV mirror write the skip fires
    // before reloading, so the persistence check never races it.
    const mirrorSettled = page.waitForResponse(
      (r) => r.url().includes('/api/settings') && r.request().method() === 'PUT',
      { timeout: 15000 }
    )
    await page.getByTestId('onboarding-skip').click()
    await page.getByTestId('confirm-accept').click()
    await expect(page.getByTestId('onboarding-wizard')).toHaveCount(0)
    await mirrorSettled
    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId('dashboard-header')).toBeVisible({ timeout: 30000 })
    await page.waitForTimeout(1200)
    await expect(page.getByTestId('onboarding-wizard')).toHaveCount(0)
  })
})
