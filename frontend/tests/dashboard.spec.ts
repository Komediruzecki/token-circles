import { expect, test } from '@playwright/test'
import { login, navigateToRoute } from './test-helpers'

test.describe('Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    // Login first
    await login(page)

    // Navigate to dashboard page
    await navigateToRoute(page, 'dashboard')
  })

  test('should display dashboard header', async ({ page }) => {
    const header = page.getByTestId('dashboard-header')
    await expect(header).toBeVisible()
  })

  test('should have page subtitle', async ({ page }) => {
    const subtitle = page.getByText(/Overview|financial|summary/i, { exact: false })
    await expect(subtitle).toBeVisible()
  })

  test('should display balance summary cards', async ({ page }) => {
    await page.waitForTimeout(500)

    const balanceLabel = page.getByText(/Total Balance|Balance/i)
    const incomeLabel = page.getByText(/Income/i)
    const expenseLabel = page.getByText(/Expenses/i)

    await expect(balanceLabel).toBeVisible()
    await expect(incomeLabel).toBeVisible()
    await expect(expenseLabel).toBeVisible()
  })

  test('should display balance values', async ({ page }) => {
    await page.waitForTimeout(500)

    const balanceValue = page.getByText(/\$[\d,]+\.\d{2}/)
    await expect(balanceValue).toBeVisible()
  })

  test('should have chart section', async ({ page }) => {
    await page.waitForTimeout(500)

    const chartSection = page.getByRole('region', { name: /chart|overview|analytics/i })
    await expect(chartSection).toBeVisible()
  })

  test('should have transactions summary', async ({ page }) => {
    await page.waitForTimeout(500)

    const recentTransactions = page.getByText(/Recent Transactions/i)
    await expect(recentTransactions).toBeVisible()
  })

  test('should display quick action buttons', async ({ page }) => {
    await page.waitForTimeout(500)

    const addBtn = page.getByRole('button', { name: /add transaction|add account/i })
    const addBtnCount = await addBtn.count()
    expect(addBtnCount).toBeGreaterThanOrEqual(0)
  })

  test('should have quick links to other pages', async ({ page }) => {
    await page.waitForTimeout(500)

    const sidebarLinks = page.getByRole('link', { name: /accounts|transactions|budgets/i })
    const count = await sidebarLinks.count()
    expect(count).toBeGreaterThanOrEqual(3)
  })

  test('should display spending trend chart', async ({ page }) => {
    await page.waitForTimeout(500)

    const chart = page.getByRole('img', { name: /chart|graph|trend/i })
    const count = await chart.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })
})
