import { expect,test } from '@playwright/test'

test('debug computed styles', async ({ page }) => {
  await page.goto('http://localhost:3800/#bills')
  await page.waitForLoadState('networkidle', { timeout: 10000 })

  const addBillBtn = page.locator('button').filter({ hasText: 'Add Bill' })

  // Check if the header-top parent is causing issues
  const result = await addBillBtn.evaluate((el: any) => {
    const parent = el.parentElement
    if (parent) {
      return {
        parentTag: parent.tagName,
        parentClass: parent.className,
        parentText: parent.textContent?.substring(0, 100),
        parentStyles: {
          display: window.getComputedStyle(parent).display,
          flexDirection: window.getComputedStyle(parent).flexDirection,
          flexWrap: window.getComputedStyle(parent).flexWrap,
          justifyContent: window.getComputedStyle(parent).justifyContent,
          alignItems: window.getComputedStyle(parent).alignItems,
          width: window.getComputedStyle(parent).width,
          height: window.getComputedStyle(parent).height,
          overflow: window.getComputedStyle(parent).overflow
        },
        buttonStyles: {
          width: window.getComputedStyle(el).width,
          height: window.getComputedStyle(el).height,
          flex: window.getComputedStyle(el).flex,
          flexBasis: window.getComputedStyle(el).flexBasis,
          flexShrink: window.getComputedStyle(el).flexShrink,
          flexGrow: window.getComputedStyle(el).flexGrow
        }
      }
    }
    return { error: 'No parent' }
  }).catch(e => ({ error: e.message }))

  console.log('Debug result:', JSON.stringify(result, null, 2))

  // Check for any CSS rule that specifically targets buttons within header-top
  const headerRules = await page.evaluate(() => {
    const rules: any[] = []
    const sheets = Array.from(document.styleSheets)
    for (const sheet of sheets) {
      try {
        for (const rule of Array.from(sheet.cssRules)) {
          if (rule.selectorText?.includes('header-top button') || rule.selectorText?.includes('header-top .btn')) {
            rules.push({ selector: rule.selectorText, css: rule.cssText?.substring(0, 500) })
          }
        }
      } catch (e) {}
    }
    return rules
  }).catch(e => ({ error: e.message }))

  console.log('Header-top rules:', JSON.stringify(headerRules, null, 2))

  await page.screenshot({ path: '/tmp/bills-debug3.png', fullPage: true })
})