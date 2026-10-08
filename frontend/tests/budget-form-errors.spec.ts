/**
 * The budget dialogs on the Budgets page, in both storage modes: Allocate and Set Budget check the
 * amount with the rules both runtimes run (shared/budgetSchema.ts), mark a refused field in its
 * own words, and say what they set.
 *
 * They answered a refusal with "Failed to allocate budget" or "Failed to set budget" and left an
 * error at the top of the page, and Set Budget added another budget on every save, so a category
 * set twice had two budgets that month, both counted. Now a refused amount is marked under the
 * field and focused, a category deleted in another tab is marked at Allocate's category, and both
 * dialogs change the month's one budget.
 *
 * The page has no control that deletes a budget: the case that removes one does it through the
 * app's own API client and checks that the page follows.
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
      await navigateToRoute(page, 'budgets')
      await expect(page.getByTestId('budgets-header')).toBeVisible({ timeout: 20_000 })
    },
  },
  {
    name: 'local-first',
    goto: async (page) => {
      await leaveOnboarding(page)
      await gotoServerless(page, 'budgets', 'budgets-header')
    },
  },
]

const allocateDialog = (page: Page): Locator => page.getByTestId('budgets-allocate-modal')
const allocateCategory = (page: Page): Locator =>
  allocateDialog(page).getByLabel('Category', { exact: true })
const allocateAmount = (page: Page): Locator =>
  allocateDialog(page).getByLabel('Amount', { exact: true })
const setBudgetDialog = (page: Page): Locator =>
  page.locator('form', { has: page.getByTestId('budgets-set-budget-notice') })
const setBudgetAmount = (page: Page): Locator =>
  setBudgetDialog(page).getByLabel('Monthly Budget Amount', { exact: true })
const submit = (dialog: Locator) => dialog.locator('button[type="submit"]').click()
const toasts = (page: Page): Locator => page.getByRole('region', { name: 'Notifications' })
const errorToasts = (page: Page): Locator => toasts(page).getByRole('alert')

/** The allocation table's row for a category. */
const row = (page: Page, name: string): Locator =>
  page.getByTestId('budgets-allocation-row').filter({
    has: page.getByTestId('budgets-allocation-category').getByText(name, { exact: true }),
  })

