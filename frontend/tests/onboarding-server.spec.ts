/**
 * Signed in, the setup wizard belongs to the account: its record is on the Worker
 * (`/api/account/state`, user_state), so an account meets the wizard once, on any device, and
 * reopens it at the step it reached.
 *
 * Each case signs up an account of its own, signs this browser in to it, and deletes it after.
 * The fixture account every other spec uses has a finished record (global.setup.ts), as every
 * account in use before the record existed does (migration 0035).
 *
 * The local-first wizard, which keeps its decision in localStorage, is onboarding.spec.ts. The
 * switch from an account to local-only, over a browser that ran the demo, is here: it starts on
 * the account's setup.
 */
import { expect, test } from '@playwright/test'
import { bootSignedIn, deleteAccount, signIn, signUpAndIn } from './own-account'
import { paintedContrast } from './painted-contrast'
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

/**
 * A YNAB Register file (Export Plan's download), hand-typed with made-up names and amounts: a
 * starting balance per account, a pay cheque, groceries, and a transfer YNAB writes once per
 * account. Three transactions come out of it.
 */
const YNAB_REGISTER = [
  [
    'Account',
    'Flag',
    'Date',
    'Payee',
    'Category Group/Category',
    'Category Group',
    'Category',
    'Memo',
    'Outflow',
    'Inflow',
    'Cleared',
  ],
  [
    'Test Checking',
    '',
    '01/02/2026',
    'Starting Balance',
    'Inflow: Ready to Assign',
    'Inflow',
    'Ready to Assign',
    '',
    '$0.00',
    '$1,250.00',
    'Reconciled',
  ],
  [
    'Test Savings',
    '',
    '01/02/2026',
    'Starting Balance',
    'Inflow: Ready to Assign',
    'Inflow',
    'Ready to Assign',
    '',
    '$0.00',
    '$3,000.00',
    'Reconciled',
  ],
  [
    'Test Checking',
    '',
    '01/05/2026',
    'Example Employer',
    'Inflow: Ready to Assign',
    'Inflow',
    'Ready to Assign',
    'Pay',
    '$0.00',
    '$2,400.00',
    'Cleared',
  ],
  [
    'Test Checking',
    '',
    '01/14/2026',
    'Corner Grocer',
    'Everyday: Groceries',
    'Everyday',
    'Groceries',
    '',
    '$54.20',
    '$0.00',
    'Cleared',
  ],
  [
    'Test Checking',
    '',
    '01/20/2026',
    'Transfer : Test Savings',
    '',
    '',
    '',
    'Top-up',
    '$200.00',
    '$0.00',
    'Cleared',
  ],
  [
    'Test Savings',
    '',
    '01/20/2026',
    'Transfer : Test Checking',
    '',
    '',
    '',
    'Top-up',
    '$0.00',
    '$200.00',
    'Cleared',
  ],
]
  .map((cells) => cells.map((c) => `"${c}"`).join(','))
  .join('\n')

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

  test('reopened at the statement, an import goes into the account made before, on the Worker', async ({
    page,
  }) => {
    const ctx = page.context()
    const { email } = await signUpAndIn(ctx)
    try {
      await bootSignedIn(ctx)
      await page.goto(`${E2E_BASE}/#dashboard`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
      await expect(page.getByTestId('onboarding-step-space')).toBeVisible({ timeout: 30_000 })
      await page.getByTestId('onboarding-next').click()
      await expect(page.getByTestId('onboarding-step-about')).toBeVisible({ timeout: 30_000 })
      await page.getByTestId('onboarding-next').click()
      await expect(page.getByTestId('onboarding-step-account')).toBeVisible({ timeout: 30_000 })

      // The main account, with what it holds today.
      await page.getByTestId('onboarding-account-name').fill('Main Checking')
      await page.getByTestId('onboarding-account-balance').fill('1500')
      const reached = recordWrite(page, (sent) => sent.step === 'import')
      await page.getByTestId('onboarding-account-create').click()
      await expect(page.getByTestId('onboarding-step-import')).toBeVisible({ timeout: 30_000 })
      await reached

      // Back on the account step: the account is listed, and the form is blank for another.
      await page.getByTestId('onboarding-back').click()
      await expect(page.getByTestId('onboarding-account-chip')).toHaveCount(1)
      await expect(page.getByTestId('onboarding-account-chip')).toContainText('Main Checking')
      await expect(page.getByTestId('onboarding-account-name')).toHaveValue('')
      await expect(page.getByTestId('onboarding-account-balance')).toHaveValue('')

      // Off to the bank to export the statement, and back: setup reopens at the statement, and
      // the statement goes into the account it has, not into a new one beside it.
      await page.reload({ waitUntil: 'domcontentloaded' })
      await expect(page.getByTestId('onboarding-step-import')).toBeVisible({ timeout: 30_000 })
      await page
        .getByTestId('onboarding-import-input')
        .setInputFiles('tests/fixtures/revolut-sample.csv')
      await expect(page.getByTestId('onboarding-import-file')).toHaveAttribute(
        'data-state',
        'ready',
        { timeout: 30_000 }
      )
      await expect(page.getByTestId('onboarding-import-target')).toHaveValue('Main Checking')
      const importAll = page.getByTestId('onboarding-import-selected')
      await expect(importAll).toHaveText('Import 7')
      const subscriptions = recordWrite(page, (sent) => sent.step === 'subscriptions')
      await importAll.click()
      await expect(page.getByTestId('onboarding-step-subscriptions')).toBeVisible({
        timeout: 30_000,
      })
      await subscriptions

      // On the Worker: still the one account, holding the statement's seven transactions.
      const accounts = (await (await ctx.request.get(`${E2E_BASE}/api/accounts`)).json()) as {
        id: number
        name: string
      }[]
      expect(accounts.map((a) => a.name)).toEqual(['Main Checking'])
      const listed = await ctx.request.get(
        `${E2E_BASE}/api/transactions?account_id=${String(accounts[0].id)}`
      )
      expect(listed.ok(), `GET /api/transactions: ${String(listed.status())}`).toBeTruthy()
      expect(((await listed.json()) as { total: number }).total).toBe(7)
    } finally {
      await deleteAccount(ctx, email)
    }
  })

  test('a YNAB Register file goes into the accounts it names, and none for the file, on the Worker', async ({
    page,
  }) => {
    const ctx = page.context()
    const { email } = await signUpAndIn(ctx)
    try {
      await bootSignedIn(ctx)
      await page.goto(`${E2E_BASE}/#dashboard`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
      await expect(page.getByTestId('onboarding-step-space')).toBeVisible({ timeout: 30_000 })
      await page.getByTestId('onboarding-next').click()
      await expect(page.getByTestId('onboarding-step-about')).toBeVisible({ timeout: 30_000 })
      await page.getByTestId('onboarding-next').click()
      await expect(page.getByTestId('onboarding-step-account')).toBeVisible({ timeout: 30_000 })
      await page.getByTestId('onboarding-account-name').fill('Main Checking')
      await page.getByTestId('onboarding-account-create').click()
      await expect(page.getByTestId('onboarding-step-import')).toBeVisible({ timeout: 30_000 })

      await expect(page.getByTestId('onboarding-import-ynab')).toContainText(
        'Choose the Register file from its Export Plan download here.'
      )
      await page.getByTestId('onboarding-import-input').setInputFiles({
        name: 'Test Plan as of 2026-01-31 Register.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from(YNAB_REGISTER),
      })
      await expect(page.getByTestId('onboarding-import-file')).toHaveAttribute(
        'data-state',
        'ready',
        { timeout: 30_000 }
      )
      // Nothing to choose: the file says where each row goes.
      await expect(page.getByTestId('onboarding-import-target')).toHaveCount(0)
      await expect(page.getByTestId('onboarding-import-accounts')).toHaveText(
        'Each row goes to its own account: Test Checking and Test Savings.'
      )
      const importAll = page.getByTestId('onboarding-import-selected')
      await expect(importAll).toHaveText('Import 3')
      await importAll.click()
      await expect(page.getByTestId('onboarding-step-subscriptions')).toBeVisible({
        timeout: 30_000,
      })

      // On the Worker: the two accounts the file names beside the one setup made, which holds
      // none of the rows, and no account for the file itself.
      const accounts = (await (await ctx.request.get(`${E2E_BASE}/api/accounts`)).json()) as {
        id: number
        name: string
      }[]
      expect(accounts.map((a) => a.name).sort()).toEqual([
        'Main Checking',
        'Test Checking',
        'Test Savings',
      ])
      const total = async (name: string) => {
        const id = accounts.find((a) => a.name === name)!.id
        const res = await ctx.request.get(`${E2E_BASE}/api/transactions?account_id=${String(id)}`)
        expect(res.ok(), `GET /api/transactions: ${String(res.status())}`).toBeTruthy()
        return ((await res.json()) as { total: number }).total
      }
      expect(await total('Main Checking')).toBe(0)
      expect(await total('Test Checking')).toBe(3)

      await page.getByTestId('onboarding-back').click()
      await expect(page.getByTestId('onboarding-import-done')).toHaveText(
        'Imported 3 transactions into Test Checking and Test Savings.'
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

/** The demo's example profiles, as the seed names them (core/demoMode.ts). */
const EXAMPLES = ['Example Low Income', 'Example Mid Income', 'Example High Income']

/**
 * This browser's local database: its profiles by id, and every row still filed on one of `gone`,
 * by store. Read straight from IndexedDB, as no page shows rows of a deleted profile.
 */
async function localWorkspace(
  page: Page,
  gone: number[] = []
): Promise<{ profiles: { id: number; name: string }[]; left: string[] }> {
  return page.evaluate(async (goneIds) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open('finance-manager')
      open.onsuccess = () => {
        resolve(open.result)
      }
      open.onerror = () => {
        reject(open.error ?? new Error('open failed'))
      }
    })
    const all = (store: string) =>
      new Promise<Record<string, unknown>[]>((resolve, reject) => {
        const read = db.transaction(store).objectStore(store).getAll()
        read.onsuccess = () => {
          resolve(read.result as Record<string, unknown>[])
        }
        read.onerror = () => {
          reject(read.error ?? new Error('read failed'))
        }
      })
    const profiles = (await all('profiles')).map((p) => ({
      id: p.id as number,
      name: p.name as string,
    }))
    const left: string[] = []
    for (const store of Array.from(db.objectStoreNames)) {
      for (const row of await all(store)) {
        if (goneIds.includes(row.profile_id as number)) left.push(store)
        if (
          store === 'settings' &&
          goneIds.some((id) => String(row.key).endsWith(`_${String(id)}`))
        ) {
          left.push(`settings ${String(row.key)}`)
        }
      }
    }
    db.close()
    return { profiles, left }
  }, gone)
}

test.describe('keeping the data in this browser, over the demo @smoke', () => {
  test('setup opens on a space of your own over the examples, and the dashboard is that space alone', async ({
    page,
  }) => {
    test.setTimeout(180_000)
    const ctx = page.context()
    const { email } = await signUpAndIn(ctx)
    try {
      // The demo first, in this browser: its three example profiles in the local database.
      await page.goto(`${E2E_BASE}/?demo=low#dashboard`, {
        waitUntil: 'domcontentloaded',
        timeout: 30_000,
      })
      await expect(page.getByTestId('dashboard-header')).toBeVisible({ timeout: 60_000 })
      await expect
        .poll(async () => (await localWorkspace(page)).profiles.map((p) => p.name), {
          timeout: 30_000,
        })
        .toEqual(EXAMPLES)
      const examples = (await localWorkspace(page)).profiles.map((p) => p.id)

      // Then the account, signed in on this browser: it meets setup.
      await page.evaluate(() => {
        localStorage.setItem('finance_storage_mode', 'self-hosted')
        localStorage.removeItem('currentProfileId')
        localStorage.removeItem('selectedProfileIds')
      })
      // A reload: the demo link left the address at /#dashboard, where a goto only moves the hash.
      await page.reload({ waitUntil: 'domcontentloaded' })
      await expect(page.getByTestId('onboarding-step-space')).toBeVisible({ timeout: 30_000 })
      await expect(page.getByTestId('onboarding-examples-choice')).toHaveCount(0)

      await page.getByTestId('onboarding-local-only').click()
      await expect(page.getByRole('alertdialog')).toContainText(
        'This browser has the example profiles from the demo.'
      )
      await page.getByTestId('confirm-accept').click()

      // The reload lands on the local workspace, and setup opens on its space over the examples.
      await expect(page.getByTestId('onboarding-examples-choice')).toBeVisible({ timeout: 60_000 })
      expect(await page.evaluate(() => localStorage.getItem('finance_storage_mode'))).toBe(
        'serverless'
      )
      await expect(page.getByTestId('onboarding-examples-remove').locator('input')).toBeChecked()
      await expect(page.getByTestId('onboarding-profile-name')).toHaveValue('Personal Profile')

      // On a phone: nothing runs off the side, and the choice is whole.
      await page.setViewportSize({ width: 375, height: 812 })
      await page.getByTestId('onboarding-examples-choice').scrollIntoViewIfNeeded()
      const fit = await page.evaluate(() => {
        const body = document.querySelector('[data-test-id="onboarding-body"]')!
        const choice = document.querySelector('[data-test-id="onboarding-examples-choice"]')!
        const parts = Array.from(choice.querySelectorAll('legend, label, p'))
        return {
          page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          body: body.scrollWidth - body.clientWidth,
          outside: parts
            .map((el) => ({ text: el.textContent ?? '', box: el.getBoundingClientRect() }))
            .filter(({ box }) => box.left < 0 || box.right > window.innerWidth)
            .map(({ text }) => text),
          clipped: parts
            .filter((el) => el.scrollWidth > el.clientWidth + 1)
            .map((el) => el.textContent ?? ''),
        }
      })
      expect(fit).toEqual({ page: 0, body: 0, outside: [], clipped: [] })

      await page.getByTestId('onboarding-profile-name').fill('Our flat')
      await page.getByTestId('onboarding-next').click()
      await expect(
        page.getByTestId('onboarding-step-about').or(page.getByTestId('onboarding-step-account'))
      ).toBeVisible({ timeout: 60_000 })

      // The examples are gone, every row of them, and the new space is all there is.
      const after = await localWorkspace(page, examples)
      expect(after.profiles.map((p) => p.name)).toEqual(['Our flat'])
      expect(after.left).toEqual([])

      await page.getByTestId('onboarding-skip').click()
      await page.getByTestId('confirm-accept').click()
      await expect(page.getByTestId('onboarding-wizard')).toHaveCount(0)
      await expect(page.getByTestId('dashboard-header')).toBeVisible({ timeout: 30_000 })
      // The initial's badge, then the name.
      await expect(page.getByTestId('profile-dropdown-btn')).toHaveText('OOur flat')

      // Setup asked once: a reload opens the dashboard, not setup.
      await page.reload({ waitUntil: 'domcontentloaded' })
      await expect(page.getByTestId('dashboard-header')).toBeVisible({ timeout: 30_000 })
      // The initial's badge, then the name.
      await expect(page.getByTestId('profile-dropdown-btn')).toHaveText('OOur flat')
      await page.waitForTimeout(1200)
      await expect(page.getByTestId('onboarding-wizard')).toHaveCount(0)
    } finally {
      await deleteAccount(ctx, email)
    }
  })

  test('beside the examples, a profile of your own is what the app opens on', async ({ page }) => {
    test.setTimeout(180_000)
    const ctx = page.context()
    const { email } = await signUpAndIn(ctx)
    try {
      await page.goto(`${E2E_BASE}/?demo=low#dashboard`, {
        waitUntil: 'domcontentloaded',
        timeout: 30_000,
      })
      await expect(page.getByTestId('dashboard-header')).toBeVisible({ timeout: 60_000 })
      await expect
        .poll(async () => (await localWorkspace(page)).profiles.map((p) => p.name), {
          timeout: 30_000,
        })
        .toEqual(EXAMPLES)

      // A profile of the person's own beside the examples, with an account in it, made on an
      // earlier visit: a higher id than every example.
      const own = await page.evaluate(async () => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const open = indexedDB.open('finance-manager')
          open.onsuccess = () => {
            resolve(open.result)
          }
          open.onerror = () => {
            reject(open.error ?? new Error('open failed'))
          }
        })
        const added = (store: string, row: Record<string, unknown>) =>
          new Promise<number>((resolve, reject) => {
            const put = db.transaction(store, 'readwrite').objectStore(store).add(row)
            put.onsuccess = () => {
              resolve(put.result as number)
            }
            put.onerror = () => {
              reject(put.error ?? new Error('add failed'))
            }
          })
        const id = await added('profiles', {
          name: 'Household',
          created_at: '2026-02-01T00:00:00.000Z',
        })
        await added('accounts', {
          profile_id: id,
          name: 'Main',
          type: 'checking',
          currency: 'EUR',
          balance: 5,
          created_at: '2026-02-01T00:00:00.000Z',
        })
        db.close()
        return id
      })
      const examples = (await localWorkspace(page)).profiles
        .filter((p) => EXAMPLES.includes(p.name))
        .map((p) => p.id)
      expect(Math.max(...examples)).toBeLessThan(own)

      await page.evaluate(() => {
        localStorage.setItem('finance_storage_mode', 'self-hosted')
        localStorage.removeItem('currentProfileId')
        localStorage.removeItem('selectedProfileIds')
      })
      await page.reload({ waitUntil: 'domcontentloaded' })
      await expect(page.getByTestId('onboarding-step-space')).toBeVisible({ timeout: 30_000 })

      await page.getByTestId('onboarding-local-only').click()
      await expect(page.getByRole('alertdialog')).toContainText(
        'with your profile "Household". You carry on with it'
      )
      await page.getByTestId('confirm-accept').click()

      // The reload lands on Household, as the confirm said, and setup stays closed.
      await expect(page.getByTestId('dashboard-header')).toBeVisible({ timeout: 60_000 })
      // The initial's badge, then the name.
      await expect(page.getByTestId('profile-dropdown-btn')).toHaveText('HHousehold')
      expect(await page.evaluate(() => localStorage.getItem('currentProfileId'))).toBe(String(own))
      await page.waitForTimeout(1200)
      await expect(page.getByTestId('onboarding-wizard')).toHaveCount(0)
    } finally {
      await deleteAccount(ctx, email)
    }
  })
})

