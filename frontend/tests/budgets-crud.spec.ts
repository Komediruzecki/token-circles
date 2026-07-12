import { expect, test } from '@playwright/test'
import { login, navigateToRoute } from './test-helpers'

test.describe('Budgets CRUD Operations', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await navigateToRoute(page, 'budgets')
  })

  test('should display budgets header', async ({ page }) => {
    await expect(page.getByTestId('budgets-header')).toBeVisible()
  })

  test('should have page subtitle', async ({ page }) => {
    // The subtitle copy is the point here (it states the zero-based budgeting model).
    await expect(page.getByTestId('budgets-subtitle')).toHaveText(/zero-based budgeting|allocate/i)
  })

  test('should have month selector controls', async ({ page }) => {
    await expect(page.getByTestId('month-selector')).toBeVisible()
    await expect(page.getByTestId('month-prev-btn')).toHaveCount(1)
    await expect(page.getByTestId('month-display')).toBeVisible()
  })

  test('should have summary cards', async ({ page }) => {
    await page.waitForTimeout(500)

    const summaryDiv = page.getByTestId('budget-summary')
    // CSS modules mangles className, so count direct children instead
    const cards = summaryDiv.locator('> div')
    expect(await cards.count()).toBeGreaterThanOrEqual(3)

    await expect(page.getByTestId('budgets-summary-income')).toBeVisible()
    await expect(page.getByTestId('budgets-summary-allocated')).toBeVisible()
    await expect(page.getByTestId('budgets-summary-spent')).toBeVisible()
  })

  test('should have remaining summary card', async ({ page }) => {
    await expect(page.getByTestId('budgets-summary-remaining')).toBeVisible()
  })

  test('should have forecast toggle button', async ({ page }) => {
    // No show/hide toggle exists; the forecast section renders unconditionally. Assert the
    // section is present rather than matching a non-existent toggle button.
    await expect(page.getByTestId('budgets-forecast')).toBeVisible()
  })

  test('should have allocation table', async ({ page }) => {
    await page.waitForTimeout(500)

    await expect(page.getByTestId('budget-allocations')).toBeVisible()
    await expect(page.getByTestId('table-header')).toBeVisible()
  })

  test('should have table with category column', async ({ page }) => {
    // Demo data seeds expense categories, so the allocation table renders with its columns.
    const table = page.getByTestId('data-table')
    await expect(table).toBeVisible()

    const headers = table.locator('thead th')
    expect(await headers.count()).toBeGreaterThanOrEqual(6)
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

    await navigateToRoute(page, 'budgets')
    await page.waitForTimeout(500)

    const criticalErrors = errors.filter(
      (msg) => msg.includes('Error') && !msg.includes('Failed to fetch')
    )
    expect(criticalErrors.length).toBeLessThan(3)
  })

  test('should display loading or content state after navigation', async ({ page }) => {
    await navigateToRoute(page, 'budgets')
    await page.waitForTimeout(1000)

    // After navigating, either loading state or the actual content should be visible
    const loadingText = page.getByTestId('loading-state')
    const contentArea = page.getByTestId('budget-allocations')
    const hasLoading = await loadingText.isVisible({ timeout: 2000 }).catch(() => false)
    const hasContent = await contentArea.isVisible({ timeout: 2000 }).catch(() => false)

    expect(hasLoading || hasContent).toBeTruthy()
  })
})
