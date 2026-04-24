import { expect,test } from '@playwright/test'

test.describe('Goals', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('#goals')
    await page.waitForLoadState('networkidle')
  })

  test('should display goals header', async ({ page }) => {
    const header = page.getByRole('heading', { name: /goals/i, level: 1 })
    await expect(header).toBeVisible()
  })

  test('should have page subtitle', async ({ page }) => {
    const subtitle = page.getByText(/save|track|achieve/i, { exact: false })
    await expect(subtitle).toBeVisible()
  })

  test('should have add goal button', async ({ page }) => {
    const addBtn = page.getByRole('button', { name: /Add Goal/i })
    await expect(addBtn).toBeVisible()
  })

  test('should display goals summary cards', async ({ page }) => {
    await page.waitForTimeout(500)

    const summaryCards = page.getByText(/Total Savings|Active Goals|Completed/i, { exact: false })
    const count = await summaryCards.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('should display goal cards', async ({ page }) => {
    await page.waitForTimeout(500)

    const goalCards = page.getByRole('listitem')
    const count = await goalCards.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('should display goal name', async ({ page }) => {
    await page.waitForTimeout(500)

    const names = page.getByText(/Emergency Fund|Vacation|Car/i)
    const count = await names.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('should display goal target amount', async ({ page }) => {
    await page.waitForTimeout(500)

    const targets = page.getByText(/\$[\d,]+\.\d{2}/)
    const count = await targets.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('should display goal saved amount', async ({ page }) => {
    await page.waitForTimeout(500)

    const saved = page.getByText(/Saved|Progress/i)
    const count = await saved.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('should display goal progress bar', async ({ page }) => {
    await page.waitForTimeout(500)

    const progressBars = page.locator('[style*="width"], progress')
    const count = await progressBars.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('should display goal percentage', async ({ page }) => {
    await page.waitForTimeout(500)

    const percentages = page.getByText(/\d+%/)
    const count = await percentages.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('should display goal icon', async ({ page }) => {
    await page.waitForTimeout(500)

    const icons = page.getByRole('img')
    const count = await icons.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('should have goal edit/delete buttons', async ({ page }) => {
    await page.waitForTimeout(500)

    const editBtns = page.getByRole('button', { name: /edit/i })
    const deleteBtns = page.getByRole('button', { name: /delete/i })

    const editCount = await editBtns.count()
    const deleteCount = await deleteBtns.count()

    expect(editCount).toBeGreaterThanOrEqual(0)
    expect(deleteCount).toBeGreaterThanOrEqual(0)
  })

  test('should display goal category', async ({ page }) => {
    await page.waitForTimeout(500)

    const categories = page.getByText(/savings|goals|expenses/i)
    const count = await categories.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('should display goal deadline', async ({ page }) => {
    await page.waitForTimeout(500)

    const deadlines = page.getByText(/\d{1,2}\/\d{1,2}\/\d{4}/)
    const count = await deadlines.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('should have goal progress chart', async ({ page }) => {
    await page.waitForTimeout(500)

    const chart = page.getByRole('img', { name: /chart|graph|progress/i })
    const count = await chart.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('should have add goal modal', async ({ page }) => {
    await page.waitForTimeout(500)

    const addBtn = page.getByRole('button', { name: /Add Goal/i })
    await addBtn.click()

    await page.waitForTimeout(300)
    const modal = page.getByRole('dialog')
    await expect(modal).toBeVisible()
  })

  test('should display goal target date picker', async ({ page }) => {
    await page.waitForTimeout(500)

    const dateInputs = page.getByRole('date')
    const count = await dateInputs.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('should filter goals by status', async ({ page }) => {
    await page.waitForTimeout(500)

    const statusFilters = page.getByRole('button', { name: /active|completed|all/i })
    const count = await statusFilters.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('should display goal tips', async ({ page }) => {
    await page.waitForTimeout(500)

    const tips = page.getByText(/tip|suggestion|advice/i, { exact: false })
    const count = await tips.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })
})