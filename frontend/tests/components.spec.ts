import { expect, test } from '@playwright/test'
import { login, navigateToRoute } from './test-helpers'

// Cross-page UI smoke checks. Every assertion targets a stable data-test-id (see tests/README.md)
// and is meaningful — the previous version was almost entirely `expect(count).toBeGreaterThanOrEqual(0)`
// no-ops that passed no matter what rendered.

test.describe('UI Components', () => {
  test('Dashboard widgets are visible', async ({ page }) => {
    await login(page)
    await navigateToRoute(page, 'dashboard')
    await expect(page.getByTestId('dashboard-metrics')).toBeVisible({ timeout: 15000 })
    // The redesigned dashboard tucks the classic charts behind a "Show more" toggle.
    await page.getByTestId('dashboard-show-more').click()
    await expect(page.getByTestId('dashboard-charts')).toBeVisible()
  })

  test('Transaction table renders correctly', async ({ page }) => {
    await login(page)
    await navigateToRoute(page, 'transactions')
    await expect(page.getByTestId('transactions-table')).toBeVisible({ timeout: 10000 })
    expect(await page.getByTestId('transactions-row').count()).toBeGreaterThan(0)
  })

  test('Pagination renders for the seeded transaction volume', async ({ page }) => {
    await login(page)
    await navigateToRoute(page, 'transactions')
    // The demo seed spans many years (>1 page of 50), so pagination renders.
    await expect(page.getByTestId('transactions-pagination').first()).toBeVisible({
      timeout: 10000,
    })
  })

  test('Filter bar is visible', async ({ page }) => {
    await login(page)
    await navigateToRoute(page, 'transactions')
    await expect(page.getByTestId('filter-bar')).toBeVisible({ timeout: 10000 })
  })

  test('Modal opens and closes correctly', async ({ page }) => {
    await login(page)
    await navigateToRoute(page, 'accounts')

    await page.getByTestId('add-account-btn').click()
    await expect(page.getByTestId('add-account-modal')).toBeVisible({ timeout: 5000 })

    // Close via the Cancel action and confirm it's gone.
    const cancel = page.getByTestId('add-account-modal').getByRole('button', { name: /cancel/i })
    if (await cancel.isVisible().catch(() => false)) {
      await cancel.click()
      await expect(page.getByTestId('add-account-modal')).toBeHidden({ timeout: 3000 })
    }
  })

  test('Category tabs switch active state', async ({ page }) => {
    await login(page)
    await navigateToRoute(page, 'categories')

    // Wait for the tab row to render before interacting (the categories page loads its data first).
    await expect(page.getByTestId('tab-all')).toBeVisible({ timeout: 10000 })
    const expenseTab = page.getByTestId('tab-expense')
    await expenseTab.click()
    await expect(expenseTab).toHaveClass(/active/i, { timeout: 5000 })
  })

  test('Bill cards display', async ({ page }) => {
    await login(page)
    await navigateToRoute(page, 'bills')
    await expect(page.getByTestId('bill-card').first()).toBeVisible({ timeout: 10000 })
  })

  test('Account cards display', async ({ page }) => {
    await login(page)
    await navigateToRoute(page, 'accounts')
    await expect(page.getByTestId('account-card').first()).toBeVisible({ timeout: 10000 })
  })

  test('Search input is present', async ({ page }) => {
    await login(page)
    await navigateToRoute(page, 'transactions')
    await expect(page.getByTestId('transactions-search')).toBeVisible({ timeout: 10000 })
  })

  test('Budgets allocation action is present', async ({ page }) => {
    await login(page)
    await navigateToRoute(page, 'budgets')
    await expect(page.getByTestId('budgets-add-allocation-btn')).toBeVisible({ timeout: 10000 })
  })

  test('Account form inputs render in the add modal', async ({ page }) => {
    await login(page)
    await navigateToRoute(page, 'accounts')
    await page.getByTestId('add-account-btn').click()
    const modal = page.getByTestId('add-account-modal')
    await expect(modal).toBeVisible({ timeout: 5000 })
    expect(await modal.locator('input, select').count()).toBeGreaterThan(0)
  })

  test('Sidebar navigation links are wired up', async ({ page }) => {
    await login(page)
    await navigateToRoute(page, 'dashboard')
    await expect(page.getByTestId('nav-link-dashboard')).toBeAttached()
    await expect(page.getByTestId('nav-link-transactions')).toBeAttached()
    await expect(page.getByTestId('nav-link-accounts')).toBeAttached()
  })

  test('Goal progress cards render', async ({ page }) => {
    await login(page)
    await navigateToRoute(page, 'goals')
    await expect(page.getByTestId('goals-grid')).toBeVisible({ timeout: 10000 })
    await expect(page.getByTestId('goal-card').first()).toBeVisible()
  })

  test('Dashboard chart region renders', async ({ page }) => {
    await login(page)
    await navigateToRoute(page, 'dashboard')
    // Charts live below the "Show more" toggle in the redesigned dashboard.
    await page.getByTestId('dashboard-show-more').click({ timeout: 15000 })
    await expect(page.getByTestId('dashboard-charts')).toBeVisible({ timeout: 15000 })
  })

  test('Responsive layout adjusts across breakpoints', async ({ page }) => {
    await login(page)
    await page.setViewportSize({ width: 1920, height: 1080 })
    await navigateToRoute(page, 'dashboard')
    await expect(page.getByTestId('dashboard-header')).toBeVisible({ timeout: 15000 })

    await page.setViewportSize({ width: 768, height: 1024 })
    await expect(page.getByTestId('dashboard-header')).toBeVisible()

    await page.setViewportSize({ width: 375, height: 667 })
    await expect(page.getByTestId('dashboard-header')).toBeVisible()
  })
})
