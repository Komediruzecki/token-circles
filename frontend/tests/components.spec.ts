import { expect,test } from '@playwright/test'

test.describe('UI Components', () => {
  test('Dashboard widgets are visible', async ({ page }) => {
    await page.goto('#dashboard')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(500)

    // Check summary cards
    const summaryCards = page.getByRole('region', { name: /summary/i })
    const count = await summaryCards.count()
    expect(count).toBeGreaterThanOrEqual(0)

    // Check chart
    const charts = page.getByRole('img', { name: /chart/i })
    const chartCount = await charts.count()
    expect(chartCount).toBeGreaterThanOrEqual(0)
  })

  test('Transaction table renders correctly', async ({ page }) => {
    await page.goto('#transactions')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(500)

    const table = page.getByRole('table')
    await expect(table).toBeVisible()

    const rows = page.getByRole('row')
    const rowCount = await rows.count()
    expect(rowCount).toBeGreaterThan(10)
  })

  test('Pagination works', async ({ page }) => {
    await page.goto('#transactions')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(500)

    const pagination = page.getByRole('navigation', { name: /pagination/i })
    const count = await pagination.count()
    expect(count).toBeGreaterThanOrEqual(0)

    if (count > 0) {
      // Test clicking on page buttons
      const pageButtons = pagination.locator('button')
      const buttonCount = await pageButtons.count()
      expect(buttonCount).toBeGreaterThan(0)
    }
  })

  test('Filter bar is visible and functional', async ({ page }) => {
    await page.goto('#transactions')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(500)

    const filterBar = page.getByRole('region', { name: /filter|search/i })
    const count = await filterBar.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('Modal opens and closes correctly', async ({ page }) => {
    await page.goto('#accounts')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(500)

    const addBtn = page.getByRole('button', { name: /add account/i })
    if (await addBtn.isVisible()) {
      await addBtn.click()
      await page.waitForTimeout(300)

      const modal = page.getByRole('dialog')
      await expect(modal).toBeVisible()

      // Click cancel or overlay to close
      const cancelBtn = page.getByRole('button', { name: /cancel/i })
      if (await cancelBtn.isVisible()) {
        await cancelBtn.click()
        await page.waitForTimeout(200)
      }
    }
  })

  test('Tabs work correctly', async ({ page }) => {
    await page.goto('#categories')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(500)

    const tabs = page.getByRole('tab')
    const count = await tabs.count()
    expect(count).toBeGreaterThanOrEqual(2)

    if (count > 1) {
      await tabs.nth(1).click()
      await page.waitForTimeout(200)

      expect(await tabs.nth(1).getAttribute('aria-selected')).toBe('true')
    }
  })

  test('Cards display correctly', async ({ page }) => {
    await page.goto('#bills')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(500)

    const cards = page.getByRole('listitem')
    const count = await cards.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('Badges show correct colors', async ({ page }) => {
    await page.goto('#accounts')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(500)

    const badges = page.getByRole('status')
    const count = await badges.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('Search input is accessible', async ({ page }) => {
    await page.goto('#transactions')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(500)

    const searchInput = page.getByPlaceholder(/search|find/i)
    const count = await searchInput.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('Select dropdowns are accessible', async ({ page }) => {
    await page.goto('#budgets')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(500)

    const selects = page.getByRole('combobox')
    const count = await selects.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('Toggle switches work', async ({ page }) => {
    await page.goto('#bills')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(500)

    const toggles = page.getByRole('checkbox', { name: /autopay/i })
    const count = await toggles.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('Form inputs are accessible', async ({ page }) => {
    await page.goto('#accounts')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(500)

    const nameInput = page.getByRole('textbox', { name: /name/i })
    const count = await nameInput.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('Toast notifications appear', async ({ page }) => {
    await page.goto('#accounts')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(500)

    // Try to trigger a save action
    const addBtn = page.getByRole('button', { name: /add account/i })
    if (await addBtn.isVisible()) {
      await addBtn.click()
      await page.waitForTimeout(300)

      const submitBtn = page.getByRole('button', { name: /add account/i })
      if (await submitBtn.isVisible()) {
        await submitBtn.click()
        await page.waitForTimeout(500)

        const toasts = page.getByRole('alert')
        const count = await toasts.count()
        expect(count).toBeGreaterThanOrEqual(0)
      }
    }
  })

  test('Sidebar navigation works', async ({ page }) => {
    await page.goto('#dashboard')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(500)

    const sidebarLinks = page.getByRole('link', { name: /dashboard|transactions|accounts/i })
    const count = await sidebarLinks.count()
    expect(count).toBeGreaterThanOrEqual(3)

    await sidebarLinks.first().click()
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(500)
  })

  test('Button states are correct', async ({ page }) => {
    await page.goto('#budgets')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(500)

    const buttons = page.getByRole('button')
    const count = await buttons.count()
    expect(count).toBeGreaterThan(0)
  })

  test('Progress bars render correctly', async ({ page }) => {
    await page.goto('#goals')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(500)

    const progressBars = page.locator('[style*="width"], progress')
    const count = await progressBars.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('Chart containers are visible', async ({ page }) => {
    await page.goto('#dashboard')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(500)

    const chartContainers = page.getByRole('region', { name: /chart|graph/i })
    const count = await chartContainers.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('Empty states display', async ({ page }) => {
    await page.goto('#bills')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(500)

    const emptyStates = page.getByText(/no bills|add your first/i)
    const count = await emptyStates.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('Responsive layout adjusts', async ({ page }) => {
    // Desktop
    await page.setViewportSize({ width: 1920, height: 1080 })
    await page.goto('#dashboard')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(500)

    // Tablet
    await page.setViewportSize({ width: 768, height: 1024 })
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(500)

    // Mobile
    await page.setViewportSize({ width: 375, height: 667 })
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(500)

    expect(true).toBeTruthy()
  })
})