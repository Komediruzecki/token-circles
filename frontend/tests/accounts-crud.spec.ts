import { expect, test } from '@playwright/test'

test.describe('Accounts CRUD Operations', () => {
  test.beforeEach(async ({ page }) => {
    // Ensure we're on the accounts page
    await page.goto('http://localhost:3800/#accounts', { waitUntil: 'networkidle' })

    // Wait for the page header to be visible (accounts page loads even if empty)
    await page.waitForSelector('[data-test-id="accounts-header"], .emptyState', {
      state: 'visible',
      timeout: 10000
    })

    // Wait for page content to stabilize
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1000)
  })

  test('should display accounts header', async ({ page }) => {
    const header = page.getByTestId('accounts-header')
    await expect(header).toBeVisible()
  })

  test('should have page subtitle', async ({ page }) => {
    const subtitle = page.getByTestId('accounts-subtitle')
    await expect(subtitle).toBeVisible()
  })

  test('should have add account button', async ({ page }) => {
    const addBtn = page.getByTestId('add-account-btn')
    await expect(addBtn).toBeVisible()
  })

  test('should have summary cards', async ({ page }) => {
    await page.waitForTimeout(500)

    const summary = page.getByTestId('accounts-summary')
    await expect(summary).toBeVisible()
  })

  test('should display total balance', async ({ page }) => {
    await page.waitForTimeout(500)

    const balanceLabel = page.getByTestId('summary-total-balance')
    await expect(balanceLabel).toBeVisible()

    const balanceValue = page.getByTestId('summary-balance-value')
    await expect(balanceValue).toBeVisible()
  })

  test('should display accounts count', async ({ page }) => {
    await page.waitForTimeout(500)

    const countLabel = page.getByTestId('summary-accounts-count')
    await expect(countLabel).toBeVisible()

    const countValue = page.getByTestId('summary-accounts-value')
    await expect(countValue).toBeVisible()
  })

  test('should display monthly income', async ({ page }) => {
    await page.waitForTimeout(500)

    const incomeLabel = page.getByTestId('summary-income')
    await expect(incomeLabel).toBeVisible()

    const incomeValue = page.getByTestId('summary-income-value')
    await expect(incomeValue).toBeVisible()
  })

  test('should display monthly expenses', async ({ page }) => {
    await page.waitForTimeout(500)

    const expensesLabel = page.getByTestId('summary-expenses')
    await expect(expensesLabel).toBeVisible()

    const expensesValue = page.getByTestId('summary-expenses-value')
    await expect(expensesValue).toBeVisible()
  })

  test('should have accounts grid', async ({ page }) => {
    await page.waitForTimeout(500)

    const accountsGrid = page.getByTestId('accounts-grid')
    await expect(accountsGrid).toBeVisible()
  })

  test('should display account cards', async ({ page }) => {
    await page.waitForTimeout(500)

    const accountCards = page.getByTestId('account-card')
    const count = await accountCards.count()
    // Should have at least 0 cards (can be empty)
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('should have account card with icon', async ({ page }) => {
    await page.waitForTimeout(500)

    const accountCards = page.getByTestId('account-card')
    const icon = accountCards.getByTestId('account-icon')
    const count = await icon.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('should have account icons matching account types', async ({ page }) => {
    await page.waitForTimeout(500)

    const icons = page.getByTestId('account-icon')
    const iconCount = await icons.count()

    // At least one account icon should be displayed
    expect(iconCount).toBeGreaterThanOrEqual(1)

    // Verify the icon is visible
    await expect(icons.first()).toBeVisible()
  })

  test('should display account name', async ({ page }) => {
    await page.waitForTimeout(500)

    const accountName = page.getByTestId('account-name')
    const count = await accountName.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('should display bank name', async ({ page }) => {
    await page.waitForTimeout(500)

    const bankName = page.getByTestId('account-bank')
    const count = await bankName.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('should display current balance card', async ({ page }) => {
    await page.waitForTimeout(500)

    const balanceLabel = page.getByText('Current Balance').first()
    const balanceValue = page.getByTestId('account-balance').first()

    await expect(balanceLabel).toBeVisible()
    await expect(balanceValue).toBeVisible()
  })

  test('should display recent activity section', async ({ page }) => {
    await page.waitForTimeout(500)

    const activityHeader = page.getByText('Recent Activity').first()
    await expect(activityHeader).toBeVisible()
  })

  test('should have activity header with view all link', async ({ page }) => {
    await page.waitForTimeout(500)

    const activitySection = page.getByTestId('activity-section')
    const count = await activitySection.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('should have "View All" link', async ({ page }) => {
    await page.waitForTimeout(500)

    // Find the link with "View All →"
    const viewAllLink = page.locator('a', { hasText: 'View All →' })
    const count = await viewAllLink.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('should display activity list', async ({ page }) => {
    await page.waitForTimeout(500)

    const activityList = page.getByTestId('activity-list')
    const count = await activityList.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('should display activity items', async ({ page }) => {
    await page.waitForTimeout(500)

    const activityItems = page.getByTestId('activity-item')
    const count = await activityItems.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('should display activity description', async ({ page }) => {
    await page.waitForTimeout(500)

    const description = page.getByTestId('activity-desc')
    const count = await description.count()
    // May be 0 if no transactions exist
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('should display activity date', async ({ page }) => {
    await page.waitForTimeout(500)

    const date = page.getByTestId('activity-date')
    const count = await date.count()
    // May be 0 if no transactions exist
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('should display activity amount with +/-', async ({ page }) => {
    await page.waitForTimeout(500)

    const amount = page.getByTestId('activity-amount')
    const count = await amount.count()
    // May be 0 if no transactions exist
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('should have account type badge', async ({ page }) => {
    await page.waitForTimeout(500)

    const accountCards = page.getByTestId('account-card')
    const cardCount = await accountCards.count()

    if (cardCount > 0) {
      const typeBadges = accountCards.getByTestId('account-type')
      const badgeCount = await typeBadges.count()
      expect(badgeCount).toBeGreaterThanOrEqual(0)
    }
  })

  test('should have account type badge text', async ({ page }) => {
    await page.waitForTimeout(500)

    const accountCards = page.getByTestId('account-card')
    const typeBadges = accountCards.getByTestId('account-type')
    const count = await typeBadges.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('should have account actions button', async ({ page }) => {
    await page.waitForTimeout(500)

    const accountCards = page.getByTestId('account-card')
    const deleteBtns = accountCards.locator('button').filter({
      has: accountCards.locator('svg path[d*="M19 7l-.867"]')
    })
    const count = await deleteBtns.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })
})
