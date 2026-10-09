/**
 * The emailed links that confirm an address or move an account to a new one, through the real
 * app against the local Worker, booted both ways (boot.ts): as dev does, and as a fresh browser
 * on production does, local-first.
 *
 * A link is spent only with its own account's session. Opened in a browser without it, the link
 * stays unspent, the browser keeps a marker the page cannot read, and the app asks for a sign-in.
 * Signing in there finishes the link, without opening it again.
 *
 * The link's raw token only exists in the mail, which no test can read, so the spec gives the
 * account's newest link a token hash it knows, through the local-D1 side door
 * settings-email-change.spec.ts uses. The link points at the Worker's own port, as the mailed one
 * points at the API origin. Cookies are not separated by port, so the session and the marker
 * reach both, as the parent-domain cookie reaches the API host in production. The route answers
 * with a redirect to the app origin the Worker is configured with, not this run's address, so the
 * spec reads that redirect without following it and opens its fragment on this run's app.
 *
 * Each case signs up accounts made for the run, with no shared storage state, and deletes them at
 * the end, also when a step fails.
 */
import {
  type APIRequestContext,
  type BrowserContext,
  expect,
  type Page,
  test,
} from '@playwright/test'
import { createHash, randomBytes } from 'node:crypto'
import { BOOTS, bootApp, signInWithPassword, storedMode } from './boot'
import { sql, sqlRows } from './db'
import { E2E_API_BASE, E2E_BASE } from './e2e-constants'

// eslint-disable-next-line sonarjs/no-hardcoded-passwords -- local throwaway fixture account
const PASSWORD = 'confirm-link-spec-password-1'
const CONFIRMED = 'Email confirmed — your account is all set'
const CHANGED = 'Email changed. Your account uses the new address from now on.'

test.use({ storageState: { cookies: [], origins: [] } })

const sha256Hex = (s: string) => createHash('sha256').update(s).digest('hex')
const runEmail = (what: string) =>
  `e2e-link-${what}-${randomBytes(6).toString('hex')}@tokencircles.test`

/** Give the newest link of `purpose` mailed to `email` a token the spec knows; return its link. */
function plantLink(email: string, purpose: 'confirm' | 'change'): string {
  const token = randomBytes(32).toString('hex')
  sql(
    `UPDATE email_verifications SET token_hash = '${sha256Hex(token)}'
     WHERE id = (SELECT MAX(id) FROM email_verifications WHERE purpose = '${purpose}' AND email = '${email}')`
  )
  return `${E2E_API_BASE}/api/auth/verify-email?token=${token}`
}

/** Sign up an account for the run on the device `api` stands for, which stays signed in to it. */
async function signUp(api: APIRequestContext, email: string): Promise<void> {
  // Sign-up and sign-in are limited per network address, and other specs use the same one.
  sql("DELETE FROM rate_limits WHERE bucket LIKE 'register:%' OR bucket LIKE 'login%'")
  const registered = await api.post(`${E2E_BASE}/api/auth/register`, {
    data: { email, password: PASSWORD },
  })
  expect(registered.ok(), `sign-up failed: ${registered.status()}`).toBeTruthy()
  const signedIn = await api.post(`${E2E_BASE}/api/auth/login`, {
    data: { email, password: PASSWORD },
  })
  expect(signedIn.ok(), `sign-in failed: ${signedIn.status()}`).toBeTruthy()
}

/** An account signed in on `api` whose address is confirmed, with a change to `next` waiting. */
async function askForChange(api: APIRequestContext, email: string, next: string): Promise<string> {
  await signUp(api, email)
  // The change lives in the notification settings, which a paid plan has.
  sql(`UPDATE users SET plan = 'ultimate', email_verified = 1 WHERE email = '${email}'`)
  const asked = await api.put(`${E2E_BASE}/api/notifications/settings`, { data: { email: next } })
  expect(asked.ok(), `asking for the change failed: ${asked.status()}`).toBeTruthy()
  return plantLink(next, 'change')
}

