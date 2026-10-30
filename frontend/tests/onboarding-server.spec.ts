/**
 * Signed in, the setup wizard belongs to the account: its record is on the Worker
 * (`/api/account/state`, user_state), so an account meets the wizard once, on any device, and
 * reopens it at the step it reached.
 *
 * Each case signs up an account of its own, signs this browser in to it, and deletes it after.
 * The fixture account every other spec uses has a finished record (global.setup.ts), as every
 * account in use before the record existed does (migration 0035).
 *
 * The local-first wizard, which keeps its decision in localStorage, is onboarding.spec.ts.
 */
import { expect, test } from '@playwright/test'
import { bootSignedIn, deleteAccount, signIn, signUpAndIn } from './own-account'
import { E2E_BASE } from './test-helpers'
import type { BrowserContext, Page, Response } from '@playwright/test'

interface OnboardingRecord {
  step: string | null
  started_at: string | null
  finished_at: string | null
  outcome: string | null
}

/** The account's record, as the Worker answers it to `ctx`'s session. */
async function recordOf(ctx: BrowserContext): Promise<OnboardingRecord | null> {
  const res = await ctx.request.get(`${E2E_BASE}/api/account/state`)
  expect(res.ok(), `GET /api/account/state: ${String(res.status())}`).toBeTruthy()
  return ((await res.json()) as { onboarding: OnboardingRecord | null }).onboarding
}

/** The next answered write to the record whose body matches. */
const recordWrite = (
  page: Page,
  matches: (sent: Partial<OnboardingRecord>) => boolean
): Promise<Response> =>
  page.waitForResponse(
    (res) =>
      new URL(res.url()).pathname === '/api/account/state/onboarding' &&
      res.request().method() === 'PUT' &&
      res.ok() &&
      matches(JSON.parse(res.request().postData() ?? '{}') as Partial<OnboardingRecord>),
    { timeout: 30_000 }
  )

const TIME = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/

