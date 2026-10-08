/**
 * Settings > Email reminders: a new account address takes effect once the new address opens the
 * link mailed to it. The real app, against the local Worker, in both storage modes.
 *
 * The link only exists inside the email, which no test can read, so the spec gives the newest
 * change row a token hash it knows, through the local-D1 side door email-code-login.spec.ts uses.
 * The Worker suite (worker/test/email-change.test.ts) reads the captured mail itself and covers
 * every way the link is refused.
 *
 * The link's route sends the browser back to the app's configured origin, which is :3800 whatever
 * port this run serves on. So the spec reads that redirect without following it, and opens the
 * fragment it carries on this run's app.
 *
 * The cloud case runs as an account made for the run, with no shared storage state, and deletes
 * it at the end. Local-first has no account email: its Settings shows no field for one.
 */
import { expect, test, type Page } from '@playwright/test'
import { createHash } from 'node:crypto'
import { E2E_BASE } from './e2e-constants'
import { sql, sqlRows } from './db'
import { getByTestId, gotoServerless } from './test-helpers'

// eslint-disable-next-line sonarjs/no-hardcoded-passwords -- local throwaway fixture account
const PASSWORD = 'email-change-spec-password-1'
const KNOWN_TOKEN = 'e2e-known-email-change-token'

test.use({ storageState: { cookies: [], origins: [] } })

const sha256Hex = (s: string) => createHash('sha256').update(s).digest('hex')
const toasts = (page: Page) => page.getByRole('region', { name: 'Notifications' })

test('a new address waits for its link, and opening it moves the account @smoke', async ({
  page,
  context,
}) => {
  test.setTimeout(120_000)
  const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
  const email = `e2e-emailchange-${run}@tokencircles.test`
  const next = `e2e-emailchange-${run}-new@tokencircles.test`

  // page.request shares the page's cookies, so signing in here signs the page in.
  sql('DELETE FROM rate_limits')
  await page.request.post(`${E2E_BASE}/api/auth/register`, { data: { email, password: PASSWORD } })
  // Email reminders, and with them the Save button, need a paid plan.
  sql(`UPDATE users SET plan = 'ultimate' WHERE email = '${email}'`)
  const login = await page.request.post(`${E2E_BASE}/api/auth/login`, {
    data: { email, password: PASSWORD },
  })
  expect(login.ok(), `API login failed: ${login.status()}`).toBeTruthy()
  const profiles = (await (await page.request.get(`${E2E_BASE}/api/profiles`)).json()) as
    { id: number }[] | { profiles: { id: number }[] }
  const profileId = (Array.isArray(profiles) ? profiles : profiles.profiles)[0].id

  await context.addInitScript((pid: string) => {
    localStorage.setItem('finance_storage_mode', 'self-hosted')
    localStorage.setItem('currentProfileId', pid)
    localStorage.setItem('darkMode', 'false')
    localStorage.setItem('finance_onboarding', 'skipped')
  }, String(profileId))

  const field = getByTestId(page, 'settings-email-input')
  const save = getByTestId(page, 'settings-notifications-save')
  const pending = getByTestId(page, 'settings-email-pending')
  const accountRows = () =>
    sqlRows<{ email: string; email_verified: number }>(
      `SELECT email, email_verified FROM users WHERE email IN ('${email}', '${next}')`
    )
  const changeRows = () =>
    sqlRows<{ id: number }>(
      `SELECT id FROM email_verifications
       WHERE purpose = 'change' AND email = '${next}' AND used_at IS NULL ORDER BY id`
    )

  await page.goto(`${E2E_BASE}/#settings`)
  await expect(field).toHaveValue(email, { timeout: 30_000 })

  // ── Save a new address: it waits, and the account keeps its own ────────────────────────────
  await field.fill(next)
  await save.click()
  await expect(pending).toContainText(
    `We sent a link to ${next}. Your sign-in address changes when you open it.`
  )
  await expect(field).toHaveValue(email)
  expect(accountRows()).toEqual([{ email, email_verified: 0 }])

  // ── Send again: a fresh link, and the first one stops working ──────────────────────────────
  const [first] = changeRows()
  await getByTestId(page, 'settings-email-resend').click()
  await expect(toasts(page).getByText(`Link sent again to ${next}.`)).toBeVisible()
  const resent = changeRows()
  expect(resent).toHaveLength(1)
  expect(resent[0].id).toBeGreaterThan(first.id)

  // ── Cancel: nothing waits, and the account keeps its address ───────────────────────────────
  await getByTestId(page, 'settings-email-cancel').click()
  await expect(
    toasts(page).getByText(`Email change canceled. Your account keeps ${email}.`)
  ).toBeVisible()
  await expect(pending).toHaveCount(0)
  expect(changeRows()).toEqual([])

  // ── Ask again, and open the link ───────────────────────────────────────────────────────────
  await field.fill(next)
  await save.click()
  await expect(pending).toContainText(next)
  sql(
    `UPDATE email_verifications SET token_hash = '${sha256Hex(KNOWN_TOKEN)}'
     WHERE id = (SELECT MAX(id) FROM email_verifications WHERE purpose = 'change' AND email = '${next}')`
  )
  const link = `${E2E_BASE}/api/auth/verify-email?token=${KNOWN_TOKEN}`
  const opened = await page.request.get(link, { maxRedirects: 0 })
  expect(opened.status()).toBe(302)
  expect(new URL(opened.headers()['location']).hash).toBe('#everified=1&change=1')
  expect(accountRows()).toEqual([{ email: next, email_verified: 1 }])

  // The app reads that fragment at boot, so it needs a fresh document, not a hash change.
  await page.goto('about:blank')
  await page.goto(`${E2E_BASE}/#everified=1&change=1`)
  await expect(
    toasts(page).getByText('Email changed. Your account uses the new address from now on.')
  ).toBeVisible({ timeout: 30_000 })
  await page.goto(`${E2E_BASE}/#settings`)
  await expect(field).toHaveValue(next, { timeout: 30_000 })
  await expect(pending).toHaveCount(0)

  // ── The link works once ────────────────────────────────────────────────────────────────────
  const reopened = await page.request.get(link, { maxRedirects: 0 })
  expect(new URL(reopened.headers()['location']).hash).toBe('#everified_error=invalid_or_used')
  expect(accountRows()).toEqual([{ email: next, email_verified: 1 }])

  // Leave nothing of this run's account in the local database.
  const deleted = await page.request.delete(`${E2E_BASE}/api/account`, {
    data: { confirm: 'delete' },
  })
  expect(deleted.ok(), `account delete failed: ${deleted.status()}`).toBeTruthy()
})

test('local-first Settings shows no account email', async ({ page }) => {
  await gotoServerless(page, 'settings', 'settings-header')

  // The rest of the General tab is there, so the email card's absence is not a page still loading.
  await expect(page.getByText('Running in Local mode')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Base Currency' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Email reminders' })).toHaveCount(0)
  await expect(getByTestId(page, 'settings-email-input')).toHaveCount(0)
  await expect(getByTestId(page, 'settings-email-pending')).toHaveCount(0)
})
