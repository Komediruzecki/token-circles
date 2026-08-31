/**
 * TOTP 2FA, the whole loop through the real UI: enroll in Settings (reading the shared secret
 * off the screen and computing codes the way an authenticator app would), hit the challenge on
 * the next password sign-in, get rejected with a wrong code, get in with a right one, sign in
 * again with a recovery code, and finally disable.
 *
 * Runs as its own user with no shared storage state — enabling 2FA on the fixture account would
 * break every other spec's sign-in.
 */
import { expect, request, test } from '@playwright/test'
import { createHmac } from 'node:crypto'
import { E2E_BASE } from './e2e-constants'
import { sql } from './db'
import { getByTestId } from './test-helpers'

const EMAIL = 'e2e-twofa@tokencircles.test'
// eslint-disable-next-line sonarjs/no-hardcoded-passwords -- local throwaway fixture account
const PASSWORD = 'twofa-spec-password-1'

test.use({ storageState: { cookies: [], origins: [] } })

// ── A minimal authenticator app: RFC 6238 TOTP over the base32 secret shown on screen ────────
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
function base32ToBuf(s: string): Buffer {
  let bits = 0
  let value = 0
  const out: number[] = []
  for (const ch of s.replace(/=+$/, '').toUpperCase()) {
    const idx = B32.indexOf(ch)
    if (idx < 0) continue
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return Buffer.from(out)
}

function totp(secretB32: string, step: number): string {
  const msg = Buffer.alloc(8)
  msg.writeBigUInt64BE(BigInt(step))
  const h = createHmac('sha1', base32ToBuf(secretB32)).update(msg).digest()
  const off = h[h.length - 1] & 0xf
  const bin = ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3]
  return String(bin % 1_000_000).padStart(6, '0')
}

/**
 * A code for the step AFTER the current one. Enrollment consumes the current step (anti-replay
 * high-water mark), so a sign-in inside the same 30s window must present a later step — which
 * the server's ±1 drift window accepts.
 */
const nextStepCode = (secret: string) => totp(secret, Math.floor(Date.now() / 1000 / 30) + 1)

async function uiLogin(page: import('@playwright/test').Page, password = PASSWORD) {
  await page.goto(`${E2E_BASE}/`)
  await page.locator('#login-email').fill(EMAIL)
  await page.locator('#login-password').fill(password)
  await page.locator('button[type="submit"]').click()
}

