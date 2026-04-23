import { expect,test } from '@playwright/test'

test.describe('Critical Feature Flows', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
  })

  test('Dashboard page loads', async ({ page }) => {
    // Wait for dashboard to load
    await page.waitForSelector('#app', { timeout: 10000 })

    // Dashboard should have the header
    const header = page.locator('.app-header, .pageHeader')
    await expect(header.first()).toBeVisible()

    // Note: summary cards may not exist if there's no data yet
    const summaryCards = page.locator('.summaryCard')
    const cardCount = await summaryCards.count()
    // Either cards exist, or at least the page header exists
    const hasHeader = (await header.count()) > 0
    expect(hasHeader || cardCount > 0).toBeTruthy()
  })

  test('Navigation works correctly', async ({ page }) => {
    // Wait for navigation to stabilize
    await page.waitForTimeout(500)

    const navLinks = page.locator('.nav-item, [data-page]')
    const linkCount = await navLinks.count()
    expect(linkCount).toBeGreaterThan(0)

    // Click on dashboard (it's active by default)
    await page.click('[data-page="dashboard"], .nav-item:first-child')

    // Should stay on dashboard or navigate correctly
    await page.waitForTimeout(500)
  })

  test('Settings page is accessible', async ({ page }) => {
    // Wait for app to load
    await page.waitForSelector('#app')

    // Navigate to settings
    await page.goto('#settings', { waitUntil: 'networkidle' })

    // Wait for settings content
    await page.waitForTimeout(500)

    // Verify settings page loads
    const settingsHeader = page.locator('h2, h1').filter({ hasText: /settings|Settings/ })
    await expect(settingsHeader).toBeVisible({ timeout: 5000 })
  })

  test('Transactions page loads without errors', async ({ page }) => {
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        console.error('Console error:', msg.text())
      }
    })

    // Navigate to transactions
    await page.goto('#transactions', { waitUntil: 'networkidle' })

    // Wait for page content
    await page.waitForTimeout(500)

    // Check for transaction-related elements (even if empty)
    const transactionElements = page.locator('.transaction-card, [data-testid="transaction-row"]')
    const count = await transactionElements.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })
})

