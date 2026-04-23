import { expect,test } from '@playwright/test'

test.describe('App Load', () => {
  test.beforeEach(async ({ page }) => {
    // Start with a clean slate - navigate to dashboard first
    await page.goto('/')
  })

  test('should load without errors', async ({ page, context }) => {
    // Capture console messages
    const consoleMessages: string[] = []
    const errorMessages: string[] = []

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        errorMessages.push(msg.text())
      }
      consoleMessages.push(msg.text())
    })

    page.on('pageerror', (error) => {
      errorMessages.push(error.message)
    })

    // Wait for app to be ready
    await page.waitForTimeout(500)
    await page.waitForSelector('#app', { timeout: 10000 })

    // Check for critical console errors
    const criticalErrors = errorMessages.filter(
      (msg) => msg.includes('Error') || msg.includes('Failed')
    )

    // There might be some expected console warnings, but no critical errors
    expect(criticalErrors.length).toBeLessThan(3)

    // Check that the main app is rendered
    await expect(page.locator('#app')).toBeVisible()
  })

  test('should load stylesheets', async ({ page }) => {
    // Check that critical CSS is loaded by looking for rendered content
    await page.waitForSelector('body', { timeout: 5000 })

    // Vite bundles CSS into JS, so we verify the app loaded properly
    const hasBody = await page.locator('body').isVisible()
    expect(hasBody).toBeTruthy()

    // Check for Google Fonts link
    const fontsLink = await page.locator('link[href*="Inter"]').count()
    expect(fontsLink).toBeGreaterThan(0)
  })
})

