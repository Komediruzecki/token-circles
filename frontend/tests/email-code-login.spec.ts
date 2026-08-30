/**
 * Email-code sign-in through the real UI: request a code, get rejected on a wrong guess, sign in
 * with the right one. The raw code only exists inside the email, which no test can read — so the
 * spec rewrites the freshly minted row's hash to that of a code it knows, via the same local-D1
 * side door global.setup uses. The ceremony cookie set by the request stays untouched: the spec
 * verifies against exactly the row the browser is bound to.
 *
 * Runs as its own user with no shared storage state.
 */
import { expect, request, test } from '@playwright/test'
import { createHash } from 'node:crypto'
import { E2E_BASE } from './e2e-constants'
import { sql } from './db'
import { getByTestId } from './test-helpers'

const EMAIL = 'e2e-emailcode@tokencircles.test'
// eslint-disable-next-line sonarjs/no-hardcoded-passwords -- local throwaway fixture account
const PASSWORD = 'emailcode-spec-password-1'
const KNOWN_CODE = '123456'

test.use({ storageState: { cookies: [], origins: [] } })

const sha256Hex = (s: string) => createHash('sha256').update(s).digest('hex')

test('request a code, wrong guess rejected, known code signs in', async ({ page, context }) => {
  test.setTimeout(120_000)

  // A registered account whose profile id the app can boot from after the reload.
  const api = await request.newContext({ baseURL: E2E_BASE })
  sql('DELETE FROM rate_limits')
  sql(`DELETE FROM login_codes WHERE email = '${EMAIL}'`)
  await api.post('/api/auth/register', { data: { email: EMAIL, password: PASSWORD } })
  const login = await api.post('/api/auth/login', { data: { email: EMAIL, password: PASSWORD } })
  expect(login.ok(), `API login failed: ${login.status()}`).toBeTruthy()
  const profiles = (await (await api.get('/api/profiles')).json()) as
    { id: number }[] | { profiles: { id: number }[] }
  const profileId = (Array.isArray(profiles) ? profiles : profiles.profiles)[0].id
  await api.dispose()

  await context.addInitScript((pid: string) => {
    localStorage.setItem('finance_storage_mode', 'self-hosted')
    localStorage.setItem('currentProfileId', pid)
    localStorage.setItem('darkMode', 'false')
    localStorage.setItem('finance_onboarding', 'skipped')
  }, String(profileId))

  // ── Request: the login screen's passwordless path ──────────────────────────────────────────
  await page.goto(`${E2E_BASE}/`)
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

  // ── Wrong guess: neutral rejection, form stays ─────────────────────────────────────────────
  await getByTestId(page, 'emailcode-code').fill('999999')
  await getByTestId(page, 'emailcode-verify').click()
  await expect(getByTestId(page, 'emailcode-error')).toBeVisible()

  // ── Right code: signed in ──────────────────────────────────────────────────────────────────
  await getByTestId(page, 'emailcode-code').fill(KNOWN_CODE)
  await getByTestId(page, 'emailcode-verify').click()
  await expect(page.locator('#login-email')).toBeHidden({ timeout: 15_000 })
})
