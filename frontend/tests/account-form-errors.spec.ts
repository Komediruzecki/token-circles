/**
 * The Accounts dialog, in both storage modes: a refused account is said in the dialog, under the
 * field it is about, and a good one is added and renamed as before.
 *
 * It answered every refused save with "Failed to create account" or "Failed to update account",
 * with nothing in the dialog marked, and a base currency other than the one this browser asks for
 * lost the sentence that says where to change it. Now the dialog checks the account with the rules
 * both runtimes run (shared/accountSchema.ts), marks the field in its own words, and puts the
 * 409's sentence in the dialog's notice.
 *
 * Every case runs signed in (the Worker) and local-first (the IndexedDB router). Pull requests run
 * the `@smoke` ones; main runs them all.
 */
import { expect, test } from '@playwright/test'
import { gotoServerless, isNetworkNoise, login, navigateToRoute } from './test-helpers'
import type { Locator, Page } from '@playwright/test'

interface Mode {
  name: 'cloud' | 'local-first'
  goto: (page: Page) => Promise<void>
}

/** The setup wizard can open over local-first's demo: leave it each time it shows up. */
async function leaveOnboarding(page: Page): Promise<void> {
  await page.addLocatorHandler(page.getByTestId('onboarding-wizard'), async () => {
    await page.getByTestId('onboarding-skip').click()
    const confirm = page.getByRole('button', { name: 'Confirm' })
    if (await confirm.isVisible({ timeout: 2_000 }).catch(() => false)) await confirm.click()
  })
}

const MODES: Mode[] = [
  {
    name: 'cloud',
    goto: async (page) => {
      await leaveOnboarding(page)
      await login(page)
      await navigateToRoute(page, 'accounts')
      await expect(page.getByTestId('accounts-header')).toBeVisible({ timeout: 20_000 })
    },
  },
  {
    name: 'local-first',
    goto: async (page) => {
      await leaveOnboarding(page)
      await gotoServerless(page, 'accounts', 'accounts-header')
    },
  },
]

const dialog = (page: Page): Locator =>
  page.locator('[data-test-id="add-account-modal"], [data-test-id="edit-account-modal"]')
/**
 * A field of the dialog, found by the text of its label. Not `getByLabel`: the old dialog's labels
 * were not tied to their inputs, and a test that cannot find the field on the old code proves
 * nothing about what the old code did with it. The tie is asserted on its own.
 */
const fieldUnder = (page: Page, label: RegExp): Locator =>
  dialog(page)
    .locator('label', { hasText: label })
    .locator('xpath=following-sibling::*[self::input or self::select][1]')
const nameField = (page: Page): Locator => fieldUnder(page, /^\s*Account Name\s*$/)
const startingField = (page: Page): Locator => fieldUnder(page, /^\s*Starting Balance/)
const currentField = (page: Page): Locator => fieldUnder(page, /^\s*Current Balance/)
const submit = (page: Page) => dialog(page).locator('button[type="submit"]').click()
const notice = (page: Page): Locator => dialog(page).getByTestId('account-form-notice')
const toasts = (page: Page): Locator => page.getByRole('region', { name: 'Notifications' })
const errorToasts = (page: Page): Locator => toasts(page).getByRole('alert')

/** The card of the account called `name`. */
function card(page: Page, name: string): Locator {
  return page.getByTestId('account-card').filter({
    has: page.getByTestId('account-name').getByText(name, { exact: true }),
  })
}

async function openAdd(page: Page): Promise<void> {
  await page.getByTestId('add-account-btn').click()
  await expect(nameField(page)).toBeVisible()
}

async function openEdit(page: Page, name: string): Promise<void> {
  await card(page, name).getByTestId('account-edit-btn').click()
  await expect(nameField(page)).toHaveValue(name)
}

