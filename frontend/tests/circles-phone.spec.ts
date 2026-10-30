/**
 * The circles' parts at phone width (circles part 2): at 390 px every target is 48 px both ways and
 * every piece of text 12 px or more as drawn, and at 320 px nothing scrolls sideways. Local-first;
 * the statement is generated here, relative to today, as circles.spec.ts's: the last twelve full
 * months, each with a salary of 3,000, a rent of 1,000 and two grocery runs of 200, and 2,800 in a
 * savings account. Round invented values; nothing here is anyone's.
 */
import { expect, test } from '@playwright/test'
import { viaApp } from './form-errors-helpers'
import { phoneFloors, sideways } from './phone-floors'
import { gotoServerlessZeroState } from './test-helpers'
import type { Page } from '@playwright/test'

/** 'YYYY-MM' `n` months before this one. */
function monthsAgo(n: number): string {
  const d = new Date()
  d.setDate(1)
  d.setMonth(d.getMonth() - n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

const YEAR = [
  'Date,Description,Amount,Category,Type',
  ...[12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1].flatMap((n) => {
    const m = monthsAgo(n)
    return [
      `${m}-01,Salary,3000.00,Salary,income`,
      `${m}-02,Flat rent,-1000.00,Rent,expense`,
      `${m}-10,Corner market,-200.00,Groceries,expense`,
      `${m}-21,Corner market,-200.00,Groceries,expense`,
    ]
  }),
].join('\n')

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

/** The year imported as pasted CSV, and 2,800 put in a savings account. */
async function aYear(page: Page): Promise<void> {
  await go(page, 'import')
  await expect(page.getByTestId('import-header')).toBeVisible({ timeout: 30_000 })
  await page.getByTestId('import-tab-paste-csv').click()
  await page.getByTestId('import-paste-textarea').fill(YEAR)
  await page.getByTestId('import-paste-parse').click()
  await page.getByTestId('import-continue-mapping').click()
  await page.getByTestId('import-continue-preview').click()
  await expect(page.getByTestId('import-preview-total')).toHaveText('48')
  await page.getByTestId('import-execute-all').click()
  await expect(page.getByTestId('import-result')).toContainText('Imported 48', {
    timeout: 30_000,
  })
  await viaApp(page, 'POST', '/api/accounts', {
    name: 'Rainy day',
    type: 'savings',
    starting_balance: 2800,
  })
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
})
