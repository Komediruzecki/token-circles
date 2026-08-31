/**
 * Passkeys through the real UI, with Chromium's virtual authenticator (CDP WebAuthn domain)
 * standing in for the platform's screen lock: add a passkey in Settings, sign out, sign back in
 * with the passkey button.
 *
 * Runs at http://localhost:<port>, not 127.0.0.1 like the rest of the suite: the worker binds
 * passkeys to the CORS_ORIGIN hostname ("localhost" in dev), and WebAuthn refuses an RP ID that
 * does not match the page's host. Vite serves both names, but cookies and localStorage are
 * per-origin — hence this spec's own sign-in rather than the shared storage state.
 *
 * NOTE for local runs on a non-default E2E_PORT: the worker's CORS_ORIGIN must name the same
 * port (e.g. CORS_ORIGIN="http://localhost:3801" in worker/.dev.vars), or verification fails on
 * the origin check. CI runs the default 3800, which wrangler.jsonc's dev vars already name.
 */
import { expect, request, test } from '@playwright/test'
import { E2E_BASE } from './e2e-constants'
import { sql } from './db'
import { getByTestId } from './test-helpers'

const LOCALHOST_BASE = E2E_BASE.replace('127.0.0.1', 'localhost')
const EMAIL = 'e2e-passkey@tokencircles.test'
// eslint-disable-next-line sonarjs/no-hardcoded-passwords -- local throwaway fixture account
const PASSWORD = 'passkey-spec-password-1'

test.use({ storageState: { cookies: [], origins: [] } })

test('add a passkey in Settings, sign out, sign in with it @smoke', async ({ page, context }) => {
  test.setTimeout(120_000)

  const api = await request.newContext({ baseURL: LOCALHOST_BASE })
  sql('DELETE FROM rate_limits')
  sql(
    `DELETE FROM webauthn_credentials WHERE user_id IN (SELECT id FROM users WHERE email = '${EMAIL}')`
  )
  await api.post('/api/auth/register', { data: { email: EMAIL, password: PASSWORD } })
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
    // The virtual authenticator auto-fulfills conditional-mediation (autofill) requests, which
    // signs the page in and reloads it out from under the explicit button click this spec is
    // about. Turn the autofill path off so the button path is deterministic; conditional UI has
    // its own unit coverage in src/core/__tests__/webauthn.test.ts.
    Object.defineProperty(window.PublicKeyCredential, 'isConditionalMediationAvailable', {
      configurable: true,
      value: () => Promise.resolve(false),
    })
  }, String(profileId))

  // A CTAP2 platform authenticator that auto-confirms user verification — the "screen lock".
  const cdp = await context.newCDPSession(page)
  await cdp.send('WebAuthn.enable')
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  })

  // ── Add a passkey from Settings (fresh session: no re-auth prompt expected) ────────────────
  await page.goto(`${LOCALHOST_BASE}/#settings`)
  await getByTestId(page, 'settings-tab-about').click()
  await getByTestId(page, 'passkey-add').click()
  await expect(getByTestId(page, 'passkey-row')).toBeVisible({ timeout: 15_000 })

  // ── Sign out, then one tap back in ─────────────────────────────────────────────────────────
  await context.clearCookies()
  await page.goto(`${LOCALHOST_BASE}/`)
  await expect(page.locator('#login-email')).toBeVisible()
  await getByTestId(page, 'passkey-signin').click()
  // Positive signed-in proof — hidden-ness of #login-email also holds mid-ceremony.
  await expect(page.getByRole('button', { name: 'Logout' })).toBeVisible({ timeout: 15_000 })
})
