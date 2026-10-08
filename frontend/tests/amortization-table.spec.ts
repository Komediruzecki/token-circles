import { expect, test } from '@playwright/test'
import { login, navigateToRoute } from './test-helpers'

test.describe('Loan Amortization Table', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await navigateToRoute(page, 'loans')
  })

  test('should display the amortization schedule on the Month by month tab', async ({ page }) => {
    // The relayout moved the schedule from a panel under the card to the loan's own page: its
    // name opens the Month by month tab, still wrapped in the `loans-amortization` container.
    const name = page.getByTestId('loans-item-name').first()
    await expect(name).toBeVisible({ timeout: 10000 })
    await name.click()
    await expect(page.getByTestId('loans-tab-schedule')).toHaveAttribute('aria-selected', 'true')

    const amortization = page.getByTestId('loans-amortization')
    await expect(amortization).toBeVisible({ timeout: 10000 })
    // The summary line is the point of the copy assertion, so matching its words is correct.
    const summary = amortization.getByTestId('loans-schedule-summary')
    await expect(summary).toContainText(/\d+ payments, the last on/)
    await expect(summary).toContainText('Interest in all')
    await expect(amortization.getByTestId('loans-schedule-export')).toBeVisible()

    // The schedule itself: one row per payment of the seeded 60-month loan.
    await expect(amortization.getByTestId('loans-schedule-table')).toBeVisible()
    await expect(amortization.getByTestId('loans-schedule-row')).toHaveCount(60)
  })
})
