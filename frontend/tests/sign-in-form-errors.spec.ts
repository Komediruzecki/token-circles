/**
 * The sign-in screen's forms in the real app against the local Worker, booted both ways
 * (boot.ts): what is wrong is marked at the field it is about, and nothing on the screen tells an
 * address with an account from one without.
 *
 * A wrong password for an account, and any password for an address with no account, get the same
 * answer from the Worker and the same words on the screen, and neither field is marked. Asking
 * for a reset link answers the same for both. A field left empty, or filled in a way the Worker
 * would refuse, is marked with its message as its accessible description, and nothing is sent:
 * on the sign-in, account, email-code and support forms, and on the new-password screen a reset
 * link opens.
 *
 * Each case signs up an account made for the run (an example.com address) and deletes it at the
 * end, also when a step fails.
 */
import { type APIRequestContext, expect, type Page, test } from '@playwright/test'
import { createHash, randomBytes } from 'node:crypto'
import { BOOTS, bootApp, openSignIn } from './boot'
import { sql } from './db'
import { E2E_BASE } from './e2e-constants'
import { isNetworkNoise } from './test-helpers'
import { SIGN_IN_MESSAGES as SAY } from '../../shared/signInSchema'

// eslint-disable-next-line sonarjs/no-hardcoded-passwords -- local throwaway fixture account
const PASSWORD = 'signin-spec-password-1'
// eslint-disable-next-line sonarjs/no-hardcoded-passwords -- a password no account here has
const WRONG_PASSWORD = 'not-the-password-2'

test.use({ storageState: { cookies: [], origins: [] } })

const stamp = () => randomBytes(6).toString('hex')
const sha256Hex = (s: string) => createHash('sha256').update(s).digest('hex')

/** An account made for the run. */
async function signUp(api: APIRequestContext): Promise<string> {
  const email = `e2e-signin-${stamp()}@example.com`
  sql("DELETE FROM rate_limits WHERE bucket LIKE 'register%'")
  const registered = await api.post(`${E2E_BASE}/api/auth/register`, {
    data: { email, password: PASSWORD },
  })
  expect(registered.ok(), `sign-up failed: ${registered.status()}`).toBeTruthy()
  return email
}

async function deleteRunAccount(api: APIRequestContext, email: string): Promise<void> {
  try {
    sql("DELETE FROM rate_limits WHERE bucket LIKE 'login%'")
    await api.post(`${E2E_BASE}/api/auth/login`, { data: { email, password: PASSWORD } })
    await api.delete(`${E2E_BASE}/api/account`, { data: { confirm: 'delete' } })
  } catch {
    // The context is already gone. The local database is a throwaway one.
  }
}

/** Uncaught exceptions, and console errors that are not the network's own noise. */
function watchErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (msg) => {
    const text = msg.text()
    if (msg.type() === 'error' && text.includes('Error') && !isNetworkNoise(text)) {
      errors.push(text)
    }
  })
  page.on('pageerror', (error) => errors.push(error.message))
  return errors
}

/** Every POST the page sends to a path ending in `path`. */
function watchPosts(page: Page, path: string): string[] {
  const posts: string[] = []
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname.endsWith(path)) {
      posts.push(request.url())
    }
  })
  return posts
}

interface Answer {
  status: number
  body: string
}

/** Sends the form the button belongs to and returns the Worker's answer to `path`, as sent. */
async function sendAndRead(page: Page, path: string, send: () => Promise<void>): Promise<Answer> {
  const answered = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith(path)
  )
  await send()
  const response = await answered
  return { status: response.status(), body: await response.text() }
}

const email = (page: Page) => page.locator('#login-email')
const password = (page: Page) => page.locator('#login-password')
const submit = (page: Page) => page.locator('form button[type="submit"]').first().click()

async function expectUnmarked(page: Page) {
  await expect(email(page)).not.toHaveAttribute('aria-invalid', 'true')
  await expect(password(page)).not.toHaveAttribute('aria-invalid', 'true')
}

