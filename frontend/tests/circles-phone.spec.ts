/**
 * The circles' parts at phone width (circles part 2): at 390 px every target is 48 px both ways and
 * every piece of text 12 px or more as drawn, and at 320 px nothing scrolls sideways. Local-first;
 * the statement is generated here, relative to today, as circles.spec.ts's: the last twelve full
 * months, each with a salary of 3,000, a rent of 1,000 and two grocery runs of 200, and 2,800 in a
 * savings account. Round invented values; nothing here is anyone's.
 */
import { expect, test } from '@playwright/test'
import { aSpaceOnly, aYear, go } from './circles-fixture'
import { phoneFloors, sideways } from './phone-floors'

const PHONE = { width: 390, height: 844 }
const NARROWEST = { width: 320, height: 640 }
const NOTHING_BELOW = { targets: [], text: [] }

test.describe('The circles at phone width', () => {
  test.beforeEach(() => {
    test.setTimeout(150_000)
  })

  test("the ledger: each circle's number at 12 px or more, each row a 48 px target", async ({
    page,
  }) => {
    await aSpaceOnly(page)
    await page.setViewportSize(PHONE)
    await go(page, 'progress')
    const ledger = page.getByTestId('progress-circles')
    await expect(ledger.getByTestId('circle-row')).toHaveCount(7, { timeout: 30_000 })
    await expect(ledger.locator('svg text')).toHaveCount(7)
    expect(await phoneFloors(page, ['[data-test-id="progress-circles"]'])).toEqual(NOTHING_BELOW)

    await page.setViewportSize(NARROWEST)
    expect(await sideways(page)).toBe(0)
  })

  test("a circle's cards: each source a 48 px target once Where this comes from opens", async ({
    page,
  }) => {
    await aSpaceOnly(page)
    await aYear(page)
    await page.setViewportSize(PHONE)
    await go(page, 'progress/4')
    const view = page.getByTestId('circle-view')
    const where = view.getByTestId('benchmark-where')
    await expect(where.first()).toBeVisible({ timeout: 30_000 })
    for (const each of await where.all()) await each.locator('summary').click()
    await expect(where.first().locator('a').first()).toBeVisible()
    expect(await phoneFloors(page, ['[data-test-id="circle-view"]'])).toEqual(NOTHING_BELOW)

    await page.setViewportSize(NARROWEST)
    expect(await sideways(page)).toBe(0)
  })

  test("Dashboard's next step and savings gauge: 48 px targets, 12 px text", async ({ page }) => {
    await aSpaceOnly(page)
    await aYear(page)
    await page.setViewportSize(PHONE)
    await go(page, 'dashboard')
    const home = page.getByTestId('dashboard-container')
    await expect(home.getByTestId('next-step-card')).toBeVisible({ timeout: 30_000 })
    // The benchmarks gate is open in development: the region note and its Change link show.
    await expect(home.getByTestId('savings-gauge-region')).toBeVisible({ timeout: 30_000 })
    const parts = [
      '[data-test-id="dashboard-container"] [data-test-id="next-step-card"]',
      '[data-test-id="savings-gauge"]',
    ]
    expect(await phoneFloors(page, parts)).toEqual(NOTHING_BELOW)

    await page.setViewportSize(NARROWEST)
    expect(await sideways(page)).toBe(0)
  })
})
