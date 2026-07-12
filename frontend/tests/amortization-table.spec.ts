import { expect, test } from '@playwright/test'
import { login, navigateToRoute } from './test-helpers'

test.describe('Loan Amortization Table', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await navigateToRoute(page, 'loans')
  })

  test('should display amortization schedule when clicking View Amortization', async ({ page }) => {
    // Open the amortization view for the first seeded loan.
    const amortBtn = page.getByTestId('loans-amortization-btn').first()
    await expect(amortBtn).toBeVisible({ timeout: 10000 })
    await amortBtn.click()

    // The panel is rendered by LoanAmortizationTable — a component outside this migration's scope,
    // so it exposes no inner test-ids of its own. Loans.tsx wraps it in the `loans-amortization`
    // container, so scope these assertions under that hook instead of searching the whole page.
    // The summary-card labels are the point of the copy assertions, so matching text is correct.
    const amortization = page.getByTestId('loans-amortization')
    await expect(amortization).toBeVisible({ timeout: 10000 })
    await expect(amortization.getByText('Total Paid')).toBeVisible({ timeout: 10000 })
    await expect(amortization.getByText('Total Interest')).toBeVisible()
    await expect(amortization.getByText('Payoff Date')).toBeVisible()

    // The rendered amortization schedule table lives inside the same container.
    await expect(amortization.locator('table').first()).toBeVisible()
  })
})
