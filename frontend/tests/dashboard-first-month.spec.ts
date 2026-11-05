/**
 * The first Dashboard after setup imported earlier months only (review M6). People who imported
 * August to October on 3 November met November: "INCOME €0.00", "↓2350.00 vs last month" beside
 * "€2,350.00", "No flows for November 2026 yet". While Getting started shows, the Dashboard opens on
 * the latest month with entries and says so, once; a card's change names its currency and month.
 * Local-first, with a made-up Revolut statement dated relative to today, so it holds every month.
 */
import { expect, test } from '@playwright/test'
import { gotoServerlessZeroState } from './test-helpers'

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

/** The month `back` months before this one: its YYYY-MM and its name. */
function monthBack(back: number): { key: string; name: string } {
  const d = new Date()
  d.setDate(1)
  d.setMonth(d.getMonth() - back)
  return {
    key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
    name: MONTHS[d.getMonth()],
  }
}

/** A Revolut statement: pay and a shop in the month two back, pay and two shops last month. */
function statement(): string {
  const two = monthBack(2).key
  const one = monthBack(1).key
  const row = (day: string, type: string, what: string, amount: string) =>
    `${type},Current,${day} 09:00:00,${day} 09:00:00,${what},${amount},0,EUR,COMPLETED,0`
  return [
    'Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance',
    row(`${two}-02`, 'TOPUP', 'Payroll', '2000.00'),
    row(`${two}-10`, 'CARD_PAYMENT', 'Konzum Zagreb', '-40.00'),
    row(`${one}-02`, 'TOPUP', 'Payroll', '2350.00'),
    row(`${one}-12`, 'CARD_PAYMENT', 'Konzum Zagreb', '-45.20'),
    row(`${one}-20`, 'CARD_PAYMENT', 'Konzum Zagreb', '-30.00'),
  ].join('\n')
}

test('opens on the latest month with entries while Getting started shows (review M6)', async ({
  page,
}) => {
  test.setTimeout(90000)
  await gotoServerlessZeroState(page, 'dashboard', 'onboarding-wizard')
  await page.getByTestId('onboarding-next').click()
  if (await page.getByTestId('onboarding-step-about').isVisible()) {
    await page.getByTestId('onboarding-next').click()
  }
  await expect(page.getByTestId('onboarding-step-account')).toBeVisible()
  await page.getByTestId('onboarding-account-name').fill('Main Checking')
  await page.getByTestId('onboarding-account-create').click()
  await expect(page.getByTestId('onboarding-step-import')).toBeVisible()
  await page.getByTestId('onboarding-import-input').setInputFiles({
    name: 'revolut-two-months.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(statement(), 'utf-8'),
  })
  await expect(page.getByTestId('onboarding-import-file')).toHaveAttribute('data-state', 'ready', {
    timeout: 20000,
  })
  await page.getByTestId('onboarding-import-selected').click()
  await expect(page.getByTestId('onboarding-step-subscriptions')).toBeVisible({ timeout: 15000 })
  await page.getByTestId('onboarding-next').click()
  await expect(page.getByTestId('onboarding-step-done')).toBeVisible()
  await page.getByTestId('onboarding-finish').click()
  await expect(page.getByTestId('onboarding-wizard')).toHaveCount(0)

  // Getting started shows, this month has nothing: last month, and why.
  const now = monthBack(0)
  const last = monthBack(1)
  const before = monthBack(2)
  const named = (m: { key: string; name: string }) =>
    m.key.slice(0, 4) === now.key.slice(0, 4) ? m.name : `${m.name} ${m.key.slice(0, 4)}`
  await expect(page.getByTestId('getting-started')).toBeVisible({ timeout: 30000 })
  await expect(page.getByTestId('dashboard-empty-month')).toHaveText(
    `${now.name} has no entries yet. Showing ${named(last)}.`,
    { timeout: 30000 }
  )
  await expect(page).toHaveURL(new RegExp(`period=${last.key}`))

  // Last month's pay against the month before's, in money and named.
  const income = page.getByTestId('dashboard-metric-income')
  await expect(income).toContainText('€2,350.00')
  await expect(income.getByTestId('dashboard-metric-change')).toHaveText(
    `↑€350.00vs ${before.name}`
  )

  // Once: the month the person moves to stays, and a later visit does not move it again.
  await page.getByTestId('period-next').click()
  await expect(page.getByTestId('dashboard-empty-month')).toHaveCount(0)
  await expect(page).toHaveURL(new RegExp(`period=${now.key}`))
  await page.evaluate(() => {
    window.location.hash = 'transactions'
  })
  await expect(page.getByTestId('transactions-header')).toBeVisible()
  await page.evaluate(() => {
    window.location.hash = 'dashboard'
  })
  await expect(page.getByTestId('dashboard-container')).toBeVisible()
  await page.waitForTimeout(1000)
  await expect(page).toHaveURL(new RegExp(`period=${now.key}`))
  await expect(page.getByTestId('dashboard-empty-month')).toHaveCount(0)

  // Only while Getting started shows: hidden, a new session stays on this month.
  await page.getByTestId('getting-started-hide').click()
  await expect(page.getByTestId('getting-started')).toHaveCount(0)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByTestId('dashboard-container')).toBeVisible({ timeout: 30000 })
  await expect(page.getByTestId('dashboard-metric-income')).toBeVisible({ timeout: 30000 })
  await page.waitForTimeout(1500)
  await expect(page).toHaveURL(new RegExp(`period=${now.key}`))
  await expect(page.getByTestId('dashboard-empty-month')).toHaveCount(0)
})

