/**
 * One-time e2e setup: bring up an account on the Worker and save the signed-in state.
 *
 * This used to be four curl commands in `.github/workflows/e2e.yml` against the Express server,
 * which meant the suite only worked in CI and only against a runtime nothing ships. It is a
 * Playwright setup project now, so `pnpm run test:e2e` does the whole thing locally too, and it
 * talks to the Worker — the API that actually serves the app.
 *
 * The signed-in state is saved once and reused by every spec. That matters: the login route is
 * rate-limited per IP, and a suite with one browser context per CPU signing in individually spent
 * that budget and started failing on the machines with the most cores.
 */
import { expect, request, test as setup } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { E2E_BASE, E2E_EMAIL, E2E_PASSWORD, E2E_PROFILE, STORAGE_STATE } from './e2e-constants'
import { seedProfile } from './e2e-seed'

setup('sign in and save the session', async () => {
  const api = await request.newContext({ baseURL: E2E_BASE })

  // The local database survives between runs, and so did the login/register rate-limit counters —
  // so the seventh `pnpm run test:e2e` of an afternoon failed at sign-in with 429 and took the
  // whole suite with it. The limiter is doing its job; a fixture database has no business
  // remembering yesterday's attempts.
  sql('DELETE FROM rate_limits')

  // Register is idempotent by design: the route is deliberately anti-enumerating, so an address
  // that already exists gets the same neutral response as a new one. A rerun against a local D1
  // that still holds the account is therefore a no-op, not an error.
  await api.post('/api/auth/register', {
    data: { email: E2E_EMAIL, password: E2E_PASSWORD },
  })

  // Two adjustments the API cannot make to its own fixture account:
  //
  // `email_verified` — the account is real, so it starts unverified and the app shows a
  // confirm-your-email strip. Nothing here is testing that strip, and letting it push the layout
  // down changes what is on screen for every other spec. There is no mail server to click.
  //
  // `plan` — Free allows two profiles, and specs that need isolation create their own. The third
  // one hit the cap and failed with a plan error, which is a true thing about the Free tier and a
  // useless thing to discover from a subscription-scan spec. Plan limits are the worker suite's
  // job; this suite should not be quietly rationed by them.
  sql(`UPDATE users SET email_verified = 1, plan = 'ultimate' WHERE email = '${E2E_EMAIL}'`)

  const login = await api.post('/api/auth/login', {
    data: { email: E2E_EMAIL, password: E2E_PASSWORD },
  })
  expect(
    login.ok(),
    `login failed: ${login.status()} ${await login.text()}\n` +
      `Is the Worker up on :8787 with JWT_SECRET set in worker/.dev.vars?`
  ).toBeTruthy()

  const profileId = await e2eProfile(api)
  await seedProfile(api, profileId)

  // eslint-disable-next-line security/detect-non-literal-fs-filename -- a constant path
  mkdirSync(dirname(STORAGE_STATE), { recursive: true })
  const state = await api.storageState()
  await api.dispose()

  // The cookie alone is not a signed-in app: the frontend reads these three from localStorage to
  // decide it is in server mode at all, and which profile to open. Saving them beside the cookie
  // is what makes every spec's first navigation land on a working app rather than the login form.
  state.origins = [
    {
      origin: E2E_BASE,
      localStorage: [
        { name: 'finance_storage_mode', value: 'self-hosted' },
        { name: 'currentProfileId', value: String(profileId) },
        { name: 'darkMode', value: 'false' },
      ],
    },
  ]
  const { writeFileSync } = await import('node:fs')
  writeFileSync(STORAGE_STATE, JSON.stringify(state, null, 2))
})

/**
 * The profile every spec starts in.
 *
 * Not the one registration creates: that one is inserted directly, so it has no categories, and a
 * categories page with nothing on it renders its empty state rather than its grid. `POST
 * /api/profiles` is the path the app uses and it seeds the defaults.
 */
async function e2eProfile(api: Awaited<ReturnType<typeof request.newContext>>): Promise<number> {
  const list = await api.get('/api/profiles')
  expect(list.ok(), `could not read profiles: ${list.status()}`).toBeTruthy()
  const body = (await list.json()) as
    | { id: number; name: string }[]
    | { profiles: { id: number; name: string }[] }
  const profiles = Array.isArray(body) ? body : body.profiles
  const existing = profiles?.find((p) => p.name === E2E_PROFILE)
  if (existing) return existing.id

  const created = await api.post('/api/profiles', { data: { name: E2E_PROFILE } })
  expect(created.ok(), `could not create the test profile: ${created.status()}`).toBeTruthy()
  return ((await created.json()) as { id: number }).id
}

/**
 * Run one statement against the local D1. `wrangler dev` and `wrangler d1 execute --local` share
 * the same state directory, so this reaches the database the Worker is serving from.
 */
function sql(command: string): void {
  const workerDir = resolve(process.cwd(), '..', 'worker')
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- derived from cwd, not input
  if (!existsSync(workerDir)) throw new Error(`worker/ not found next to ${process.cwd()}`)
  // The worker's own wrangler, by path. Not `npx wrangler`: resolving a binary off PATH is how a
  // test harness ends up running something other than the tool it meant to.
  const wrangler = resolve(workerDir, 'node_modules', '.bin', 'wrangler')
  execFileSync(wrangler, ['d1', 'execute', 'finance-manager', '--local', '--command', command], {
    cwd: workerDir,
    stdio: 'pipe',
  })
}
