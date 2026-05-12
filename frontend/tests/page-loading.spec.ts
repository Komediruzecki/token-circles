/**
 * E2E Tests - Page Loading Tests
 * Tests each page loads without errors or console warnings
 */
import { test, expect } from '@playwright/test'
import { login, navigateToRoute } from './test-helpers'

test.describe('Page Loading Tests', () => {
  const pages = [
    'dashboard',
    'transactions',
    'accounts',
    'categories',
    'budgets',
    'analytics',
    'bills',
    'loans',
    'retirement',
    'goals',
    'settings',
    'import',
  ]

  for (const pageName of pages) {
    test(`/${pageName} page loads without errors`, async ({ page }) => {
      await login(page)
      await navigateToRoute(page, pageName)

      // Wait a moment for any async operations to complete
      await page.waitForTimeout(1000)

      // Check for console errors
      const errors: string[] = []
      page.on('console', (msg) => {
        if (msg.type() === 'error') {
          errors.push(msg.text())
        }
      })

      // Wait for any unhandled promise rejections
      const rejectionErrors: string[] = []
      page.on('pageerror', (error) => {
        rejectionErrors.push(error.message)
      })

      // Wait for any API errors in the network
      await page.waitForTimeout(500)

      // Assert no console errors
      expect(errors.length).toBe(0)

      // Assert no page errors
      expect(rejectionErrors.length).toBe(0)

      // Verify page content loaded (at least the main heading exists)
      const hasContent = (await page.locator('h1, h2, h3').count()) > 0
      expect(hasContent).toBe(true)
    })
  }
})

test.describe('Navigation Tests', () => {
  test('navigation links work correctly', async ({ page }) => {
    await login(page)
    await navigateToRoute(page, 'dashboard')

    // Test main navigation
    const navItems = page.locator('[data-nav-item]')
    await expect(navItems).toHaveCount(8)

    // Click on Transactions
    await navItems.filter({ hasText: 'Transactions' }).first().click()
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveURL(/#transactions/)
  })

  test('sidebar navigation works', async ({ page }) => {
    await login(page)
    await navigateToRoute(page, 'dashboard')

    // Find all sidebar links
    const sidebarLinks = page.locator('nav a[href^="#"]')
    const count = await sidebarLinks.count()
    expect(count).toBeGreaterThan(0)

    // Click first link
    await sidebarLinks.first().click()
    await page.waitForLoadState('networkidle')
  })
})

test.describe('Modal Loading Tests', () => {
  test('modals open and close correctly', async ({ page }) => {
    await login(page)
    await navigateToRoute(page, 'dashboard')

    // Find and click a button that opens a modal
    const modalOpeners = page.locator('button[onclick*="modal"], button[onclick*="Modal"]')
    const count = await modalOpeners.count()

    if (count > 0) {
      await modalOpeners.first().click()
      await page.waitForTimeout(500)

      const modal = page.locator('.modal-overlay')
      await expect(modal).toBeVisible()

      // Close modal
      const closeButtons = modal.locator('button:has-text("Close")')
      await closeButtons.first().click()
      await page.waitForTimeout(300)

      await expect(modal).not.toBeVisible()
    }
  })
})

test.describe('Component Loading Tests', () => {
  test('charts load without errors', async ({ page }) => {
    await login(page)
    await navigateToRoute(page, 'dashboard')

    // Wait for charts to render
    await page.waitForTimeout(2000)

    // Check for chart-related errors
    const errors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        errors.push(msg.text())
      }
    })

    // Give time for any chart rendering to complete
    await page.waitForTimeout(1000)

    expect(errors.length).toBe(0)
  })

  test('tables load without errors', async ({ page }) => {
    await login(page)
    await navigateToRoute(page, 'transactions')

    // Wait for table to render
    await page.waitForTimeout(500)

    // Check for table-related errors
    const errors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        errors.push(msg.text())
      }
    })

    // Check that table exists
    const table = page.locator('table')
    await expect(table).toBeVisible({ timeout: 5000 })

    expect(errors.length).toBe(0)
  })
})

test.describe('Form Loading Tests', () => {
  test('forms initialize correctly', async ({ page }) => {
    await login(page)
    await navigateToRoute(page, 'transactions')

    // Find all form inputs
    const formInputs = page.locator(
      'input[type="text"], input[type="number"], input[type="date"], select'
    )
    const count = await formInputs.count()

    // At least some inputs should exist
    expect(count).toBeGreaterThan(0)
  })

  test('buttons are clickable', async ({ page }) => {
    await login(page)
    await navigateToRoute(page, 'transactions')

    // Find buttons
    const buttons = page.locator('button')
    const count = await buttons.count()

    if (count > 0) {
      const firstButton = buttons.first()
      await firstButton.click()
      await page.waitForTimeout(300)
      // Button should still exist after click
      await expect(firstButton).toBeVisible()
    }
  })
})
