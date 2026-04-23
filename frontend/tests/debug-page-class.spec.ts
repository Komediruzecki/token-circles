import { expect,test } from '@playwright/test'

test('debug page class', async ({ page }) => {
  await page.goto('http://localhost:3800/#bills')
  await page.waitForLoadState('networkidle', { timeout: 10000 })

  const pageContent = page.locator('.page')

  // Check page class and visibility
  const pageInfo = await pageContent.evaluate((el: any) => {
    return {
      className: el.className,
      hasActive: el.classList.contains('active'),
      display: window.getComputedStyle(el).display,
      offsetWidth: el.offsetWidth,
      offsetHeight: el.offsetHeight,
      childElements: el.children.length
    }
  }).catch(e => ({ error: e.message }))

  console.log('Page content info:', JSON.stringify(pageInfo, null, 2))

  // Check if active class exists
  const activeExists = await pageContent.classList.contains('active').catch(() => false)
  console.log('Has active class:', activeExists)

  // Check if page is actually visible in viewport
  const bounds = await pageContent.boundingBox()
  console.log('Page bounding box:', bounds)

  // Check body content
  const bodyText = await page.locator('body').textContent().catch(() => '')
  console.log('Body has "Bills" text:', bodyText.includes('Bills'))

  // Check the actual HTML structure
  const html = await page.locator('#page-content').innerHTML().catch(() => '')
  console.log('Page content starts with:', html.substring(0, 300))
})