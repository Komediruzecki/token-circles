/**
 * The circles' parts at phone width (circles part 2): at 390 px every target is 48 px both ways and
 * every piece of text 12 px or more as drawn, and at 320 px nothing scrolls sideways. Local-first.
 */
import { expect, test } from '@playwright/test'
import { phoneFloors, sideways } from './phone-floors'
import { gotoServerlessZeroState } from './test-helpers'
import type { Page } from '@playwright/test'

const PHONE = { width: 390, height: 844 }
const NARROWEST = { width: 320, height: 640 }
const NOTHING_BELOW = { targets: [], text: [] }

/** A workspace with its first profile, and setup left after the space step. */
async function aSpaceOnly(page: Page): Promise<void> {
  await gotoServerlessZeroState(page, 'dashboard', 'onboarding-wizard')
  await page.getByTestId('onboarding-next').click()
  await expect(page.getByTestId('onboarding-step-space')).toBeVisible()
  await page.getByTestId('onboarding-next').click()
  await expect(page.getByTestId('onboarding-step-account')).toBeVisible()
  await page.getByTestId('onboarding-skip').click()
  await page.getByTestId('confirm-accept').click()
  await expect(page.getByTestId('onboarding-wizard')).toHaveCount(0)
}

async function go(page: Page, hash: string): Promise<void> {
  await page.evaluate((h) => {
    window.location.hash = h
  }, hash)
}

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
})