test('enroll, challenge on sign-in, recovery code, disable @smoke', async ({ page, context }) => {
  test.setTimeout(180_000)

  // ── Arrange: a dedicated user with a clean 2FA slate, signed in via the API ────────────────
  const api = await request.newContext({ baseURL: E2E_BASE })
  sql('DELETE FROM rate_limits')
  sql(`DELETE FROM recovery_codes WHERE user_id IN (SELECT id FROM users WHERE email = '${EMAIL}')`)
  sql(
    `DELETE FROM totp_credentials WHERE user_id IN (SELECT id FROM users WHERE email = '${EMAIL}')`
  )
  await api.post('/api/auth/register', { data: { email: EMAIL, password: PASSWORD } })
  sql(`UPDATE users SET email_verified = 1 WHERE email = '${EMAIL}'`)
  const login = await api.post('/api/auth/login', { data: { email: EMAIL, password: PASSWORD } })
  expect(login.ok(), `API login failed: ${login.status()}`).toBeTruthy()
  const profiles = (await (await api.get('/api/profiles')).json()) as
    { id: number }[] | { profiles: { id: number }[] }
  const profileId = (Array.isArray(profiles) ? profiles : profiles.profiles)[0].id

  await context.addCookies((await api.storageState()).cookies)
  await api.dispose()
  await context.addInitScript((pid: string) => {
    localStorage.setItem('finance_storage_mode', 'self-hosted')
    localStorage.setItem('currentProfileId', pid)
    localStorage.setItem('darkMode', 'false')
    localStorage.setItem('finance_onboarding', 'skipped')
  }, String(profileId))

  // ── Enroll through Settings -> About ───────────────────────────────────────────────────────
  await page.goto(`${E2E_BASE}/#settings`)
  await getByTestId(page, 'settings-tab-about').click()
  await getByTestId(page, 'twofa-enable-btn').click()

  const secret = (await getByTestId(page, 'twofa-secret').textContent())?.trim() ?? ''
  expect(secret).toMatch(/^[A-Z2-7]{32}$/)
  await expect(getByTestId(page, 'twofa-qr').locator('svg')).toBeVisible()

  await getByTestId(page, 'twofa-enroll-code').fill(
    totp(secret, Math.floor(Date.now() / 1000 / 30))
  )
  await getByTestId(page, 'twofa-enroll-confirm').click()

  const codesText = (await getByTestId(page, 'twofa-recovery-codes').textContent()) ?? ''
  const recoveryCodes = codesText.match(/[A-Z2-7]{5}-[A-Z2-7]{5}/g) ?? []
  expect(recoveryCodes).toHaveLength(10)
  await getByTestId(page, 'twofa-codes-done').click()
  await expect(getByTestId(page, 'twofa-enabled-badge')).toBeVisible()

  // ── Password sign-in now hits the challenge; wrong code stays out, TOTP gets in ────────────
  await context.clearCookies()
  await uiLogin(page)
  await expect(getByTestId(page, 'twofa-code')).toBeVisible()

  await getByTestId(page, 'twofa-code').fill('000000')
  await getByTestId(page, 'twofa-submit').click()
  await expect(getByTestId(page, 'twofa-error')).toBeVisible()

  await getByTestId(page, 'twofa-code').fill(nextStepCode(secret))
  await getByTestId(page, 'twofa-submit').click()
  // Success reloads into the signed-in app. The proof must be POSITIVE (the Logout button):
  // #login-email is already hidden while the challenge is showing, so asserting hidden-ness
  // passes instantly and the next clearCookies races the verify response's Set-Cookie —
  // which then re-authenticates the browser (exactly what CI's slower runners hit).
  await expect(page.getByRole('button', { name: 'Logout' })).toBeVisible({ timeout: 15_000 })

  // ── "Create account" with this existing 2FA-protected email also lands on the challenge ────
  await context.clearCookies()
  await page.goto(`${E2E_BASE}/`)
  await page.getByText('Create one').click()
  await page.locator('#login-email').fill(EMAIL)
  await page.locator('#login-password').fill(PASSWORD)
  await page.locator('button[type="submit"]').click()
  await expect(getByTestId(page, 'twofa-code')).toBeVisible()
  await getByTestId(page, 'twofa-back').click()
  await expect(page.locator('#login-email')).toBeVisible()

  // ── A recovery code also gets in — once ────────────────────────────────────────────────────
  await context.clearCookies()
  await uiLogin(page)
  await expect(getByTestId(page, 'twofa-code')).toBeVisible()
  await getByTestId(page, 'twofa-use-recovery').click()
  await getByTestId(page, 'twofa-code').fill(recoveryCodes[0])
  await getByTestId(page, 'twofa-submit').click()
  await expect(page.getByRole('button', { name: 'Logout' })).toBeVisible({ timeout: 15_000 })

  // ── Disable demands a factor; a recovery code counts (a fresh TOTP step may not exist yet —
  // the challenge sign-in above just consumed one inside the same 30s window) ─────────────────
  await page.goto(`${E2E_BASE}/#settings`)
  await getByTestId(page, 'settings-tab-about').click()
  await getByTestId(page, 'twofa-disable-btn').click()
  await getByTestId(page, 'twofa-disable-code').fill(recoveryCodes[1])
  await getByTestId(page, 'twofa-disable-confirm').click()
  await expect(getByTestId(page, 'twofa-enable-btn')).toBeVisible()

  // Password sign-in is challenge-free again.
  await context.clearCookies()
  await uiLogin(page)
  await expect(page.getByRole('button', { name: 'Logout' })).toBeVisible({ timeout: 15_000 })
})
