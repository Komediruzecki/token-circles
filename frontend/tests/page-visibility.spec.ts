/**
 * Page Visibility Tests
 * Tests that all pages are visible after navigation
 */

import { expect, test } from '@playwright/test'
import { login, navigateToRoute, getByTestId } from './test-helpers'

test.describe('Page Visibility', () => {
  test('dashboard page is visible on initial load', async ({ page }) => {
    await login(page)
    await navigateToRoute(page, 'dashboard')
    await expect(getByTestId(page, 'dashboard-container')).toBeVisible()
  })

  test('transactions page is visible', async ({ page }) => {
    await login(page)
    await navigateToRoute(page, 'transactions')
    await expect(getByTestId(page, 'transactions-header')).toBeVisible()
  })

  test('accounts page is visible', async ({ page }) => {
    await login(page)
    await navigateToRoute(page, 'accounts')
    await expect(getByTestId(page, 'accounts-header')).toBeVisible()
  })

  test('categories page is visible', async ({ page }) => {
    await login(page)
    await navigateToRoute(page, 'categories')
    await expect(getByTestId(page, 'categories-header')).toBeVisible()
  })

  test('budgets page is visible', async ({ page }) => {
    await login(page)
    await navigateToRoute(page, 'budgets')
    await expect(getByTestId(page, 'budgets-header')).toBeVisible()
  })

  test('loans page is visible', async ({ page }) => {
    await login(page)
    await navigateToRoute(page, 'loans')
    await expect(getByTestId(page, 'loans-header')).toBeVisible()
  })

  test('goals page is visible', async ({ page }) => {
    await login(page)
    await navigateToRoute(page, 'goals')
    await expect(getByTestId(page, 'goals-header')).toBeVisible()
  })

  test('bills page is visible', async ({ page }) => {
    await login(page)
    await navigateToRoute(page, 'bills')
    await expect(getByTestId(page, 'bills-header')).toBeVisible()
  })

  test('housing page is visible', async ({ page }) => {
    await login(page)
    await navigateToRoute(page, 'housing')
    await expect(getByTestId(page, 'housing-header')).toBeVisible()
  })

  test('retirement page is visible', async ({ page }) => {
    await login(page)
    await navigateToRoute(page, 'retirement')
    await expect(getByTestId(page, 'retirement-header')).toBeVisible()
  })

  test('analytics page is visible', async ({ page }) => {
    await login(page)
    await navigateToRoute(page, 'analytics')
    // Check for any visible content on the page
    await expect(
      page.locator('main h1, main [class*="header"], main [class*="title"]').first()
    ).toBeVisible({ timeout: 10000 })
  })

  test('settings page is visible', async ({ page }) => {
    await login(page)
    await navigateToRoute(page, 'settings')
    await expect(
      page.locator('main h1, main [class*="header"], main [class*="title"]').first()
    ).toBeVisible({ timeout: 10000 })
  })

  test('import page is visible', async ({ page }) => {
    await login(page)
    await navigateToRoute(page, 'import')
    await expect(
      page.locator('main h1, main [class*="header"], main [class*="title"]').first()
    ).toBeVisible({ timeout: 10000 })
  })

  test('navigation preserves visible content', async ({ page }) => {
    await login(page)
    await navigateToRoute(page, 'dashboard')
    await expect(getByTestId(page, 'dashboard-container')).toBeVisible()
    await navigateToRoute(page, 'transactions')
    await expect(getByTestId(page, 'transactions-header')).toBeVisible()
  })
})
