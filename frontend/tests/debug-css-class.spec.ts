import { expect,test } from '@playwright/test'

test('debug CSS classes on page', async ({ page }) => {
  await page.goto('http://localhost:3800/#bills')
  await page.waitForLoadState('networkidle', { timeout: 10000 })

  const billsPageClass = await page.locator('._billsPage_1605t_1').first().isVisible()
  console.log('Has billsPage class:', billsPageClass)

  // Check the pageHeader specifically
  const pageHeader = page.locator('.pageHeader')
  const pageInfo = await pageHeader.evaluate((el) => ({
    className: el.className,
    hasBillsPage: el.className.includes('billsPage')
  }))
  console.log('PageHeader class:', JSON.stringify(pageInfo, null, 2))

  // Check billName elements
  const billNameElements = await page.locator('.billName').all()
  console.log('Number of .billName elements:', billNameElements.length)

  for (let i = 0; i < billNameElements.length; i++) {
    const nameEl = billNameElements[i]
    const info = await nameEl.evaluate((el) => ({
      text: el.textContent,
      className: el.className,
      parentHasBillsPage: el.parentElement?.className?.includes('billsPage')
    }))
    console.log(`BillName ${i}:`, JSON.stringify(info, null, 2))
  }
})