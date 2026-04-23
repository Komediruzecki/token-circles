import { expect,test } from '@playwright/test'

test('debug button parent chain', async ({ page }) => {
  await page.goto('http://localhost:3800/#bills')
  await page.waitForLoadState('networkidle', { timeout: 10000 })

  const addBillBtn = page.locator('button').filter({ hasText: 'Add Bill' })

  // Get full parent chain
  const chain = await addBillBtn.evaluate((el: any) => {
    const chain = []
    let current = el

    while (current && current !== document.body) {
      const styles = {
        tag: current.tagName,
        class: current.className,
        id: current.id,
        text: current.textContent?.substring(0, 50).replace(/\s+/g, ' '),
        offsetWidth: current.offsetWidth,
        offsetHeight: current.offsetHeight,
        display: window.getComputedStyle(current).display,
        visibility: window.getComputedStyle(current).visibility,
        opacity: window.getComputedStyle(current).opacity,
        position: window.getComputedStyle(current).position,
        overflow: window.getComputedStyle(current).overflow,
        width: window.getComputedStyle(current).width,
        height: window.getComputedStyle(current).height,
        flex: window.getComputedStyle(current).flex,
        flexDirection: window.getComputedStyle(current).flexDirection
      }
      chain.push(styles)
      current = current.parentElement
    }
    return chain
  }).catch(e => ({ error: e.message }))

  console.log('Parent chain:', JSON.stringify(chain, null, 2))

  // Check if any parent has overflow hidden
  const hiddenParent = chain.find((p: any) => p.overflow === 'hidden' || p.display === 'none' || p.visibility === 'hidden')

  if (hiddenParent) {
    console.log('Found hidden parent:', hiddenParent)
  } else {
    console.log('No hidden parents found')
  }

  // Check the level right before the button (index from bottom)
  const buttonIndex = chain.length - 1
  const parentOfButton = buttonIndex > 0 ? chain[buttonIndex - 1] : null

  if (parentOfButton) {
    console.log('Parent of button:', JSON.stringify(parentOfButton, null, 2))
  }
})