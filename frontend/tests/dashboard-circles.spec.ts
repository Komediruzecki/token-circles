/**
 * Dashboard and the circles (circles part 2, design.md 2.1 and 2.3), in both storage modes: Your
 * next step takes Getting started's place once a year is on file, with a way to all seven circles,
 * and the savings gauge reads the last 12 tracked months whatever the period bar says, with the
 * goal kept on the profile. A goal this browser kept before goals were the profile's moves to the
 * first profile that opens Dashboard, once.
 *
 * The statement is generated here, relative to today, as circles.spec.ts's: the last twelve full
 * months, each with a salary of 3,000, a rent of 1,000 and two grocery runs of 200. So 1,600 of
 * 3,000 is kept a month, 53.3%; with 2,800 in a savings account, Solid ground is the circle being
 * worked on. Round invented values; nothing here is anyone's.
 */
import { expect, test } from '@playwright/test'
import { viaApp } from './form-errors-helpers'
import { bootSignedIn, deleteAccount, signUpAndIn } from './own-account'
import { E2E_BASE, gotoServerlessZeroState } from './test-helpers'
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

const KEPT = 'You kept 53.3% of your income'

/** Import a generated statement on the Import page, as pasted CSV. */
async function importStatement(page: Page, statement: string, rows: number): Promise<void> {
  await page.evaluate(() => {
    window.location.hash = 'import'
  })
  await expect(page.getByTestId('import-header')).toBeVisible({ timeout: 30_000 })
  await page.getByTestId('import-tab-paste-csv').click()
  await page.getByTestId('import-paste-textarea').fill(statement)
  await page.getByTestId('import-paste-parse').click()
  await page.getByTestId('import-continue-mapping').click()
  await page.getByTestId('import-continue-preview').click()
  await expect(page.getByTestId('import-preview-total')).toHaveText(String(rows))
  await page.getByTestId('import-execute-all').click()
  await expect(page.getByTestId('import-result')).toContainText(`Imported ${rows}`, {
    timeout: 30_000,
  })
}

async function openDashboard(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.location.hash = 'dashboard'
  })
  await expect(page.getByTestId('dashboard-header')).toBeVisible({ timeout: 30_000 })
}

const dashboard = (page: Page) => page.getByTestId('dashboard-container')

/** Signed up and in, with setup skipped, which gives the account its Getting started card. */
async function signedInAndSkipped(page: Page, before?: () => Promise<void>): Promise<string> {
  const ctx = page.context()
  const { email } = await signUpAndIn(ctx)
  await bootSignedIn(ctx)
  await page.goto(`${E2E_BASE}/#dashboard`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
  await expect(page.getByTestId('onboarding-step-welcome')).toBeVisible({ timeout: 30_000 })
  await before?.()
  await page.getByTestId('onboarding-skip').click()
  await page.getByTestId('confirm-accept').click()
  await expect(page.getByTestId('onboarding-wizard')).toHaveCount(0)
  return email
}

/** A goal kept the way Dashboard kept it before goals were the profile's. */
async function aBrowserGoal(page: Page): Promise<void> {
  await page.evaluate(() => {
    localStorage.setItem('savingsGoal', '15')
  })
}

/**
 * The gauge reads the year whatever the period, and the browser's goal is the profile's now: it
 * shows on the gauge, the browser holds it no more, and a reload reads it back.
 */
async function theGaugeKeepsTheYearAndTheGoal(page: Page): Promise<void> {
  await importStatement(page, YEAR, 48)
  await openDashboard(page)
  const gauge = dashboard(page).getByTestId('savings-gauge')
  await expect(gauge.getByTestId('savings-gauge-title')).toHaveText(KEPT, { timeout: 30_000 })
  await expect(gauge.locator('svg[role="img"]')).toContainText('12 MONTHS')
  const goal = 'Your goal: 15%. Reached, with 38.3 points to spare.'
  await expect(gauge.getByTestId('savings-gauge-goal')).toHaveText(goal, { timeout: 30_000 })
  expect(await page.evaluate(() => localStorage.getItem('savingsGoal'))).toBeNull()

  // This month has no entries: the totals follow the period, the gauge keeps to the year.
  await page.getByTestId('period-pill-thisMonth').click()
  await expect(dashboard(page).getByTestId('dashboard-metric-income')).toContainText('0.00', {
    timeout: 30_000,
  })
  await expect(gauge.getByTestId('savings-gauge-title')).toHaveText(KEPT)

  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByTestId('dashboard-header')).toBeVisible({ timeout: 30_000 })
  await expect(dashboard(page).getByTestId('savings-gauge-goal')).toHaveText(goal, {
    timeout: 30_000,
  })
}

test.describe('Dashboard: Your next step @smoke', () => {
  test.beforeEach(() => {
    test.setTimeout(150_000)
  })

  test('signed in: Getting started until a year is on file, then Your next step', async ({
    page,
  }) => {
    const email = await signedInAndSkipped(page)
    try {
      const home = dashboard(page)
      await expect(home.getByTestId('getting-started')).toBeVisible({ timeout: 30_000 })
      await expect(home.getByTestId('next-step-card')).toHaveCount(0)

      await importStatement(page, YEAR, 48)
      await viaApp(page, 'POST', '/api/accounts', {
        name: 'Rainy day',
        type: 'savings',
        starting_balance: 2800,
      })
      await openDashboard(page)
      const step = home.getByTestId('next-step-card')
      await expect(step.getByTestId('next-step-title')).toHaveText(
        'Grow your cushion to three months',
        { timeout: 30_000 }
      )
      // Retired, not hidden: nothing was written, so a lapsed year would bring it back.
      await expect(home.getByTestId('getting-started')).toHaveCount(0)
      await expect(home.getByTestId('savings-gauge-title')).toHaveText(KEPT)

      const circles = step.getByTestId('next-step-circles')
      expect((await circles.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(48)
      await circles.click()
      await expect(page.getByTestId('progress-header')).toBeVisible({ timeout: 30_000 })
    } finally {
      await deleteAccount(page.context(), email)
    }
  })
})

test.describe("Dashboard: the savings gauge's year and goal", () => {
  test.beforeEach(() => {
    test.setTimeout(150_000)
  })

  test('local-first: the gauge keeps to the year, and the browser goal moves to the profile once', async ({
    page,
  }) => {
    await gotoServerlessZeroState(page, 'dashboard', 'onboarding-wizard')
    await aBrowserGoal(page)
    // The space step makes the workspace's first profile; setup is left after it.
    await page.getByTestId('onboarding-next').click()
    await expect(page.getByTestId('onboarding-step-space')).toBeVisible()
    await page.getByTestId('onboarding-next').click()
    await expect(page.getByTestId('onboarding-step-account')).toBeVisible()
    await page.getByTestId('onboarding-skip').click()
    await page.getByTestId('confirm-accept').click()
    await expect(page.getByTestId('onboarding-wizard')).toHaveCount(0)
    await theGaugeKeepsTheYearAndTheGoal(page)
  })

  test('signed in: the gauge keeps to the year, and the browser goal moves to the profile once', async ({
    page,
  }) => {
    const email = await signedInAndSkipped(page, () => aBrowserGoal(page))
    try {
      await theGaugeKeepsTheYearAndTheGoal(page)
    } finally {
      await deleteAccount(page.context(), email)
    }
  })
})
