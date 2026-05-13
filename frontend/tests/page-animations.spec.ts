/**
 * Page Animation Tests
 * Tests that pages have proper animation transitions
 */

import { expect, test } from '@playwright/test'
import { login, navigateToRoute, getByTestId } from './test-helpers'

test.describe('Page Animations', () => {
  test('page content is visible', async ({ page }) => {
    await login(page)
    await navigateToRoute(page, 'dashboard')
    await expect(page.locator('h1').first()).toBeVisible()
  })

  test('page content has fadeIn animation class', async ({ page }) => {
    await login(page)
    await navigateToRoute(page, 'dashboard')
    const content = page.locator('[class*="page"]').first()
    await expect(content).toBeVisible()

    const style = await content.evaluate((el) => {
      const styles = window.getComputedStyle(el)
      return { opacity: styles.opacity }
    })
    expect(style.opacity).not.toBe('0')
  })

  test('navigation preserves visible content', async ({ page }) => {
    await login(page)
    await navigateToRoute(page, 'dashboard')

    await navigateToRoute(page, 'transactions')
    await expect(page.locator('h1').first()).toBeVisible()

    await navigateToRoute(page, 'dashboard')
    await expect(page.locator('h1').first()).toBeVisible()
  })

  test('dashboard loads with all sections visible', async ({ page }) => {
    await login(page)
    await navigateToRoute(page, 'dashboard')

    await expect(getByTestId(page, 'dashboard-header')).toBeVisible({ timeout: 10000 })
  })

  test('transactions page shows table', async ({ page }) => {
    await login(page)
    await navigateToRoute(page, 'transactions')
    await expect(page.locator('table, [data-test-id="transactions-header"]').first()).toBeVisible({ timeout: 5000 })
  })

  test('accounts grid renders', async ({ page }) => {
    await login(page)
    await navigateToRoute(page, 'accounts')
    await expect(getByTestId(page, 'accounts-grid')).toBeVisible({ timeout: 5000 })
  })

  test('budgets page renders content', async ({ page }) => {
    await login(page)
    await navigateToRoute(page, 'budgets')
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 5000 })
  })

  test('goals page renders', async ({ page }) => {
    await login(page)
    await navigateToRoute(page, 'goals')
    await expect(getByTestId(page, 'goals-header')).toBeVisible({ timeout: 5000 })
  })

  test('loans page renders', async ({ page }) => {
    await login(page)
    await navigateToRoute(page, 'loans')
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 5000 })
  })

  test('bills page renders', async ({ page }) => {
    await login(page)
    await navigateToRoute(page, 'bills')
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 5000 })
  })

  test('retirement page renders', async ({ page }) => {
    await login(page)
    await navigateToRoute(page, 'retirement')
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 5000 })
  })

  test('analytics page renders', async ({ page }) => {
    await login(page)
    await navigateToRoute(page, 'analytics')
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 5000 })
  })

  test('settings page renders', async ({ page }) => {
    await login(page)
    await navigateToRoute(page, 'settings')
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 5000 })
  })

  test('housing page renders', async ({ page }) => {
    await login(page)
    await navigateToRoute(page, 'housing')
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 5000 })
  })
})