for (const boot of BOOTS) {
  test.describe(`booted as ${boot === 'prod' ? 'a fresh browser on production' : 'dev boots'}`, () => {
    test(`a wrong password and an address with no account get the same answer, and no field is marked (${boot}) @smoke`, async ({
      page,
      context,
      request,
    }) => {
      test.setTimeout(150_000)
      const errors = watchErrors(page)
      const account = await signUp(request)
      try {
        await bootApp(context, boot)
        await openSignIn(page, boot, E2E_BASE)

        const tryWith = async (address: string): Promise<{ answer: Answer; said: string }> => {
          sql("DELETE FROM rate_limits WHERE bucket LIKE 'login%'")
          await email(page).fill(address)
          await password(page).fill(WRONG_PASSWORD)
          const answer = await sendAndRead(page, '/api/auth/login', () => submit(page))
          await expect(page.getByTestId('login-error')).not.toHaveText('')
          return { answer, said: (await page.getByTestId('login-error').textContent()) ?? '' }
        }

        const known = await tryWith(account)
        await expectUnmarked(page)
        const unknown = await tryWith(`e2e-signin-nobody-${stamp()}@example.com`)
        await expectUnmarked(page)

        expect(known.answer.status).toBe(401)
        expect(unknown.answer).toEqual(known.answer)
        expect(unknown.said).toBe(known.said)
        expect(errors).toEqual([])
      } finally {
        await deleteRunAccount(request, account)
      }
    })

    test(`asking for a reset link answers the same for an address with an account and one without (${boot})`, async ({
      page,
      context,
      request,
    }) => {
      test.setTimeout(150_000)
      const errors = watchErrors(page)
      const account = await signUp(request)
      try {
        await bootApp(context, boot)
        await openSignIn(page, boot, E2E_BASE)
        await page.getByRole('button', { name: 'Forgot password?' }).click()

        const askFor = async (address: string): Promise<{ answer: Answer; said: string }> => {
          sql("DELETE FROM rate_limits WHERE bucket LIKE 'forgot%'")
          await email(page).fill(address)
          const answer = await sendAndRead(page, '/api/auth/forgot-password', () =>
            page.getByRole('button', { name: 'Send reset link' }).click()
          )
          await expect(page.getByTestId('auth-notice')).not.toHaveText('')
          return { answer, said: (await page.getByTestId('auth-notice').textContent()) ?? '' }
        }

        const known = await askFor(account)
        const unknown = await askFor(`e2e-signin-nobody-${stamp()}@example.com`)

        expect(known.answer.status).toBe(200)
        expect(unknown.answer).toEqual(known.answer)
        expect(unknown.said).toBe(known.said)
        await expect(email(page)).not.toHaveAttribute('aria-invalid', 'true')
        expect(errors).toEqual([])
      } finally {
        await deleteRunAccount(request, account)
      }
    })

    test(`what is missing is marked at its field, and nothing is sent (${boot})`, async ({
      page,
      context,
    }) => {
      test.setTimeout(150_000)
      const errors = watchErrors(page)
      const signIns = watchPosts(page, '/api/auth/login')
      const registrations = watchPosts(page, '/api/auth/register')
      const codeRequests = watchPosts(page, '/api/auth/email-code/request')
      const supportMessages = watchPosts(page, '/api/support/contact')
      await bootApp(context, boot)
      await openSignIn(page, boot, E2E_BASE)

      // ── Sign in, empty, then an address that is not one ─────────────────────────────────────
      await submit(page)
      await expect(email(page)).toHaveAttribute('aria-invalid', 'true')
      await expect(email(page)).toHaveAccessibleDescription(SAY.email)
      await expect(email(page)).toBeFocused()
      await expect(password(page)).toHaveAttribute('aria-invalid', 'true')
      await expect(password(page)).toHaveAccessibleDescription(SAY.password)

      await email(page).fill('name-at-example.com')
      await password(page).fill(WRONG_PASSWORD)
      await submit(page)
      await expect(email(page)).toHaveAccessibleDescription(SAY.emailFormat)
      await expect(password(page)).not.toHaveAttribute('aria-invalid', 'true')

      // ── A code by email, with no address ──────────────────────────────────────────────────────
      await page.getByTestId('emailcode-open').click()
      await page.getByTestId('emailcode-email').fill('')
      await page.getByTestId('emailcode-send').click()
      await expect(page.getByTestId('emailcode-email')).toHaveAttribute('aria-invalid', 'true')
      await expect(page.getByTestId('emailcode-email')).toHaveAccessibleDescription(SAY.email)
      await page.getByTestId('emailcode-back').click()

      // ── A message to support, empty ───────────────────────────────────────────────────────────
      await page.locator('a', { hasText: 'Contact support' }).click()
      await page.getByRole('button', { name: 'Send message' }).click()
      await expect(
        page.getByLabel('Your email address', { exact: true })
      ).toHaveAccessibleDescription(SAY.email)
      await expect(page.getByLabel('Message', { exact: true })).toHaveAccessibleDescription(
        SAY.supportMessage
      )
      await expect(page.getByLabel('Your email address', { exact: true })).toBeFocused()
      await page.getByRole('button', { name: 'Cancel' }).click()

      // ── A new account with a password that is too short ───────────────────────────────────────
      await page.getByText('Create one').click()
      await email(page).fill(`e2e-signin-${stamp()}@example.com`)
      await password(page).fill('short')
      await submit(page)
      await expect(password(page)).toHaveAttribute('aria-invalid', 'true')
      await expect(password(page)).toHaveAccessibleDescription(SAY.newPassword)
      await expect(password(page)).toBeFocused()

      expect(signIns).toEqual([])
      expect(registrations).toEqual([])
      expect(codeRequests).toEqual([])
      expect(supportMessages).toEqual([])
      expect(errors).toEqual([])
    })

    test(`the new-password screen marks a short password and a second entry that differs (${boot})`, async ({
      page,
      context,
      request,
    }) => {
      test.setTimeout(150_000)
      const errors = watchErrors(page)
      const resets = watchPosts(page, '/api/auth/reset-password')
      const account = await signUp(request)
      try {
        // The link the reset mail carries, with a token the spec knows.
        const token = randomBytes(32).toString('hex')
        sql(
          `INSERT INTO password_resets (user_id, token_hash, expires_at)
           VALUES ((SELECT id FROM users WHERE email = '${account}'), '${sha256Hex(token)}',
                   datetime('now', '+1 hour'))`
        )
        await bootApp(context, boot)
        await page.goto(`${E2E_BASE}/#reset-password?token=${token}`)
        const newPassword = page.getByLabel('New password', { exact: true })
        const confirmation = page.getByLabel('Confirm new password')
        const setIt = () => page.getByRole('button', { name: 'Set new password' }).click()

        await newPassword.fill('short')
        await confirmation.fill('short')
        await setIt()
        await expect(newPassword).toHaveAttribute('aria-invalid', 'true')
        await expect(newPassword).toHaveAccessibleDescription(SAY.newPassword)
        await expect(newPassword).toBeFocused()

        await newPassword.fill('a-new-password-1')
        await confirmation.fill('a-new-password-2')
        await setIt()
        await expect(confirmation).toHaveAttribute('aria-invalid', 'true')
        await expect(confirmation).toHaveAccessibleDescription(SAY.confirmPassword)
        await expect(newPassword).not.toHaveAttribute('aria-invalid', 'true')
        await expect(confirmation).toBeFocused()

        expect(resets).toEqual([])
        expect(errors).toEqual([])
      } finally {
        await deleteRunAccount(request, account)
      }
    })
  })
}
