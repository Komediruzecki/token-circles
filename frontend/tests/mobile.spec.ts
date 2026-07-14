import { expect, test } from '@playwright/test'

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
  await page.goto('http://localhost:3800/#dashboard', {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  })
  await page.waitForTimeout(1500)

  await page.keyboard.type('?')

  const heading = page.getByRole('heading', { name: 'Keyboard shortcuts' })
  await expect(heading).toBeVisible({ timeout: 5000 })
  await expect(page.getByText('Open the command bar')).toBeVisible()

  // Esc closes it.
  await page.keyboard.press('Escape')
  await expect(heading).toBeHidden({ timeout: 5000 })
})

// The core pages must never push the document wider than the mobile viewport.
for (const page_ of ['dashboard', 'transactions', 'accounts', 'analytics', 'import', 'settings']) {
  test(`#${page_} has no horizontal page overflow on mobile`, async ({ page }) => {
    await page.goto(`http://localhost:3800/#${page_}`, {
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
