import { test, expect } from '@playwright/test';

test('debug - storage and page', async ({ page }) => {
  // Navigate to blank page first and set localStorage
  await page.goto('about:blank')
  await page.evaluate(() => {
    localStorage.setItem('currentProfileId', '1')
  })

  // Now navigate to the app - localStorage should persist
  await page.goto('#dashboard', { waitUntil: 'networkidle' })
  await page.waitForTimeout(2000)

  const errors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })

  const html = await page.content()
  console.log('=== HTML Length ===', html.length)

  // Find all data-test- elements
  const dataTestElements = await page.locator('[data-test-]').all()
  console.log('=== Data-test- elements ===', dataTestElements.length)
  
  // Get first 3 HTML snippets
  for (let i = 0; i < Math.min(3, dataTestElements.length); i++) {
    const html = await dataTestElements[i].evaluate(el => el.outerHTML)
    console.log(html)
  }

  console.log('=== Console errors ===', errors.join(', '))
})