/** Every account POST or PUT the page sends over the network (local-first sends none). */
function watchAccountWrites(page: Page): string[] {
  const writes: string[] = []
  page.on('request', (request) => {
    if (['POST', 'PUT'].includes(request.method()) && /\/api\/accounts\b/.test(request.url())) {
      writes.push(`${request.method()} ${request.url()}`)
    }
  })
  return writes
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

type Method = 'GET' | 'PUT' | 'DELETE'

/** A request through the app's own API client, in whichever storage mode the page runs. */
async function viaApp<T = unknown>(
  page: Page,
  method: Method,
  url: string,
  body?: unknown
): Promise<T> {
  const answer = await page.evaluate(
    async (req) => {
      const spec = '/src/core/api.ts'
      const mod = (await import(/* @vite-ignore */ spec)) as {
        apiGet: (url: string) => Promise<unknown>
        apiPut: (url: string, body: unknown) => Promise<unknown>
        apiDelete: (url: string) => Promise<unknown>
      }
      if (req.method === 'GET') return mod.apiGet(req.url)
      if (req.method === 'PUT') return mod.apiPut(req.url, req.body)
      return mod.apiDelete(req.url)
    },
    { method, url, body }
  )
  return answer as T
}

/**
 * The profile's base currency, written down (local-first's demo has none until the first account
 * is saved, and then takes whatever that account asks for), and another one for this browser to
 * ask for.
 */
async function anotherCurrency(page: Page): Promise<{ configured: string; asked: string }> {
  const settings = await viaApp<{ currency?: string }>(page, 'GET', '/api/settings')
  const configured = settings.currency || 'EUR'
  await viaApp(page, 'PUT', '/api/settings', { currency: configured })
  return { configured, asked: configured === 'USD' ? 'EUR' : 'USD' }
}

/**
 * Takes out of the Worker's database the accounts a case made, whether or not the case got that
 * far: the fixture account is shared by every spec and outlives a local run. Local-first keeps
 * everything in the test's own browser, which goes with it.
 */
async function sweep(page: Page, mode: Mode, stamp: string): Promise<void> {
  if (mode.name !== 'cloud' || !stamp) return
  const accounts = await viaApp<{ id: number; name: string }[]>(page, 'GET', '/api/accounts')
  for (const account of accounts.filter((a) => a.name.includes(stamp))) {
    await viaApp(page, 'DELETE', `/api/accounts/${account.id}`)
  }
}

const conflict = (currency: string) =>
  `Account balances use ${currency}. Change the base currency in Settings before adding financial data.`

for (const mode of MODES) {
  test.describe(`the account dialog, ${mode.name} @smoke`, () => {
    test.beforeEach(async ({ page }) => {
      test.setTimeout(120_000)
      await mode.goto(page)
      await expect(page.getByTestId('account-card').first()).toBeVisible({ timeout: 20_000 })
    })

    test('a blank name is marked under the field, focused, and nothing is sent', async ({
      page,
    }) => {
      const writes = watchAccountWrites(page)
      await openAdd(page)

      await submit(page)

      await expect(nameField(page)).toHaveAttribute('aria-invalid', 'true')
      await expect(nameField(page)).toHaveAccessibleDescription('Give the account a name.')
      await expect(nameField(page)).toBeFocused()
      expect(writes).toEqual([])
      // And each label names its field.
      await expect(dialog(page).getByLabel('Account Name', { exact: true })).toBeFocused()
      await expect(dialog(page).getByLabel(/^Current Balance/)).toHaveCount(1)
      await expect(errorToasts(page)).toHaveCount(0)
    })

    test('a different base currency is said in the dialog, adding and editing', async ({
      page,
    }) => {
      const { configured, asked } = await anotherCurrency(page)
      // This browser asks for another currency than the profile's: the runtimes answer 409.
      await page.evaluate((code) => localStorage.setItem('localCurrency', code), asked)
      const existing = (await page.getByTestId('account-name').first().textContent())?.trim() ?? ''

      await openAdd(page)
      await nameField(page).fill('zz-other-currency')
      await submit(page)

      await expect(notice(page)).toHaveText(conflict(configured))
      await expect(dialog(page)).toBeVisible()
      await expect(card(page, 'zz-other-currency')).toHaveCount(0)
      await expect(errorToasts(page)).toHaveCount(0)

      await dialog(page).getByRole('button', { name: 'Cancel' }).click()
      await openEdit(page, existing)
      await nameField(page).fill(`${existing} renamed`)
      await submit(page)

      await expect(notice(page)).toHaveText(conflict(configured))
      await expect(dialog(page)).toBeVisible()
      await expect(card(page, existing)).toHaveCount(1)
      await expect(errorToasts(page)).toHaveCount(0)
    })
  })

  test.describe(`the account dialog's balances and saves, ${mode.name}`, () => {
    /** In the name of every account a case makes, so `sweep` can find it. */
    let stamp = ''

    test.beforeEach(async ({ page }) => {
      test.setTimeout(120_000)
      stamp = Date.now().toString(36)
      await mode.goto(page)
      await expect(page.getByTestId('account-card').first()).toBeVisible({ timeout: 20_000 })
    })

    test.afterEach(async ({ page }) => {
      await sweep(page, mode, stamp)
    })

    test('a balance it cannot read is marked under that balance', async ({ page }) => {
      const writes = watchAccountWrites(page)
      await openAdd(page)
      await nameField(page).fill('zz-unreadable')
      await startingField(page).fill('12,3,4')
      await currentField(page).fill('lots')

      await submit(page)

      await expect(startingField(page)).toHaveAccessibleDescription(
        'Enter the starting balance as a number, like 1250.50.'
      )
      await expect(currentField(page)).toHaveAccessibleDescription(
        'Enter the balance as a number, like 1250.50.'
      )
      await expect(startingField(page)).toBeFocused()
      expect(writes).toEqual([])
      await expect(errorToasts(page)).toHaveCount(0)
    })

    test('an account is added at its starting balance, renamed, and named in each toast', async ({
      page,
    }) => {
      const errors = watchErrors(page)
      const name = `zz-account-${stamp}`
      await openAdd(page)
      await nameField(page).fill(name)
      await startingField(page).fill('1250,50')

      await submit(page)

      await expect(dialog(page)).toHaveCount(0)
      await expect(toasts(page).getByText(`Added "${name}" to your accounts.`)).toBeVisible()
      await expect(card(page, name)).toHaveCount(1)
      await expect(card(page, name).getByTestId('account-balance')).toContainText('1,250.5')

      await openEdit(page, name)
      await nameField(page).fill(`${name}-renamed`)
      await submit(page)

      await expect(dialog(page)).toHaveCount(0)
      await expect(toasts(page).getByText(`Saved your changes to "${name}-renamed".`)).toBeVisible()
      await expect(card(page, `${name}-renamed`)).toHaveCount(1)
      await expect(errorToasts(page)).toHaveCount(0)
      expect(errors).toEqual([])
    })
  })
}