test('waits for entries: setup skipped, a statement imported later opens its month (review M6)', async ({
  page,
}) => {
  test.setTimeout(90000)
  await gotoServerlessZeroState(page, 'dashboard', 'onboarding-wizard')
  await page.getByTestId('onboarding-next').click()
  if (await page.getByTestId('onboarding-step-about').isVisible()) {
    await page.getByTestId('onboarding-next').click()
  }
  await expect(page.getByTestId('onboarding-step-account')).toBeVisible()
  await page.getByTestId('onboarding-account-skip').click()
  await expect(page.getByTestId('onboarding-step-import')).toBeVisible()
  await page.getByTestId('onboarding-import-skip').click()
  await expect(page.getByTestId('onboarding-step-done')).toBeVisible()
  await page.getByTestId('onboarding-finish').click()
  await expect(page.getByTestId('onboarding-wizard')).toHaveCount(0)

  // Nothing in any month yet: the Dashboard stays on this one, and says nothing.
  const now = monthBack(0)
  const last = monthBack(1)
  await expect(page.getByTestId('getting-started')).toBeVisible({ timeout: 30000 })
  await expect(page.getByTestId('dashboard-metric-income')).toBeVisible({ timeout: 30000 })
  await page.waitForTimeout(1000)
  await expect(page.getByTestId('dashboard-empty-month')).toHaveCount(0)

  // The statement goes in on the Import page; back on the Dashboard, its month.
  await page.evaluate(() => {
    window.location.hash = 'import/bank'
  })
  await page.getByTestId('bank-file-input').setInputFiles({
    name: 'revolut-two-months.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(statement(), 'utf-8'),
  })
  const select = page.getByTestId('bank-target-account')
  await select.selectOption('__create-account__')
  await page.getByTestId('account-select-name').fill('Later Bank')
  await page.getByTestId('account-select-submit').click()
  await expect(select).toHaveValue('Later Bank', { timeout: 10000 })
  await page.getByTestId('bank-process-btn').click()
  await page.getByTestId('import-summary-import').click()
  await expect(page.getByTestId('import-result')).toContainText('Imported', { timeout: 15000 })
  await page.evaluate(() => {
    window.location.hash = 'dashboard'
  })
  const named =
    last.key.slice(0, 4) === now.key.slice(0, 4)
      ? last.name
      : `${last.name} ${last.key.slice(0, 4)}`
  await expect(page.getByTestId('dashboard-empty-month')).toHaveText(
    `${now.name} has no entries yet. Showing ${named}.`,
    { timeout: 30000 }
  )
})
