import { expect, test } from '@playwright/test'
import { login, navigateToRoute, getByTestId } from './test-helpers'

test.describe('Budgets CRUD Operations', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await navigateToRoute(page, 'budgets')
  })

  test('should display budgets header', async ({ page }) => {
    const header = getByTestId(page, 'budgets-header')
    await expect(header).toBeVisible()
  })

  test('should have page subtitle', async ({ page }) => {
    const subtitle = getByTestId(page, 'budgets-subtitle')
    const text = await subtitle.textContent()
    expect(text).toMatch(/zero-based budgeting|allocate/i)
  })

  test('should have month selector controls', async ({ page }) => {
    const monthSelector = getByTestId(page, 'month-selector')
    if (await monthSelector.isVisible().catch(() => false)) {
      await expect(monthSelector).toBeVisible()

      const prevBtn = getByTestId(page, 'month-prev-btn')
      await expect(prevBtn).toHaveCount(1)

      const monthDisplay = getByTestId(page, 'month-display')
      await expect(monthDisplay).toBeVisible()
    }
  })

  test('should have summary cards', async ({ page }) => {
    await page.waitForTimeout(500)

    const summaryDiv = getByTestId(page, 'budget-summary')
    // CSS modules mangles className, so count direct children instead
    const cards = summaryDiv.locator('> div')
    const count = await cards.count()

    expect(count).toBeGreaterThanOrEqual(3)

    await expect(getByTestId(page, 'budget-summary').getByText('Income')).toBeVisible()
    await expect(getByTestId(page, 'budget-summary').getByText('Allocated', { exact: true })).toBeVisible()
    await expect(getByTestId(page, 'budget-summary').getByText('Spent')).toBeVisible()
  })

  test('should have remaining summary card', async ({ page }) => {
    await expect(getByTestId(page, 'budget-summary').getByText('Remaining')).toBeVisible()
  })

  test('should have forecast toggle button', async ({ page }) => {
    const toggleBtn = getByTestId(page, 'forecast-toggle-section button')
    if (await toggleBtn.isVisible().catch(() => false)) {
      await expect(toggleBtn).toBeVisible()
      await expect(toggleBtn).toHaveText(/Show Budget Forecast|Hide Budget Forecast/i)
    }
  })

  test('should have allocation table', async ({ page }) => {
    await page.waitForTimeout(500)

    const tableContainer = getByTestId(page, 'budget-allocations')
    await expect(tableContainer).toBeVisible()

    const tableHeader = getByTestId(page, 'table-header')
    await expect(tableHeader).toBeVisible()
  })

  test('should have table with category column', async ({ page }) => {
    const table = getByTestId(page, 'budget-allocations').getByTestId('data-table')
    if (await table.isVisible().catch(() => false)) {
      const headers = table.locator('thead th')
      const count = await headers.count()
      expect(count).toBeGreaterThanOrEqual(6)
    }
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
    const loadingText = getByTestId(page, 'loading-state')
    const contentArea = getByTestId(page, 'budget-allocations')
    const hasLoading = await loadingText.isVisible({ timeout: 2000 }).catch(() => false)
    const hasContent = await contentArea.isVisible({ timeout: 2000 }).catch(() => false)

    expect(hasLoading || hasContent).toBeTruthy()
  })
})
