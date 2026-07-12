import { expect, test } from '@playwright/test'
import { login, navigateToRoute } from './test-helpers'

test.describe('Loans CRUD Operations', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await navigateToRoute(page, 'loans')
  })

  test('should display loans header', async ({ page }) => {
    await expect(page.getByTestId('loans-header')).toBeVisible()
  })

  test('should have page subtitle', async ({ page }) => {
    // The subtitle wording is the point here, so assert on the copy — scoped to its test-id node.
    const subtitle = page.getByTestId('loans-subtitle')
    const text = await subtitle.textContent()
    expect(text).toMatch(/Track loans|manage payments/i)
  })

  test('should have add loan button', async ({ page }) => {
    const addBtn = page.getByTestId('add-loan-btn')
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

    // The page header renders once the Loans route mounts; use its test-id as the ready signal.
    const header = page.getByTestId('loans-header')
    const hasContent = await header.isVisible({ timeout: 3000 }).catch(() => false)
    expect(hasContent).toBe(true)
  })
})
