/**
 * A new account's first week, lived in about a minute with the time machine (tests/time-machine/):
 * every mail read from the local mailbox the Worker sends to, every day reached by moving the
 * account, and the daily job fired as wrangler fires a scheduled event.
 *
 * - Day 0: sign up on the sign-in screen, confirm through the link in the mail, set up without a
 *   statement, look at Progress, and see the first-week switch in Settings.
 * - Day 1: the daily job sends nothing.
 * - Day 2: it sends the day-2 mail once, with links to this run's app, the article and the stop link.
 * - Day 7, after an import: it sends the day-7 mail, and the switch leaves Settings.
 * - A stop link pressed on day 2 keeps the day-7 mail away, import or not.
 * - Local-first has no account and no mail. Its week runs on the browser's clock (page.clock), and
 *   crosses a month end the cloud week cannot.
 *
 * The cloud frame is data back: a move takes the account's own instants into the past and the job
 * runs at the real now (worker/scripts/time-machine.ts). Each test uses an account of its own, so
 * the specs running beside it see nothing of its moves.
 */
import { expect, test } from '@playwright/test'
import { randomBytes } from 'node:crypto'
import { articleUrl } from '../../shared/articles'
import { bootApp, openSignIn } from './boot'
import { sql } from './db'
import { E2E_API_BASE, E2E_API_PORT, E2E_BASE, E2E_MAIL_BASE, E2E_PORT } from './e2e-constants'
import { deleteAccount } from './own-account'
import { gotoServerlessZeroState } from './test-helpers'
import { timeMachine } from './time-machine/harness'
import type { Mail } from './time-machine/harness'
import type { BrowserContext, Page } from '@playwright/test'

const machine = timeMachine({ apiBase: E2E_API_BASE, mailBase: E2E_MAIL_BASE })

// eslint-disable-next-line sonarjs/no-hardcoded-passwords -- local throwaway accounts
const PASSWORD = 'first-week-journey-1'
const CONFIRM = 'Confirm your email for Token Circles'
const WELCOME = 'Token Circles is ready for your first statement'
const DAY2 = 'How to get a year of statements out of your bank'
const DAY7 = 'Your first week in Token Circles'

/** This run's app and Worker as the Worker names them in mail links (playwright.config.ts). */
const APP_LINK = `http://localhost:${String(E2E_PORT)}`
const API_LINK = `http://localhost:${String(E2E_API_PORT)}`

/** Three entries, so the month they are in counts as tracked. */
const STATEMENT = (dates: [string, string, string]) =>
  [
    'Date,Description,Amount,Category,Type',
    `${dates[0]},First week salary,2000.00,Salary,income`,
    `${dates[1]},First week groceries,-52.30,Groceries,expense`,
    `${dates[2]},First week coffee,-3.20,Dining,expense`,
  ].join('\n')

const newAddress = (who: string) =>
  `first-week-${who}-${randomBytes(5).toString('hex')}@example.test`

const clearLimits = () => {
  sql(
    "DELETE FROM rate_limits WHERE bucket LIKE 'register%' OR bucket LIKE 'login%' OR bucket LIKE 'confirm-resend%'"
  )
}

/** The confirm link in a confirm mail. */
function confirmLink(mail: Mail): string {
  const link = machine.links(mail).find((l) => l.includes('/api/auth/verify-email?token='))
  expect(link, 'the confirm mail carries its link').toBeTruthy()
  return link as string
}

/**
 * Open the confirm link in this browser and land where it sends the browser, on this run's app.
 * Its redirect names the app the mails link to (localhost); the browser signed up on 127.0.0.1,
 * where its cookies are, so the fragment is opened there, in a page load of its own.
 */
async function openConfirmLink(page: Page, link: string): Promise<void> {
  const opened = await page.request.get(link, { maxRedirects: 0 })
  expect(opened.status()).toBe(302)
  const to = new URL(opened.headers()['location'])
  expect(to.origin).toBe(APP_LINK)
  await page.goto('about:blank')
  await page.goto(`${E2E_BASE}/${to.hash}`)
}

