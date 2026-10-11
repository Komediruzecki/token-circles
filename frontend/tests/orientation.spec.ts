/**
 * Getting started: after an import, the first three next steps match what the data shows, each
 * with its reason, on the setup wizard's last step and on Dashboard's card, in both storage modes.
 *
 * The statement is generated here, relative to today: the last four full months, each with a
 * Netflix and a Spotify charge left without a category and two grocery runs. So four months are
 * tracked, the scan spots two subscriptions, and half the entries have no category. The rules
 * after those three apply too (Groceries has no budget, and every month spent more than it
 * earned), and the card shows three steps all the same.
 */
import { expect, test } from '@playwright/test'
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
      `${m}-10,Corner market,-64.20,Groceries,expense`,
      `${m}-21,Corner market,-58.40,Groceries,expense`,
    ]
  }),
].join('\n')

const AFTER_IMPORT = [
  {
    title: 'Import the rest of your year',
    reason: 'You have 4 tracked months from the past year. A month counts once it holds 3 entries.',
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
  reason: 'No month from the past year is tracked yet. A month counts once it holds 3 entries.',
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

/** Import the generated statement on the Import page, as pasted CSV. */
async function importStatement(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.location.hash = 'import'
  })
  await expect(page.getByTestId('import-header')).toBeVisible({ timeout: 30_000 })
  await page.getByTestId('import-tab-paste-csv').click()
  await page.getByTestId('import-paste-textarea').fill(STATEMENT)
  await page.getByTestId('import-paste-parse').click()
  await page.getByTestId('import-continue-mapping').click()
  await page.getByTestId('import-continue-preview').click()
  await expect(page.getByTestId('import-preview-total')).toHaveText('16')
  await page.getByTestId('import-execute-all').click()
  await expect(page.getByTestId('import-result')).toContainText('Imported 16', { timeout: 30_000 })
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
    await page.getByTestId('onboarding-next').click()
    await expect(page.getByTestId('onboarding-step-space')).toBeVisible()
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
    await page.getByTestId('getting-started-hide').click()
    await expect(page.getByTestId('getting-started')).toHaveCount(0)
    expect(await page.evaluate(() => localStorage.getItem('finance_getting_started:local'))).toBe(
      '{"hidden":true}'
    )

    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId('dashboard-header')).toBeVisible({ timeout: 30_000 })
    // The badges have been worked out from the import, so the card would be showing by now.
    await expect(page.getByTestId('badge-rail')).toContainText('4 months tracked', {
      timeout: 30_000,
    })
    await expect(page.getByTestId('getting-started')).toHaveCount(0)
  })

  test("local-first: the wizard's last step lists the steps, and one leads off to its page", async ({
    page,
  }) => {
    await gotoServerlessZeroState(page, 'dashboard', 'onboarding-wizard')
    await page.getByTestId('onboarding-next').click()
    await expect(page.getByTestId('onboarding-step-space')).toBeVisible()
    await page.getByTestId('onboarding-next').click()
    await expect(page.getByTestId('onboarding-step-account')).toBeVisible()
    await page.getByTestId('onboarding-next').click()
    await page.getByTestId('confirm-accept').click()
    await expect(page.getByTestId('onboarding-step-import')).toBeVisible()
    await page.getByTestId('onboarding-next').click()
    await page.getByTestId('confirm-accept').click()
    await expect(page.getByTestId('onboarding-step-subscriptions')).toBeVisible()
    await page.getByTestId('onboarding-next').click()

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
      await expect(page.getByTestId('onboarding-step-welcome')).toBeVisible({ timeout: 30_000 })
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
        await expect(other.getByTestId('badge-rail')).toContainText('4 months tracked', {
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
