/**
 * The emailed links that confirm an address or move an account to a new one, through the real
 * app against the local Worker, booted both ways (boot.ts): as dev does, and as a fresh browser
 * on production does, local-first.
 *
 * A link is spent only with its own account's session. Opened in a browser without it, the link
 * stays unspent, the browser keeps a marker the page cannot read, and the app asks for a sign-in.
 * Signing in there finishes the link, without opening it again.
 *
 * A password account signs in, and uses the app, only once its address is confirmed. Signing up
 * says to check the inbox. Its password is refused as a wrong one is, with a way to send the link
 * again, until the browser signing in has opened the link. A session from before addresses had to
 * be confirmed gets Confirm your email instead of the app.
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
import { BOOTS, bootApp, openSignIn, signInWithPassword, storedMode } from './boot'
import { accountMade, confirmAccount, sql, sqlRows } from './db'
import { E2E_API_BASE, E2E_BASE } from './e2e-constants'

// eslint-disable-next-line sonarjs/no-hardcoded-passwords -- local throwaway fixture account
const PASSWORD = 'confirm-link-spec-password-1'
const CONFIRMED = 'Email confirmed — your account is all set'
const CHANGED = 'Email changed. Your account uses the new address from now on.'
/** What a refused password sign-in says, for a wrong password and an address not confirmed yet. */
const REFUSED =
  "That email and password don't match, or the email isn't confirmed yet. Just signed up? Open the link we emailed you, then sign in."

test.use({ storageState: { cookies: [], origins: [] } })

const sha256Hex = (s: string) => createHash('sha256').update(s).digest('hex')
const runEmail = (what: string) =>
  `e2e-link-${what}-${randomBytes(6).toString('hex')}@tokencircles.test`

/** Give the newest link of `purpose` mailed to `email` a token the spec knows; return its link. */
async function plantLink(email: string, purpose: 'confirm' | 'change'): Promise<string> {
  // A sign-up makes its link after its answer.
  const unspent = () =>
    sqlRows<{ n: number }>(
      `SELECT COUNT(*) AS n FROM email_verifications
       WHERE purpose = '${purpose}' AND email = '${email}' AND used_at IS NULL`
    )[0]?.n ?? 0
  await expect.poll(unspent, { timeout: 15_000 }).toBeGreaterThan(0)
  const token = randomBytes(32).toString('hex')
  sql(
    `UPDATE email_verifications SET token_hash = '${sha256Hex(token)}'
     WHERE id = (SELECT MAX(id) FROM email_verifications WHERE purpose = '${purpose}' AND email = '${email}')`
  )
  return `${E2E_API_BASE}/api/auth/verify-email?token=${token}`
}

/**
 * Sign up an account for the run, on another device. Its address waits for its confirm link, so
 * it is signed in nowhere.
 */
async function signUp(api: APIRequestContext, email: string): Promise<void> {
  // Sign-up and sign-in are limited per network address, and other specs use the same one.
  sql("DELETE FROM rate_limits WHERE bucket LIKE 'register:%' OR bucket LIKE 'login%'")
  const registered = await api.post(`${E2E_BASE}/api/auth/register`, {
    data: { email, password: PASSWORD },
  })
  expect(registered.ok(), `sign-up failed: ${registered.status()}`).toBeTruthy()
  await accountMade(email)
}

/** Sign in on the device `api` stands for. */
async function signInOn(api: APIRequestContext, email: string): Promise<void> {
  sql("DELETE FROM rate_limits WHERE bucket LIKE 'login%'")
  const signedIn = await api.post(`${E2E_BASE}/api/auth/login`, {
    data: { email, password: PASSWORD },
  })
  expect(signedIn.ok(), `sign-in failed: ${signedIn.status()}`).toBeTruthy()
}

/** Sign up an account for the run with its address confirmed, signed in on `api`. */
async function signUpConfirmed(api: APIRequestContext, email: string): Promise<void> {
  await signUp(api, email)
  await confirmAccount(email)
  await signInOn(api, email)
}

/**
 * Sign up an account for the run whose address waits for its link, signed in on `api` with a
 * session from before addresses had to be confirmed: confirmed while it signs in, waiting again
 * after.
 */
async function signedInFromBefore(api: APIRequestContext, email: string): Promise<void> {
  await signUpConfirmed(api, email)
  sql(`UPDATE users SET email_verified = 0 WHERE email = '${email}'`)
}