/** Go to a page of the app, as a reload after a move does: a page keeps what it read. */
async function open(page: Page, route: string, ready: string): Promise<void> {
  await page.goto('about:blank')
  await page.goto(`${E2E_BASE}/#${route}`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
  await expect(page.getByTestId(ready)).toBeVisible({ timeout: 30_000 })
}

/** Setup on its shortest path: the space, one account, no statement. */
async function setUpWithoutStatement(page: Page): Promise<void> {
  await expect(page.getByTestId('onboarding-step-space')).toBeVisible({ timeout: 30_000 })
  await page.getByTestId('onboarding-next').click()
  await expect(page.getByTestId('onboarding-step-about')).toBeVisible({ timeout: 30_000 })
  await page.getByTestId('onboarding-next').click()
  await expect(page.getByTestId('onboarding-step-account')).toBeVisible({ timeout: 30_000 })
  await page.getByTestId('onboarding-account-name').fill('Main Checking')
  await page.getByTestId('onboarding-account-create').click()
  await expect(page.getByTestId('onboarding-step-import')).toBeVisible({ timeout: 30_000 })
  await page.getByTestId('onboarding-import-skip').click()
  await expect(page.getByTestId('onboarding-step-done')).toBeVisible({ timeout: 30_000 })
  await page.getByTestId('onboarding-finish').click()
  await expect(page.getByTestId('onboarding-wizard')).toHaveCount(0)
}

/** A statement pasted on the Import page and imported. */
async function importStatement(page: Page, csv: string): Promise<void> {
  await open(page, 'import', 'import-header')
  await page.getByTestId('import-tab-paste-csv').click()
  await page.getByTestId('import-paste-textarea').fill(csv)
  await page.getByTestId('import-paste-parse').click()
  await page.getByTestId('import-continue-mapping').click()
  await page.getByTestId('import-continue-preview').click()
  await expect(page.getByTestId('import-preview-total')).toHaveText('3')
  await page.getByTestId('import-execute-all').click()
  await expect(page.getByTestId('import-result')).toContainText('Imported 3', { timeout: 30_000 })
}

/** Sign up through the API on `ctx` and confirm with the link from the mail: day 0. */
async function signUpAndConfirm(ctx: BrowserContext, email: string): Promise<void> {
  clearLimits()
  const made = await ctx.request.post(`${E2E_BASE}/api/auth/register`, {
    data: { email, password: PASSWORD },
  })
  expect(made.ok(), await made.text()).toBeTruthy()
  const link = confirmLink(await machine.waitForMail(email, CONFIRM))
  const opened = await ctx.request.get(link, { maxRedirects: 0 })
  expect(opened.status()).toBe(302)
  await machine.waitForMail(email, WELCOME)
}

/** Fire the daily job and return the mails it sent `email`. */
async function fireFor(email: string): Promise<string[]> {
  const before = await machine.lastMailId(email)
  await machine.fire()
  return (await machine.mailsSince(email, before)).map((m) => m.subject)
}

test.describe('the first week of a new account', () => {
  // A browser of its own: no fixture session, so the sign-up is a new visitor's.
  test.use({ storageState: { cookies: [], origins: [] } })

  test('lives day 0 to day 7: confirm, setup, the day-2 mail, an import, the day-7 mail', async ({
    page,
  }) => {
    test.setTimeout(120_000)
    const ctx = page.context()
    const email = newAddress('journey')
    try {
      // Day 0: sign up on the sign-in screen, then the link in the confirm mail signs this browser
      // in and opens setup.
      clearLimits()
      await bootApp(ctx, 'server')
      await openSignIn(page, 'server', E2E_BASE)
      await page.getByText('Create one').click()
      await page.locator('#login-email').fill(email)
      await page.locator('#login-password').fill(PASSWORD)
      await page.locator('button[type="submit"]').click()
      await expect(page.getByTestId('check-inbox-address')).toHaveText(email, { timeout: 30_000 })
      expect(machine.state(email).dayZero, 'no day 0 before the link').toBeNull()

      await openConfirmLink(page, confirmLink(await machine.waitForMail(email, CONFIRM)))
      await setUpWithoutStatement(page)
      await machine.waitForMail(email, WELCOME)
      const day0 = machine.state(email)
      expect(day0.dayZero).not.toBeNull()
      expect(day0.day).toBe(0)
      expect(day0.mails).toEqual({
        day2: 'not yet: due from day 2',
        day7: 'not yet: due from day 7',
      })
      await open(page, 'progress', 'progress-header')
      await expect(page.getByTestId('progress-streak')).toBeVisible()
      await open(page, 'settings', 'settings-week-one')

      // Day 1: nothing is due.
      expect(machine.moveTo(email, 1).state.day).toBe(1)
      expect(await fireFor(email)).toEqual([])

      // Day 2: the mail on exporting a year of statements, once, linking to this run's app.
      expect(machine.moveTo(email, 2).state.mails.day2).toBe('due: the next daily job sends it')
      const before = await machine.lastMailId(email)
      await machine.fire()
      const day2 = await machine.waitForMail(email, DAY2, { after: before })
      const links = machine.links(day2)
      expect(links).toContain(`${APP_LINK}/#import`)
      expect(links).toContain(articleUrl('bank-year'))
      const stop = links.find((l) => l.startsWith(`${API_LINK}/api/notifications/unsubscribe?`))
      expect(stop, 'the day-2 mail has its stop link').toBeTruthy()
      expect(new URL(stop as string).searchParams.get('list')).toBe('week-one')
      expect(day2.headers?.['List-Unsubscribe']).toBe(`<${stop as string}>`)
      expect(await fireFor(email), 'a second run sends it no second time').toEqual([])
      expect(machine.state(email).mails.day2).toMatch(/^went at .* UTC, day 2\.\d\d$/)

      // Still day 2: the first statement, imported.
      await importStatement(page, STATEMENT(['2026-07-01', '2026-07-02', '2026-07-03']))
      expect(machine.state(email).mails.day7).toBe('not yet: due from day 7')

      // Day 7: what the first import found, and the week is over.
      await open(page, 'settings', 'settings-week-one')
      expect(machine.moveTo(email, 7).state.mails.day7).toBe('due: the next daily job sends it')
      const sent = await fireFor(email)
      expect(sent).toEqual([DAY7])
      expect(await fireFor(email)).toEqual([])
      // The card has loaded the account's settings once its form is there; no mail is ahead now.
      await open(page, 'settings', 'settings-notifications-form')
      await expect(page.getByTestId('settings-week-one')).toHaveCount(0)
    } finally {
      await deleteAccount(ctx, email)
    }
  })

  test('a stop link pressed on day 2 keeps the day-7 mail away', async ({ page }) => {
    test.setTimeout(90_000)
    const ctx = page.context()
    const email = newAddress('stop')
    try {
      await signUpAndConfirm(ctx, email)
      machine.moveTo(email, 2)
      const before = await machine.lastMailId(email)
      await machine.fire()
      const day2 = await machine.waitForMail(email, DAY2, { after: before })
      const stop = machine
        .links(day2)
        .find((l) => l.startsWith(`${API_LINK}/api/notifications/unsubscribe?`))
      expect(stop).toBeTruthy()

      // The link only asks; the button stops.
      await page.goto(stop as string)
      await expect(page.getByRole('heading', { name: 'Stop first-week mails?' })).toBeVisible()
      expect(machine.state(email).mails.day7).toBe('not yet: due from day 7')
      await page.getByRole('button', { name: 'Unsubscribe' }).click()
      await expect(page.getByRole('heading', { name: 'First-week mails are off' })).toBeVisible()
      expect(machine.state(email).mails.day7).toBe('stopped: first-week mails are off')

      // An import that would have made the day-7 mail due.
      await bootApp(ctx, 'server', email)
      await importStatement(page, STATEMENT(['2026-07-01', '2026-07-02', '2026-07-03']))
      machine.moveTo(email, 7)
      expect(await fireFor(email)).toEqual([])
      expect(machine.state(email).mails.day7).toBe('stopped: first-week mails are off')
    } finally {
      await deleteAccount(ctx, email)
    }
  })

  test('local-first lives its week on the browser clock, across a month end', async ({ page }) => {
    test.setTimeout(90_000)
    // Day 0 on a Thursday at noon UTC, so the date is the same in every time zone a runner has.
    const day = (n: number) => new Date(Date.UTC(2026, 9, 29 + n, 12))
    await page.clock.install({ time: day(0) })
    await gotoServerlessZeroState(page, 'dashboard', 'onboarding-wizard')
    await setUpWithoutStatement(page)

    const firstImport = () =>
      page
        .getByTestId('progress-list')
        .locator('li:not([data-timeline-stop])', { hasText: 'First import' })
    const lastMonthShown = () => page.locator('[data-month-cell]').last()

    // Day 0, 29 October: nothing tracked, so the strip ends with September.
    await open(page, 'progress', 'progress-header')
    await expect(lastMonthShown()).toHaveAttribute('data-month', '2026-09')
    await expect(firstImport()).toContainText('One completed import.')

    // Day 2, 31 October: a statement of three October entries.
    await page.clock.setSystemTime(day(2))
    await importStatement(page, STATEMENT(['2026-10-27', '2026-10-28', '2026-10-29']))
    await open(page, 'progress', 'progress-header')
    await expect(lastMonthShown()).toHaveAttribute('data-month', '2026-10')
    await expect(lastMonthShown()).toHaveAttribute('data-tracked', 'true')
    await expect(firstImport()).toContainText('Earned October 2026')

    // Day 7, 5 November: the import stays an October one, stamped by the clock it was made on.
    await page.clock.setSystemTime(day(7))
    await open(page, 'progress', 'progress-header')
    await expect(firstImport()).toContainText('Earned October 2026')
    await expect(page.locator('[data-month-cell][data-month="2026-11"]')).toHaveCount(0)
    await expect(lastMonthShown()).toHaveAttribute('data-month', '2026-10')
  })
})
