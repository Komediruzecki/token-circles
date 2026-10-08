/**
 * The Bills dialog, in both storage modes: a refused bill is said under the field it is about,
 * and a good one is added with its category, edited, paid and deleted, each with a toast.
 *
 * The dialog answered every refused save with "Failed to save bill" in a toast and nothing
 * marked, and it dropped the category it was given, so a bill saved with one had none. Now it
 * checks with the rules both runtimes run (shared/billSchema.ts), marks the field in its own words
 * and focuses it, and a category deleted in another tab is marked at the category.
 *
 * Every case runs signed in (the Worker) and local-first (the IndexedDB router). Pull requests run
 * the `@smoke` ones; main runs them all.
 */
import { expect, test } from '@playwright/test'
import { E2E_BASE, gotoServerless, isNetworkNoise, login, navigateToRoute } from './test-helpers'
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
      await navigateToRoute(page, 'bills')
      await expect(page.getByTestId('bills-header')).toBeVisible({ timeout: 20_000 })
    },
  },
  {
    name: 'local-first',
    goto: async (page) => {
      await leaveOnboarding(page)
      await gotoServerless(page, 'bills', 'bills-header')
    },
  },
]

const dialog = (page: Page): Locator => page.getByTestId('bill-modal')
const nameField = (page: Page): Locator => page.getByTestId('bill-form-name')
const amountField = (page: Page): Locator => page.getByTestId('bill-form-amount')
const dateField = (page: Page): Locator => page.getByTestId('bill-form-date')
const categoryField = (page: Page): Locator => page.getByTestId('bill-form-category')
const submit = (page: Page) => page.getByTestId('bill-form-submit').click()
const toasts = (page: Page): Locator => page.getByRole('region', { name: 'Notifications' })
const errorToasts = (page: Page): Locator => toasts(page).getByRole('alert')

/** The card of the bill called `name`, wherever it is listed. */
function card(page: Page, name: string): Locator {
  return page
    .getByTestId('bill-name')
    .filter({ hasText: name })
    .locator('xpath=ancestor::*[.//*[@data-test-id="bill-amount"]][1]')
}

/** Every bill write the page sends over the network (local-first sends none). */
function watchBillWrites(page: Page): string[] {
  const writes: string[] = []
  page.on('request', (request) => {
    if (['POST', 'PUT'].includes(request.method()) && /\/api\/bills\b/.test(request.url())) {
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

type Method = 'GET' | 'POST' | 'DELETE'

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
        apiPost: (url: string, body: unknown) => Promise<unknown>
        apiDelete: (url: string) => Promise<unknown>
      }
      if (req.method === 'GET') return mod.apiGet(req.url)
      if (req.method === 'POST') return mod.apiPost(req.url, req.body)
      return mod.apiDelete(req.url)
    },
    { method, url, body }
  )
  return answer as T
}

/** An amount as the app writes it, in the profile's currency. */
async function money(page: Page, amount: number): Promise<string> {
  return page.evaluate(async (value) => {
    const spec = '/src/core/api.ts'
    const mod = (await import(/* @vite-ignore */ spec)) as {
      formatCurrency: (amount: number) => string
    }
    return mod.formatCurrency(value)
  }, amount)
}

