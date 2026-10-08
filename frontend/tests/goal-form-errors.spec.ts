/**
 * The goal dialog and Add Funds, in both storage modes: a refused goal or amount is said under the
 * field it is about, and a good one is added, funded, renamed and deleted with a toast that says
 * which goal.
 *
 * The dialog leaned on the browser's own bubbles for an empty name, and a refused save said
 * "Failed to save goal" in a toast with nothing marked. Add Funds sent a blank or negative amount
 * on to the runtime. Now both check with the rules both runtimes run (shared/goalSchema.ts), mark
 * the field in its own words, focus it, and send nothing.
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
      await navigateToRoute(page, 'goals')
      await expect(page.getByTestId('goals-header')).toBeVisible({ timeout: 20_000 })
    },
  },
  {
    name: 'local-first',
    goto: async (page) => {
      await leaveOnboarding(page)
      await gotoServerless(page, 'goals', 'goals-header')
    },
  },
]

const dialog = (page: Page): Locator => page.getByTestId('goals-modal')
const nameField = (page: Page): Locator => page.getByTestId('goals-form-name')
const targetField = (page: Page): Locator => page.getByTestId('goals-form-target')
const submit = (page: Page) => page.getByTestId('goals-modal-submit').click()
const toasts = (page: Page): Locator => page.getByRole('region', { name: 'Notifications' })
const errorToasts = (page: Page): Locator => toasts(page).getByRole('alert')

/** The card of the goal called `name`. */
function card(page: Page, name: string): Locator {
  return page.getByTestId('goal-card').filter({
    has: page.getByTestId('goal-name').getByText(name, { exact: true }),
  })
}

