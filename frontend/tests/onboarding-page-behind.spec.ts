/**
 * The setup wizard on a phone: the page behind it holds still and stays out of sight.
 *
 * Reported from an iPhone (iOS Safari) on dev, 2026-10-30: with the wizard open, the Dashboard
 * showed around it (the spending heatmap under the bottom toolbar, page text under the status bar)
 * and scrolled under a finger. The wizard is a fixed layer; the document behind it was still the
 * scroller, still focusable and still painted. Measured here before the fix, iPhone 13 profile:
 * a wheel turn on the wizard's ground moved the document 600 px, a touch drag 834 px.
 *
 * Chromium with an iPhone profile, so touch drags go through CDP, which scrolls the way a finger
 * does. It cannot show Safari's toolbars, so "nothing painted behind" is checked as the shell being
 * hidden, which holds wherever Safari draws.
 */
import { devices, expect, test } from '@playwright/test'
import { gotoServerlessZeroState } from './test-helpers'
import type { Page } from '@playwright/test'

const iPhone = devices['iPhone 13']
test.use({
  storageState: { cookies: [], origins: [] },
  viewport: iPhone.viewport,
  userAgent: iPhone.userAgent,
  deviceScaleFactor: iPhone.deviceScaleFactor,
  isMobile: true,
  hasTouch: true,
})

const scrollY = (page: Page) => page.evaluate(() => Math.round(window.scrollY))

/** A finger drag from (x, fromY) to (x, toY), as touch events the compositor scrolls by. */
async function drag(page: Page, x: number, fromY: number, toY: number): Promise<void> {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: fromY }] })
  for (let i = 1; i <= 10; i++) {
    const y = fromY + ((toY - fromY) * i) / 10
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] })
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await cdp.detach()
}

/** Every way a phone or a mouse tries to move the page while the wizard is open. */
async function tryToScrollThePage(page: Page): Promise<void> {
  // The wizard's ground, outside the panel: the top-left corner.
  await page.mouse.move(8, 8)
  await page.mouse.wheel(0, 600)
  await drag(page, 10, 600, 100)
  // Inside the panel, past the end of whatever it has to scroll.
  const body = await page.getByTestId('onboarding-panel').locator('> div').first().boundingBox()
  expect(body).not.toBeNull()
  const x = body!.x + body!.width / 2
  const mid = body!.y + body!.height / 2
  for (let i = 0; i < 3; i++)
    await drag(page, x, mid + body!.height * 0.4, mid - body!.height * 0.4)
  await page.mouse.move(x, mid)
  await page.mouse.wheel(0, 1600)
  // Let any fling settle before reading where the page is.
  await page.waitForTimeout(600)
}

/** Skip setup and confirm, as the wizard asks. */
async function leaveTheWizard(page: Page): Promise<void> {
  await page.getByTestId('onboarding-skip').click()
  await page.getByTestId('confirm-accept').click()
  await expect(page.getByTestId('onboarding-wizard')).toHaveCount(0)
}

test.describe('the page behind the setup wizard, on a phone', () => {
  test('does not scroll, show, or take focus while the wizard is open, and comes back on close @smoke', async ({
    page,
  }) => {
    test.setTimeout(90_000)
    await gotoServerlessZeroState(page, 'dashboard', 'onboarding-wizard')
    await expect(page.getByTestId('onboarding-panel')).toBeVisible()

    // There is a page to scroll: the empty Dashboard is taller than the phone.
    const tall = await page.evaluate(() => document.scrollingElement!.scrollHeight - innerHeight)
    expect(tall).toBeGreaterThan(500)

    await tryToScrollThePage(page)
    expect(await scrollY(page)).toBe(0)

    // Nothing of the shell is drawn, reachable by Tab, or in the accessibility tree.
    await expect(page.getByTestId('dashboard-container')).toBeHidden()
    await expect(page.getByRole('button', { name: 'Quick add entry' })).toHaveCount(0)
    for (let i = 0; i < 25; i++) {
      await page.keyboard.press('Tab')
      const inWizard = await page.evaluate(() => {
        const wizard = document.querySelector('[data-test-id="onboarding-wizard"]')
        const active = document.activeElement
        return active === document.body || !!wizard?.contains(active)
      })
      expect(inWizard, `Tab ${i + 1} stays in the wizard`).toBe(true)
    }

    await leaveTheWizard(page)
    await expect(page.getByTestId('dashboard-container')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Quick add entry' })).toBeVisible()
    await page.mouse.move(200, 400)
    await page.mouse.wheel(0, 400)
    await expect.poll(() => scrollY(page)).toBeGreaterThan(0)
  })

  test('opened from a scrolled Settings page, it closes onto the same place @smoke', async ({
    page,
  }) => {
    test.setTimeout(90_000)
    await gotoServerlessZeroState(page, 'dashboard', 'onboarding-wizard')
    await leaveTheWizard(page)

    await page.evaluate(() => {
      window.location.hash = 'settings'
    })
    await page.getByTestId('settings-tab-about').click()
    const relaunch = page.getByTestId('settings-run-onboarding')
    // Halfway down: a place to keep, with room to move both ways. At the end of the page a scroll
    // down could not move it, with or without the wizard holding it.
    await expect(relaunch).toBeVisible()
    const max = await page.evaluate(() => document.scrollingElement!.scrollHeight - innerHeight)
    await page.evaluate(
      (y) => {
        window.scrollTo(0, y)
      },
      Math.floor(max / 2)
    )
    await expect(relaunch).toBeInViewport()
    const before = await scrollY(page)
    expect(before).toBeGreaterThan(0)
    expect(before).toBeLessThan(max)

    await relaunch.click()
    await expect(page.getByTestId('onboarding-panel')).toBeVisible()
    await tryToScrollThePage(page)
    expect(await scrollY(page)).toBe(before)

    await leaveTheWizard(page)
    expect(await scrollY(page)).toBe(before)
    await expect(relaunch).toBeInViewport()
  })

  test('on a short phone the panel still scrolls its own steps @smoke', async ({ page }) => {
    test.setTimeout(90_000)
    await page.setViewportSize({ width: 320, height: 568 })
    await gotoServerlessZeroState(page, 'dashboard', 'onboarding-wizard')
    // The name screen fits a 568 px screen. About this space, with its two questions, does not.
    await page.getByTestId('onboarding-next').click()
    await expect(page.getByTestId('onboarding-step-about')).toBeVisible({ timeout: 15_000 })
    const body = page.getByTestId('onboarding-body')
    const room = await body.evaluate((el) => el.scrollHeight - el.clientHeight)
    expect(room).toBeGreaterThan(0)

    const box = (await body.boundingBox())!
    await drag(page, box.x + box.width / 2, box.y + box.height * 0.9, box.y + box.height * 0.1)
    await expect.poll(() => body.evaluate((el) => el.scrollTop)).toBeGreaterThan(0)
    expect(await scrollY(page)).toBe(0)
    // The primary action is on screen, inside the panel.
    await expect(page.getByTestId('onboarding-next')).toBeInViewport()
  })
})
