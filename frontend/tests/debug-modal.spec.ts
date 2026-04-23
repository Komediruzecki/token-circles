import { test } from '@playwright/test'

test('debug modal structure', async ({ page }) => {
  await page.goto('http://localhost:3800/#bills')
  await page.waitForLoadState('networkidle', { timeout: 10000 })

  // Find the "Add Bill" button
  const addBillBtn = page.locator('button').filter({ hasText: 'Add Bill' })

  // Click to open modal
  await addBillBtn.click()
  await page.waitForTimeout(500)

  // Inspect the modal
  const html = await page.locator('body').innerHTML()
  console.log('Modal HTML snippet:')
  const modalStart = html.indexOf('modal')
  if (modalStart !== -1) {
    console.log(html.substring(modalStart - 100, modalStart + 500))
  }

  // Get all elements with class containing 'modal'
  const modalElements = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('[class*="modal"]')).map((el) => ({
      tag: el.tagName,
      className: el.className,
      text: el.textContent?.substring(0, 50)
    }))
  })

  console.log('Modal elements:', JSON.stringify(modalElements, null, 2))
})