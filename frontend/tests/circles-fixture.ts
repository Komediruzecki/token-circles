/**
 * A local-first workspace for the circles' browser tests (circles-phone.spec.ts and
 * circles-layout.spec.ts): its first profile, setup left after the space step, and a year of
 * entries generated relative to today, as circles.spec.ts's. Each of the last twelve full months
 * has a salary of 3,000, a rent of 1,000 and two grocery runs of 200, and a savings account holds
 * 2,800, so Solid ground is the circle being worked on. Round invented values; nothing here is
 * anyone's.
 */
import { expect } from '@playwright/test'
import { viaApp } from './form-errors-helpers'
import { gotoServerlessZeroState } from './test-helpers'
import type { Page } from '@playwright/test'

/** 'YYYY-MM' `n` months before this one. */
export function monthsAgo(n: number): string {
  const d = new Date()
  d.setDate(1)
  d.setMonth(d.getMonth() - n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export const YEAR = [
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

/** Go to `hash` as a link would. */
export async function go(page: Page, hash: string): Promise<void> {
  await page.evaluate((h) => {
    window.location.hash = h
  }, hash)
}

/** A workspace with its first profile, and setup left after the space step. */
export async function aSpaceOnly(page: Page): Promise<void> {
  await gotoServerlessZeroState(page, 'dashboard', 'onboarding-wizard')
  await expect(page.getByTestId('onboarding-step-space')).toBeVisible()
  await page.getByTestId('onboarding-next').click()
  await expect(page.getByTestId('onboarding-step-about')).toBeVisible()
  await page.getByTestId('onboarding-next').click()
  await expect(page.getByTestId('onboarding-step-account')).toBeVisible()
  await page.getByTestId('onboarding-skip').click()
  await page.getByTestId('confirm-accept').click()
  await expect(page.getByTestId('onboarding-wizard')).toHaveCount(0)
}

/** The year imported as pasted CSV, and 2,800 put in a savings account. */
export async function aYear(page: Page): Promise<void> {
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
