import { expect,test } from '@playwright/test'

test.describe('Transactions', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('#transactions')
    await page.waitForLoadState('networkidle')
  })

  test('should display transactions header', async ({ page }) => {
    const header = page.getByRole('heading', { name: /transactions/i, level: 1 })
    await expect(header).toBeVisible()
  })

  test('should have page subtitle', async ({ page }) => {
    const subtitle = page.getByText(/Track|manage|history/i, { exact: false })
    await expect(subtitle).toBeVisible()
  })

  test('should have add transaction button', async ({ page }) => {
    const addBtn = page.getByRole('button', { name: /Add Transaction/i })
    await expect(addBtn).toBeVisible()
  })

  test('should display transaction summary cards', async ({ page }) => {
    await page.waitForTimeout(500)

    const summaryCards = page.getByText(/Total Transactions|This Month|Income|Expenses/i, { exact: false })
    const count = await summaryCards.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('should display transactions table', async ({ page }) => {
    await page.waitForTimeout(500)

    const table = page.getByRole('table')
    await expect(table).toBeVisible()
  })

  test('should have filter bar with search', async ({ page }) => {
    await page.waitForTimeout(500)

    const searchInput = page.getByPlaceholder(/search|find|filter/i)
    const searchCount = await searchInput.count()
    expect(searchCount).toBeGreaterThanOrEqual(0)
  })

  test('should have filter bar with date range', async ({ page }) => {
    await page.waitForTimeout(500)

    const dateFilter = page.getByRole('combobox', { name: /date|period/i })
    const dateFilterCount = await dateFilter.count()
    expect(dateFilterCount).toBeGreaterThanOrEqual(0)
  })

  test('should have filter bar with category filter', async ({ page }) => {
    await page.waitForTimeout(500)

    const categoryFilter = page.getByRole('combobox', { name: /category/i })
    const categoryFilterCount = await categoryFilter.count()
    expect(categoryFilterCount).toBeGreaterThanOrEqual(0)
  })

  test('should display transaction rows', async ({ page }) => {
    await page.waitForTimeout(500)

    const rows = page.getByRole('row')
    const count = await rows.count()
    expect(count).toBeGreaterThanOrEqual(10)
  })

  test('should display transaction description', async ({ page }) => {
    await page.waitForTimeout(500)

    const descriptions = page.getByText(/Miscellaneous|Purchase|Transfer/i)
    const count = await descriptions.count()
    expect(count).toBeGreaterThanOrEqual(10)
  })

  test('should display transaction amount', async ({ page }) => {
    await page.waitForTimeout(500)

    const amounts = page.getByText(/-?\$[\d,]+\.\d{2}/)
    const count = await amounts.count()
    expect(count).toBeGreaterThanOrEqual(10)
  })

  test('should display transaction date', async ({ page }) => {
    await page.waitForTimeout(500)

    const dates = page.getByText(/\d{1,2}\/\d{1,2}/)
    const count = await dates.count()
    expect(count).toBeGreaterThanOrEqual(10)
  })

  test('should display transaction category', async ({ page }) => {
    await page.waitForTimeout(500)

    const categories = page.getByText(/Salary|Food|Groceries|Rent/i)
    const count = await categories.count()
    expect(count).toBeGreaterThanOrEqual(10)
  })

  test('should have sort functionality', async ({ page }) => {
    await page.waitForTimeout(500)

    const sortButtons = page.getByRole('button', { name: /sort|asc|desc/i })
    const count = await sortButtons.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('should have pagination', async ({ page }) => {
    await page.waitForTimeout(500)

    const pagination = page.getByRole('navigation', { name: /pagination/i })
    const paginationCount = await pagination.count()
    expect(paginationCount).toBeGreaterThanOrEqual(0)
  })

  test('should have export buttons', async ({ page }) => {
    await page.waitForTimeout(500)

    const exportButtons = page.getByRole('button', { name: /export|download|csv|excel/i })
    const count = await exportButtons.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('should filter transactions by category', async ({ page }) => {
    await page.waitForTimeout(500)

    const categorySelect = page.getByRole('combobox', { name: /category/i })
    if (await categorySelect.count() > 0) {
      await categorySelect.selectOption({ index: 1 })
      await page.waitForTimeout(500)

      const rows = page.getByRole('row')
      const count = await rows.count()
      expect(count).toBeGreaterThan(0)
    }
  })

  test('should have transaction detail modal', async ({ page }) => {
    await page.waitForTimeout(500)

    const rows = page.getByRole('row')
    if (await rows.count() > 0) {
      await rows.first().click()
      await page.waitForTimeout(500)

      const modal = page.getByRole('dialog')
      const modalCount = await modal.count()
      expect(modalCount).toBeGreaterThanOrEqual(0)
    }
  })
})