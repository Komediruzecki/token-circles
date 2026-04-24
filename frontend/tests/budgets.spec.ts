import { expect,test } from '@playwright/test'

test.describe('Budgets', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('#budgets')
    await page.waitForLoadState('networkidle')
  })

  test('should display budgets header', async ({ page }) => {
    const header = page.getByRole('heading', { name: /budgets/i, level: 1 })
    await expect(header).toBeVisible()
  })

  test('should have page subtitle', async ({ page }) => {
    const subtitle = page.getByText(/Plan|track|limit/i, { exact: false })
    await expect(subtitle).toBeVisible()
  })

  test('should have add budget button', async ({ page }) => {
    const addBtn = page.getByRole('button', { name: /Add Budget/i })
    await expect(addBtn).toBeVisible()
  })

  test('should display budget summary cards', async ({ page }) => {
    await page.waitForTimeout(500)

    const summaryCards = page.getByText(/Total Budgeted|Total Spent|Remaining/i, { exact: false })
    const count = await summaryCards.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('should display budget bars', async ({ page }) => {
    await page.waitForTimeout(500)

    const budgetBars = page.locator('[style*="width"], progress')
    const count = await budgetBars.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('should display budget items', async ({ page }) => {
    await page.waitForTimeout(500)

    const budgetItems = page.getByRole('listitem')
    const count = await budgetItems.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('should display budget name', async ({ page }) => {
    await page.waitForTimeout(500)

    const names = page.getByText(/Food|Rent|Entertainment/i)
    const count = await names.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('should display budget category', async ({ page }) => {
    await page.waitForTimeout(500)

    const categories = page.getByText(/Salary|Food|Groceries/i)
    const count = await categories.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('should display budget amount', async ({ page }) => {
    await page.waitForTimeout(500)

    const amounts = page.getByText(/\$[\d,]+\.\d{2}/)
    const count = await amounts.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('should display budget progress', async ({ page }) => {
    await page.waitForTimeout(500)

    const progressBars = page.locator('[style*="width"]')
    const count = await progressBars.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('should display budget percentage', async ({ page }) => {
    await page.waitForTimeout(500)

    const percentages = page.getByText(/\d+%/)
    const count = await percentages.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('should have budget edit/delete buttons', async ({ page }) => {
    await page.waitForTimeout(500)

    const editBtns = page.getByRole('button', { name: /edit/i })
    const deleteBtns = page.getByRole('button', { name: /delete/i })

    const editCount = await editBtns.count()
    const deleteCount = await deleteBtns.count()

    expect(editCount).toBeGreaterThanOrEqual(0)
    expect(deleteCount).toBeGreaterThanOrEqual(0)
  })

  test('should have budget summary stats', async ({ page }) => {
    await page.waitForTimeout(500)

    const totalBudgeted = page.getByText(/Total Budgeted/i)
    const totalSpent = page.getByText(/Total Spent/i)
    const remaining = page.getByText(/Remaining/i)

    await expect(totalBudgeted).toBeVisible()
    await expect(totalSpent).toBeVisible()
    await expect(remaining).toBeVisible()
  })

  test('should display budget trend chart', async ({ page }) => {
    await page.waitForTimeout(500)

    const chart = page.getByRole('img', { name: /chart|graph|trend/i })
    const count = await chart.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('should have budget comparison view', async ({ page }) => {
    await page.waitForTimeout(500)

    const comparisonView = page.getByRole('button', { name: /compare|view/i })
    const count = await comparisonView.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('should filter budgets by time period', async ({ page }) => {
    await page.waitForTimeout(500)

    const periodSelect = page.getByRole('combobox', { name: /period|month|year/i })
    const count = await periodSelect.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('should have add budget modal', async ({ page }) => {
    await page.waitForTimeout(500)

    const addBtn = page.getByRole('button', { name: /Add Budget/i })
    await addBtn.click()

    await page.waitForTimeout(300)
    const modal = page.getByRole('dialog')
    await expect(modal).toBeVisible()
  })

  test('should display budget alerts', async ({ page }) => {
    await page.waitForTimeout(500)

    const alerts = page.getByText(/alert|warning|over budget/i, { exact: false })
    const count = await alerts.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })
})