/** Sign in on the sign-in screen with the right password, and see it refused. */
async function refusedSignIn(page: Page, email: string): Promise<void> {
  await page.locator('#login-email').fill(email)
  await page.locator('#login-password').fill(PASSWORD)
  await page.locator('button[type="submit"]').click()
  await expect(page.getByTestId('login-error')).toHaveText(REFUSED, { timeout: 30_000 })
  await expect(page.getByRole('button', { name: 'Logout' })).toHaveCount(0)
}

/** An account signed in on `api` whose address is confirmed, with a change to `next` waiting. */
async function askForChange(api: APIRequestContext, email: string, next: string): Promise<string> {
  await signUpConfirmed(api, email)
  // The change lives in the notification settings, which a paid plan has.
  sql(`UPDATE users SET plan = 'ultimate' WHERE email = '${email}'`)
  const asked = await api.put(`${E2E_BASE}/api/notifications/settings`, { data: { email: next } })
  expect(asked.ok(), `asking for the change failed: ${asked.status()}`).toBeTruthy()
  return plantLink(next, 'change')
}

/** The id of the newest confirm link made for `email`, or 0 when there is none. */
const newestConfirmLink = (email: string) =>
  sqlRows<{ id: number | null }>(
    `SELECT MAX(id) AS id FROM email_verifications WHERE purpose = 'confirm' AND email = '${email}'`
  )[0]?.id ?? 0

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

/**
 * Land on the app with the link's answer, as the browser does after the redirect: in a page load
 * of its own. From a page already on the app, going to its address with only another fragment
 * would not load it again, and the app reads the fragment as it loads.
 */