test.describe('the setup wizard on the account @smoke', () => {
  test.beforeEach(() => {
    test.setTimeout(120_000)
  })

  test('a new account meets it, and reopens it at the step it reached', async ({ page }) => {
    const ctx = page.context()
    const { email } = await signUpAndIn(ctx)
    try {
      await bootSignedIn(ctx)
      const steps: string[] = []
      page.on('request', (req) => {
        if (new URL(req.url()).pathname !== '/api/account/state/onboarding') return
        const sent = JSON.parse(req.postData() ?? '{}') as Partial<OnboardingRecord>
        if (sent.step) steps.push(sent.step)
      })
      const started = recordWrite(page, (sent) => sent.step === 'space')
      await page.goto(`${E2E_BASE}/#dashboard`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
      await expect(page.getByTestId('onboarding-step-space')).toBeVisible({ timeout: 30_000 })
      await started

      // The space's second screen is the same step: nothing new to keep until the account.
      await page.getByTestId('onboarding-next').click()
      await expect(page.getByTestId('onboarding-step-about')).toBeVisible({ timeout: 30_000 })
      const reached = recordWrite(page, (sent) => sent.step === 'account')
      await page.getByTestId('onboarding-next').click()
      await expect(page.getByTestId('onboarding-step-account')).toBeVisible({ timeout: 30_000 })
      await reached

      await page.reload({ waitUntil: 'domcontentloaded' })
      await expect(page.getByTestId('onboarding-step-account')).toBeVisible({ timeout: 30_000 })

      const record = await recordOf(ctx)
      expect(record).toMatchObject({ step: 'account', finished_at: null, outcome: null })
      expect(record!.started_at).toMatch(TIME)
      // The old first screen is never written: setup opens on the space.
      expect(steps).toEqual(['space', 'account'])
    } finally {
      await deleteAccount(ctx, email)
    }
  })

  test('a record left at the old first screen reopens on the space, and moves on from there', async ({
    page,
  }) => {
    const ctx = page.context()
    const { email } = await signUpAndIn(ctx)
    try {
      // Left at welcome, as a build before the space opened setup kept it.
      const left = await ctx.request.put(`${E2E_BASE}/api/account/state/onboarding`, {
        data: { step: 'welcome' },
      })
      expect(left.ok(), `PUT /api/account/state/onboarding: ${String(left.status())}`).toBeTruthy()
      const { started_at: startedAt } = (await recordOf(ctx))!
      expect(startedAt).toMatch(TIME)

      await bootSignedIn(ctx)
      const moved = recordWrite(page, (sent) => sent.step === 'space')
      await page.goto(`${E2E_BASE}/#dashboard`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
      await expect(page.getByTestId('onboarding-step-space')).toBeVisible({ timeout: 30_000 })
      await moved

      expect(await recordOf(ctx)).toMatchObject({
        step: 'space',
        started_at: startedAt,
        finished_at: null,
        outcome: null,
      })
    } finally {
      await deleteAccount(ctx, email)
    }
  })

  test('the space step keeps where you live and who the space covers on the profile', async ({
    page,
  }) => {
    const ctx = page.context()
    const { email } = await signUpAndIn(ctx)
    /** The profile's answers as the Worker keeps them, under the plain key. */
    const answers = async () => {
      const res = await ctx.request.get(`${E2E_BASE}/api/settings`)
      expect(res.ok(), `GET /api/settings: ${String(res.status())}`).toBeTruthy()
      const { guidance } = (await res.json()) as { guidance?: string }
      return guidance === undefined ? null : (JSON.parse(guidance) as unknown)
    }
    try {
      await bootSignedIn(ctx)
      await page.goto(`${E2E_BASE}/#dashboard`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
      await expect(page.getByTestId('onboarding-step-space')).toBeVisible({ timeout: 30_000 })
      await page.getByTestId('onboarding-next').click()
      await expect(page.getByTestId('onboarding-step-about')).toBeVisible({ timeout: 30_000 })

      await page.getByTestId('onboarding-space-region-UK').click()
      await page.getByTestId('onboarding-space-adults-1').click()
      await page.getByTestId('onboarding-next').click()
      await expect(page.getByTestId('onboarding-step-account')).toBeVisible({ timeout: 30_000 })
      await expect.poll(answers).toEqual({ region: 'UK', adults: 1 })

      // Settings shows them, and Remove answer clears one there.
      await page.getByTestId('onboarding-skip').click()
      await page.getByTestId('confirm-accept').click()
      await expect(page.getByTestId('onboarding-wizard')).toHaveCount(0)
      await page.evaluate(() => {
        window.location.hash = 'settings'
      })
      await expect(page.getByTestId('settings-about-space')).toBeVisible({ timeout: 30_000 })
      await expect(
        page.getByTestId('about-this-space').getByRole('radio', { name: 'United Kingdom' })
      ).toBeChecked()
      await expect(page.getByTestId('settings-space-region-note')).toHaveText(
        'Compared with the United Kingdom, from your answer.'
      )
      await page.getByTestId('settings-space-region-ask-again').click()
      await expect.poll(answers).toEqual({ adults: 1 })
      await expect(page.getByTestId('settings-space-region-note')).toContainText(
        'Not answered yet.'
      )
    } finally {
      await deleteAccount(ctx, email)
    }
  })

  test('a skip is kept on the account, and another browser on it opens no wizard', async ({
    page,
    browser,
  }) => {
    const ctx = page.context()
    const { email } = await signUpAndIn(ctx)
    try {
      await bootSignedIn(ctx)
      await page.goto(`${E2E_BASE}/#dashboard`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
      await expect(page.getByTestId('onboarding-step-space')).toBeVisible({ timeout: 30_000 })

      const skipped = recordWrite(page, (sent) => sent.outcome === 'skipped')
      await page.getByTestId('onboarding-skip').click()
      await page.getByTestId('confirm-accept').click()
      await expect(page.getByTestId('onboarding-wizard')).toHaveCount(0)
      await skipped

      const record = await recordOf(ctx)
      expect(record).toMatchObject({ step: 'space', outcome: 'skipped' })
      expect(record!.finished_at).toMatch(TIME)

      // Another device: nothing in its storage, the same account signed in.
      const elsewhere = await browser.newContext({ storageState: { cookies: [], origins: [] } })
      try {
        await signIn(elsewhere, email)
        await bootSignedIn(elsewhere)
        const other = await elsewhere.newPage()
        await other.goto(`${E2E_BASE}/#dashboard`, {
          waitUntil: 'domcontentloaded',
          timeout: 30_000,
        })
        await expect(other.getByTestId('dashboard-header')).toBeVisible({ timeout: 30_000 })
        await other.waitForTimeout(1200)
        await expect(other.getByTestId('onboarding-wizard')).toHaveCount(0)
      } finally {
        await elsewhere.close()
      }
    } finally {
      await deleteAccount(ctx, email)
    }
  })

  test('a decision this browser kept from before goes to the account, once', async ({ page }) => {
    const ctx = page.context()
    const { email, id } = await signUpAndIn(ctx)
    const flag = `finance_onboarding:account-${id}`
    try {
      await bootSignedIn(ctx)
      // Finished in this browser before the record existed: the flag the app kept then.
      await ctx.addInitScript((key) => {
        if (!sessionStorage.getItem('onb_flag_seeded')) {
          sessionStorage.setItem('onb_flag_seeded', '1')
          localStorage.setItem(key, 'completed')
        }
      }, flag)
      const writes: string[] = []
      page.on('request', (req) => {
        if (new URL(req.url()).pathname.startsWith('/api/account/state/')) {
          writes.push(`${req.method()} ${req.postData() ?? ''}`)
        }
      })

      const sent = recordWrite(page, (body) => body.outcome === 'completed')
      await page.goto(`${E2E_BASE}/#dashboard`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
      await expect(page.getByTestId('dashboard-header')).toBeVisible({ timeout: 30_000 })
      await sent
      await expect(page.getByTestId('onboarding-wizard')).toHaveCount(0)
      expect(await recordOf(ctx)).toMatchObject({ step: null, outcome: 'completed' })
      await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), flag)).toBeNull()

      await page.reload({ waitUntil: 'domcontentloaded' })
      await expect(page.getByTestId('dashboard-header')).toBeVisible({ timeout: 30_000 })
      await page.waitForTimeout(1200)
      await expect(page.getByTestId('onboarding-wizard')).toHaveCount(0)
      expect(writes).toEqual(['PUT {"outcome":"completed"}'])
    } finally {
      await deleteAccount(ctx, email)
    }
  })

  test('a second account in the same browser meets its own wizard', async ({ page }) => {
    const ctx = page.context()
    // The fixture account, signed in from the saved state: finished long ago, no wizard.
    await page.goto(`${E2E_BASE}/#dashboard`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await expect(page.getByTestId('dashboard-header')).toBeVisible({ timeout: 30_000 })
    await page.waitForTimeout(1200)
    await expect(page.getByTestId('onboarding-wizard')).toHaveCount(0)

    const { email } = await signUpAndIn(ctx)
    try {
      await page.evaluate(() => {
        localStorage.removeItem('currentProfileId')
        localStorage.removeItem('selectedProfileIds')
      })
      await page.reload({ waitUntil: 'domcontentloaded' })
      await expect(page.getByTestId('onboarding-step-space')).toBeVisible({ timeout: 30_000 })
    } finally {
      await deleteAccount(ctx, email)
    }
  })
})
