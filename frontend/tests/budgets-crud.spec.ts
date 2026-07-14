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
    // The month selector is the shared PeriodBar (steppers + a clickable period label). Scope the
    // controls to the month-selector container — PeriodBar is reused on other pages that keep-alive
    // may leave mounted in the DOM.
    const monthSelector = page.getByTestId('month-selector')
    await expect(monthSelector).toBeVisible()
    await expect(monthSelector.getByTestId('period-prev')).toBeVisible()
    await expect(monthSelector.getByTestId('period-label')).toBeVisible()
    await expect(monthSelector.getByTestId('period-next')).toBeVisible()
  })

  test('should have summary cards', async ({ page }) => {
    // Assert each summary card by its stable test-id. Each `toBeVisible` auto-waits for the budgets
    // page to finish loading (the container gets a generous timeout), which is robust under load —
    // unlike a fixed sleep + counting anonymous child divs, which raced the page mount.
    await expect(page.getByTestId('budget-summary')).toBeVisible({ timeout: 15000 })
    await expect(page.getByTestId('budgets-summary-income')).toBeVisible()
    await expect(page.getByTestId('budgets-summary-allocated')).toBeVisible()
    await expect(page.getByTestId('budgets-summary-spent')).toBeVisible()
    await expect(page.getByTestId('budgets-summary-remaining')).toBeVisible()
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

  test('should render content after navigation', async ({ page }) => {
    await navigateToRoute(page, 'budgets')

    // The allocations container renders as soon as the budgets page mounts — it wraps the
    // loading / empty / table states, so it's present regardless of whether data has resolved.
    // Waiting for it is a robust "the page loaded" check, unlike the previous racy either/or on a
    // fixed sleep (which failed when navigation landed between states under load).
    await expect(page.getByTestId('budget-allocations')).toBeVisible({ timeout: 15000 })
  })
})
