import { expect, test } from '@playwright/test'
import { login, navigateToRoute } from './test-helpers'

// Structural assertions target stable `data-test-id` hooks, never user-visible copy. See
// tests/README.md and the Loans ids in src/features/Loans.tsx. The demo profile
// (Example Low Income) seeds one loan, so loan-card assertions can be meaningful rather than
// tolerant `>= 0` no-ops.
test.describe('Loans', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await navigateToRoute(page, 'loans')
  })

  test('should display loans header', async ({ page }) => {
    await expect(page.getByTestId('loans-header')).toBeVisible()
  })

  test('should have page subtitle', async ({ page }) => {
    await expect(page.getByTestId('loans-subtitle')).toBeVisible()
  })

  test('should have add loan button', async ({ page }) => {
    await expect(page.getByTestId('add-loan-btn')).toBeVisible()
  })

  test('should display loans summary cards', async ({ page }) => {
    // The four summary cards render unconditionally, independent of loan data.
    await expect(page.getByTestId('loans-summary')).toBeVisible()
    await expect(page.getByTestId('loans-summary-card')).toHaveCount(4)
  })

  test('should display loan cards', async ({ page }) => {
    await expect(page.getByTestId('loans-list')).toBeVisible()
    await expect(page.getByTestId('loans-item').first()).toBeVisible({ timeout: 10000 })
  })

  test('should display loan name', async ({ page }) => {
    await expect(page.getByTestId('loans-item-name').first()).toBeVisible({ timeout: 10000 })
  })

  test('should display loan principal', async ({ page }) => {
    const principal = page.getByTestId('loans-item-principal').first()
    await expect(principal).toBeVisible({ timeout: 10000 })
    await expect(principal).toHaveText(/\d/) // a formatted money amount, currency-agnostic
  })

  test('should display loan remaining balance', async ({ page }) => {
    const remaining = page.getByTestId('loans-item-remaining').first()
    await expect(remaining).toBeVisible({ timeout: 10000 })
    await expect(remaining).toHaveText(/\d/)
  })

  test('should display loan interest rate', async ({ page }) => {
    const rate = page.getByTestId('loans-item-rate').first()
    await expect(rate).toBeVisible({ timeout: 10000 })
    await expect(rate).toHaveText(/%/) // component renders `<rate>%`
  })

  test('should display loan monthly payment', async ({ page }) => {
    const monthly = page.getByTestId('loans-item-monthly').first()
    await expect(monthly).toBeVisible({ timeout: 10000 })
    await expect(monthly).toHaveText(/\d/)
  })

  test('should display loan status badges', async ({ page }) => {
    await expect(page.getByTestId('loans-item-status').first()).toBeVisible({ timeout: 10000 })
  })

  test('should display loan progress bar', async ({ page }) => {
    await expect(page.getByTestId('loans-item-progress').first()).toBeVisible({ timeout: 10000 })
  })

  test('should display loan progress percentage', async ({ page }) => {
    const percent = page.getByTestId('loans-item-progress-percent').first()
    await expect(percent).toBeVisible({ timeout: 10000 })
    await expect(percent).toHaveText(/%/)
  })

  test('should display loan total paid', async ({ page }) => {
    await expect(page.getByTestId('loans-item-total-paid').first()).toBeVisible({ timeout: 10000 })
  })

  test('should have loan edit/delete buttons', async ({ page }) => {
    await expect(page.getByTestId('loans-item-edit').first()).toBeVisible({ timeout: 10000 })
    await expect(page.getByTestId('loans-item-delete').first()).toBeVisible()
  })

  test('should display loan amortization chart', async ({ page }) => {
    // The "Loan Overview" charts section renders whenever at least one loan exists.
    await expect(page.getByTestId('loans-charts')).toBeVisible({ timeout: 10000 })
  })

  test('should display loan detail rows', async ({ page }) => {
    await expect(page.getByTestId('loans-item-details').first()).toBeVisible({ timeout: 10000 })
  })

  test('should have add loan modal', async ({ page }) => {
    await page.getByTestId('add-loan-btn').click()
    await expect(page.getByTestId('loans-modal')).toBeVisible()
  })

  test('should display loan start date', async ({ page }) => {
    // The loan card does not surface the start date; the Add/Edit form is where it is exposed.
    await page.getByTestId('add-loan-btn').click()
    await expect(page.getByTestId('loans-modal')).toBeVisible()
    await expect(page.getByTestId('loans-form-start-date')).toBeVisible()
  })

  test('should display loan term', async ({ page }) => {
    // Term is exposed by the Add/Edit form rather than the loan card.
    await page.getByTestId('add-loan-btn').click()
    await expect(page.getByTestId('loans-modal')).toBeVisible()
    await expect(page.getByTestId('loans-form-term')).toBeVisible()
  })

  test('should have prepayment option', async ({ page }) => {
    await expect(page.getByTestId('loans-prepay-btn').first()).toBeVisible({ timeout: 10000 })
  })
})
