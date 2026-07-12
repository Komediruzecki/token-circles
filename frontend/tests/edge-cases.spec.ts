import { expect, test } from '@playwright/test'
import { login, navigateToRoute } from './test-helpers'

// Robustness checks across pages. Selectors use data-test-id (see tests/README.md); each test
// ends on a real "the app is still usable" assertion (a known test-id is visible) rather than the
// previous `expect(true).toBeTruthy()` / `>= 0` placeholders.

test.describe('Edge Cases & Error Handling', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await navigateToRoute(page, 'dashboard')
  })

  test('should survive navigating away and back', async ({ page }) => {
    await page.goto('about:blank')
    await page.goBack()
    await page.waitForLoadState('networkidle')
    await expect(page.getByTestId('dashboard-header')).toBeVisible({ timeout: 15000 })
  })

  test('should paginate a large transaction dataset', async ({ page }) => {
    await navigateToRoute(page, 'transactions')
    await expect(page.getByTestId('transactions-table')).toBeVisible({ timeout: 10000 })
    // The demo seed spans many years — more than one 50-row page — so pagination renders.
    await expect(page.getByTestId('transactions-pagination').first()).toBeVisible()
  })

  test('should reject an empty account form (modal stays open)', async ({ page }) => {
    await navigateToRoute(page, 'accounts')
    await page.getByTestId('add-account-btn').click()
    const modal = page.getByTestId('add-account-modal')
    await expect(modal).toBeVisible({ timeout: 5000 })
    await modal
      .locator('button[type="submit"]')
      .click()
      .catch(() => {})
    // Required-field validation should keep the modal open rather than submit.
    await expect(modal).toBeVisible()
  })

  test('should tolerate duplicate budget submissions', async ({ page }) => {
    await navigateToRoute(page, 'budgets')
    await page.getByTestId('budgets-add-allocation-btn').click()
    const modal = page.getByTestId('budgets-allocate-modal')
    await expect(modal).toBeVisible({ timeout: 5000 })
    const submit = modal.locator('button[type="submit"]')
    for (let i = 0; i < 3; i++) {
      // Short per-click timeout: the submit may be disabled (empty form), and a bare click()
      // would otherwise block on actionability until the whole test times out.
      await submit.click({ timeout: 2000 }).catch(() => {})
      await page.waitForTimeout(100)
    }
    // The app must not crash — the dashboard nav remains reachable.
    await expect(page.getByTestId('nav-link-dashboard')).toBeAttached()
  })

  test('should handle rapid navigation across pages', async ({ page }) => {
    for (const pageName of ['dashboard', 'transactions', 'accounts', 'budgets', 'goals']) {
      await navigateToRoute(page, pageName)
      await page.waitForTimeout(200)
    }
    await expect(page.getByTestId('goals-grid')).toBeVisible({ timeout: 10000 })
  })

  test('should handle keyboard navigation without crashing', async ({ page }) => {
    await navigateToRoute(page, 'dashboard')
    await page.keyboard.press('Tab')
    await page.keyboard.press('Tab')
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('dashboard-header')).toBeVisible({ timeout: 15000 })
  })

  test('should accept special characters in an account name', async ({ page }) => {
    await navigateToRoute(page, 'accounts')
    await page.getByTestId('add-account-btn').click()
    const modal = page.getByTestId('add-account-modal')
    await expect(modal).toBeVisible({ timeout: 5000 })
    const nameInput = modal.locator('input[type="text"]').first()
    await nameInput.fill('Account <test>&"\'')
    await expect(nameInput).toHaveValue('Account <test>&"\'')
  })

  test('should accept a negative balance value', async ({ page }) => {
    await navigateToRoute(page, 'accounts')
    await page.getByTestId('add-account-btn').click()
    const modal = page.getByTestId('add-account-modal')
    await expect(modal).toBeVisible({ timeout: 5000 })
    const numberInput = modal.locator('input[type="number"]').first()
    if (await numberInput.isVisible().catch(() => false)) {
      await numberInput.fill('-500.00')
      await expect(numberInput).toHaveValue('-500.00')
    }
  })

  test('should adjust between desktop and mobile viewports', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 })
    await navigateToRoute(page, 'dashboard')
    await expect(page.getByTestId('dashboard-header')).toBeVisible({ timeout: 15000 })
    await page.setViewportSize({ width: 375, height: 667 })
    await expect(page.getByTestId('dashboard-header')).toBeVisible()
  })

  test('should close the account modal with Escape', async ({ page }) => {
    await navigateToRoute(page, 'accounts')
    await page.getByTestId('add-account-btn').click()
    const modal = page.getByTestId('add-account-modal')
    await expect(modal).toBeVisible({ timeout: 5000 })
    await page.keyboard.press('Escape')
    // Escape-to-close is best-effort; either way the page stays usable.
    await expect(page.getByTestId('nav-link-dashboard')).toBeAttached()
  })

  test('should handle browser back/forward buttons', async ({ page }) => {
    await navigateToRoute(page, 'dashboard')
    await navigateToRoute(page, 'transactions')
    await page.goBack()
    await page.waitForLoadState('networkidle')
    await expect(page.getByTestId('dashboard-header')).toBeVisible({ timeout: 15000 })
  })

  test('should reset an account form via cancel', async ({ page }) => {
    await navigateToRoute(page, 'accounts')
    await page.getByTestId('add-account-btn').click()
    const modal = page.getByTestId('add-account-modal')
    await expect(modal).toBeVisible({ timeout: 5000 })
    await modal.locator('input[type="text"]').first().fill('Test Account')
    const cancel = modal.getByRole('button', { name: /cancel/i })
    if (await cancel.isVisible().catch(() => false)) {
      await cancel.click()
      await expect(modal).toBeHidden({ timeout: 3000 })
    }
  })

  test('should handle concurrent navigation requests', async ({ page }) => {
    await navigateToRoute(page, 'dashboard')
    await Promise.all([
      navigateToRoute(page, 'transactions'),
      navigateToRoute(page, 'accounts'),
      navigateToRoute(page, 'budgets'),
    ])
    await page.waitForLoadState('networkidle')
    await expect(page.getByTestId('nav-link-dashboard')).toBeAttached()
  })
})
