/**
 * Getting started: after an import, the first three next steps match what the data shows, each
 * with its reason, on the setup wizard's last step and on Dashboard's card, in both storage modes.
 *
 * The statement is generated here, relative to today: the last four full months, each with a
 * Netflix and a Spotify charge left without a category and two grocery runs. So four months are
 * tracked, the scan spots two subscriptions, and half the entries have no category. The rules
 * after those three apply too (Groceries has no budget, and every month spent more than it
 * earned), and the card shows three steps all the same. The grocery runs come to a different
 * amount each month: one amount on one day every month is a regular payment, which the scan
 * proposes too.
 *
 * The cushion step reads a second statement, with a salary and the grocery runs alone, against a
 * savings account opened after the import: it shows while the money there covers less than a
 * month of groceries, and leaves once a second account takes it past one. A move between two
 * current accounts leaves it as it was: they are read as one pool.
 */
import { expect, test } from '@playwright/test'
import { viaApp } from './form-errors-helpers'
import { bootSignedIn, deleteAccount, signIn, signUpAndIn } from './own-account'
import { E2E_BASE, gotoServerlessZeroState } from './test-helpers'
import type { Page } from '@playwright/test'

/** 'YYYY-MM' `n` months before this one. */
function monthsAgo(n: number): string {
  const d = new Date()
  d.setDate(1)
  d.setMonth(d.getMonth() - n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

const STATEMENT = [
  'Date,Description,Amount,Category,Type',
  ...[4, 3, 2, 1].flatMap((n) => {
    const m = monthsAgo(n)
    return [
      `${m}-03,NETFLIX.COM,-15.99,,expense`,
      `${m}-07,SPOTIFY,-10.99,,expense`,
      `${m}-10,Corner market,-${(64.2 + 7 * n).toFixed(2)},Groceries,expense`,
      `${m}-21,Corner market,-${(58.4 + 9 * n).toFixed(2)},Groceries,expense`,
    ]
  }),
].join('\n')

const AFTER_IMPORT = [
  {
    title: 'Import the rest of your year',
    reason: '4 of the last 13 months are tracked. A month counts once it holds 3 entries.',
    href: '#import',
  },
  {
    title: 'Review the 2 subscriptions we spotted',
    reason: "They're in your statements but not on Bills yet.",
    href: '#bills?scan=1',
  },
  {
    title: 'Sort the 8 entries without a category',
    reason: "That's 50% of your entries. Budgets and Analytics group spending by category.",
    href: '#transactions?uncategorised=1',
  },
]

const NOTHING_YET = {
  title: 'Import a year of statements',
  reason: 'None of the last 13 months is tracked yet. A month counts once it holds 3 entries.',
  href: '#import',
}

/** The steps a list shows, read off the page. */
async function stepsIn(page: Page, list: string) {
  const steps = page.getByTestId(list).getByTestId('next-step')
  const out: Array<{ title: string; reason: string; href: string }> = []
  for (const step of await steps.all()) {
    const link = step.getByTestId('next-step-link')
    out.push({
      title: (await link.locator('span').first().textContent()) ?? '',
      reason: (await step.getByTestId('next-step-reason').textContent()) ?? '',
      href: (await link.getAttribute('href')) ?? '',
    })
  }
  return out
}

/** The card's steps once they say what `expected` says, failing with what they say otherwise. */
async function cardShows(page: Page, expected: unknown[]): Promise<void> {
  await expect(page.getByTestId('getting-started')).toBeVisible({ timeout: 30_000 })
  await expect.poll(() => stepsIn(page, 'getting-started'), { timeout: 30_000 }).toEqual(expected)
}

/** Import a generated statement on the Import page, as pasted CSV. */
async function importStatement(page: Page, statement = STATEMENT, rows = 16): Promise<void> {
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

test.describe('Getting started @smoke', () => {
  test.beforeEach(() => {
    test.setTimeout(150_000)
  })

  test('local-first: the card follows an import, opens the scan, and hides for good', async ({
    page,
  }) => {
    await gotoServerlessZeroState(page, 'dashboard', 'onboarding-wizard')
    // The space step makes the workspace's first profile; setup is left after it.
    await expect(page.getByTestId('onboarding-step-space')).toBeVisible()
    await page.getByTestId('onboarding-next').click()
    await expect(page.getByTestId('onboarding-step-about')).toBeVisible()
    await page.getByTestId('onboarding-next').click()
    await expect(page.getByTestId('onboarding-step-account')).toBeVisible()
    await page.getByTestId('onboarding-skip').click()
    await page.getByTestId('confirm-accept').click()
    await expect(page.getByTestId('onboarding-wizard')).toHaveCount(0)

    await cardShows(page, [NOTHING_YET])

    await importStatement(page)
    await openDashboard(page)
    await cardShows(page, AFTER_IMPORT)

    await page.getByTestId('getting-started').getByText('Review the 2 subscriptions').click()
    await expect(page.getByTestId('bills-header')).toBeVisible({ timeout: 30_000 })
    // Pages stay mounted once visited, and Import has a scan of its own: this one is Bills'.
    const scan = page.locator('.page-bills').getByTestId('sub-scan-modal')
    await expect(scan).toBeVisible()
    await expect(scan.locator('[data-test-id="sub-scan-row"][data-name="Netflix"]')).toBeVisible({
      timeout: 15_000,
    })
    await expect(scan.locator('[data-test-id="sub-scan-row"][data-name="Spotify"]')).toBeVisible()
    await scan.getByRole('button', { name: 'Close' }).click()

    await openDashboard(page)
    // Hide is for good: a full touch target, not a chip.
    const hide = page.getByTestId('getting-started-hide')
    expect((await hide.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44)
    await hide.click()
    await expect(page.getByTestId('getting-started')).toHaveCount(0)
    expect(await page.evaluate(() => localStorage.getItem('finance_getting_started:local'))).toBe(
      '{"hidden":true}'
    )
    // Your next step takes its place: Getting started's first step, while less than a year is here.
    await expect(page.getByTestId('dashboard-container').getByTestId('next-step-title')).toHaveText(
      AFTER_IMPORT[0].title,
      { timeout: 30_000 }
    )

    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId('dashboard-header')).toBeVisible({ timeout: 30_000 })
    // The badges have been worked out from the import, so the card would be showing by now.
    await expect(page.getByTestId('badge-rail')).toContainText('4 months in a row', {
      timeout: 30_000,
    })
    await expect(page.getByTestId('getting-started')).toHaveCount(0)
  })

  test("local-first: the wizard's last step lists the steps, and one leads off to its page", async ({
    page,
  }) => {
    await gotoServerlessZeroState(page, 'dashboard', 'onboarding-wizard')
    await expect(page.getByTestId('onboarding-step-space')).toBeVisible()
    await page.getByTestId('onboarding-next').click()
    await expect(page.getByTestId('onboarding-step-about')).toBeVisible()
    await page.getByTestId('onboarding-next').click()
    await expect(page.getByTestId('onboarding-step-account')).toBeVisible()
    // Nothing typed and no statement chosen: each Skip goes on without asking, and with nothing
    // imported there are no subscriptions to look for.
    await page.getByTestId('onboarding-account-skip').click()
    await expect(page.getByTestId('onboarding-step-import')).toBeVisible()
    await page.getByTestId('onboarding-import-skip').click()

    await expect(page.getByTestId('onboarding-step-done')).toBeVisible()
    await expect
      .poll(() => stepsIn(page, 'onboarding-next-steps'), { timeout: 30_000 })
      .toEqual([NOTHING_YET])

    await page.getByTestId('onboarding-next-steps').getByText(NOTHING_YET.title).click()
    await expect(page.getByTestId('onboarding-wizard')).toHaveCount(0)
    await expect(page.getByTestId('import-header')).toBeVisible({ timeout: 30_000 })
    expect(await page.evaluate(() => localStorage.getItem('finance_onboarding:local'))).toBe(
      'completed'
    )
  })

  test('signed in: the card is on the account, follows an import, and hides on every device', async ({
    page,
    browser,
  }) => {
    const ctx = page.context()
    const { email } = await signUpAndIn(ctx)
    try {
      await bootSignedIn(ctx)
      await page.goto(`${E2E_BASE}/#dashboard`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
      await expect(page.getByTestId('onboarding-step-space')).toBeVisible({ timeout: 30_000 })
      const began = page.waitForResponse(
        (res) =>
          new URL(res.url()).pathname === '/api/account/state/getting_started' &&
          res.request().method() === 'PUT' &&
          res.ok(),
        { timeout: 30_000 }
      )
      await page.getByTestId('onboarding-skip').click()
      await page.getByTestId('confirm-accept').click()
      await expect(page.getByTestId('onboarding-wizard')).toHaveCount(0)
      expect((await began).request().postData()).toBe('{"hidden":false}')

      await cardShows(page, [NOTHING_YET])

      await importStatement(page)
      await openDashboard(page)
      await cardShows(page, AFTER_IMPORT)

      // The step for entries with no category lists those eight, from all time.
      await page.getByTestId('getting-started').getByText('Sort the 8 entries').click()
      await expect(page.getByTestId('uncategorised-note')).toHaveText(
        /Showing the 8 entries without a category\./,
        { timeout: 30_000 }
      )
      await expect(page.getByTestId('transactions-row')).toHaveCount(8)

      await openDashboard(page)
      const hidden = page.waitForResponse(
        (res) =>
          new URL(res.url()).pathname === '/api/account/state/getting_started' &&
          res.request().method() === 'PUT' &&
          res.ok(),
        { timeout: 30_000 }
      )
      await page.getByTestId('getting-started-hide').click()
      expect((await hidden).request().postData()).toBe('{"hidden":true}')
      await expect(page.getByTestId('getting-started')).toHaveCount(0)
      await expect(
        page.getByTestId('dashboard-container').getByTestId('next-step-title')
      ).toHaveText(AFTER_IMPORT[0].title, { timeout: 30_000 })

      // Another device: nothing in its storage, the same account signed in.
      const elsewhere = await browser.newContext({ storageState: { cookies: [], origins: [] } })
      try {
        await signIn(elsewhere, email)
        await bootSignedIn(elsewhere)
        const other = await elsewhere.newPage()
        await other.goto(`${E2E_BASE}/#dashboard`, {
          waitUntil: 'domcontentloaded',
          timeout: 30_000,
        })
        await expect(other.getByTestId('dashboard-header')).toBeVisible({ timeout: 30_000 })
        await expect(other.getByTestId('badge-rail')).toContainText('4 months in a row', {
          timeout: 30_000,
        })
        await expect(other.getByTestId('getting-started')).toHaveCount(0)
      } finally {
        await elsewhere.close()
      }
    } finally {
      await deleteAccount(ctx, email)
    }
  })
})

/**
 * Four months of a salary and two grocery runs: 650.40 of groceries, 162.60 a month, all of it
 * needed every month. Nothing to sort, no subscription and no month in the red, so the steps are
 * the year still to import, a budget for Groceries, and the cushion.
 */
const GROCERIES = [
  'Date,Description,Amount,Category,Type',
  ...[4, 3, 2, 1].flatMap((n) => {
    const m = monthsAgo(n)
    return [
      `${m}-01,Salary,1500.00,Salary,income`,
      `${m}-10,Corner market,-${(64.2 + 7 * n).toFixed(2)},Groceries,expense`,
      `${m}-21,Corner market,-${(58.4 + 9 * n).toFixed(2)},Groceries,expense`,
    ]
  }),
].join('\n')

const LAST_MONTH = new Date(`${monthsAgo(1)}-15T12:00:00`).toLocaleString('en-GB', {
  month: 'long',
})

const BEFORE_A_CUSHION = [
  {
    title: 'Import the rest of your year',
    reason: '4 of the last 13 months are tracked. A month counts once it holds 3 entries.',
    href: '#import',
  },
  {
    title: 'Set a budget for Groceries',
    reason: `You spent more on it in ${LAST_MONTH} than on any other category with no budget or bill.`,
    href: '#budgets',
  },
]

const CUSHION = {
  // 100 against 162.60 a month is 18 whole days.
  title: 'Build a one-month cushion',
  reason: 'The money you can reach covers 18 days of what you need.',
  href: '#goals',
}

/** Import the groceries, then open savings accounts and follow the card. */
async function cushionComesAndGoes(page: Page): Promise<void> {
  await importStatement(page, GROCERIES, 12)
  await openDashboard(page)
  // No account yet: nothing says what money there is, so no cushion step.
  await cardShows(page, BEFORE_A_CUSHION)

  await viaApp(page, 'POST', '/api/accounts', {
    name: 'Rainy day',
    type: 'savings',
    starting_balance: 100,
  })
  await cardShows(page, [...BEFORE_A_CUSHION, CUSHION])

  // 200 is more than a month: the step leaves.
  await viaApp(page, 'POST', '/api/accounts', {
    name: 'Holiday fund',
    type: 'savings',
    starting_balance: 100,
  })
  await cardShows(page, BEFORE_A_CUSHION)
}

/** Today as the app dates an entry: the device's calendar day. */
function today(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Import the groceries, keep 50 in each of two current accounts, and move the one's money to the
 * other today. The money the person can reach stays what it was. A savings account opened after
 * the move shows the card has read it: had the move hidden the 50, the card would say 13 days.
 */
async function moveBetweenCurrentAccounts(page: Page): Promise<void> {
  await importStatement(page, GROCERIES, 12)
  await openDashboard(page)
  await cardShows(page, BEFORE_A_CUSHION)

  for (const name of ['Old bank', 'New bank']) {
    await viaApp(page, 'POST', '/api/accounts', { name, type: 'giro', starting_balance: 50 })
  }
  // 100 within reach: 18 days.
  await cardShows(page, [...BEFORE_A_CUSHION, CUSHION])

  const accounts = await viaApp<Array<{ id: number; name: string }>>(page, 'GET', '/api/accounts')
  const idOf = (name: string) => accounts.find((account) => account.name === name)?.id
  await viaApp(page, 'POST', '/api/transactions', {
    description: 'Move to the new bank',
    amount: 50,
    type: 'transfer',
    date: today(),
    account_id: idOf('Old bank'),
    transfer_account_id: idOf('New bank'),
  })
  await viaApp(page, 'POST', '/api/accounts', {
    name: 'Rainy day',
    type: 'savings',
    starting_balance: 25,
  })
  // 125 within reach: 23 days.
  await cardShows(page, [
    ...BEFORE_A_CUSHION,
    { ...CUSHION, reason: 'The money you can reach covers 23 days of what you need.' },
  ])
}

/** A local-first space with the setup wizard skipped, on Dashboard. */
async function startLocalFirst(page: Page): Promise<void> {
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

/** `run` in a new account's space, signed in, with the setup wizard skipped; deleted after. */
async function signedIn(page: Page, run: (page: Page) => Promise<void>): Promise<void> {
  const ctx = page.context()
  const { email } = await signUpAndIn(ctx)
  try {
    await bootSignedIn(ctx)
    await page.goto(`${E2E_BASE}/#dashboard`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await expect(page.getByTestId('onboarding-step-space')).toBeVisible({ timeout: 30_000 })
    await page.getByTestId('onboarding-skip').click()
    await page.getByTestId('confirm-accept').click()
    await expect(page.getByTestId('onboarding-wizard')).toHaveCount(0)

    await run(page)
  } finally {
    await deleteAccount(ctx, email)
  }
}

test.describe('Getting started: the cushion @smoke', () => {
  test.beforeEach(() => {
    test.setTimeout(150_000)
  })

  test('local-first: the cushion step shows under a month of savings and leaves past one', async ({
    page,
  }) => {
    await startLocalFirst(page)
    await cushionComesAndGoes(page)
  })

  test('signed in: the cushion step shows under a month of savings and leaves past one', async ({
    page,
  }) => {
    await signedIn(page, cushionComesAndGoes)
  })

  test('local-first: a move between two current accounts leaves the step as it was', async ({
    page,
  }) => {
    await startLocalFirst(page)
    await moveBetweenCurrentAccounts(page)
  })

  test('signed in: a move between two current accounts leaves the step as it was', async ({
    page,
  }) => {
    await signedIn(page, moveBetweenCurrentAccounts)
  })
})
