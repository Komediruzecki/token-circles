import { expect, test } from '@playwright/test'
import { login, navigateToRoute } from './test-helpers'

/**
 * An (i) explanation opens beside its icon, inside the window.
 *
 * Its panel is `position: fixed`, placed from the icon's box in window coordinates. Inside an
 * ancestor with a backdrop-filter, a transform or a filter, "fixed" is measured from that ancestor
 * instead, and Dashboard's metric cards blur what is behind them: on 19 Nov the Net Worth
 * explanation opened 431 px below its icon at 1440x900 and 427 px below it on a phone, off the
 * bottom of the window both times. The panel now renders at the end of the page, where no
 * ancestor can move it.
 *
 * Opened from the keyboard (focus), which is one of its three ways in: in a dev build a click on
 * a metric card also opens the calculation tracer.
 */
const SIZES = [
  { name: 'a window', use: { viewport: { width: 1440, height: 900 } } },
  {
    name: 'a phone',
    use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
  },
]

for (const size of SIZES) {
  test.describe(`on ${size.name}`, () => {
    test.use(size.use)

    test("Net Worth's explanation opens beside its (i), inside the window @smoke", async ({
      page,
    }) => {
      await login(page)
      await navigateToRoute(page, 'dashboard')
      const card = page.getByTestId('dashboard-metric-networth')
      await expect(card).toBeVisible({ timeout: 15000 })
      const trigger = card.getByRole('button', { name: /all account balances/ })
      await trigger.scrollIntoViewIfNeeded()
      await trigger.focus()
      const panel = page.getByRole('tooltip')
      await expect(panel).toBeVisible()
      await expect(trigger).toHaveAttribute('aria-describedby', (await panel.getAttribute('id'))!)

      const icon = (await trigger.boundingBox())!
      const box = (await panel.boundingBox())!
      const view = page.viewportSize()!
      // All of it inside the window...
      expect(box.x, 'left edge').toBeGreaterThanOrEqual(0)
      expect(box.y, 'top edge').toBeGreaterThanOrEqual(0)
      expect(box.x + box.width, 'right edge').toBeLessThanOrEqual(view.width)
      expect(box.y + box.height, 'bottom edge').toBeLessThanOrEqual(view.height)
      // ...and beside its icon: just under it (or just over it, near the bottom of the window),
      // with the icon's centre over the panel.
      const iconBottom = icon.y + icon.height
      const gap = box.y >= iconBottom ? box.y - iconBottom : icon.y - (box.y + box.height)
      expect(gap, 'gap between the icon and the panel').toBeGreaterThanOrEqual(0)
      expect(gap, 'gap between the icon and the panel').toBeLessThanOrEqual(12)
      const centre = icon.x + icon.width / 2
      expect(centre).toBeGreaterThanOrEqual(box.x)
      expect(centre).toBeLessThanOrEqual(box.x + box.width)
    })
  })
}

/**
 * A pinned explanation closes with its page.
 *
 * Every visited page stays mounted and is hidden with display: none, and the panel renders at the
 * end of the page, outside it. On 19 Nov a tip pinned on Dashboard stayed open after a hash change
 * and after Back on a phone, drawn at the top left of the window from its hidden icon's empty box,
 * over whatever page came next, until the next press.
 */
const netWorthTip = (page: import('@playwright/test').Page) =>
  page
    .getByTestId('dashboard-metric-networth')
    .getByRole('button', { name: /all account balances/ })

test.describe('a pinned explanation closes with its page', () => {
  test.describe('on a window', () => {
    test.use({ viewport: { width: 1440, height: 900 } })

    test('pinned with a click, then Loans by hash @smoke', async ({ page }) => {
      await login(page)
      await navigateToRoute(page, 'dashboard')
      const trigger = netWorthTip(page)
      await expect(trigger).toBeVisible({ timeout: 15000 })
      await trigger.click()
      const panel = page.getByRole('tooltip')
      await expect(panel).toBeVisible()

      await page.evaluate(() => {
        window.location.hash = '#loans'
      })
      await expect(page.getByTestId('loans-header')).toBeVisible({ timeout: 15000 })
      await expect(panel).toHaveCount(0)
    })
  })

  test.describe('on a phone', () => {
    test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

    test('pinned with a tap, then Back @smoke', async ({ page }) => {
      await login(page)
      await navigateToRoute(page, 'loans')
      await navigateToRoute(page, 'dashboard')
      const trigger = netWorthTip(page)
      await expect(trigger).toBeVisible({ timeout: 15000 })
      await trigger.scrollIntoViewIfNeeded()
      await trigger.tap()
      const panel = page.getByRole('tooltip')
      await expect(panel).toBeVisible()

      await page.goBack()
      await expect(page.getByTestId('loans-header')).toBeVisible({ timeout: 15000 })
      await expect(panel).toHaveCount(0)
    })
  })
})