// The space step signed in has one line local-first never shows: the way to keep the data in this
// browser instead. Read over what the screen paints behind it, wide and on a phone.
test.describe("the signed-in space step's text over what is painted behind it", () => {
  for (const theme of ['light', 'dark']) {
    test(`every line reads at AA, ${theme}`, async ({ page }) => {
      test.setTimeout(120_000)
      const ctx = page.context()
      const { email } = await signUpAndIn(ctx)
      try {
        await bootSignedIn(ctx)
        await ctx.addInitScript((value) => {
          localStorage.setItem('finance-theme', value)
        }, theme)
        await page.goto(`${E2E_BASE}/#dashboard`, {
          waitUntil: 'domcontentloaded',
          timeout: 30_000,
        })
        await expect(page.getByTestId('onboarding-step-space')).toBeVisible({ timeout: 30_000 })
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
        await expect(page.getByTestId('onboarding-local-only')).toBeVisible()
        const wrong: string[] = []
        for (const size of [
          { width: 1280, height: 720 },
          { width: 390, height: 844 },
          { width: 320, height: 568 },
        ]) {
          await page.setViewportSize(size)
          const lines = await paintedContrast(page)
          expect(lines.map((l) => l.what)).toContain('Keep my data in this browser only')
          for (const { what, ratio, need, field } of lines) {
            const where = `${String(size.width)}x${String(size.height)}: "${what}"`
            if (ratio < need)
              wrong.push(`${where} reads at ${String(ratio)}:1, under ${String(need)}:1`)
            if (size.width <= 620 && field > 2) {
              wrong.push(`${where} has the orbit field behind it (${String(field)})`)
            }
          }
        }
        expect(wrong).toEqual([])
      } finally {
        await deleteAccount(ctx, email)
      }
    })
  }
})
