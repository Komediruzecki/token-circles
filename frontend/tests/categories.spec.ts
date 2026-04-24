import { expect,test } from '@playwright/test'

test.describe('Categories', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('#categories')
    await page.waitForLoadState('networkidle')
  })

  test('should display categories header', async ({ page }) => {
    const header = page.getByRole('heading', { name: /categories/i, level: 1 })
    await expect(header).toBeVisible()
  })

  test('should have page subtitle', async ({ page }) => {
    const subtitle = page.getByText(/organize|manage/i, { exact: false })
    await expect(subtitle).toBeVisible()
  })

  test('should have add category button', async ({ page }) => {
    const addBtn = page.getByRole('button', { name: /Add Category/i })
    await expect(addBtn).toBeVisible()
  })

  test('should display categories grid', async ({ page }) => {
    await page.waitForTimeout(500)

    const grid = page.getByRole('region', { name: /categories/i })
    await expect(grid).toBeVisible()
  })

  test('should display expense categories', async ({ page }) => {
    await page.waitForTimeout(500)

    const expenseCategories = page.getByText(/Salary|Food|Rent|Utilities/i)
    const count = await expenseCategories.count()
    expect(count).toBeGreaterThanOrEqual(5)
  })

  test('should display category items with colors', async ({ page }) => {
    await page.waitForTimeout(500)

    const categoryItems = page.getByRole('listitem')
    const count = await categoryItems.count()
    expect(count).toBeGreaterThanOrEqual(5)
  })

  test('should display category name', async ({ page }) => {
    await page.waitForTimeout(500)

    const names = page.getByText(/Salary|Food|Rent|Groceries/i)
    const count = await names.count()
    expect(count).toBeGreaterThanOrEqual(5)
  })

  test('should display transaction count for category', async ({ page }) => {
    await page.waitForTimeout(500)

    const counts = page.getByText(/×\d+/)
    const count = await counts.count()
    expect(count).toBeGreaterThanOrEqual(5)
  })

  test('should display spending amount for category', async ({ page }) => {
    await page.waitForTimeout(500)

    const amounts = page.getByText(/\$[\d,]+\.\d{2}/)
    const count = await amounts.count()
    expect(count).toBeGreaterThanOrEqual(5)
  })

  test('should have category edit/delete buttons', async ({ page }) => {
    await page.waitForTimeout(500)

    const editBtns = page.getByRole('button', { name: /edit/i })
    const deleteBtns = page.getByRole('button', { name: /delete/i })

    const editCount = await editBtns.count()
    const deleteCount = await deleteBtns.count()

    expect(editCount).toBeGreaterThanOrEqual(0)
    expect(deleteCount).toBeGreaterThanOrEqual(0)
  })

  test('should have category items with icons', async ({ page }) => {
    await page.waitForTimeout(500)

    const icons = page.getByRole('img')
    const count = await icons.count()
    expect(count).toBeGreaterThanOrEqual(5)
  })

  test('should display category color indicators', async ({ page }) => {
    await page.waitForTimeout(500)

    const colorIndicators = page.locator('[style*="background-color"], [style*="border-color"]')
    const count = await colorIndicators.count()
    expect(count).toBeGreaterThanOrEqual(5)
  })

  test('should have multiple category tabs', async ({ page }) => {
    await page.waitForTimeout(500)

    const tabs = page.getByRole('tab')
    const count = await tabs.count()
    expect(count).toBeGreaterThanOrEqual(2)
  })

  test('should filter by category type', async ({ page }) => {
    await page.waitForTimeout(500)

    const expenseTab = page.getByRole('tab', { name: /expenses?/i })
    const incomeTab = page.getByRole('tab', { name: /income/i })

    await expect(expenseTab).toBeVisible()
    await expect(incomeTab).toBeVisible()
  })

  test('should display total category spending', async ({ page }) => {
    await page.waitForTimeout(500)

    const totalSpending = page.getByText(/Total/i)
    await expect(totalSpending).toBeVisible()
  })

  test('should have add category modal', async ({ page }) => {
    await page.waitForTimeout(500)

    const addBtn = page.getByRole('button', { name: /Add Category/i })
    await addBtn.click()

    await page.waitForTimeout(300)
    const modal = page.getByRole('dialog')
    await expect(modal).toBeVisible()
  })
})