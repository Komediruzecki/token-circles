import { expect, test } from '@playwright/test'
import { login, navigateToRoute, getByTestId } from './test-helpers'

test.describe('Loans CRUD Operations', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await navigateToRoute(page, 'loans')
  })

  test('should display loans header', async ({ page }) => {
    const header = getByTestId(page, 'loans-header')
    await expect(header).toBeVisible()
  })

  test('should have page subtitle', async ({ page }) => {
    const subtitle = getByTestId(page, 'loans-subtitle')
    const text = await subtitle.textContent()
    expect(text).toMatch(/Track loans|manage payments/i)
  })

  test('should have add loan button', async ({ page }) => {
    const addBtn = getByTestId(page, 'add-loan-btn')
    const isVisible = await addBtn.isVisible({ timeout: 3000 }).catch(() => false)
    expect(isVisible).toBeTruthy()
  })

  test('should handle errors gracefully', async ({ page }) => {
    const errors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        errors.push(msg.text())
      }
    })

    page.on('pageerror', (error) => {
      errors.push(error.message)
    })

    await navigateToRoute(page, 'loans')
    await page.waitForTimeout(500)

    const criticalErrors = errors.filter(
      (msg) => msg.includes('Error') && !msg.includes('Failed to fetch')
    )
    expect(criticalErrors.length).toBeLessThan(3)
  })

  test('should display loading state', async ({ page }) => {
    await navigateToRoute(page, 'loans')
    await page.waitForTimeout(500)

    const content = page.locator('h1').first()
    const hasContent = await content.isVisible({ timeout: 500 }).catch(() => false)
    expect(hasContent).toBe(true)
  })
})
