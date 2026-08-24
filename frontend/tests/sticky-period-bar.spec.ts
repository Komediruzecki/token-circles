/**
 * The period bar stays put while the page scrolls.
 *
 * None of this can be tested from the component. `position: sticky` only travels inside its own
 * parent's box, so whether the bar actually pins depends entirely on where the page puts it — the
 * exact thing a unit test cannot see. These scroll a real page and read where the bar ended up.
 */
import { expect, test, type Page } from '@playwright/test'
import { getByTestId, login, navigateToRoute } from './test-helpers'

/**
 * Pages are kept alive when you navigate away, so several PeriodBars are mounted at once and a
 * bare `period-bar` locator matches all of them. Everything here is scoped to the page under test.
 */
const PAGES = [
  { route: 'budgets', container: 'budgets-page' },
  { route: 'transactions', container: 'page-transactions' },
  { route: 'dashboard', container: 'dashboard-container' },
] as const

const barIn = (page: Page, container: string) =>
  getByTestId(page, container).getByTestId('period-bar')

/**
 * The preference ships OFF, so every test about pinning has to turn it on first — before the app
 * boots, because the signal reads storage once at import.
 */
const enableSticky = (page: Page) =>
  page.addInitScript(() => {
    try {
      localStorage.setItem('finance-sticky-period-bar', 'true')
    } catch {
      /* about:blank */
    }
  })

/** Where the bar is, in viewport coordinates. */
async function barTop(page: Page, container: string): Promise<number> {
  const box = await barIn(page, container).boundingBox()
  expect(box).not.toBeNull()
  return box!.y
}

/** Scroll far enough that an unpinned bar would be well off the top of the screen. */
async function scrollDown(page: Page, by = 900): Promise<void> {
  await page.evaluate((y) => {
    window.scrollTo(0, y)
  }, by)
  await page.waitForTimeout(150)
}

const pageIsScrollable = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight > 400)

test.describe('the period bar stays in view', () => {
  test.beforeEach(async ({ page }) => {
    await enableSticky(page)
    await login(page)
  })

  for (const { route, container } of PAGES) {
    test(`pins to the top on ${route}`, async ({ page }) => {
      await navigateToRoute(page, route)
      await expect(barIn(page, container)).toBeVisible()
      test.skip(!(await pageIsScrollable(page)), `${route} is too short to scroll in this fixture`)

      const before = await barTop(page, container)
      await scrollDown(page)
      const after = await barTop(page, container)

      // Still on screen, near the top — not carried off with the rest of the page.
      expect(after).toBeGreaterThanOrEqual(0)
      expect(after).toBeLessThan(before)
      expect(after).toBeLessThan(120)
      await expect(barIn(page, container)).toBeInViewport()
    })
  }

  test('is still usable once pinned', async ({ page }) => {
    await navigateToRoute(page, 'budgets')
    const host = page.locator('[data-test-id="month-selector"]')
    await expect(barIn(page, 'budgets-page')).toBeVisible()
    test.skip(!(await pageIsScrollable(page)), 'budgets is too short to scroll in this fixture')
    await scrollDown(page)

    // The whole point: change the month without scrolling back up.
    const label = await host.getByTestId('period-label').textContent()
    await host.getByTestId('period-prev').click()
    await expect(host.getByTestId('period-label')).not.toHaveText(label ?? '')
    await host.getByTestId('period-next').click()
    await expect(host.getByTestId('period-label')).toHaveText(label ?? '')
  })

  test('gains its lifted look only once it is actually pinned', async ({ page }) => {
    await navigateToRoute(page, 'budgets')
    const host = page.locator('[data-test-id="month-selector"]')
    await expect(host).toHaveAttribute('data-sticky', 'on')
    test.skip(!(await pageIsScrollable(page)), 'budgets is too short to scroll in this fixture')

    // Sitting in the flow: no shadow, because nothing is passing underneath it.
    await expect(host).toHaveAttribute('data-stuck', 'false')
    await scrollDown(page)
    await expect(host).toHaveAttribute('data-stuck', 'true')
    await page.evaluate(() => {
      window.scrollTo(0, 0)
    })
    await expect(host).toHaveAttribute('data-stuck', 'false')
  })

  test('keeps the anchors the tours and the other specs rely on', async ({ page }) => {
    await navigateToRoute(page, 'budgets')
    // The wrapper divs that used to carry these are gone; the component owns them now.
    await expect(page.locator('[data-test-id="month-selector"]')).toBeVisible()
    await expect(page.locator('[data-tour="budgets-month"]')).toHaveCount(1)
    await expect(
      page.locator('[data-test-id="month-selector"] [data-test-id="period-bar"]')
    ).toBeVisible()

    await navigateToRoute(page, 'dashboard')
    await expect(page.locator('[data-tour="dashboard-period"]')).toHaveCount(1)
  })
})

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 780 } })

  test.beforeEach(async ({ page }) => {
    await enableSticky(page)
    await login(page)
  })

  test('pins below the menu button rather than underneath it', async ({ page }) => {
    await navigateToRoute(page, 'budgets')
    await expect(barIn(page, 'budgets-page')).toBeVisible()
    test.skip(!(await pageIsScrollable(page)), 'budgets is too short to scroll on this viewport')
    await scrollDown(page)

    const bar = (await barIn(page, 'budgets-page').boundingBox())!
    const menu = await page
      .locator('button[class*="mobile-toggle"], button[class*="mobileToggle"]')
      .first()
      .boundingBox()

    expect(bar.y).toBeGreaterThanOrEqual(0)
    await expect(barIn(page, 'budgets-page')).toBeInViewport()
    if (menu) {
      // Below the fixed menu button, not sliding under it — the one offset that makes this look
      // broken rather than merely unpolished.
      expect(bar.y).toBeGreaterThanOrEqual(menu.y + menu.height - 1)
    }

    // And it does not eat the screen: a slim bar, not a header.
    expect(bar.height).toBeLessThan(140)
  })

  test('does not overflow the viewport width', async ({ page }) => {
    await navigateToRoute(page, 'budgets')
    const bar = (await barIn(page, 'budgets-page').boundingBox())!
    expect(bar.x).toBeGreaterThanOrEqual(0)
    expect(bar.x + bar.width).toBeLessThanOrEqual(390 + 1)
    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1
    )
    expect(overflows).toBe(false)
  })
})

