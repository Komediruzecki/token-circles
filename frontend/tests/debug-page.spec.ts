import { test, expect } from '@playwright/test';

test('debug - page details', async ({ page }) => {
  // Setup localStorage
  await page.goto('about:blank')
  await page.evaluate(() => {
    localStorage.clear()
    localStorage.setItem('currentProfileId', '1')
  })

  // Navigate to dashboard
  await page.goto('http://localhost:3847/#dashboard', { waitUntil: 'networkidle' })

  // Collect errors
  const errors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      errors.push(msg.text())
    }
  })

  page.on('pageerror', (error) => {
    errors.push(error.message)
  })

  // Wait for page to load
  await page.waitForTimeout(3000)

  // Debug: find all elements with any data-test- attribute
  const elements = await page.locator('[data-test-]').all()
  console.log('Elements with data-test-:', elements.length)
  for (const el of elements) {
    const html = await el.evaluate(el => el.outerHTML)
    console.log('HTML:', html)
  }

  console.log('Console errors:', errors.join(', '))
})