/** Every budget write the page sends over the network (local-first sends none). */
function watchBudgetWrites(page: Page): string[] {
  const writes: string[] = []
  page.on('request', (request) => {
    if (['POST', 'PUT'].includes(request.method()) && /\/api\/budgets\b/.test(request.url())) {
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

/** A description that opens with `words`, whatever hint follows them. */
const startsWith = (words: string) => new RegExp(`^${words.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)

/** "October 2026": the month the page opens on, as the toast names it. */
const thisMonth = () => new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

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
 * Takes out of the Worker's database the categories a case made, and their budgets with them,
 * whether or not the case got that far: the fixture profile is shared by every spec and outlives a
 * local run. Local-first keeps everything in the test's own browser, which goes with it.
 */
async function sweep(page: Page, mode: Mode, stamp: string): Promise<void> {
  if (mode.name !== 'cloud' || !stamp) return
  const categories = await viaApp<{ id: number; name: string }[]>(page, 'GET', '/api/categories')
  const made = categories.filter((c) => c.name.includes(stamp))
  const budgets = await viaApp<{ id: number; category_id: number }[]>(page, 'GET', '/api/budgets')
  for (const budget of budgets.filter((b) => made.some((c) => c.id === b.category_id))) {
    await viaApp(page, 'DELETE', `/api/budgets/${budget.id}`)
  }
  for (const category of made) await viaApp(page, 'DELETE', `/api/categories/${category.id}`)
}

/** Adds an expense category for the case, and waits for the page to list it. */
async function addCategory(page: Page, name: string): Promise<number> {
  const created = await viaApp<{ id: number }>(page, 'POST', '/api/categories', {
    name,
    type: 'expense',
    color: '#0ea5e9',
    icon: 'tag',
  })
  await expect(row(page, name)).toHaveCount(1, { timeout: 15_000 })
  return created.id
}

async function openAllocateFor(page: Page, name: string): Promise<void> {
  await page.getByTestId('budgets-add-allocation-btn').click()
  await expect(allocateDialog(page)).toBeVisible()
  await allocateCategory(page).selectOption({ label: name })
}

for (const mode of MODES) {
  test.describe(`the budget dialogs, ${mode.name} @smoke`, () => {
    /** In the name of every category a case makes, so `sweep` can find it. */
    let stamp = ''

    test.beforeEach(async ({ page }) => {
      test.setTimeout(120_000)
      // Unique to this case: two cases that start in the same millisecond on two workers must not
      // sweep each other's rows.
      stamp = `${Date.now().toString(36)}${test.info().parallelIndex}`
      await mode.goto(page)
      await expect(page.getByTestId('budgets-allocation-row').first()).toBeVisible({
        timeout: 20_000,
      })
    })

    test.afterEach(async ({ page }) => {
      await sweep(page, mode, stamp)
    })

    test('Allocate marks an amount it cannot use under the field, focused, and sends nothing', async ({
      page,
    }) => {
      const writes = watchBudgetWrites(page)
      await page.getByTestId('budgets-add-allocation-btn').click()
      await expect(allocateDialog(page)).toBeVisible()

      for (const [typed, said] of [
        ['', 'Enter the budget amount.'],
        ['lots', 'Enter the amount as a number, like 250.00.'],
        ['-5', 'Enter an amount of zero or more.'],
        ['12.345', 'Use at most two decimal places, like 250.50.'],
      ] as const) {
        await allocateAmount(page).fill(typed)
        await submit(allocateDialog(page))

        await expect(allocateAmount(page)).toHaveAttribute('aria-invalid', 'true')
        // The message, then the field's hint (what is left to allocate).
        await expect(allocateAmount(page)).toHaveAccessibleDescription(startsWith(said))
        await expect(allocateAmount(page)).toBeFocused()
      }
      expect(writes).toEqual([])
      await expect(errorToasts(page)).toHaveCount(0)

      // The message goes as soon as the field is fixed, without another submit.
      await allocateAmount(page).fill('12.34')
      await expect(allocateAmount(page)).not.toHaveAttribute('aria-invalid', 'true')
    })

    test("a category deleted in another tab is marked at Allocate's category", async ({ page }) => {
      const name = `zz-budget-gone-${stamp}`
      const id = await addCategory(page, name)
      await openAllocateFor(page, name)
      await allocateAmount(page).fill('80')

      await deleteElsewhere(page, mode, `/api/categories/${id}`)
      await submit(allocateDialog(page))

      await expect(allocateCategory(page)).toHaveAttribute('aria-invalid', 'true')
      await expect(allocateCategory(page)).toHaveAccessibleDescription(
        'Choose the category this budget is for.'
      )
      await expect(allocateDialog(page)).toBeVisible()
      await expect(errorToasts(page)).toHaveCount(0)
    })

    test('a budget is allocated, changed with Set Budget, and removed, and the page says each', async ({
      page,
    }) => {
      const errors = watchErrors(page)
      const name = `zz-budget-${stamp}`
      const categoryId = await addCategory(page, name)

      // Allocate, with a comma for the cents.
      await openAllocateFor(page, name)
      await allocateAmount(page).fill('250,5')
      await submit(allocateDialog(page))

      await expect(allocateDialog(page)).toHaveCount(0)
      await expect(
        toasts(page).getByText(
          `Set the ${name} budget for ${thisMonth()} to ${await money(page, 250.5)}.`
        )
      ).toBeVisible()
      await expect(row(page, name).getByTestId('budgets-allocation-amount')).toHaveText(
        await money(page, 250.5)
      )

      // Change, from the row: the dialog opens on the budget the month has.
      await row(page, name).getByRole('button', { name: 'Change' }).click()
      await expect(allocateAmount(page)).toHaveValue('250.5')
      await allocateAmount(page).fill('300')
      await submit(allocateDialog(page))

      await expect(
        toasts(page).getByText(
          `Set the ${name} budget for ${thisMonth()} to ${await money(page, 300)}.`
        )
      ).toBeVisible()
      await expect(row(page, name).getByTestId('budgets-allocation-amount')).toHaveText(
        await money(page, 300)
      )

      // Set Budget, from the category's card: it opens on the month's budget and changes it.
      await page
        .locator('h3', { hasText: name })
        .locator('xpath=ancestor::div[.//*[@data-test-id="budgets-category-actions"]][1]')
        .getByTitle('Set Budget')
        .click()
      await expect(setBudgetAmount(page)).toHaveValue('300')
      await setBudgetAmount(page).fill('-1')
      await submit(setBudgetDialog(page))
      await expect(setBudgetAmount(page)).toHaveAccessibleDescription(
        'Enter an amount of zero or more.'
      )
      await expect(setBudgetAmount(page)).toBeFocused()
      await setBudgetAmount(page).fill('320.75')
      await submit(setBudgetDialog(page))

      await expect(setBudgetDialog(page)).toHaveCount(0)
      await expect(
        toasts(page).getByText(
          `Set the ${name} budget for ${thisMonth()} to ${await money(page, 320.75)}.`
        )
      ).toBeVisible()
      await expect(row(page, name).getByTestId('budgets-allocation-amount')).toHaveText(
        await money(page, 320.75)
      )

      // One budget for the category this month, changed each time: none added beside it.
      const budgets = await viaApp<{ id: number; category_id: number; amount: number }[]>(
        page,
        'GET',
        '/api/budgets'
      )
      const ours = budgets.filter((b) => b.category_id === categoryId)
      expect(ours.map((b) => b.amount)).toEqual([320.75])

      // Removed: the row goes back to a category without a budget.
      await viaApp(page, 'DELETE', `/api/budgets/${ours[0]!.id}`)
      await expect(row(page, name).getByTestId('budgets-allocation-amount')).toHaveText(
        await money(page, 0)
      )
      await expect(row(page, name).getByRole('button', { name: 'Change' })).toHaveCount(0)
      await expect(errorToasts(page)).toHaveCount(0)
      expect(errors).toEqual([])
    })
  })
}
