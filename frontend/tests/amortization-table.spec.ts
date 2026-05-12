import { expect, test } from '@playwright/test'
import { login, navigateToRoute } from './test-helpers'

test.describe('Loan Amortization Table', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await navigateToRoute(page, 'loans')
  })

  test('should display amortization schedule when clicking View Amortization', async ({ page }) => {
    // Find and click the first "View Amortization" button
    const amortBtn = page.locator('[title="View Amortization"]').first()
    await expect(amortBtn).toBeVisible({ timeout: 10000 })
    await amortBtn.click()

    // Wait for API call and render - Total Paid summary card should appear
    await expect(page.getByText('Total Paid')).toBeVisible({ timeout: 10000 })

    // Verify summary cards show data
    await expect(page.getByText('Total Interest')).toBeVisible()
    await expect(page.getByText('Payoff Date')).toBeVisible()

    // Verify the amortization schedule table is rendered
    await expect(page.locator(`[class*="amortTable"] table`)).toBeVisible()
  })
})
