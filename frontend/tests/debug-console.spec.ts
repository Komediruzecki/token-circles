import { test, expect } from '@playwright/test';

test('debug - console errors', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('currentProfileId', '1')
    localStorage.setItem('darkMode', 'false')
  })
  
  await page.goto('#dashboard', { waitUntil: 'networkidle' })
  await page.waitForTimeout(3000)

  const consoleErrors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text())
    }
  })

  // Wait longer for possible lazy loading
  await page.waitForTimeout(2000)
  
  console.log('=== Console Errors ===')
  consoleErrors.forEach(e => console.error(e))
  
  // Check page body
  const body = await page.locator('body').innerHTML()
  console.log('=== Body HTML ===')
  console.log(body.substring(0, 500))
})
