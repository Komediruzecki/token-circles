import { expect, test } from '@playwright/test'
import fs from 'fs'

test.describe('Debug 2', () => {
  test('check page structure', async ({ page, context }) => {
    await page.addInitScript(() => {
      localStorage.setItem('currentProfileId', '1')
      localStorage.setItem('darkMode', 'false')
    })

    await page.goto('http://localhost:3847/#transactions')

    // Wait for page to stabilize
    await page.waitForTimeout(5000)

    // Get all elements with IDs
    const allElements = await page.locator('*').all()
    
    const elementsWithDataAttributes: any[] = []
    for (const el of allElements) {
      const attrs = await el.evaluate((e: any) => {
        return {
          tag: e.tagName,
          id: e.id,
          className: e.className,
          hasDataTestId: !!e.dataset.testId,
          innerHTML: e.innerHTML.substring(0, 100),
        }
      })
      elementsWithDataAttributes.push(attrs)
    }

    // Check if dashboard page loads
    const dashPage = await page.locator('#root').locator('div[data-testid="page-dashboard"]').count()
    
    // Check for any content
    const pageContent = await page.locator('#root').innerHTML()

    fs.writeFileSync('/tmp/finance-manager/frontend/debug2-output.json', JSON.stringify({
      allElementCount: allElements.length,
      dashPageCount: dashPage,
      pageContent: pageContent,
      elementsWithDataAttributes: elementsWithDataAttributes.slice(0, 50),
    }, null, 2))

    expect(allElements.length).toBeGreaterThan(0)
  })
})
