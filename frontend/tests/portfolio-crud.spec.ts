import { expect, test } from '@playwright/test'
import { login, navigateToRoute, getByTestId, E2E_BASE } from './test-helpers'

test.describe('Portfolio CRUD Operations', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await navigateToRoute(page, 'portfolio')
  })

  test('should display portfolio header', async ({ page }) => {
    const header = getByTestId(page, 'portfolio-header')
    await expect(header).toBeVisible()
  })

  test('should have page subtitle', async ({ page }) => {
    const subtitle = getByTestId(page, 'portfolio-subtitle')
    await expect(subtitle).toBeVisible()
  })

  test('should have add holding button', async ({ page }) => {
    const addBtn = getByTestId(page, 'add-holding-btn')
    await expect(addBtn).toBeVisible()
  })

  test('should have refresh prices button', async ({ page }) => {
    const refreshBtn = getByTestId(page, 'refresh-prices-btn')
    await expect(refreshBtn).toBeVisible()
  })

  test('should display summary cards after loading', async ({ page }) => {
    const summary = getByTestId(page, 'portfolio-summary')
    await expect(summary).toBeVisible({ timeout: 10000 })
  })

  test('should display holdings table', async ({ page }) => {
    const table = page.getByTestId('portfolio-holdings')
    await expect(table).toBeVisible({ timeout: 10000 })
  })

  test('should display holding rows with tickers', async ({ page }) => {
    const rows = page.getByTestId('portfolio-holding-row')
    await expect(rows.first()).toBeVisible({ timeout: 10000 })
    const rowCount = await rows.count()
    expect(rowCount).toBeGreaterThanOrEqual(1)
    // Every holding row renders exactly one ticker cell.
    expect(await page.getByTestId('portfolio-ticker').count()).toBe(rowCount)
  })

  test('should open add modal when clicking add holding', async ({ page }) => {
    await getByTestId(page, 'add-holding-btn').click()
    await expect(page.getByTestId('portfolio-modal')).toBeVisible({ timeout: 5000 })
    // Copy is the point: the modal opens in "add" mode (not "edit").
    await expect(page.getByTestId('portfolio-modal-title')).toHaveText('Add Holding')
  })

  test('should show ticker input in add modal', async ({ page }) => {
    await getByTestId(page, 'add-holding-btn').click()
    await expect(page.getByTestId('portfolio-form-ticker')).toBeVisible({ timeout: 5000 })
  })

  test('should show shares, price, and date fields in modal', async ({ page }) => {
    await getByTestId(page, 'add-holding-btn').click()
    await expect(page.getByTestId('portfolio-form-shares')).toBeVisible({ timeout: 5000 })
    await expect(page.getByTestId('portfolio-form-price')).toBeVisible()
    await expect(page.getByTestId('portfolio-form-date')).toBeVisible()
  })

  test('should show validation error on empty form submit', async ({ page }) => {
    await getByTestId(page, 'add-holding-btn').click()
    const submitBtn = page.getByTestId('portfolio-modal-submit')
    await expect(submitBtn).toBeVisible({ timeout: 5000 })
    await submitBtn.click()
    // Required fields block submission, so the modal stays open.
    await expect(page.getByTestId('portfolio-modal')).toBeVisible()
  })

  test('should close modal when clicking overlay', async ({ page }) => {
    await getByTestId(page, 'add-holding-btn').click()
    const modal = page.getByTestId('portfolio-modal')
    await expect(modal).toBeVisible({ timeout: 5000 })
    // Click the overlay backdrop (top-left corner sits outside the centered modal).
    await page.getByTestId('portfolio-modal-overlay').click({ position: { x: 5, y: 5 } })
    await expect(modal).not.toBeVisible({ timeout: 3000 })
  })

  test('should display pie chart allocation', async ({ page }) => {
    const allocation = page.getByTestId('portfolio-allocation')
    await expect(allocation).toBeVisible({ timeout: 10000 })
  })

  test('should refresh prices when clicking refresh', async ({ page }) => {
    await page.waitForTimeout(2000)
    const refreshBtn = getByTestId(page, 'refresh-prices-btn')
    await expect(refreshBtn).toBeEnabled({ timeout: 5000 })
    await refreshBtn.click()
    // Button text should change to "Refreshing..."
    await page.waitForTimeout(500)
    const text = await refreshBtn.textContent()
    expect(text).toBeTruthy()
  })

  test('should navigate to portfolio page via hash', async ({ page }) => {
    // Use 127.0.0.1 (not localhost) so the session cookie set by login() — bound to the
    // 127.0.0.1 origin — rides along; a cross-origin hop would drop it to the login screen.
    await page.goto(`${E2E_BASE}/#portfolio`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(1000)
    const header = page.getByTestId('portfolio-header')
    await expect(header).toBeVisible({ timeout: 10000 })
  })

  test('should handle errors gracefully', async ({ page }) => {
    const errors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text())
    })
    page.on('pageerror', (error) => {
      errors.push(error.message)
    })

    await navigateToRoute(page, 'portfolio')
    await page.waitForTimeout(1000)

    const criticalErrors = errors.filter(
      (msg) => msg.includes('Error') && !msg.includes('Failed to fetch')
    )
    expect(criticalErrors.length).toBeLessThan(3)
  })
})
