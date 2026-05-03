import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  // Add localStorage data before page loads
  await page.addInitScript(() => {
    localStorage.setItem('currentProfileId', '1')
    localStorage.setItem('darkMode', 'false')
  })
  await page.goto('#dashboard', { waitUntil: 'networkidle' })
  await page.waitForTimeout(1000)
})

test('should have elements', async ({ page }) => {
  const dataTestElements = await page.locator('[data-test-]').count()
  console.log('Data-test- elements:', dataTestElements)
  
  // Look for account-specific elements
  const accountsHeader = await page.locator('[data-test-id="accounts-header"]').count()
  console.log('accounts-header:', accountsHeader)
  
  // Get page HTML
  const html = await page.content()
  console.log('HTML length:', html.length)
})
