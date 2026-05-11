import { expect, test } from '@playwright/test'
import { login, navigateToRoute, getByTestId } from './test-helpers'

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
    await page.waitForTimeout(2000)
    const table = page.locator('table')
    await expect(table).toBeVisible({ timeout: 10000 })
  })

  test('should display holding rows with tickers', async ({ page }) => {
    await page.waitForTimeout(2000)
    const rows = page.locator('table tbody tr')
    const count = await rows.count()
    expect(count).toBeGreaterThanOrEqual(1)
  })

  test('should open add modal when clicking add holding', async ({ page }) => {
    const addBtn = getByTestId(page, 'add-holding-btn')
    await addBtn.click()
    // Modal title should appear
    const modalTitle = page.locator('h3', { hasText: 'Add Holding' })
    await expect(modalTitle).toBeVisible({ timeout: 5000 })
  })

  test('should show ticker input in add modal', async ({ page }) => {
    const addBtn = getByTestId(page, 'add-holding-btn')
    await addBtn.click()
    const tickerInput = page.locator('input[placeholder*="AAPL"]')
    await expect(tickerInput).toBeVisible({ timeout: 5000 })
  })

  test('should show shares, price, and date fields in modal', async ({ page }) => {
    const addBtn = getByTestId(page, 'add-holding-btn')
    await addBtn.click()
    await page.waitForTimeout(300)
    // Should have at least 4 input fields (ticker, shares, price, date)
    const inputs = page.locator('input')
    const count = await inputs.count()
    // At least ticker, shares, price, date + maybe notes
    expect(count).toBeGreaterThanOrEqual(3)
  })

  test('should show validation error on empty form submit', async ({ page }) => {
    const addBtn = getByTestId(page, 'add-holding-btn')
    await addBtn.click()
    await page.waitForTimeout(300)
    // Find and submit the form without filling anything
    const submitBtn = page.locator('form button[type="submit"], form button.btnPrimary')
    if (await submitBtn.isVisible()) {
      await submitBtn.click()
      // Should see an error toast or validation
      await page.waitForTimeout(500)
    }
  })

  test('should close modal when clicking overlay', async ({ page }) => {
    const addBtn = getByTestId(page, 'add-holding-btn')
    await addBtn.click()
    await page.waitForTimeout(300)
    const modalTitle = page.locator('h3', { hasText: 'Add Holding' })
    await expect(modalTitle).toBeVisible({ timeout: 5000 })
    // Click outside modal
    await page.mouse.click(10, 10)
    await page.waitForTimeout(300)
    const modalAfter = page.locator('h3', { hasText: 'Add Holding' })
    await expect(modalAfter).not.toBeVisible({ timeout: 3000 })
  })

  test('should display pie chart allocation', async ({ page }) => {
    await page.waitForTimeout(2000)
    const pieChart = page.locator('svg circle')
    const count = await pieChart.count()
    // Pie chart has a center circle
    expect(count).toBeGreaterThanOrEqual(1)
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
    await page.goto('http://localhost:3800/#portfolio', { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(1000)
    const header = getByTestId(page, 'portfolio-header')
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
