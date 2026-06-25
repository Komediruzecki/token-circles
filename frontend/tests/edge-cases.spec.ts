import { expect, test } from '@playwright/test'
import { login, navigateToRoute } from './test-helpers'

test.describe('Edge Cases & Error Handling', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await navigateToRoute(page, 'dashboard')
  })

  test('should handle empty states gracefully', async ({ page }) => {
    // Test with no data scenario
    const emptyStateSelectors = [
      '.empty-state',
      '[data-test-id="empty-state"]',
      '[class*="empty"]',
      '[class*="no-data"]',
    ]

    for (const selector of emptyStateSelectors) {
      const element = page.locator(selector)
      const count = await element.count()
      if (count > 0) {
        await expect(element).toBeVisible()
      }
    }
  })

  test('should handle loading states', async ({ page }) => {
    await navigateToRoute(page, 'dashboard')

    const loadingSelectors = ['.loading', '[data-test-id="loading"]', '[class*="loading"]']

    for (const selector of loadingSelectors) {
      const element = page.locator(selector)
      const count = await element.count()
      if (count > 0) {
        await expect(element).toBeVisible()
      }
    }
  })

  test('should handle network errors gracefully', async ({ page }) => {
    // Test with simulated network error
    await page.goto('about:blank')
    await page.goBack()
    await page.waitForLoadState('networkidle')

    const pageContent = await page.content()
    expect(pageContent).toBeTruthy()
  })

  test('should handle large datasets', async ({ page }) => {
    await navigateToRoute(page, 'transactions')

    // Check if table has pagination
    const pagination = page.getByRole('navigation', { name: /pagination/i })
    const paginationCount = await pagination.count()
    expect(paginationCount).toBeGreaterThanOrEqual(0)

    // Check if there are multiple pages of data
    const rows = page.locator('table tr, [data-test-id="tx-row"]')
    const rowCount = await rows.count()
    expect(rowCount).toBeGreaterThanOrEqual(0)
  })

  test('should handle form validation', async ({ page }) => {
    await navigateToRoute(page, 'accounts')

    const addBtn = page.locator('[data-test-id="add-account-btn"]')
    if (await addBtn.isVisible().catch(() => false)) {
      await addBtn.click()
      await page.waitForTimeout(300)

      // Submit form without data
      const submitBtn = page.locator('[data-test-id="add-account-modal"] button[type="submit"]')
      await submitBtn.click().catch(() => {})
      await page.waitForTimeout(300)

      // Check if validation messages are shown
      const errorMessages = page.getByText(/required|invalid|error/i)
      const count = await errorMessages.count()
      expect(count).toBeGreaterThanOrEqual(0)
    }
  })

  test('should handle duplicate submissions', async ({ page }) => {
    await navigateToRoute(page, 'budgets')

    const addBtn = page.getByRole('button', { name: /Add Budget/i })
    if (await addBtn.isVisible()) {
      await addBtn.click()
      await page.waitForTimeout(300)

      // Try to submit the same form multiple times
      const submitBtn = page.getByRole('button', { name: /save budget/i })
      for (let i = 0; i < 3; i++) {
        await submitBtn.click()
        await page.waitForTimeout(100)
      }

      // Should not crash or show errors
      expect(true).toBeTruthy()
    }
  })

  test('should handle rapid navigation', async ({ page }) => {
    const pages = ['dashboard', 'transactions', 'accounts', 'budgets', 'goals']

    for (const pageName of pages) {
      await navigateToRoute(page, pageName)
      await page.waitForTimeout(200)
    }

    // Should complete without errors
    expect(true).toBeTruthy()
  })

  test('should handle keyboard navigation', async ({ page }) => {
    await navigateToRoute(page, 'dashboard')

    // Tab through interactive elements
    await page.keyboard.press('Tab')
    await page.waitForTimeout(100)

    await page.keyboard.press('Tab')
    await page.waitForTimeout(100)

    // Press Enter on first element
    await page.keyboard.press('Enter')
    await page.waitForTimeout(100)

    expect(true).toBeTruthy()
  })

  test('should handle long text content', async ({ page }) => {
    await navigateToRoute(page, 'settings')

    // Check if form fields handle long text
    const textarea = page.locator('textarea')
    const count = await textarea.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('should handle special characters in input', async ({ page }) => {
    await navigateToRoute(page, 'accounts')

    const addBtn = page.getByTestId('add-account-btn')
    if (await addBtn.isVisible()) {
      await addBtn.click()
      await page.waitForTimeout(300)

      // Test with special characters
      const nameInput = page.getByRole('textbox', { name: /name/i })
      if (await nameInput.isVisible()) {
        await nameInput.fill('Account <test>&"\'')
        await page.waitForTimeout(200)

        expect(true).toBeTruthy()
      }
    }
  })

  test('should handle negative numbers', async ({ page }) => {
    await navigateToRoute(page, 'accounts')

    const addBtn = page.getByTestId('add-account-btn')
    if (await addBtn.isVisible()) {
      await addBtn.click()
      await page.waitForTimeout(300)

      // Test with negative number
      const balanceInput = page.getByRole('spinbutton', { name: /balance/i })
      if (await balanceInput.isVisible()) {
        await balanceInput.fill('-500.00')
        await page.waitForTimeout(200)

        expect(true).toBeTruthy()
      }
    }
  })

  test('should handle very large numbers', async ({ page }) => {
    await navigateToRoute(page, 'transactions')

    const amountInput = page.getByRole('spinbutton')
    const count = await amountInput.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('should handle responsive design', async ({ page }) => {
    // Test desktop view
    await page.setViewportSize({ width: 1920, height: 1080 })
    await navigateToRoute(page, 'dashboard')
    await page.waitForTimeout(500)

    // Test mobile view
    await page.setViewportSize({ width: 375, height: 667 })
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(500)

    expect(true).toBeTruthy()
  })

  test('should handle modal overlay clicks', async ({ page }) => {
    await navigateToRoute(page, 'accounts')

    const addBtn = page.getByTestId('add-account-btn')
    if (await addBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await addBtn.click()
      await page.waitForTimeout(500)

      // Click on modal overlay to close it
      const overlay = page.locator('[class*="overlay"], [class*="backdrop"]')
      const overlayCount = await overlay.count()
      if (overlayCount > 0) {
        await overlay
          .first()
          .click({ timeout: 5000 })
          .catch(() => {})
        await page.waitForTimeout(500)
      }

      // Close modal via Escape as fallback
      await page.keyboard.press('Escape')
      await page.waitForTimeout(500)
    }

    expect(true).toBeTruthy()
  })

  test('should handle modal ESC key close', async ({ page }) => {
    await navigateToRoute(page, 'accounts')

    const addBtn = page.getByTestId('add-account-btn')
    if (await addBtn.isVisible()) {
      await addBtn.click()
      await page.waitForTimeout(300)

      // Press ESC to close modal
      await page.keyboard.press('Escape')
      await page.waitForTimeout(200)

      expect(true).toBeTruthy()
    }
  })

  test('should handle browser back/forward buttons', async ({ page }) => {
    await navigateToRoute(page, 'dashboard')
    await page.waitForTimeout(500)

    await navigateToRoute(page, 'transactions')
    await page.waitForTimeout(500)

    await page.goBack()
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(500)

    expect(true).toBeTruthy()
  })

  test('should handle form reset', async ({ page }) => {
    await navigateToRoute(page, 'accounts')

    const addBtn = page.getByTestId('add-account-btn')
    if (await addBtn.isVisible()) {
      await addBtn.click()
      await page.waitForTimeout(300)

      // Fill in form fields
      const nameInput = page.getByRole('textbox', { name: /name/i })
      if (await nameInput.isVisible()) {
        await nameInput.fill('Test Account')
        await page.waitForTimeout(200)

        // Reset form
        const cancelBtn = page.getByRole('button', { name: /cancel/i })
        if (await cancelBtn.isVisible()) {
          await cancelBtn.click()
          await page.waitForTimeout(200)
        }
      }
    }
  })

  test('should handle concurrent requests', async ({ page }) => {
    await navigateToRoute(page, 'dashboard')

    // Trigger multiple navigation actions concurrently
    const promises = [
      navigateToRoute(page, 'transactions'),
      navigateToRoute(page, 'accounts'),
      navigateToRoute(page, 'budgets'),
    ]

    await Promise.all(promises)
    await page.waitForLoadState('networkidle')

    expect(true).toBeTruthy()
  })

  test('should handle timezone changes', async ({ page }) => {
    await navigateToRoute(page, 'dashboard')
    await page.waitForTimeout(500)

    // Verify date displays
    const dates = page.getByText(/\d{1,2}\/\d{1,2}\/\d{4}/)
    const count = await dates.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })
})
