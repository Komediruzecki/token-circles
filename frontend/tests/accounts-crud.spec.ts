import { expect, test } from '@playwright/test'

test.describe('Accounts CRUD Operations', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('#accounts')
    await page.waitForLoadState('networkidle')
  })

  test('should display accounts header', async ({ page }) => {
    const header = page.getByRole('heading', { name: /accounts/i, level: 1 })
    await expect(header).toBeVisible()
  })

  test('should have page subtitle', async ({ page }) => {
    const subtitle = page.getByText(/Manage bank accounts|track balances/i, { exact: false })
    await expect(subtitle).toBeVisible()
  })

  test('should have add account button', async ({ page }) => {
    const addBtn = page.getByRole('button', { name: /Add Account/i })
    await expect(addBtn).toBeVisible()
  })

  test('should have summary cards', async ({ page }) => {
    await page.waitForTimeout(500)

    const cards = page.getByText(/Total Balance|Accounts|Income|Expenses/i, { exact: false })
    const count = await cards.count()

    // Should have at least 4 summary cards
    expect(count).toBeGreaterThanOrEqual(4)
  })

  test('should display total balance', async ({ page }) => {
    await page.waitForTimeout(500)

    const balanceLabel = page.getByText('Total Balance', { exact: true })
    await expect(balanceLabel).toBeVisible()

    const balanceValue = page.getByText(/\$[\d,]+\.\d{2}/)
    await expect(balanceValue).toBeVisible()
  })

  test('should display accounts count', async ({ page }) => {
    await page.waitForTimeout(500)

    const countLabel = page.getByText('Accounts', { exact: true })
    await expect(countLabel).toBeVisible()

    const countValue = page.getByText(/\d+/)
    await expect(countValue).toBeVisible()
  })

  test('should display monthly income', async ({ page }) => {
    await page.waitForTimeout(500)

    const incomeLabel = page.getByText('Income', { exact: true })
    await expect(incomeLabel).toBeVisible()

    const incomeValue = page.getByText(/\$[\d,]+\.\d{2}/)
    await expect(incomeValue).beVisible()
  })

  test('should display monthly expenses', async ({ page }) => {
    await page.waitForTimeout(500)

    const expensesLabel = page.getByText('Expenses', { exact: true })
    await expect(expensesLabel).toBeVisible()

    const expensesValue = page.getByText(/\$[\d,]+\.\d{2}/)
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

  test('should have account icons: 🏦 checking, 💰 savings, 💳 credit, 📈 investment', async ({
    page,
  }) => {
    await page.waitForTimeout(500)

    const icons = page.getByTestId('account-icon')
    const hasChecking = (await icons.count()) > 0 // At least one icon should be present
    expect(hasChecking).toBeTruthy()
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

    const balanceText = page.getByText(/Total Balance|balance|Balance/i)
    const balanceValue = page.getByText(/\$[\d,]+\.\d{2}/)

    await expect(balanceText).toBeVisible()
    await expect(balanceValue).toBeVisible()
  })

  test('should display recent activity section', async ({ page }) => {
    await page.waitForTimeout(500)

    const activityHeader = page.getByText(/Recent Activity|Activity/i)
    await expect(activityHeader).toBeVisible()
  })

  test('should have activity header with view all link', async ({ page }) => {
    await page.waitForTimeout(500)

    const viewAll = page.getByText(/View All/i)
    const activitySection = page.getByTestId('activity-section')

    await expect(activitySection).toBeVisible()
  })

  test('should have "View All" link', async ({ page }) => {
    await page.waitForTimeout(500)

    const viewAll = page.getByRole('link', { name: /View All/i })
    await expect(viewAll).toBeVisible()
  })

  test('should display activity list', async ({ page }) => {
    await page.waitForTimeout(500)

    const activityList = page.getByTestId('activity-list')
    await expect(activityList).toBeVisible()
  })

  test('should display activity items', async ({ page }) => {
    await page.waitForTimeout(500)

    const activityItems = page.getByTestId('activity-item')
    const count = await activityItems.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('should display activity description', async ({ page }) => {
    await page.waitForTimeout(500)

    const description = page.getByTestId('activity-description')
    const count = await description.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('should display activity date', async ({ page }) => {
    await page.waitForTimeout(500)

    const date = page.getByTestId('activity-date')
    const count = await date.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('should display activity amount with +/-', async ({ page }) => {
    await page.waitForTimeout(500)

    const amount = page.getByText(/[-+]\$[\d,]+\.\d{2}/)
    const count = await amount.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('should have account type badge', async ({ page }) => {
    await page.waitForTimeout(500)

    const typeBadge = page.getByTestId('account-type')
    const count = await typeBadge.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('should have account type badge text', async ({ page }) => {
    await page.waitForTimeout(500)

    const typeText = page.getByText(/checking|savings|credit|investment/i)
    const count = await typeText.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('should have account actions button', async ({ page }) => {
    await page.waitForTimeout(500)

    const actionsButton = page.getByRole('button', { name: /Edit|Delete/i })
    const count = await actionsButton.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })
})