/** The account's address, whether it is confirmed, and how many of its links are unspent. */
function accountState(email: string) {
  return sqlRows<{ email: string; email_verified: number; waiting: number }>(
    `SELECT users.email, users.email_verified,
       (SELECT COUNT(*) FROM email_verifications
        WHERE email_verifications.user_id = users.id AND used_at IS NULL) AS waiting
     FROM users WHERE users.email = '${email}'`
  )[0]
}

/** Open the link with the page's cookies, and return the fragment its redirect carries. */
async function openLink(page: Page, link: string): Promise<string> {
  const opened = await page.request.get(link, { maxRedirects: 0 })
  expect(opened.status()).toBe(302)
  return new URL(opened.headers()['location']).hash
}

/** The marker the browser keeps for the link, as the browser stores it. */
async function marker(context: BrowserContext) {
  return (await context.cookies()).find((c) => c.name === 'fm_email_link')
}

/** Land on the app with the link's answer, as the browser does after the redirect. */
const land = (page: Page, fragment: string) => page.goto(`${E2E_BASE}/${fragment}`)

const toast = (page: Page, text: string) =>
  page.getByRole('region', { name: 'Notifications' }).getByText(text)

/** The finish route's answer to the sign-in that `act` makes. */
async function finishAnswer(page: Page, act: () => Promise<void>): Promise<unknown> {
  const answered = page.waitForResponse((r) => r.url().includes('/api/auth/email-link/finish'), {
    timeout: 30_000,
  })
  await act()
  return (await answered).json()
}

/** Delete the run's accounts, signing in to each first. Best effort: never throws. */
async function deleteRunAccounts(page: Page, emails: string[]): Promise<void> {
  for (const email of emails) {
    try {
      await page.request.post(`${E2E_BASE}/api/auth/login`, {
        data: { email, password: PASSWORD },
      })
      await page.request.delete(`${E2E_BASE}/api/account`, { data: { confirm: 'delete' } })
    } catch {
      // The page or its context is already gone. The local database is a throwaway one.
    }
  }
}

