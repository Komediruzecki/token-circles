import { expect,test } from '@playwright/test'

test('debug add bill button', async ({ page }) => {
  await page.goto('http://localhost:3800/#bills')
  await page.waitForLoadState('networkidle', { timeout: 10000 })

  const addBillBtn = page.locator('button').filter({ hasText: 'Add Bill' })

  // Get debug info for the Add Bill button specifically
  const info = await addBillBtn.evaluate((el: any) => {
    const parent = el.parentElement
    if (!parent) return { error: 'No parent' }

    return {
      btn: {
        tagName: el.tagName,
        className: el.className,
        textContent: el.textContent?.substring(0, 50),
        offsetWidth: el.offsetWidth,
        offsetHeight: el.offsetHeight,
        style: {
          width: el.style.width,
          height: el.style.height,
          display: el.style.display,
          flex: el.style.flex
        },
        computed: {
          width: window.getComputedStyle(el).width,
          height: window.getComputedStyle(el).height,
          display: window.getComputedStyle(el).display,
          flex: window.getComputedStyle(el).flex,
          flexShrink: window.getComputedStyle(el).flexShrink
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
  }).catch(e => ({ error: e.message }))

  console.log('Add Bill button info:', JSON.stringify(info, null, 2))

  // Check if there's a CSS rule with higher specificity affecting the button
  const selectorMatch = await addBillBtn.evaluate((el: any) => {
    const sheets = Array.from(document.styleSheets)
    const matches = []

    for (const sheet of sheets) {
      try {
        for (const rule of Array.from(sheet.cssRules)) {
          try {
            if (el.matches(rule.selectorText)) {
              matches.push({
                selector: rule.selectorText,
                css: rule.cssText?.substring(0, 500)
              })
            }
          } catch (e) {}
        }
      } catch (e) {}
    }
    return matches
  }).catch(e => ({ error: e.message }))

  console.log('Selector matches for Add Bill button:', JSON.stringify(selectorMatch, null, 2))

  // Check all CSS rules that might be affecting this button
  const allRules = await page.evaluate(() => {
    const rules: any[] = []
    const sheets = Array.from(document.styleSheets)

    for (const sheet of sheets) {
      try {
        for (const rule of Array.from(sheet.cssRules)) {
          if (rule.selectorText?.includes('button') || rule.selectorText?.includes('.header-top')) {
            rules.push({
              selector: rule.selectorText,
              css: rule.cssText?.substring(0, 500)
            })
          }
        }
      } catch (e) {}
    }
    return rules
  }).catch(e => ({ error: e.message }))

  console.log('Relevant CSS rules:', JSON.stringify(allRules, null, 2))
})