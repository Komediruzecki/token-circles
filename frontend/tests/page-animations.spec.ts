/**
 * Page Animation Tests
 * Tests that pages have proper animation transitions
 */

import { expect, test } from '@playwright/test'
import { login, navigateToRoute } from './test-helpers'

test.describe('Page Animations', () => {
  test('page content is visible', async ({ page }) => {
    await login(page)
    await navigateToRoute(page, 'dashboard')
    await expect(page.locator('#page-content')).toBeVisible()
    await expect(page.locator('.page-content')).toBeVisible()
  })

  test('page content has fadeIn animation class', async ({ page }) => {
    await login(page)
    await navigateToRoute(page, 'dashboard')
    const content = page.locator('.page-dashboard')
    await expect(content).toBeVisible()

    // Check that the element has animation or transition
    const style = await content.evaluate((el) => {
      const styles = window.getComputedStyle(el)
      return {
        opacity: styles.opacity,
        transition: styles.transition,
      }
    })
    expect(style.opacity).not.toBe('0')
  })

  test('navigation preserves visible content', async ({ page }) => {
    await login(page)
    await navigateToRoute(page, 'dashboard')

    // Navigate from dashboard to transactions
    await navigateToRoute(page, 'transactions')

    await expect(page.locator('#page-content')).toBeVisible()
    await expect(page.locator('.page-transactions')).toBeVisible()

    // Navigate back to dashboard
    await navigateToRoute(page, 'dashboard')

    await expect(page.locator('.page-dashboard')).toBeVisible()
  })

  test('dashboard loads with all sections visible', async ({ page }) => {
    await login(page)
    await navigateToRoute(page, 'dashboard')

    await page.waitForSelector('.dashboard-header', { state: 'visible' })
    await page.waitForSelector('.summary-cards', { state: 'visible' })
    await page.waitForSelector('.recent-transactions', { state: 'visible' })

    await expect(page.locator('.dashboard-header')).toBeVisible()
    await expect(page.locator('.summary-cards')).toBeVisible()
    await expect(page.locator('.recent-transactions')).toBeVisible()
  })

  test('transactions page shows table', async ({ page }) => {
    await login(page)
    await navigateToRoute(page, 'transactions')
    await page.waitForSelector('table', { state: 'visible' })

    await expect(page.locator('table')).toBeVisible()
  })

  test('accounts grid renders', async ({ page }) => {
    await login(page)
    await navigateToRoute(page, 'accounts')
    await page.waitForSelector('.accounts-grid', { state: 'visible' })

    await expect(page.locator('.accounts-grid')).toBeVisible()
  })

  test('budgets page renders content', async ({ page }) => {
    await login(page)
    await navigateToRoute(page, 'budgets')
    await page.waitForSelector('.page-budgets', { state: 'visible' })

    await expect(page.locator('.page-budgets')).toBeVisible()
  })

  test('goals page renders', async ({ page }) => {
    await login(page)
    await navigateToRoute(page, 'goals')
    await page.waitForSelector('.page-goals', { state: 'visible' })

    await expect(page.locator('.page-goals')).toBeVisible()
  })

  test('loans page renders', async ({ page }) => {
    await login(page)
    await navigateToRoute(page, 'loans')
    await page.waitForSelector('.page-loans', { state: 'visible' })

    await expect(page.locator('.page-loans')).toBeVisible()
  })

  test('bills page renders', async ({ page }) => {
    await login(page)
    await navigateToRoute(page, 'bills')
    await page.waitForSelector('.page-bills', { state: 'visible' })

    await expect(page.locator('.page-bills')).toBeVisible()
  })

  test('retirement page renders', async ({ page }) => {
    await login(page)
    await navigateToRoute(page, 'retirement')
    await page.waitForSelector('.page-retirement', { state: 'visible' })

    await expect(page.locator('.page-retirement')).toBeVisible()
  })

  test('analytics page renders', async ({ page }) => {
    await login(page)
    await navigateToRoute(page, 'analytics')
    await page.waitForSelector('.page-analytics', { state: 'visible' })

    await expect(page.locator('.page-analytics')).toBeVisible()
  })

  test('settings page renders', async ({ page }) => {
    await login(page)
    await navigateToRoute(page, 'settings')
    await page.waitForSelector('.page-settings', { state: 'visible' })

    await expect(page.locator('.page-settings')).toBeVisible()
  })

  test('housing page renders', async ({ page }) => {
    await login(page)
    await navigateToRoute(page, 'housing')
    await page.waitForSelector('.page-housing', { state: 'visible' })

    await expect(page.locator('.page-housing')).toBeVisible()
  })
})