for (const boot of BOOTS) {
  test.describe(`booted as ${boot === 'prod' ? 'a fresh browser on production' : 'dev boots'}`, () => {
    test(`a confirm link opened without a session finishes once signed in there (${boot}) @smoke`, async ({
      page,
      context,
      request,
    }) => {
      test.setTimeout(120_000)
      const email = runEmail('confirm')
      try {
        // The account signs up on another device; this browser has no session.
        await signUp(request, email)
        const link = plantLink(email, 'confirm')
        await bootApp(context, boot, email)

        const fragment = await openLink(page, link)
        expect(fragment).toBe('#everified_error=signin_required')
        expect(accountState(email)).toMatchObject({ email_verified: 0, waiting: 1 })
        expect(await marker(context)).toMatchObject({
          path: '/api/auth/email-link/finish',
          httpOnly: true,
          sameSite: 'Lax',
        })

        await land(page, fragment)
        await expect(page.getByTestId('auth-notice')).toHaveText(
          'Sign in to confirm your address.',
          {
            timeout: 30_000,
          }
        )
        // A local-first browser moved to account mode to get here.
        expect(await storedMode(page)).toBe('self-hosted')

        await signInWithPassword(page, email, PASSWORD)

        await expect(toast(page, CONFIRMED)).toBeVisible({ timeout: 30_000 })
        expect(accountState(email)).toMatchObject({ email_verified: 1, waiting: 0 })
        expect(await marker(context)).toBeUndefined()
      } finally {
        await deleteRunAccounts(page, [email])
      }
    })

    test(`a change link opened without a session finishes once signed in there (${boot}) @smoke`, async ({
      page,
      context,
      request,
    }) => {
      test.setTimeout(120_000)
      const email = runEmail('change-from')
      const next = runEmail('change-to')
      try {
        const link = await askForChange(request, email, next)
        await bootApp(context, boot, email)

        const fragment = await openLink(page, link)
        expect(fragment).toBe('#everified_error=signin_required&change=1')

        await land(page, fragment)
        await expect(page.getByTestId('auth-notice')).toHaveText(
          'Sign in to finish changing your address.',
          { timeout: 30_000 }
        )
        // The account still has its old address until the link finishes.
        await signInWithPassword(page, email, PASSWORD)

        await expect(toast(page, CHANGED)).toBeVisible({ timeout: 30_000 })
        expect(accountState(next)).toMatchObject({ email: next, email_verified: 1 })
        expect(accountState(email)).toBeUndefined()
      } finally {
        await deleteRunAccounts(page, [email, next])
      }
    })

    test(`opened again by a mail app's fresh browser, it finishes after signing in there (${boot})`, async ({
      page,
      context,
      request,
    }) => {
      test.setTimeout(120_000)
      const email = runEmail('twice')
      try {
        await signUp(request, email)
        const link = plantLink(email, 'confirm')
        await bootApp(context, boot, email)

        // The first open, then a fresh browser for the next one: no cookies at all.
        await openLink(page, link)
        await context.clearCookies()
        expect(await marker(context)).toBeUndefined()
        const fragment = await openLink(page, link)
        expect(fragment).toBe('#everified_error=signin_required')
        expect(accountState(email)).toMatchObject({ email_verified: 0, waiting: 1 })

        await land(page, fragment)
        await expect(page.getByTestId('auth-notice')).toHaveText(
          'Sign in to confirm your address.',
          {
            timeout: 30_000,
          }
        )
        await signInWithPassword(page, email, PASSWORD)

        await expect(toast(page, CONFIRMED)).toBeVisible({ timeout: 30_000 })
        expect(accountState(email)).toMatchObject({ email_verified: 1, waiting: 0 })
      } finally {
        await deleteRunAccounts(page, [email])
      }
    })

    test(`with the cookies cleared after the only open, signing in finishes nothing and the link still works (${boot})`, async ({
      page,
      context,
      request,
    }) => {
      test.setTimeout(120_000)
      const email = runEmail('cleared')
      try {
        await signUp(request, email)
        const link = plantLink(email, 'confirm')
        await bootApp(context, boot, email)

        await land(page, await openLink(page, link))
        await expect(page.getByTestId('auth-notice')).toHaveText(
          'Sign in to confirm your address.',
          {
            timeout: 30_000,
          }
        )
        // The marker was the browser's only record that it opened the link.
        await context.clearCookies()

        const answer = await finishAnswer(page, () => signInWithPassword(page, email, PASSWORD))

        expect(answer).toEqual({ outcome: 'none', change: false })
        await expect(toast(page, CONFIRMED)).toHaveCount(0)
        expect(accountState(email)).toMatchObject({ email_verified: 0, waiting: 1 })
        // Opened again, now signed in here, it finishes at once.
        expect(await openLink(page, link)).toBe('#everified=1')
        expect(accountState(email)).toMatchObject({ email_verified: 1, waiting: 0 })
      } finally {
        await deleteRunAccounts(page, [email])
      }
    })

    test(`signed in to another account: sign out, sign in to the right one, and it finishes (${boot}) @smoke`, async ({
      page,
      context,
      request,
    }) => {
      test.setTimeout(150_000)
      const email = runEmail('owner')
      const other = runEmail('other')
      try {
        await signUp(request, email)
        const link = plantLink(email, 'confirm')
        // This browser is signed in to another account.
        await signUp(page.request, other)
        await bootApp(context, boot, other)

        const fragment = await openLink(page, link)
        expect(fragment).toBe('#everified_error=signin_required')
        await land(page, fragment)

        await expect(page.locator('[data-testid="email-link-other-account"]')).toHaveText(
          'That link is for another account. Sign out, then sign in to that account, and its address is confirmed as soon as you do.',
          { timeout: 30_000 }
        )
        expect(accountState(email)).toMatchObject({ email_verified: 0, waiting: 1 })
        expect(accountState(other)).toMatchObject({ email_verified: 0 })

        await page.getByRole('button', { name: 'Logout' }).click()
        await expect(page.getByTestId('auth-notice')).toHaveText(
          'Sign in to confirm your address.',
          {
            timeout: 30_000,
          }
        )
        await signInWithPassword(page, email, PASSWORD)

        await expect(toast(page, CONFIRMED)).toBeVisible({ timeout: 30_000 })
        expect(accountState(email)).toMatchObject({ email_verified: 1, waiting: 0 })
        expect(accountState(other)).toMatchObject({ email_verified: 0 })
      } finally {
        await deleteRunAccounts(page, [email, other])
      }
    })

    test(`a link opened signed in finishes at once (${boot}) @smoke`, async ({ page, context }) => {
      test.setTimeout(120_000)
      const email = runEmail('at-once')
      try {
        await signUp(page.request, email)
        const link = plantLink(email, 'confirm')
        await bootApp(context, boot, email)

        const fragment = await openLink(page, link)

        expect(fragment).toBe('#everified=1')
        expect(accountState(email)).toMatchObject({ email_verified: 1, waiting: 0 })
        expect(await marker(context)).toBeUndefined()
        await land(page, fragment)
        await expect(toast(page, CONFIRMED)).toBeVisible({ timeout: 30_000 })
      } finally {
        await deleteRunAccounts(page, [email])
      }
    })

    test(`the marker of a link that expired since does nothing after signing in (${boot})`, async ({
      page,
      context,
      request,
    }) => {
      test.setTimeout(120_000)
      const email = runEmail('expired')
      try {
        await signUp(request, email)
        const link = plantLink(email, 'confirm')
        await bootApp(context, boot, email)
        await land(page, await openLink(page, link))
        await expect(page.getByTestId('auth-notice')).toHaveText(
          'Sign in to confirm your address.',
          {
            timeout: 30_000,
          }
        )
        sql(
          `UPDATE email_verifications SET expires_at = '2020-01-01T00:00:00.000Z'
           WHERE user_id = (SELECT id FROM users WHERE email = '${email}') AND used_at IS NULL`
        )

        const answer = await finishAnswer(page, () => signInWithPassword(page, email, PASSWORD))

        expect(answer).toEqual({ outcome: 'none', change: false })
        await expect(toast(page, CONFIRMED)).toHaveCount(0)
        expect(accountState(email)).toMatchObject({ email_verified: 0, waiting: 1 })
        expect(await marker(context)).toBeUndefined()
      } finally {
        await deleteRunAccounts(page, [email])
      }
    })

    test(`the marker of a link spent since does nothing after signing in (${boot})`, async ({
      page,
      context,
      request,
    }) => {
      test.setTimeout(120_000)
      const email = runEmail('spent')
      try {
        await signUp(request, email)
        const link = plantLink(email, 'confirm')
        await bootApp(context, boot, email)
        await land(page, await openLink(page, link))
        await expect(page.getByTestId('auth-notice')).toHaveText(
          'Sign in to confirm your address.',
          {
            timeout: 30_000,
          }
        )
        // The other device, where the account is signed in, opens the same link.
        const elsewhere = await request.get(link, { maxRedirects: 0 })
        expect(new URL(elsewhere.headers()['location']).hash).toBe('#everified=1')

        const answer = await finishAnswer(page, () => signInWithPassword(page, email, PASSWORD))

        expect(answer).toEqual({ outcome: 'none', change: false })
        await expect(toast(page, CONFIRMED)).toHaveCount(0)
        expect(accountState(email)).toMatchObject({ email_verified: 1, waiting: 0 })
        expect(await marker(context)).toBeUndefined()
      } finally {
        await deleteRunAccounts(page, [email])
      }
    })
  })
}
