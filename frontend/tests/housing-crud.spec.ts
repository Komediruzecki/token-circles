import { expect, test } from '@playwright/test'
import { login, navigateToRoute, getByTestId } from './test-helpers'

test.describe('Housing CRUD Operations', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await navigateToRoute(page, 'housing')
  })

  test('should display housing header', async ({ page }) => {
    const header = getByTestId(page, 'housing-header')
    await expect(header).toBeVisible()
  })

  test('should have page subtitle', async ({ page }) => {
    const subtitle = getByTestId(page, 'housing-subtitle')
    const text = await subtitle.textContent()
    expect(text).toMatch(/Track housing|expenses/i)
  })

  test('should have add expense button', async ({ page }) => {
    const addBtn = getByTestId(page, 'add-housing-expense-btn')
    const isVisible = await addBtn.isVisible({ timeout: 3000 }).catch(() => false)
    expect(isVisible).toBeTruthy()
  })

  test('should handle errors gracefully', async ({ page }) => {
    const errors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        errors.push(msg.text())
      }
    })

    page.on('pageerror', (error) => {
      errors.push(error.message)
    })

    await navigateToRoute(page, 'housing')
    await page.waitForTimeout(500)

    const criticalErrors = errors.filter(
      (msg) => msg.includes('Error') && !msg.includes('Failed to fetch')
    )
    expect(criticalErrors.length).toBeLessThan(3)
  })

  test('should display loading state', async ({ page }) => {
    await navigateToRoute(page, 'housing')
    await page.waitForTimeout(500)

    const loadingText = getByTestId(page, 'loading-state')
    const hasLoading = await loadingText.isVisible({ timeout: 2000 }).catch(() => false)
    expect(hasLoading).toBeTruthy()
  })
})
