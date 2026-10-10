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
 * The cloud case runs as an account made for the run, with no shared storage state, and plants a
 * token made for the run. It deletes the account at the end, also when a step fails, and clears
 * only the rate-limit buckets it uses. Local-first has no account email: its Settings shows no
 * field for one.
 *
 * The cloud case runs booted both ways (boot.ts): as dev does, signed in through the API, and as
 * a fresh browser on production, which starts local-first and signs in through Manage Account.
 */
import { expect, test, type Page } from '@playwright/test'
import { createHash, randomBytes } from 'node:crypto'
import { BOOTS, bootApp, openSignIn, signInWithPassword } from './boot'
import { E2E_BASE } from './e2e-constants'
import { confirmAccount, sql, sqlRows } from './db'
import { getByTestId, gotoServerless } from './test-helpers'

// eslint-disable-next-line sonarjs/no-hardcoded-passwords -- local throwaway fixture account
const PASSWORD = 'email-change-spec-password-1'

test.use({ storageState: { cookies: [], origins: [] } })

const sha256Hex = (s: string) => createHash('sha256').update(s).digest('hex')
const toasts = (page: Page) => page.getByRole('region', { name: 'Notifications' })

/**
 * Delete the run's account through the API, signing in again first if the page is no longer
 * signed in. Best effort, for a test that stopped part way: it never throws.
 */
async function deleteRunAccount(page: Page, addresses: string[]): Promise<void> {
  const remove = () =>
    page.request.delete(`${E2E_BASE}/api/account`, { data: { confirm: 'delete' } })
  try {
    if ((await remove()).ok()) return
    for (const address of addresses) {
      const login = await page.request.post(`${E2E_BASE}/api/auth/login`, {
        data: { email: address, password: PASSWORD },
      })
      if (login.ok() && (await remove()).ok()) return
    }
  } catch {
    // The page or its context is already gone; the local database is a throwaway one.
  }
}

for (const boot of BOOTS) {
  test(`a new address waits for its link, and opening it moves the account (${boot}) @smoke`, async ({
    page,
    context,
  }) => {
    test.setTimeout(120_000)
    const run = randomBytes(6).toString('hex')
    const email = `e2e-emailchange-${run}@tokencircles.test`
    const next = `e2e-emailchange-${run}-new@tokencircles.test`
    // The link's raw token only exists in the mail, so the run plants the hash of one it knows.
    const knownToken = randomBytes(32).toString('hex')
    let userId = 0
    let deleted = false

    try {
      // Sign-up is limited per network address, and specs earlier in a run sign up from the same
      // one. Only that bucket is cleared: a spec counting its own limits elsewhere is left alone.
      sql("DELETE FROM rate_limits WHERE bucket LIKE 'register:%'")
      // page.request shares the page's cookies, so signing in here signs the page in.
      await page.request.post(`${E2E_BASE}/api/auth/register`, {
        data: { email, password: PASSWORD },
      })
      await confirmAccount(email)
      // Email reminders, and with them the Save button, need a paid plan.
      sql(`UPDATE users SET plan = 'ultimate' WHERE email = '${email}'`)
      userId = sqlRows<{ id: number }>(`SELECT id FROM users WHERE email = '${email}'`)[0].id
      await bootApp(context, boot, email)
      if (boot === 'server') {
        const login = await page.request.post(`${E2E_BASE}/api/auth/login`, {
          data: { email, password: PASSWORD },
        })
        expect(login.ok(), `API login failed: ${login.status()}`).toBeTruthy()
      } else {
        await openSignIn(page, boot, E2E_BASE)
        await signInWithPassword(page, email, PASSWORD)
      }

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
      expect(accountRows()).toEqual([{ email, email_verified: 1 }])

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
        `UPDATE email_verifications SET token_hash = '${sha256Hex(knownToken)}'
       WHERE id = (SELECT MAX(id) FROM email_verifications WHERE purpose = 'change' AND email = '${next}')`
      )
      const link = `${E2E_BASE}/api/auth/verify-email?token=${knownToken}`
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
      const removed = await page.request.delete(`${E2E_BASE}/api/account`, {
        data: { confirm: 'delete' },
      })
      expect(removed.ok(), `account delete failed: ${removed.status()}`).toBeTruthy()
      deleted = true
    } finally {
      if (!deleted) await deleteRunAccount(page, [next, email])
      // This run's own limit buckets: its addresses', its account's, and the email change count
      // for the network address the run asks from. No other spec asks for an email change.
      sql(
        `DELETE FROM rate_limits WHERE bucket LIKE '%${run}%'
       OR bucket IN ('email-change-account:${userId}', 'email-change-account-day:${userId}')
       OR bucket LIKE 'email-change-ip:%'`
      )
    }
  })
}

test('local-first Settings shows no account email', async ({ page }) => {
  await gotoServerless(page, 'settings', 'settings-header')

  // The rest of the General tab is there, so the email card's absence is not a page still loading.
  await expect(page.getByText('Running in Local mode')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Base Currency' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Email reminders' })).toHaveCount(0)
  await expect(getByTestId(page, 'settings-email-input')).toHaveCount(0)
  await expect(getByTestId(page, 'settings-email-pending')).toHaveCount(0)
})