async function land(page: Page, fragment: string): Promise<void> {
  await page.goto('about:blank')
  await page.goto(`${E2E_BASE}/${fragment}`)
}

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
        const link = await plantLink(email, 'confirm')
        await bootApp(context, boot, email)

        const fragment = await openLink(page, link)
        expect(fragment).toBe('#everified_error=signin_required')
        expect(accountState(email)).toMatchObject({ email_verified: 0, waiting: 1 })
        expect(await marker(context)).toMatchObject({
          path: '/api/auth',
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
        const link = await plantLink(email, 'confirm')
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

    test(`with the cookies cleared after the only open, the password is refused and the link still works (${boot})`, async ({
      page,
      context,
      request,
    }) => {
      test.setTimeout(120_000)
      const email = runEmail('cleared')
      try {
        await signUp(request, email)
        const link = await plantLink(email, 'confirm')
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

        // Nothing here proves the mailbox now: the password is refused, as a wrong one is.
        await refusedSignIn(page, email)
        expect(accountState(email)).toMatchObject({ email_verified: 0, waiting: 1 })
        // Opened again, the link still works: the next sign-in here confirms the address.
        await land(page, await openLink(page, link))
        await signInWithPassword(page, email, PASSWORD)
        await expect(toast(page, CONFIRMED)).toBeVisible({ timeout: 30_000 })
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
        const link = await plantLink(email, 'confirm')
        // This browser is signed in to another account.
        await signUpConfirmed(page.request, other)
        await bootApp(context, boot, other)

        const fragment = await openLink(page, link)
        expect(fragment).toBe('#everified_error=signin_required')
        await land(page, fragment)

        await expect(page.locator('[data-testid="email-link-other-account"]')).toHaveText(
          'That link is for another account. Sign out, then sign in to that account, and its address is confirmed as soon as you do.',
          { timeout: 30_000 }
        )
        expect(accountState(email)).toMatchObject({ email_verified: 0, waiting: 1 })
        expect(accountState(other)).toMatchObject({ email_verified: 1 })

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
        expect(accountState(other)).toMatchObject({ email_verified: 1 })
      } finally {
        await deleteRunAccounts(page, [email, other])
      }
    })

    test(`a link opened signed in finishes at once (${boot}) @smoke`, async ({ page, context }) => {
      test.setTimeout(120_000)
      const email = runEmail('at-once')
      try {
        await signedInFromBefore(page.request, email)
        const link = await plantLink(email, 'confirm')
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

    test(`the marker of a link that expired since does not let the password in (${boot})`, async ({
      page,
      context,
      request,
    }) => {
      test.setTimeout(120_000)
      const email = runEmail('expired')
      try {
        await signUp(request, email)
        const link = await plantLink(email, 'confirm')
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

        // The link the marker names proves nothing now: the password is refused, as a wrong one is.
        await refusedSignIn(page, email)

        expect(accountState(email)).toMatchObject({ email_verified: 0, waiting: 1 })
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
        // The other device holds a session from before addresses had to be confirmed.
        await signedInFromBefore(request, email)
        const link = await plantLink(email, 'confirm')
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

    test(`signing up says to check the inbox, the password is refused until the link is opened, and then it signs in (${boot}) @smoke`, async ({
      page,
      context,
    }) => {
      test.setTimeout(150_000)
      const email = runEmail('sign-up')
      try {
        sql(
          "DELETE FROM rate_limits WHERE bucket LIKE 'register%' OR bucket LIKE 'login%' OR bucket LIKE 'confirm-resend%'"
        )
        await bootApp(context, boot)
        await openSignIn(page, boot, E2E_BASE)
        await page.getByText('Create one').click()
        await page.locator('#login-email').fill(email)
        await page.locator('#login-password').fill(PASSWORD)
        await page.locator('button[type="submit"]').click()

        await expect(page.getByTestId('check-inbox-address')).toHaveText(email, {
          timeout: 30_000,
        })
        await accountMade(email)
        await expect.poll(() => accountState(email)?.waiting).toBe(1)
        expect(accountState(email)).toMatchObject({ email_verified: 0 })
        expect((await context.cookies()).find((c) => c.name === 'fm_session')).toBeUndefined()

        // Back on the form, the password is refused until the address is confirmed, and the
        // refusal sends the link again: a fresh one, which retires the first.
        await page.getByTestId('check-inbox-back').click()
        await refusedSignIn(page, email)
        const first = newestConfirmLink(email)
        const resent = page.waitForResponse((r) =>
          r.url().endsWith('/api/auth/verify-email/resend')
        )
        await page.getByTestId('send-confirm-link').click()
        expect((await resent).status()).toBe(200)
        await expect(page.getByTestId('check-inbox-address')).toHaveText(email)
        await expect.poll(() => newestConfirmLink(email)).toBeGreaterThan(first)
        expect(accountState(email)).toMatchObject({ email_verified: 0, waiting: 1 })

        // The newest link, opened in this browser, lets the next sign-in here in.
        await land(page, await openLink(page, await plantLink(email, 'confirm')))
        await signInWithPassword(page, email, PASSWORD)
        await expect(toast(page, CONFIRMED)).toBeVisible({ timeout: 30_000 })
        expect(accountState(email)).toMatchObject({ email_verified: 1, waiting: 0 })
      } finally {
        await deleteRunAccounts(page, [email])
      }
    })

    test(`a session from before gets Confirm your email, which sends the link again and signs out, and the link lets it in (${boot}) @smoke`, async ({
      page,
      context,
    }) => {
      test.setTimeout(150_000)
      const email = runEmail('gate')
      try {
        // This browser holds a session from before addresses had to be confirmed.
        await signedInFromBefore(page.request, email)
        await bootApp(context, boot, email)
        await page.goto(`${E2E_BASE}/`)
        if (boot === 'prod') {
          // A fresh browser starts local-first: Manage Account moves it to account mode.
          await page.getByTestId('profile-dropdown-btn').click()
          await page.getByText('Manage Account', { exact: true }).click()
        }

        await expect(page.getByTestId('confirm-email-address')).toHaveText(email, {
          timeout: 30_000,
        })
        await expect(page.getByRole('button', { name: 'Logout' })).toHaveCount(0)

        // Send the link again, signed in: a fresh one.
        sql(`DELETE FROM rate_limits WHERE bucket = 'resend-verification:${email}'`)
        const first = newestConfirmLink(email)
        const resent = page.waitForResponse((r) =>
          r.url().endsWith('/api/auth/resend-verification')
        )
        await page.locator('[data-testid="confirm-email-resend"]').click()
        expect((await resent).status()).toBe(200)
        await expect(page.getByText('Sent. Check your inbox.')).toBeVisible()
        expect(newestConfirmLink(email)).toBeGreaterThan(first)

        // Sign out, then open the newest link here: the next sign-in confirms the address.
        await page.getByTestId('confirm-email-sign-out').click()
        await expect(page.locator('#login-email')).toBeVisible({ timeout: 30_000 })
        expect((await context.cookies()).find((c) => c.name === 'fm_session')).toBeUndefined()
        await land(page, await openLink(page, await plantLink(email, 'confirm')))
        await expect(page.getByTestId('auth-notice')).toHaveText(
          'Sign in to confirm your address.',
          { timeout: 30_000 }
        )
        await signInWithPassword(page, email, PASSWORD)
        await expect(toast(page, CONFIRMED)).toBeVisible({ timeout: 30_000 })
        expect(accountState(email)).toMatchObject({ email_verified: 1, waiting: 0 })
      } finally {
        await deleteRunAccounts(page, [email])
      }
    })
  })
}