/** Every goal write the page sends over the network (local-first sends none). */
function watchGoalWrites(page: Page): string[] {
  const writes: string[] = []
  page.on('request', (request) => {
    if (
      ['POST', 'PUT'].includes(request.method()) &&
      /\/api\/savings-goals\b/.test(request.url())
    ) {
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

type Method = 'GET' | 'DELETE'

/** A request through the app's own API client, in whichever storage mode the page runs. */
async function viaApp<T = unknown>(page: Page, method: Method, url: string): Promise<T> {
  const answer = await page.evaluate(
    async (req) => {
      const spec = '/src/core/api.ts'
      const mod = (await import(/* @vite-ignore */ spec)) as {
        apiGet: (url: string) => Promise<unknown>
        apiDelete: (url: string) => Promise<unknown>
      }
      return req.method === 'GET' ? mod.apiGet(req.url) : mod.apiDelete(req.url)
    },
    { method, url }
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

/**
 * Takes out of the Worker's database the goals a case made, whether or not the case got that far:
 * the fixture profile is shared by every spec and outlives a local run. Local-first keeps
 * everything in the test's own browser, which goes with it.
 */
async function sweep(page: Page, mode: Mode, stamp: string): Promise<void> {
  if (mode.name !== 'cloud' || !stamp) return
  const goals = await viaApp<{ id: number; name: string }[]>(page, 'GET', '/api/savings-goals')
  for (const goal of goals.filter((g) => g.name.includes(stamp))) {
    await viaApp(page, 'DELETE', `/api/savings-goals/${goal.id}`)
  }
}

for (const mode of MODES) {
  test.describe(`the goal dialog and Add Funds, ${mode.name} @smoke`, () => {
    /** In the name of every goal a case makes, so `sweep` can find it. */
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

    test('a goal without a name or a target is marked at each, focused, and nothing is sent', async ({
      page,
    }) => {
      const writes = watchGoalWrites(page)
      await page.getByTestId('add-goal-btn').click()
      await expect(dialog(page)).toBeVisible()

      await submit(page)

      await expect(nameField(page)).toHaveAttribute('aria-invalid', 'true')
      await expect(nameField(page)).toHaveAccessibleDescription('Give the goal a name.')
      await expect(targetField(page)).toHaveAttribute('aria-invalid', 'true')
      await expect(targetField(page)).toHaveAccessibleDescription(
        'Enter the amount you want to save.'
      )
      await expect(nameField(page)).toBeFocused()

      await nameField(page).fill('Bike')
      await targetField(page).fill('0')
      await submit(page)

      await expect(nameField(page)).not.toHaveAttribute('aria-invalid', 'true')
      await expect(targetField(page)).toHaveAccessibleDescription('Enter a target more than zero.')
      await expect(targetField(page)).toBeFocused()
      expect(writes).toEqual([])
      await expect(errorToasts(page)).toHaveCount(0)
      // And each label names its field.
      await expect(dialog(page).getByLabel('Goal Name', { exact: true })).toHaveValue('Bike')
      await expect(dialog(page).getByLabel('Target Amount', { exact: true })).toBeFocused()
    })

    test('a goal is added, funded, renamed and deleted, and each step names it', async ({
      page,
    }) => {
      const errors = watchErrors(page)
      const name = `zz-goal-${stamp}`

      await page.getByTestId('add-goal-btn').click()
      await nameField(page).fill(name)
      await targetField(page).fill('1200,50')
      await submit(page)

      await expect(dialog(page)).toHaveCount(0)
      await expect(toasts(page).getByText(`Added "${name}" to your goals.`)).toBeVisible()
      await expect(card(page, name).getByTestId('goal-progress-target')).toHaveText(
        await money(page, 1200.5)
      )

      // Add Funds: a blank or zero amount is marked under the amount, and nothing is sent.
      const writes = watchGoalWrites(page)
      await card(page, name).getByTestId('goal-contribute-btn').click()
      const funds = card(page, name).getByTestId('goal-contribute-form')
      const amount = funds.getByTestId('goal-contribute-amount')
      for (const [typed, said] of [
        ['', 'Enter the amount to add.'],
        ['0', 'Enter an amount more than zero.'],
        ['fifty', 'Enter the amount as a number, like 50.00.'],
      ] as const) {
        await amount.fill(typed)
        await funds.locator('button[type="submit"]').click()

        await expect(amount).toHaveAttribute('aria-invalid', 'true')
        await expect(amount).toHaveAccessibleDescription(said)
        await expect(amount).toBeFocused()
      }
      expect(writes).toEqual([])
      await expect(funds.getByLabel(`Amount to add to ${name}`, { exact: true })).toBeFocused()

      await amount.fill('50,25')
      await funds.locator('button[type="submit"]').click()

      await expect(funds).toHaveCount(0)
      await expect(
        toasts(page).getByText(`Added ${await money(page, 50.25)} to "${name}".`)
      ).toBeVisible()
      await expect(card(page, name).getByTestId('goal-progress-current')).toContainText(
        `${await money(page, 50.25)} of`
      )

      // Renamed: the dialog opens on the goal, and keeps the money already in it.
      await card(page, name).getByTestId('goal-edit-btn').click()
      await expect(page.getByTestId('goals-modal-title')).toHaveText('Edit Goal')
      await expect(nameField(page)).toHaveValue(name)
      await nameField(page).fill(`${name}-renamed`)
      await submit(page)

      await expect(dialog(page)).toHaveCount(0)
      await expect(toasts(page).getByText(`Saved your changes to "${name}-renamed".`)).toBeVisible()
      await expect(
        card(page, `${name}-renamed`).getByTestId('goal-progress-current')
      ).toContainText(`${await money(page, 50.25)} of`)

      // Deleted, once it is confirmed.
      await card(page, `${name}-renamed`).getByTestId('goal-delete-btn').click()
      await page.getByTestId('confirm-accept').click()

      await expect(toasts(page).getByText('Goal deleted successfully')).toBeVisible()
      await expect(card(page, `${name}-renamed`)).toHaveCount(0)
      await expect(errorToasts(page)).toHaveCount(0)
      expect(errors).toEqual([])
    })
  })
}
