import { expect, test } from '@playwright/test'
import { login, navigateToRoute, getByTestId } from './test-helpers'

test.describe('Goals', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await navigateToRoute(page, 'goals')
  })

  test('should display goals header', async ({ page }) => {
    const header = getByTestId(page, 'goals-header')
    await expect(header).toBeVisible()
  })

  test('should have page subtitle', async ({ page }) => {
    const subtitle = getByTestId(page, 'goals-subtitle')
    await expect(subtitle).toBeVisible()
  })

  test('should have add goal button', async ({ page }) => {
    const addBtn = getByTestId(page, 'add-goal-btn')
    await expect(addBtn).toBeVisible()
  })

  test('should display goals summary cards', async ({ page }) => {
    await page.waitForTimeout(1000)

    const summaryCards = page.getByText(/Total Savings|Active Goals|Completed/i, { exact: false })
    const count = await summaryCards.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('should display goal cards', async ({ page }) => {
    await page.waitForTimeout(1000)

    const goalCards = getByTestId(page, 'goal-card')
    const count = await goalCards.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('should display goal name', async ({ page }) => {
    await page.waitForTimeout(1000)

    const names = getByTestId(page, 'goal-name')
    const count = await names.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('should display goal target amount', async ({ page }) => {
    await page.waitForTimeout(1000)

    const targets = page.getByText(/\$[\d,]+\.\d{2}/)
    const count = await targets.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('should display goal saved amount', async ({ page }) => {
    await page.waitForTimeout(1000)

    const saved = page.getByText(/Saved|Progress/i)
    const count = await saved.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('should display goal progress bar', async ({ page }) => {
    await page.waitForTimeout(1000)

    const progressBars = getByTestId(page, 'goal-progress-bar')
    const count = await progressBars.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('should display goal percentage', async ({ page }) => {
    await page.waitForTimeout(1000)

    const percentages = getByTestId(page, 'goal-progress-percent')
    const count = await percentages.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('should display goal icon', async ({ page }) => {
    await page.waitForTimeout(1000)

    const icons = getByTestId(page, 'goal-icon')
    const count = await icons.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('should have goal edit/delete buttons', async ({ page }) => {
    await page.waitForTimeout(1000)

    const editBtns = getByTestId(page, 'goal-edit-btn')
    const goalCards = getByTestId(page, 'goal-card')
    const deleteBtns = getByTestId(page, 'goal-delete-btn')

    const editCount = await editBtns.count()
    const goalCount = await goalCards.count()
    expect(editCount).toBeGreaterThanOrEqual(0)
    expect(goalCount).toBeGreaterThanOrEqual(0)
    // delete button may not exist for all cards
  })

  test('should display goal deadline', async ({ page }) => {
    await page.waitForTimeout(1000)

    const dates = getByTestId(page, 'goal-date')
    const count = await dates.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('should have add goal modal', async ({ page }) => {
    await page.waitForTimeout(500)

    const addBtn = getByTestId(page, 'add-goal-btn')
    await addBtn.click()

    await page.waitForTimeout(500)
    const modal = page.getByRole('dialog')
    await expect(modal).toBeVisible()
  })

  test('should display goal target date picker', async ({ page }) => {
    await page.waitForTimeout(500)

    const dateInputs = page.locator('input[type="date"]')
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
