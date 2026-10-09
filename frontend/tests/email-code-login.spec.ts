/**
 * Email-code sign-in through the real UI: request a code, get rejected on a wrong guess, sign in
 * with the right one. The raw code only exists inside the email, which no test can read — so the
 * spec rewrites the freshly minted row's hash to that of a code it knows, via the same local-D1
 * side door global.setup uses. The ceremony cookie set by the request stays untouched: the spec
 * verifies against exactly the row the browser is bound to.
 *
 * Runs as its own user with no shared storage state. The second case signs up an account of its
 * own each run: only an account whose address was not confirmed yet loses what it had set up.
 *
 * Each case runs booted both ways (boot.ts): as dev does, and as a fresh browser on production,
 * which starts local-first and reaches the sign-in screen through Manage Account.
 */
import { expect, request, test } from '@playwright/test'
import { createHash, randomBytes } from 'node:crypto'
import { BOOTS, bootApp, openSignIn } from './boot'
import { E2E_BASE } from './e2e-constants'
import { sql } from './db'
import { getByTestId } from './test-helpers'
import { SIGN_IN_MESSAGES } from '../../shared/signInSchema'

/** One account per boot, so the two runs of the case never share a code. */
const emailFor = (boot: string) =>
  boot === 'server' ? 'e2e-emailcode@tokencircles.test' : `e2e-emailcode-${boot}@tokencircles.test`
// eslint-disable-next-line sonarjs/no-hardcoded-passwords -- local throwaway fixture account
const PASSWORD = 'emailcode-spec-password-1'
const KNOWN_CODE = '123456'

test.use({ storageState: { cookies: [], origins: [] } })

const sha256Hex = (s: string) => createHash('sha256').update(s).digest('hex')

for (const boot of BOOTS) {
  test(`request a code, wrong guess rejected, known code signs in (${boot}) @smoke`, async ({
    page,
    context,
  }) => {
    test.setTimeout(120_000)
    const EMAIL = emailFor(boot)

    // A registered account whose profile id the app can boot from after the reload. Its profile
    // is read from the database rather than through a password sign-in: the first code sign-in
    // confirms the address and, as on any account whose address was not confirmed yet, removes
    // the password it registered with, so the next run (or a retry) could not sign in with it.
    const api = await request.newContext({ baseURL: E2E_BASE })
    sql('DELETE FROM rate_limits')
    sql(`DELETE FROM login_codes WHERE email = '${EMAIL}'`)
    await api.post('/api/auth/register', { data: { email: EMAIL, password: PASSWORD } })
    await api.dispose()
    await bootApp(context, boot, EMAIL)

    // ── Request: the login screen's passwordless path ──────────────────────────────────────────
    await openSignIn(page, boot, E2E_BASE)
    await getByTestId(page, 'emailcode-open').click()
    await getByTestId(page, 'emailcode-email').fill(EMAIL)
    await getByTestId(page, 'emailcode-send').click()
    await expect(getByTestId(page, 'emailcode-code')).toBeVisible()

    // The browser now holds the ceremony cookie for the newest row; give that row a hash the
    // spec knows. (The mailed code is unreadable here by design.)
    sql(
      `UPDATE login_codes SET code_hash = '${sha256Hex(KNOWN_CODE)}'
     WHERE id = (SELECT MAX(id) FROM login_codes WHERE email = '${EMAIL}')`
    )

    // ── Wrong guess: said under the code field, and the form stays ─────────────────────────────
    await getByTestId(page, 'emailcode-code').fill('999999')
    await getByTestId(page, 'emailcode-verify').click()
    await expect(getByTestId(page, 'emailcode-code')).toHaveAttribute('aria-invalid', 'true')
    await expect(getByTestId(page, 'emailcode-code')).toHaveAccessibleDescription(
      SIGN_IN_MESSAGES.emailCodeRefused
    )

    // ── Right code: signed in ──────────────────────────────────────────────────────────────────
    await getByTestId(page, 'emailcode-code').fill(KNOWN_CODE)
    await getByTestId(page, 'emailcode-verify').click()
    // Positive proof of the signed-in app: #login-email is hidden during the code step too, so
    // its absence proves nothing (and lets the next action race the Set-Cookie + reload).
    await expect(page.getByRole('button', { name: 'Logout' })).toBeVisible({ timeout: 15_000 })
  })

  test(`a code sign-in that confirms the address says what confirming it removed (${boot}) @smoke`, async ({
    page,
  }) => {
    test.setTimeout(120_000)
    const email = `e2e-emailcode-${randomBytes(6).toString('hex')}@tokencircles.test`
    try {
      sql('DELETE FROM rate_limits')
      const api = await request.newContext({ baseURL: E2E_BASE })
      await api.post('/api/auth/register', { data: { email, password: PASSWORD } })
      await api.dispose()
      await bootApp(page.context(), boot, email)

      await openSignIn(page, boot, E2E_BASE)
      await getByTestId(page, 'emailcode-open').click()
      await getByTestId(page, 'emailcode-email').fill(email)
      await getByTestId(page, 'emailcode-send').click()
      await expect(getByTestId(page, 'emailcode-code')).toBeVisible()
      sql(
        `UPDATE login_codes SET code_hash = '${sha256Hex(KNOWN_CODE)}'
       WHERE id = (SELECT MAX(id) FROM login_codes WHERE email = '${email}')`
      )
      await getByTestId(page, 'emailcode-code').fill(KNOWN_CODE)
      await getByTestId(page, 'emailcode-verify').click()
      await expect(page.getByRole('button', { name: 'Logout' })).toBeVisible({ timeout: 15_000 })

      // The password it signed up with went when the code confirmed the address, and the app,
      // after its reload, says so.
      await expect(page.locator('[data-testid="access-cleared-notice"]')).toContainText(
        'Confirming your email removed what was set up before it: the old password'
      )
    } finally {
      await page.request
        .delete(`${E2E_BASE}/api/account`, { data: { confirm: 'delete' } })
        .catch(() => undefined)
    }
  })
}
