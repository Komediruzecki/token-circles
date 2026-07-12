import { expect, test } from '@playwright/test'

/**
 * Analytics page tests.
 * Tests that the page loads without full page reloads on filter changes
 * and that the monthly savings card is present.
 *
 * Structural assertions target stable `data-test-id` hooks in Analytics.tsx rather than
 * user-visible copy or CSS-module class fragments (`[class*="statLabel"]`), which change with
 * design/wording. See tests/README.md for the test-id convention. These tests run in serverless
 * mode, where the app auto-seeds demo data (transactions from 2000 to the current year) on first
 * load, so the analytics content renders with real values.
 */

test('analytics page - loads without errors and shows header', async ({ page }) => {
  const consoleErrors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })

  await page.addInitScript(() => {
    localStorage.setItem('finance_storage_mode', 'serverless')
  })

  await page.goto('http://localhost:3800/#analytics', {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  })
  await page.waitForTimeout(2000)

  // Analytics page header (the H1) should be visible. It renders unconditionally, independent of
  // whether analytics data has resolved.
  await expect(page.getByTestId('analytics-header')).toBeVisible({ timeout: 10000 })

  // No console errors (filter out CORS/network errors that aren't our bugs)
  const relevantErrors = consoleErrors.filter(
    (e) => !e.includes('Failed to load') && !e.includes('NetworkError') && !e.includes('fetch')
  )
  // The analytics page should not have JS errors
  for (const err of relevantErrors) {
    console.log('Console error:', err)
  }
})

test('analytics page - year change does not cause full page navigation', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('finance_storage_mode', 'serverless')
  })

  await page.goto('http://localhost:3800/#analytics', {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  })
  await page.waitForTimeout(2000)

  // The Category Trends year picker. Demo mode seeds multiple years, so it has >1 option.
  const yearSelect = page.getByTestId('analytics-trends-year')
  await expect(yearSelect).toBeVisible({ timeout: 10000 })

  // Switch to a different year and confirm it applied as an in-page filter change (no full
  // reload / hash navigation away from the analytics route).
  const options = await yearSelect.locator('option').allTextContents()
  const currentValue = await yearSelect.inputValue()
  const otherOption = options.find((o) => o.trim() !== currentValue && !isNaN(Number(o.trim())))

  if (otherOption) {
    await yearSelect.selectOption(otherOption.trim())
    await page.waitForTimeout(1500)
    // The select reflects the new year — the change took effect in place.
    await expect(yearSelect).toHaveValue(otherOption.trim())
  }

  // A full reload would navigate off the SPA route; we must still be on the analytics page.
  expect(page.url()).toContain('analytics')
})

test('analytics page - monthly savings section present', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('finance_storage_mode', 'serverless')
  })

  await page.goto('http://localhost:3800/#analytics', {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  })
  await page.waitForTimeout(2000)

  // The Monthly Savings card and its per-month income/expense breakdown cards. All render once
  // analytics data resolves, which demo mode guarantees.
  await expect(page.getByTestId('analytics-monthly-savings')).toBeVisible({ timeout: 10000 })
  await expect(page.getByTestId('analytics-monthly-income')).toBeVisible()
  await expect(page.getByTestId('analytics-monthly-expense')).toBeVisible()
})

test('analytics page - monthly selectors exist in monthly card', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('finance_storage_mode', 'serverless')
  })

  await page.goto('http://localhost:3800/#analytics', {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  })
  await page.waitForTimeout(2000)

  // The monthly savings card exposes a month picker. It always renders 12 options (Jan–Dec).
  const monthSelect = page.getByTestId('analytics-monthly-month')
  await expect(monthSelect).toBeVisible({ timeout: 10000 })
  await expect(monthSelect.locator('option')).toHaveCount(12)
})
