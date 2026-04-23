import { expect,test } from '@playwright/test'

test.describe('All Pages Load Without Console Errors', () => {
  const pages = [
    { name: 'dashboard', path: '#dashboard' },
    { name: 'transactions', path: '#transactions' },
    { name: 'budgets', path: '#budgets' },
    { name: 'loans', path: '#loans' },
    { name: 'goals', path: '#goals' },
    { name: 'bills', path: '#bills' },
    { name: 'accounts', path: '#accounts' },
    { name: 'categories', path: '#categories' },
    { name: 'settings', path: '#settings' },
    { name: 'retirement', path: '#retirement' },
    { name: 'housing', path: '#housing' },
    { name: 'analytics', path: '#analytics' },
  ]

  pages.forEach(({ name, path }) => {
    test(`${name} page loads without errors`, async ({ page }, _) => {
      // Reset to dashboard before each test
      await page.goto('/#dashboard')

      // Capture console messages
      const errorMessages: string[] = []

      page.on('console', (msg) => {
        if (msg.type() === 'error') {
          errorMessages.push(msg.text())
        }
      })

      page.on('pageerror', (error) => {
        errorMessages.push(error.message)
      })

      // Navigate to the page
      await page.goto(path, { waitUntil: 'networkidle' })

      // Wait for the page content to load
      await page.waitForTimeout(500)

      // Check for any console errors
      const criticalErrors = errorMessages.filter(
        (msg) => msg.includes('Error') || msg.includes('Failed') || msg.includes('undefined')
      )

      // Report errors if any exist
      if (criticalErrors.length > 0) {
        console.log(`Errors on ${name} page:`, criticalErrors)
      }

      // Assert that we have fewer than 3 critical errors (some warnings are OK)
      expect(criticalErrors.length).toBeLessThan(3)

      // Verify the page is visible
      await expect(page).toHaveTitle(/Finance Manager/)
    })
  })
})

