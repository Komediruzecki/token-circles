/**
 * Resetting a password through the real app against the local Worker, booted both ways
 * (boot.ts): asked for on the sign-in screen, then set from the link in a browser of its own, as
 * a mail app opens it.
 *
 * The reset link's raw token only exists in the mail, which no test can read, so the spec gives
 * the row the request created a token hash it knows, through the local-D1 side door the other
 * link specs use, and opens the link the mail carries with that token.
 *
 * Each case signs up an account made for the run and deletes it at the end, also when a step
 * fails.
 */
import { type APIRequestContext, type Browser, expect, type Page, test } from '@playwright/test'
import { createHash, randomBytes } from 'node:crypto'
import { BOOTS, bootApp, openSignIn, signInWithPassword, storedMode } from './boot'
import { sql, sqlRows } from './db'
import { E2E_BASE } from './e2e-constants'

// eslint-disable-next-line sonarjs/no-hardcoded-passwords -- local throwaway fixture account
const OLD_PASSWORD = 'reset-spec-old-password-1'
// eslint-disable-next-line sonarjs/no-hardcoded-passwords -- local throwaway fixture account
const NEW_PASSWORD = 'reset-spec-new-password-2'

test.use({ storageState: { cookies: [], origins: [] } })

const sha256Hex = (s: string) => createHash('sha256').update(s).digest('hex')
const runEmail = () => `e2e-reset-${randomBytes(6).toString('hex')}@tokencircles.test`

async function signUp(api: APIRequestContext, email: string): Promise<void> {
  sql("DELETE FROM rate_limits WHERE bucket LIKE 'register:%' OR bucket LIKE 'login%'")
  const registered = await api.post(`${E2E_BASE}/api/auth/register`, {
    data: { email, password: OLD_PASSWORD },
  })
  expect(registered.ok(), `sign-up failed: ${registered.status()}`).toBeTruthy()
}

/** Sign in on `api` and make the account an API token, which a reset otherwise keeps. */
async function addApiToken(api: APIRequestContext, email: string): Promise<void> {
  sql("DELETE FROM rate_limits WHERE bucket LIKE 'login%'")
  const signedIn = await api.post(`${E2E_BASE}/api/auth/login`, {
    data: { email, password: OLD_PASSWORD },
  })
  expect(signedIn.ok(), `sign-in failed: ${signedIn.status()}`).toBeTruthy()
  // API tokens come with a paid plan.
  sql(`UPDATE users SET plan = 'ultimate' WHERE email = '${email}'`)
  const minted = await api.post(`${E2E_BASE}/api/account/api-tokens`, {
    data: { name: 'Reset spec', scopes: ['read'] },
  })
  expect(minted.status(), 'making an API token').toBe(201)
}

const apiTokensOf = (email: string) =>
  sqlRows<{ n: number }>(
    `SELECT COUNT(*) AS n FROM api_tokens
     WHERE user_id = (SELECT id FROM users WHERE email = '${email}')`
  )[0]?.n

/** Ask for a reset on the sign-in screen, as the person does. */
async function askForReset(page: Page, email: string): Promise<void> {
  sql("DELETE FROM rate_limits WHERE bucket LIKE 'reset:%'")
  await page.getByRole('button', { name: 'Forgot password?' }).click()
  await page.locator('#login-email').fill(email)
  await page.getByRole('button', { name: 'Send reset link' }).click()
  await expect(page.getByTestId('auth-notice')).toHaveText(
    'If an account exists for that email, a reset link is on its way. Check your inbox.',
    { timeout: 30_000 }
  )
}

/** The link the reset mail carries, with a token the spec gave the request's row. */
function plantResetLink(email: string): string {
  const token = randomBytes(32).toString('hex')
  sql(
    `UPDATE password_resets SET token_hash = '${sha256Hex(token)}'
     WHERE id = (SELECT MAX(id) FROM password_resets
                 WHERE user_id = (SELECT id FROM users WHERE email = '${email}'))`
  )
  return `${E2E_BASE}/#reset-password?token=${token}`
}

/** Open the link in a browser of its own, booted `boot`'s way, and set the new password there. */
async function setNewPassword(browser: Browser, boot: (typeof BOOTS)[number], link: string) {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } })
  await bootApp(context, boot)
  const page = await context.newPage()
  await page.goto(link)
  await page.getByLabel('New password', { exact: true }).fill(NEW_PASSWORD)
  await page.getByLabel('Confirm new password').fill(NEW_PASSWORD)
  await page.getByRole('button', { name: 'Set new password' }).click()
  // The app lands on the sign-in screen, in account mode, a local-first browser included.
  await expect(page.locator('#login-email')).toBeVisible({ timeout: 30_000 })
  expect(await storedMode(page)).toBe('self-hosted')
  return { context, page }
}

const signInStatus = async (api: APIRequestContext, email: string, password: string) => {
  sql("DELETE FROM rate_limits WHERE bucket LIKE 'login%'")
  return (await api.post(`${E2E_BASE}/api/auth/login`, { data: { email, password } })).status()
}

async function deleteRunAccount(api: APIRequestContext, email: string): Promise<void> {
  try {
    await api.post(`${E2E_BASE}/api/auth/login`, { data: { email, password: NEW_PASSWORD } })
    await api.delete(`${E2E_BASE}/api/account`, { data: { confirm: 'delete' } })
  } catch {
    // The context is already gone. The local database is a throwaway one.
  }
}

for (const boot of BOOTS) {
  test.describe(`booted as ${boot === 'prod' ? 'a fresh browser on production' : 'dev boots'}`, () => {
    test(`a reset sets the new password: the old one fails and the new one signs in (${boot}) @smoke`, async ({
      page,
      context,
      request,
      browser,
    }) => {
      test.setTimeout(150_000)
      const email = runEmail()
      try {
        await signUp(request, email)
        sql(`UPDATE users SET email_verified = 1 WHERE email = '${email}'`)
        await bootApp(context, boot)
        await openSignIn(page, boot, E2E_BASE)
        await askForReset(page, email)

        const opened = await setNewPassword(browser, boot, plantResetLink(email))
        // A confirmed account loses nothing else, so the sign-in screen has nothing to add.
        await expect(opened.page.getByTestId('auth-notice')).toHaveCount(0)

        expect(await signInStatus(request, email, OLD_PASSWORD)).toBe(401)
        await signInWithPassword(opened.page, email, NEW_PASSWORD)
        await opened.context.close()
      } finally {
        await deleteRunAccount(request, email)
      }
    })

    test(`on an unconfirmed account, the sign-in screen says what else the reset removed (${boot}) @smoke`, async ({
      page,
      context,
      request,
      browser,
    }) => {
      test.setTimeout(150_000)
      const email = runEmail()
      try {
        await signUp(request, email)
        await addApiToken(request, email)
        expect(apiTokensOf(email)).toBe(1)
        await bootApp(context, boot)
        await openSignIn(page, boot, E2E_BASE)
        await askForReset(page, email)

        const opened = await setNewPassword(browser, boot, plantResetLink(email))

        await expect(opened.page.getByTestId('auth-notice')).toHaveText(
          'Your new password is set. Confirming your email removed what was set up before it: passkeys, two-factor authentication, API tokens and sign-ins on other devices. Sign in, then add what you need again in Settings.'
        )
        expect(apiTokensOf(email)).toBe(0)
        expect(await signInStatus(request, email, OLD_PASSWORD)).toBe(401)
        await signInWithPassword(opened.page, email, NEW_PASSWORD)
        await opened.context.close()
      } finally {
        await deleteRunAccount(request, email)
      }
    })
  })
}
