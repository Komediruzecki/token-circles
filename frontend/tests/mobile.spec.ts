import { expect, test } from '@playwright/test'
import { E2E_BASE } from './test-helpers'

/**
 * Mobile-viewport checks (iPhone 15 Pro) for the shortcut guide and for the
 * "no horizontal page scroll" rule across the core pages — a squished/overflowing
 * layout would push the page wider than the viewport, which these assertions catch.
 * Runs in serverless mode, where the app auto-seeds demo data.
 */
test.use({ viewport: { width: 393, height: 852 } })

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('finance_storage_mode', 'serverless')
  })
})

test('keyboard shortcuts modal opens with "?" and lists the command bar', async ({ page }) => {
  await page.goto(`${E2E_BASE}/#dashboard`, {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  })
  // The shortcuts modal is gated behind the app-ready state, and serverless demo seeding can take
  // >10s under parallel load. Wait for the dashboard shell to mount before typing "?" — otherwise
  // the keypress is swallowed by the "Loading…" gate and the modal never appears.
  await expect(page.getByTestId('dashboard-container')).toBeVisible({ timeout: 30000 })

  await page.keyboard.type('?')

  const modal = page.getByTestId('shortcuts-modal')
  await expect(modal).toBeVisible({ timeout: 5000 })
  // The modal's purpose is to list shortcuts, so assert its command-bar entry renders (scoped to
  // the modal so this checks the guide's content, not some other command-bar copy on the page).
  await expect(modal.getByText(/command bar/i).first()).toBeVisible()

  // Esc closes it.
  await page.keyboard.press('Escape')
  await expect(modal).toBeHidden({ timeout: 5000 })
})

// The core pages must never push the document wider than the mobile viewport.
for (const page_ of ['dashboard', 'transactions', 'accounts', 'analytics', 'import', 'settings']) {
  test(`#${page_} has no horizontal page overflow on mobile`, async ({ page }) => {
    await page.goto(`${E2E_BASE}/#${page_}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    })
    await page.waitForTimeout(1500)
    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1
    )
    expect(overflows, `#${page_} should not scroll horizontally`).toBe(false)
  })
}