/**
 * The bar's own shape on a phone, which has nothing to do with the setting — it applies whether
 * the bar is pinned or not, and it is the reason the pinned bar is worth having rather than an
 * obstruction: three rows of controls stuck to the top of a phone is a header, not a control.
 */
test.describe('the bar on a phone', () => {
  test.use({ viewport: { width: 390, height: 780 } })

  test('lays out in two rows, with "All" beside the steppers', async ({ page }) => {
    await login(page)
    await navigateToRoute(page, 'budgets')
    const bar = barIn(page, 'budgets-page')
    await expect(bar).toBeVisible()

    const steppers = bar.getByTestId('period-prev')
    const all = bar.getByTestId('period-pill-all')
    const thisMonth = bar.getByTestId('period-pill-thisMonth')

    const [step, allBox, monthBox] = await Promise.all([
      steppers.boundingBox(),
      all.boundingBox(),
      thisMonth.boundingBox(),
    ])

    // "All" shares the steppers' row: same vertical centre, and to their right.
    const centre = (b: { y: number; height: number }) => b.y + b.height / 2
    expect(Math.abs(centre(allBox!) - centre(step!))).toBeLessThan(12)
    expect(allBox!.x).toBeGreaterThan(step!.x)

    // The remaining pills are on a second row, below both.
    expect(monthBox!.y).toBeGreaterThan(allBox!.y + allBox!.height - 4)

    // Exactly two rows: count the distinct vertical centres of every control in the bar.
    const rows = await bar.evaluate((root: HTMLElement) => {
      const centres = [...root.querySelectorAll('button')].map((el) => {
        const r = el.getBoundingClientRect()
        return Math.round((r.y + r.height / 2) / 8)
      })
      return new Set(centres).size
    })
    expect(rows).toBe(2)
  })

  test('the pills fit their row without overflowing it', async ({ page }) => {
    await login(page)
    await navigateToRoute(page, 'budgets')
    const bar = barIn(page, 'budgets-page')
    await expect(bar).toBeVisible()

    const box = (await bar.boundingBox())!
    for (const id of ['thisMonth', 'lastMonth', 'ytd', 'last30', 'last90', 'all']) {
      const pill = (await bar.getByTestId(`period-pill-${id}`).boundingBox())!
      expect(pill.x, `${id} starts left of the bar`).toBeGreaterThanOrEqual(box.x - 1)
      expect(pill.x + pill.width, `${id} runs past the bar`).toBeLessThanOrEqual(
        box.x + box.width + 1
      )
    }
  })
})

test.describe('when nobody has turned it on', () => {
  test('the bar scrolls away with the page', async ({ page }) => {
    // No init script: this is a fresh account seeing the app as it ships.
    await login(page)
    await navigateToRoute(page, 'budgets')

    const host = page.locator('[data-test-id="month-selector"]')
    await expect(host).toHaveAttribute('data-sticky', 'off')
    await expect(barIn(page, 'budgets-page')).toBeVisible()
    test.skip(!(await pageIsScrollable(page)), 'budgets is too short to scroll in this fixture')

    await scrollDown(page, 1200)
    // Carried off the top with everything else, which is what off means.
    await expect(barIn(page, 'budgets-page')).not.toBeInViewport()
  })

  test('turning it on in Settings pins the bar', async ({ page }) => {
    await login(page)
    await navigateToRoute(page, 'settings')
    const toggle = page.locator('#setting-sticky-period')
    await expect(toggle).toBeVisible()
    await toggle.click()

    await navigateToRoute(page, 'budgets')
    const host = page.locator('[data-test-id="month-selector"]')
    await expect(host).toHaveAttribute('data-sticky', 'on')
    test.skip(!(await pageIsScrollable(page)), 'budgets is too short to scroll in this fixture')

    const before = await barTop(page, 'budgets-page')
    await scrollDown(page)
    const after = await barTop(page, 'budgets-page')
    expect(after).toBeLessThan(before)
    await expect(barIn(page, 'budgets-page')).toBeInViewport()
  })
})
