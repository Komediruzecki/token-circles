import { expect,test } from '@playwright/test'

test('debug matching CSS rules', async ({ page }) => {
  await page.goto('http://localhost:3800/#bills')
  await page.waitForLoadState('networkidle', { timeout: 10000 })

  const addBillBtn = page.locator('button').filter({ hasText: 'Add Bill' }).first()

  // Check which CSS rules match the button
  const matchingRules = await addBillBtn.evaluate((el: any) => {
    const matching: any[] = []
    const sheets = Array.from(document.styleSheets)

    for (const sheet of sheets) {
      try {
        for (const rule of Array.from(sheet.cssRules)) {
          try {
            // Check if this selector would match the element
            if (el.matches(rule.selectorText)) {
              matching.push({
                rule: rule.selectorText,
                css: rule.cssText?.substring(0, 500)
              })
            }
          } catch (e) {
            // Selector might be invalid
          }
        }
      } catch (e) {
        // CORS issues with some stylesheets
      }
    }
    return matching
  }).catch(e => ({ error: e.message }))

  console.log('Rules matching button:', JSON.stringify(matchingRules, null, 2))

  // Check all stylesheets
  await addBillBtn.evaluate((el: any) => {
    const stylesheets: any[] = []
    const sheets = Array.from(document.styleSheets)

    for (const sheet of sheets) {
      try {
        const rules: any[] = []
        for (const rule of Array.from(sheet.cssRules)) {
          // Check if this rule matches any descendant of the button
          if (el.closest(rule.selectorText)) {
            rules.push({
              selector: rule.selectorText
            })
          }
          // Check if button is a descendant
          try {
            if ((rule.selectorText?.includes('button') || rule.selectorText?.includes('header-top')) &&
                el.closest(rule.selectorText)) {
              rules.push({
                selector: rule.selectorText,
                matches: true
              })
            }
          } catch (e) {}
        }
        if (rules.length > 0) {
          stylesheets.push({
            href: sheet.href,
            rules: rules
          })
        }
      } catch (e) {}
    }
    console.log('Stylesheets with matching rules:', JSON.stringify(stylesheets, null, 2))
  })

  // Also check if button itself matches specific selectors
  const matches = await addBillBtn.evaluate((el: any) => {
    const tests = [
      'button',
      '.btn',
      'button.btn',
      'button.btn-primary',
      '.header-top button',
      '[class*="btn"]',
      'button:has-text("Add Bill")'
    ]
    return tests.map(t => ({ selector: t, matches: el.matches(t) }))
  }).catch(e => ({ error: e.message }))

  console.log('Selector matches:', JSON.stringify(matches, null, 2))

  await page.screenshot({ path: '/tmp/bills-debug2.png', fullPage: true })
})