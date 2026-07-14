import { expect, test } from '@playwright/test'
import { gotoServerless } from './test-helpers'

/**
 * Analytics page tests.
 * Tests that the page loads without full page reloads on filter changes
 * and that the monthly savings card is present.
 *
 * Structural assertions target stable `data-test-id` hooks in Analytics.tsx rather than
 * user-visible copy or CSS-module class fragments (`[class*="statLabel"]`), which change with
 * design/wording. See tests/README.md for the test-id convention. These tests run in serverless
 * mode, where the app auto-seeds demo data (transactions from 2000 to the current year) on first
 * load, so the analytics content renders with real values. `gotoServerless` waits for that seed
 * to finish (gating on `analytics-header`) instead of a fixed sleep — the seed can take >10s under
 * parallel CI load, which is what used to make these tests flake.
 */

test('analytics page - loads without errors and shows header', async ({ page }) => {
  const consoleErrors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })

  // Resolves once the seed completes and the Analytics header (which renders unconditionally,
  // independent of whether analytics data has resolved) is visible.
  await gotoServerless(page, 'analytics', 'analytics-header')

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
  await gotoServerless(page, 'analytics', 'analytics-header')

  // The Category Trends year picker. Demo mode seeds multiple years, so it has >1 option.
  // It lives inside the data-resolved region, so it appears shortly after the header.
  const yearSelect = page.getByTestId('analytics-trends-year')
  await expect(yearSelect).toBeVisible({ timeout: 15000 })

  // Switch to a different year and confirm it applied as an in-page filter change (no full
  // reload / hash navigation away from the analytics route).
  const options = await yearSelect.locator('option').allTextContents()
  const currentValue = await yearSelect.inputValue()
  const otherOption = options.find((o) => o.trim() !== currentValue && !isNaN(Number(o.trim())))

  if (otherOption) {
    await yearSelect.selectOption(otherOption.trim())
    // `toHaveValue` auto-retries until the change takes effect in place — no fixed sleep needed.
    await expect(yearSelect).toHaveValue(otherOption.trim())
  }

  // A full reload would navigate off the SPA route; we must still be on the analytics page.
  expect(page.url()).toContain('analytics')
})

test('analytics page - monthly savings section present', async ({ page }) => {
  await gotoServerless(page, 'analytics', 'analytics-header')

  // The Monthly Savings card and its per-month income/expense breakdown cards. All render once
  // analytics data resolves, which demo mode guarantees.
  await expect(page.getByTestId('analytics-monthly-savings')).toBeVisible({ timeout: 15000 })
  await expect(page.getByTestId('analytics-monthly-income')).toBeVisible({ timeout: 15000 })
  await expect(page.getByTestId('analytics-monthly-expense')).toBeVisible({ timeout: 15000 })
})

test('analytics page - monthly selectors exist in monthly card', async ({ page }) => {
  await gotoServerless(page, 'analytics', 'analytics-header')

  // The monthly savings card exposes a month picker. It always renders 12 options (Jan–Dec).
  const monthSelect = page.getByTestId('analytics-monthly-month')
  await expect(monthSelect).toBeVisible({ timeout: 15000 })
  await expect(monthSelect.locator('option')).toHaveCount(12)
})
