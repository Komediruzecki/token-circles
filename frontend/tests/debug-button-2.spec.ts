import { expect,test } from '@playwright/test'

test('debug button issue', async ({ page }) => {
  await page.goto('http://localhost:3800/#bills')
  await page.waitForLoadState('networkidle', { timeout: 10000 })

  const addBillBtn = page.locator('button').filter({ hasText: 'Add Bill' })

  // Get debug info
  const info = await page.evaluate(() => {
    const btn = document.querySelector('button') as HTMLElement
    if (!btn) return { error: 'No button found' }

    const parent = btn.parentElement
    if (!parent) return { error: 'No parent' }

    return {
      btn: {
        tagName: btn.tagName,
        className: btn.className,
        offsetWidth: btn.offsetWidth,
        offsetHeight: btn.offsetHeight,
        style: {
          width: btn.style.width,
          height: btn.style.height,
          display: btn.style.display,
          flex: btn.style.flex
        },
        computed: {
          width: window.getComputedStyle(btn).width,
          height: window.getComputedStyle(btn).height,
          display: window.getComputedStyle(btn).display,
          flex: window.getComputedStyle(btn).flex
        }
      },
      parent: {
        tagName: parent.tagName,
        className: parent.className,
        offsetWidth: parent.offsetWidth,
        offsetHeight: parent.offsetHeight,
        display: window.getComputedStyle(parent).display
      }
    }
  })

  console.log('Button info:', JSON.stringify(info, null, 2))

  // Check CSS rules
  const rules = await page.evaluate(() => {
    const matching: string[] = []
    const sheets = Array.from(document.styleSheets)
    for (const sheet of sheets) {
      try {
        for (const rule of Array.from(sheet.cssRules)) {
          try {
            if (rule.selectorText?.includes('header-top')) {
              matching.push({
                selector: rule.selectorText,
                css: rule.cssText?.substring(0, 300)
              })
            }
          } catch (e) {}
        }
      } catch (e) {}
    }
    return matching
  })

  console.log('Matching header-top rules:', JSON.stringify(rules, null, 2))

  // Try clicking
  const clicked = await addBillBtn.click().catch(() => false)
  console.log('Click success:', clicked)
})