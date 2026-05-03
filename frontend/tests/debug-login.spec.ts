import { test, expect } from '@playwright/test';

test('debug - page content', async ({ page }) => {
  await page.goto('http://localhost:3847/#dashboard', { waitUntil: 'networkidle' })
  await page.waitForTimeout(2000)

  // Check if any data-test-id elements exist
  const dataTestIdCount = await page.locator('[data-test-id]').count()
  console.log('data-test-id count:', dataTestIdCount)

  if (dataTestIdCount === 0) {
    console.log('No data-test-id elements found')
    // Check if any test ID-like attributes exist
    const testIdMatches = await page.locator('*').filter({ hasAttribute: /^data-test-/ }).count()
    console.log('Elements with data-test- prefix:', testIdMatches)
  }

  // Get page title
  const title = await page.title()
  console.log('Page title:', title)

  // Get body content preview
  const bodyText = await page.locator('body').textContent()
  console.log('Body text (first 500 chars):', bodyText?.substring(0, 500))
})
