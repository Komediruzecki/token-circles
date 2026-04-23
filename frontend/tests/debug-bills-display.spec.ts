import { expect,test } from '@playwright/test'

test('debug bills display', async ({ page }) => {
  await page.goto('http://localhost:3800/#bills')
  await page.waitForLoadState('networkidle', { timeout: 10000 })

  // Check section headers
  const sectionHeaders = await page.locator('h2').allTextContents()
  console.log('Section headers:', sectionHeaders)

  // Check bill cards
  const billCards = await page.locator('.bill-card').all()
  console.log('Number of bill cards:', billCards.length)

  for (let i = 0; i < billCards.length; i++) {
    const card = billCards[i]
    const info = await card.evaluate((el) => ({
      className: el.className,
      text: el.textContent?.substring(0, 100),
      hasBillName: el.querySelector('.billName') !== null,
      hasBillDetails: el.querySelector('.billDetails') !== null,
      hasAmount: el.textContent?.includes('$') || el.textContent?.includes('€') || el.textContent?.includes('£')
    }))
    console.log(`Card ${i}:`, JSON.stringify(info, null, 2))
  }

  // Check for overdue class
  const overdueCards = await page.locator('.bill-card.overdue').count()
  console.log('Overdue cards:', overdueCards)

  // Check the upcoming section specifically
  const upcomingHeader = page.locator('h2:has-text("Upcoming Bills")')
  const upcomingSection = upcomingHeader.locator('..')
  const upcomingCount = await upcomingSection.locator('.bill-card').count()
  console.log('Upcoming section bill count:', upcomingCount)

  // Check if any bill has billName or billDetails
  const hasBillName = await page.locator('.billName').count()
  const hasBillDetails = await page.locator('.billDetails').count()
  console.log('BillName elements:', hasBillName)
  console.log('BillDetails elements:', hasBillDetails)

  await page.screenshot({ path: '/tmp/bills-debug4.png', fullPage: true })
})