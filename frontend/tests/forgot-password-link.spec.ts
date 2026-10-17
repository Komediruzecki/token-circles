/**
 * The Reset password button of the "already has an account" mail links to `/#forgot-password`.
 * Opened in a mail app's fresh browser, booted both ways (boot.ts), the app comes up on the sign-in
 * screen's reset form. A 'prod' boot is a browser that never chose a mode, which starts
 * local-first in production: the link moves it to account mode before the app mounts
 * (consumeForgotPasswordLink), since only account mode has a sign-in screen.
 */
import { expect, test } from '@playwright/test'
import { BOOTS, bootApp, storedMode } from './boot'
import { E2E_BASE } from './e2e-constants'

test.use({ storageState: { cookies: [], origins: [] } })

for (const boot of BOOTS) {
  test(`#forgot-password opens the reset form in a fresh browser (${boot}) @smoke`, async ({
    context,
    page,
  }) => {
    await bootApp(context, boot)

    await page.goto(`${E2E_BASE}/#forgot-password`)

    await expect(page.getByRole('button', { name: 'Send reset link' })).toBeVisible({
      timeout: 30_000,
    })
    expect(await storedMode(page)).toBe('self-hosted')

    // Back to sign in is the password form, and the device stays in account mode after a reload.
    await page.getByRole('button', { name: 'Back to sign in' }).click()
    await expect(page.locator('#login-password')).toBeVisible()
    expect(await page.evaluate(() => window.location.hash)).toBe('')
    await page.reload()
    await expect(page.locator('#login-password')).toBeVisible({ timeout: 30_000 })
  })
}
