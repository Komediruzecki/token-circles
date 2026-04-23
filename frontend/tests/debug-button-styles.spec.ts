import { expect,test } from '@playwright/test'

test('debug button styles', async ({ page }) => {
  await page.goto('http://localhost:3800/#bills')
  await page.waitForLoadState('networkidle', { timeout: 10000 })

  const addBillBtn = page.locator('button').filter({ hasText: 'Add Bill' })

  // Check if button is in DOM
  const inDOM = await addBillBtn.evaluate(el => {
    return {
      attached: el.isConnected,
      classList: el.className,
      textContent: el.textContent,
      innerHTML: el.innerHTML,
      parentClass: el.parentElement?.className,
      parentTextContent: el.parentElement?.textContent?.substring(0, 100),
      offsetWidth: el.offsetWidth,
      offsetHeight: el.offsetHeight
    }
  }).catch(e => ({ error: e.message }))

  console.log('Button in DOM:', JSON.stringify(inDOM, null, 2))

  // Check styles on button with lowercased class
  const buttonStyles = await addBillBtn.evaluate(el => {
    return {
      display: window.getComputedStyle(el).display,
      fontSize: window.getComputedStyle(el).fontSize,
      fontWeight: window.getComputedStyle(el).fontWeight,
      padding: window.getComputedStyle(el).padding,
      margin: window.getComputedStyle(el).margin,
      width: window.getComputedStyle(el).width,
      height: window.getComputedStyle(el).height,
      opacity: window.getComputedStyle(el).opacity,
      zIndex: window.getComputedStyle(el).zIndex
    }
  }).catch(e => ({ error: e.message }))

  console.log('Button styles:', JSON.stringify(buttonStyles, null, 2))

  // Try clicking using direct click
  const clickSuccess = await addBillBtn.first().click({ timeout: 5000 }).then(() => true).catch(() => false)
  console.log('Click success:', clickSuccess)

  // Check if page changed
  const url = page.url()
  console.log('URL after click attempt:', url)

  await page.screenshot({ path: '/tmp/bills-with-button.png', fullPage: true })
})