/** YYYY-MM-DD, `days` from today on this calendar. */
function daysFromToday(days: number): string {
  const day = new Date()
  day.setDate(day.getDate() + days)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`
}

/**
 * Deletes a row behind the page's back, as another tab would: the page's own client is not used,
 * so the page is not told.
 */
async function deleteElsewhere(page: Page, mode: Mode, url: string): Promise<void> {
  if (mode.name === 'cloud') {
    const profileId = await page.evaluate(() => localStorage.getItem('currentProfileId'))
    const res = await page.request.delete(`${E2E_BASE}${url}`, {
      headers: { 'X-Profile-Id': String(profileId) },
    })
    expect(res.ok(), `DELETE ${url}: ${res.status()}`).toBeTruthy()
    return
  }
  await page.evaluate(async (path) => {
    const spec = '/src/core/storage/localApiRouter.ts'
    const mod = (await import(/* @vite-ignore */ spec)) as {
      routeApiRequest: (url: string, init?: RequestInit) => Promise<Response>
    }
    const res = await mod.routeApiRequest(path, { method: 'DELETE' })
    if (!res.ok) throw new Error(`DELETE ${path}: ${res.status}`)
  }, url)
}

/**
 * Takes out of the Worker's database what a case made, whether or not the case got that far: the
 * payment's transaction, the bills, then their categories. The fixture profile is shared by every
 * spec and outlives a local run. Local-first keeps everything in the test's own browser, which
 * goes with it.
 */
async function sweep(page: Page, mode: Mode, stamp: string): Promise<void> {
  if (mode.name !== 'cloud' || !stamp) return
  const listed = await viaApp<{ rows?: { id: number; description: string }[] }>(
    page,
    'GET',
    `/api/transactions?search=${stamp}`
  )
  for (const t of (listed.rows ?? []).filter((row) => row.description.includes(stamp))) {
    await viaApp(page, 'DELETE', `/api/transactions/${t.id}`)
  }
  const bills = await viaApp<{ id: number; name: string }[]>(page, 'GET', '/api/bills')
  for (const bill of bills.filter((b) => b.name.includes(stamp))) {
    await viaApp(page, 'DELETE', `/api/bills/${bill.id}`)
  }
  const categories = await viaApp<{ id: number; name: string }[]>(page, 'GET', '/api/categories')
  for (const category of categories.filter((c) => c.name.includes(stamp))) {
    await viaApp(page, 'DELETE', `/api/categories/${category.id}`)
  }
}

/** Adds an expense category for the case, and waits for the dialog to offer it. */
async function addCategory(page: Page, name: string): Promise<number> {
  const created = await viaApp<{ id: number }>(page, 'POST', '/api/categories', {
    name,
    type: 'expense',
    color: '#0ea5e9',
    icon: 'tag',
  })
  await expect(categoryField(page).locator('option', { hasText: name })).toHaveCount(1, {
    timeout: 15_000,
  })
  return created.id
}

for (const mode of MODES) {
  // Pull requests run the cases tagged `@smoke`, and the ones tagged `cloudSmoke` signed in only:
  // main runs every case in both modes.
  const cloudSmoke = mode.name === 'cloud' ? ' @smoke' : ''
  test.describe(`the bill dialog, ${mode.name}`, () => {
    /** In the name of everything a case makes, so `sweep` can find it. */
    let stamp = ''

    test.beforeEach(async ({ page }) => {
      test.setTimeout(120_000)
      // Unique to this case: two cases that start in the same millisecond on two workers must not
      // sweep each other's rows.
      stamp = `${Date.now().toString(36)}${test.info().parallelIndex}`
      await mode.goto(page)
    })

    test.afterEach(async ({ page }) => {
      await sweep(page, mode, stamp)
    })

    test(`a bill without a name, an amount or a due date is marked at each, and nothing is sent${cloudSmoke}`, async ({
      page,
    }) => {
      const writes = watchBillWrites(page)
      await page.getByTestId('add-bill-btn').click()
      await expect(dialog(page)).toBeVisible()

      await submit(page)

      await expect(nameField(page)).toHaveAttribute('aria-invalid', 'true')
      await expect(nameField(page)).toHaveAccessibleDescription('Give the bill a name.')
      await expect(amountField(page)).toHaveAccessibleDescription('Enter the amount.')
      await expect(dateField(page)).toHaveAccessibleDescription('Choose the date it is due.')
      await expect(nameField(page)).toBeFocused()

      await nameField(page).fill('Water')
      await amountField(page).fill('0')
      await dateField(page).fill(daysFromToday(5))
      await submit(page)

      await expect(nameField(page)).not.toHaveAttribute('aria-invalid', 'true')
      await expect(dateField(page)).not.toHaveAttribute('aria-invalid', 'true')
      await expect(amountField(page)).toHaveAccessibleDescription('Enter an amount more than zero.')
      await expect(amountField(page)).toBeFocused()
      expect(writes).toEqual([])
      await expect(errorToasts(page)).toHaveCount(0)
      // And each label names its field.
      await expect(dialog(page).getByLabel('Bill Name', { exact: true })).toHaveValue('Water')
      await expect(dialog(page).getByLabel('Amount', { exact: true })).toBeFocused()
    })

    test(`a category deleted in another tab is marked at the category @smoke`, async ({ page }) => {
      const category = `zz-bill-gone-${stamp}`
      await page.getByTestId('add-bill-btn').click()
      const id = await addCategory(page, category)
      await nameField(page).fill(`zz-bill-${stamp}`)
      await amountField(page).fill('12')
      await dateField(page).fill(daysFromToday(5))
      await categoryField(page).selectOption({ label: category })

      await deleteElsewhere(page, mode, `/api/categories/${id}`)
      await submit(page)

      await expect(categoryField(page)).toHaveAttribute('aria-invalid', 'true')
      await expect(categoryField(page)).toHaveAccessibleDescription(
        'Choose a category from the list, or leave it blank.'
      )
      await expect(categoryField(page)).toBeFocused()
      await expect(dialog(page)).toBeVisible()
      await expect(errorToasts(page)).toHaveCount(0)
    })

    test(`a bill is added with its category, renamed, paid and deleted, and each step says so @smoke`, async ({
      page,
    }) => {
      const errors = watchErrors(page)
      const name = `zz-bill-${stamp}`
      const category = `zz-bill-cat-${stamp}`

      await page.getByTestId('add-bill-btn').click()
      await addCategory(page, category)
      await nameField(page).fill(name)
      await amountField(page).fill('42,10')
      await dateField(page).fill(daysFromToday(5))
      await categoryField(page).selectOption({ label: category })
      await submit(page)

      await expect(dialog(page)).toHaveCount(0)
      await expect(toasts(page).getByText(`Added "${name}" to your bills.`)).toBeVisible()
      await expect(card(page, name).getByTestId('bill-amount')).toHaveText(await money(page, 42.1))
      await expect(card(page, name).getByTestId('bill-details')).toContainText('Due in 5 days')

      // Renamed: the dialog opens on the bill, with the category it was saved with.
      await card(page, name).getByTestId('bill-edit-btn').click()
      await expect(page.getByTestId('bill-modal-title')).toHaveText('Edit Bill')
      await expect(nameField(page)).toHaveValue(name)
      await expect(categoryField(page).locator('option:checked')).toHaveText(category)
      await nameField(page).fill(`${name}-renamed`)
      await submit(page)

      await expect(dialog(page)).toHaveCount(0)
      await expect(toasts(page).getByText(`Saved your changes to "${name}-renamed".`)).toBeVisible()

      // Paid: it moves to the paid bills, which name its category.
      await card(page, `${name}-renamed`).getByTestId('bill-mark-paid-btn').click()

      await expect(toasts(page).getByText('Bill marked as paid')).toBeVisible()
      const paid = page
        .getByTestId('bills-paid-section')
        .getByTestId('bill-name')
        .filter({ hasText: `${name}-renamed` })
      await expect(paid).toHaveCount(1)
      await expect(card(page, `${name}-renamed`).getByTestId('bill-details')).toContainText(
        `Monthly • ${category}`
      )

      // Deleted, once it is confirmed.
      await card(page, `${name}-renamed`).getByTestId('bill-delete-btn').click()
      await page.getByTestId('confirm-accept').click()

      await expect(toasts(page).getByText('Bill deleted successfully')).toBeVisible()
      await expect(page.getByTestId('bill-name').filter({ hasText: name })).toHaveCount(0)
      await expect(errorToasts(page)).toHaveCount(0)
      expect(errors).toEqual([])
    })
  })
}
