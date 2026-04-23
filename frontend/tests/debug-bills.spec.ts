import { expect,test } from '@playwright/test'

test('debug bills page', async ({ page }) => {
  await page.goto('http://localhost:3800/#bills')

  // Wait for page to load
  await page.waitForLoadState('networkidle', { timeout: 10000 })

  // Take a screenshot for debugging
  await page.screenshot({ path: '/tmp/bills-debug.png', fullPage: true })

  // Check body
  console.log('Body has text:', await page.locator('body').textContent())

  // Check for page elements
  console.log('Page content visible:', await page.locator('#page-content').isVisible({ timeout: 3000 }).catch(() => false))
  console.log('Page content HTML:', await page.locator('#page-content').innerHTML({ timeout: 3000 }).catch(() => '<error>'))

  // Check for specific elements
  const hasBillsText = await page.locator('body:has-text("Bills")').isVisible({ timeout: 3000 }).catch(() => false)
  console.log('Has "Bills" text:', hasBillsText)

  const allAddBillButtons = await page.locator('button').filter({ hasText: 'Add Bill' })
  console.log('Total "Add Bill" buttons:', await allAddBillButtons.count())

  const firstAddBillBtn = allAddBillButtons.first()
  console.log('First "Add Bill" button class:', await firstAddBillBtn.getAttribute('class'))
  console.log('First "Add Bill" button visible:', await firstAddBillBtn.isVisible({ timeout: 3000 }).catch(() => false))

  const allButtons = await page.locator('button').count()
  console.log('Total buttons on page:', allButtons)

  // Check page content classes
  const pageContentEl = await page.locator('#page-content').evaluate(el => ({
    classes: el.className,
    style: el.style.cssText
  }))
  console.log('Page content classes:', pageContentEl.classes)
  console.log('Page content style:', pageContentEl.style)
  console.log('Has "active" class:', pageContentEl.classes.includes('active'))

  // Navigate to different page and check
  await page.locator('a[href="#transactions"]').click()
  await page.waitForTimeout(1000)

  const pageContentEl2 = await page.locator('#page-content').evaluate(el => ({
    classes: el.className,
    style: el.style.cssText
  }))
  console.log('After transaction navigation classes:', pageContentEl2.classes)
  console.log('Has "active" class after navigation:', pageContentEl2.classes.includes('active'))

  // Navigate back to bills
  await page.locator('a[href="#bills"]').click()
  await page.waitForTimeout(1000)

  const pageContentEl3 = await page.locator('#page-content').evaluate(el => ({
    classes: el.className,
    style: el.style.cssText
  }))
  console.log('After bills navigation classes:', pageContentEl3.classes)
  console.log('Has "active" class after navigation back:', pageContentEl3.classes.includes('active'))

  // Check sidebar
  const sidebarLink = page.locator('a[href="#bills"]')
  console.log('Sidebar link active:', await sidebarLink.getAttribute('class'))

  // Get console errors
  const errors: string[] = []
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(msg.text())
  })

  page.on('pageerror', error => errors.push(error.message))

  await page.waitForTimeout(2000)

  if (errors.length > 0) {
    console.log('Console errors:', errors)
  }
})