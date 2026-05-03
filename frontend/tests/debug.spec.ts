import { expect, test } from '@playwright/test'
import fs from 'fs'

test.describe('Debug', () => {
  test('check page', async ({ page, context }) => {
    // Set localStorage before load
    await page.addInitScript(() => {
      localStorage.setItem('currentProfileId', '1')
      localStorage.setItem('darkMode', 'false')
    })

    // Capture console messages from browser
    const messages: string[] = []
    const consoleMessages: string[] = []
    page.on('console', msg => {
      if (msg.type() === 'error') {
        messages.push(`ERROR: ${msg.text()}`)
      } else {
        consoleMessages.push(`${msg.type()}: ${msg.text()}`)
      }
    })
    page.on('pageerror', error => {
      messages.push(`PAGE ERROR: ${error.message}`)
    })

    await page.goto('http://localhost:3847/#transactions')

    // Wait for page to stabilize
    await page.waitForTimeout(5000)

    // Take a screenshot
    await page.screenshot({ path: 'test-output.png' })

    // Check if any data-test-id elements exist
    const elements = await page.locator('[data-test-id]').count()

    // Check for dashboard elements
    const dashboardHeader = await page.locator('[data-test-id="dashboard-header"]').count()

    // Check if any account elements exist
    const accountsHeader = await page.locator('[data-test-id="accounts-header"]').count()

    // Check if transactions element exists
    const transactionsHeader = await page.locator('[data-test-id="transactions-header"]').count()

    // Check for error messages on page
    const pageErrors = await page.evaluate(() => {
      return (window as any).solid_errors || []
    })

    // Get page HTML
    const html = await page.content()

    // Try waiting for any element
    const anyElement = await page.locator('body *').count()

    // Check if there's a root element with content
    const rootChildren = await page.locator('#root > *').count()

    // Check page title
    const title = await page.title()

    // Try to see what's in localStorage
    const localStorageItems = await page.evaluate(() => {
      const items: any = {}
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)
        if (key) {
          items[key] = localStorage.getItem(key)
        }
      }
      return items
    })

    // Write results to a file
    fs.writeFileSync('/tmp/finance-manager/frontend/debug-output.json', JSON.stringify({
      title,
      elements,
      accountsHeader,
      transactionsHeader,
      rootChildren,
      anyElement,
      htmlLength: html.length,
      localStorageItems,
      consoleErrors: messages,
      consoleMessages,
      pageErrors,
    }, null, 2))

    // Assert we found some content
    expect(title).toBeTruthy()
    expect(rootChildren).toBeGreaterThan(0)
    expect(anyElement).toBeGreaterThan(0)
  })
})
