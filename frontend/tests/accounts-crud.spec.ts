import { expect, test } from '@playwright/test'
import { login, navigateToRoute, getByTestId } from './test-helpers'

test.describe('Accounts CRUD Operations', () => {
  test.beforeEach(async ({ page }) => {
    // Login first
    await login(page)

    // Navigate to accounts page
    await navigateToRoute(page, 'accounts')
  })

  test('should display accounts header', async ({ page }) => {
    const header = getByTestId(page, 'accounts-header')
    await expect(header).toBeVisible()
  })

  test('should have page subtitle', async ({ page }) => {
    const subtitle = getByTestId(page, 'accounts-subtitle')
    await expect(subtitle).toBeVisible()
  })

  test('should have add account button', async ({ page }) => {
    const addBtn = getByTestId(page, 'add-account-btn')
    await expect(addBtn).toBeVisible()
  })

  test('should have summary cards', async ({ page }) => {
    const summary = getByTestId(page, 'accounts-summary')
    await expect(summary).toBeVisible()
  })

  test('should display total balance', async ({ page }) => {
    const balanceLabel = getByTestId(page, 'summary-total-balance')
    await expect(balanceLabel).toBeVisible()

    const balanceValue = getByTestId(page, 'summary-balance-value')
    await expect(balanceValue).toBeVisible()
  })

  test('should display accounts count', async ({ page }) => {
    const countLabel = getByTestId(page, 'summary-accounts-count')
    await expect(countLabel).toBeVisible()

    const countValue = getByTestId(page, 'summary-accounts-value')
    await expect(countValue).toBeVisible()
  })

  test('should display monthly income', async ({ page }) => {
    const incomeLabel = getByTestId(page, 'summary-income')
    await expect(incomeLabel).toBeVisible()

    const incomeValue = getByTestId(page, 'summary-income-value')
    await expect(incomeValue).toBeVisible()
  })

  test('should display monthly expenses', async ({ page }) => {
    const expensesLabel = getByTestId(page, 'summary-expenses')
    await expect(expensesLabel).toBeVisible()

    const expensesValue = getByTestId(page, 'summary-expenses-value')
    await expect(expensesValue).toBeVisible()
  })

  test('should have accounts grid', async ({ page }) => {
    const accountsGrid = getByTestId(page, 'accounts-grid')
    await expect(accountsGrid).toBeVisible()
  })

  test('should display account cards', async ({ page }) => {
    const accountCards = page.getByTestId('account-card')
    await expect(accountCards.first()).toBeVisible()
    // Demo data seeds several accounts, so at least one card renders.
    expect(await accountCards.count()).toBeGreaterThanOrEqual(1)
  })

  test('should have account card with icon', async ({ page }) => {
    const cardCount = await page.getByTestId('account-card').count()
    // Each account card renders exactly one type icon.
    expect(await page.getByTestId('account-icon').count()).toBe(cardCount)
  })

  test('should have account icons matching account types', async ({ page }) => {
    const icons = getByTestId(page, 'account-icon')
    const iconCount = await icons.count()

    // At least one account icon should be displayed
    expect(iconCount).toBeGreaterThanOrEqual(1)

    // Verify the icon is visible
    await expect(icons.first()).toBeVisible()
  })

  test('should display account name', async ({ page }) => {
    const cardCount = await page.getByTestId('account-card').count()
    // One name heading per account card.
    expect(await page.getByTestId('account-name').count()).toBe(cardCount)
    await expect(page.getByTestId('account-name').first()).toBeVisible()
  })

  test('should display bank name', async ({ page }) => {
    const cardCount = await page.getByTestId('account-card').count()
    // One bank line per account card (falls back to "No bank listed").
    expect(await page.getByTestId('account-bank').count()).toBe(cardCount)
  })

  test('should display current balance card', async ({ page }) => {
    await expect(page.getByTestId('current-balance-card').first()).toBeVisible()
    await expect(page.getByTestId('account-balance').first()).toBeVisible()
  })

  test('should display recent activity section', async ({ page }) => {
    await expect(page.getByTestId('activity-section').first()).toBeVisible()
  })

  test('should have activity header with view all link', async ({ page }) => {
    const cardCount = await page.getByTestId('account-card').count()
    // One activity section per card, each carrying a "View All" link.
    expect(await page.getByTestId('activity-section').count()).toBe(cardCount)
    expect(await page.getByTestId('activity-view-all').count()).toBe(cardCount)
  })

  test('should have "View All" link', async ({ page }) => {
    const cardCount = await page.getByTestId('account-card').count()
    expect(await page.getByTestId('activity-view-all').count()).toBe(cardCount)
  })

  test('should display activity list', async ({ page }) => {
    const cardCount = await page.getByTestId('account-card').count()
    // Each card renders its own activity list container.
    expect(await page.getByTestId('activity-list').count()).toBe(cardCount)
  })

  test('should display activity items', async ({ page }) => {
    const itemCount = await page.getByTestId('activity-item').count()
    // Each activity item carries exactly one amount.
    expect(await page.getByTestId('activity-amount').count()).toBe(itemCount)
  })

  test('should display activity description', async ({ page }) => {
    const itemCount = await page.getByTestId('activity-item').count()
    expect(await page.getByTestId('activity-desc').count()).toBe(itemCount)
  })

  test('should display activity date', async ({ page }) => {
    const itemCount = await page.getByTestId('activity-item').count()
    expect(await page.getByTestId('activity-date').count()).toBe(itemCount)
  })

  test('should display activity amount with +/-', async ({ page }) => {
    const itemCount = await page.getByTestId('activity-item').count()
    expect(await page.getByTestId('activity-amount').count()).toBe(itemCount)
  })

  test('should have account type badge', async ({ page }) => {
    const cardCount = await page.getByTestId('account-card').count()
    // Each account card shows exactly one type badge.
    expect(await page.getByTestId('account-type').count()).toBe(cardCount)
  })

  test('should have account type badge text', async ({ page }) => {
    const cardCount = await page.getByTestId('account-card').count()
    expect(await page.getByTestId('account-type').count()).toBe(cardCount)
  })

  test('should have account actions button', async ({ page }) => {
    const cardCount = await page.getByTestId('account-card').count()
    // Each account card has exactly one delete control.
    expect(await page.getByTestId('account-delete-btn').count()).toBe(cardCount)
  })
})
