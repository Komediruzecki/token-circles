import { expect, test } from '@playwright/test'
import { login, navigateToRoute, getByTestId } from './test-helpers'

test.describe('Categories CRUD Operations', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await navigateToRoute(page, 'categories')
  })

  test('should display categories header', async ({ page }) => {
    const header = getByTestId(page, 'categories-header')
    await expect(header).toBeVisible()
  })

  test('should have page subtitle', async ({ page }) => {
    const subtitle = getByTestId(page, 'categories-subtitle')
    const text = await subtitle.textContent()
    expect(text).toMatch(/organize.*transactions|expense and income/i)
  })

  test('should have new category button', async ({ page }) => {
    const addBtn = getByTestId(page, 'add-category-btn')
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

    await navigateToRoute(page, 'categories')
    await page.waitForTimeout(500)

    const criticalErrors = errors.filter(
      (msg) => msg.includes('Error') && !msg.includes('Failed to fetch')
    )
    expect(criticalErrors.length).toBeLessThan(3)
  })

  test('should display loading state', async ({ page }) => {
    await navigateToRoute(page, 'categories')
    await page.waitForTimeout(500)

    const loadingText = getByTestId(page, 'loading-state')
    const hasLoading = await loadingText.isVisible({ timeout: 2000 }).catch(() => false)
    expect(hasLoading).toBeTruthy()
  })
})
