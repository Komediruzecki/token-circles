/**
 * The Retirement page's goal dialog and the planner's assumptions, in both storage modes: a refused
 * goal or plan is said under the field it is about, and a good one is saved with a toast that says
 * what was saved.
 *
 * The goal dialog leaned on the browser's own bubbles, and a refused save said "Failed to save
 * retirement goal" in a toast with nothing marked. The planner sent whatever was on screen and had
 * it moved into range without a word: a withdrawal rate of 0 % was saved as 0.1 %, a lifestyle
 * costing nothing was dropped. Now both check with the rules both runtimes run
 * (shared/retirementGoalSchema.ts, shared/retirementPlanSchema.ts), mark the field in its own
 * words, a lifestyle's under the field of its row, focus it, and send nothing. A goal another tab
 * deleted is said in the dialog, in the same words from either runtime.
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
      await navigateToRoute(page, 'retirement')
      await expect(page.getByTestId('retirement-header')).toBeVisible({ timeout: 20_000 })
    },
  },
  {
    name: 'local-first',
    goto: async (page) => {
      await leaveOnboarding(page)
      await gotoServerless(page, 'retirement', 'retirement-header')
    },
  },
]

const dialog = (page: Page): Locator => page.getByTestId('retirement-modal')
const field = (page: Page, label: string): Locator =>
  dialog(page).getByLabel(label, { exact: true })
const submitGoal = (page: Page) => page.getByTestId('retirement-modal-submit').click()
const saveButton = (page: Page): Locator => page.getByTestId('retirement-save-settings')
const toasts = (page: Page): Locator => page.getByRole('region', { name: 'Notifications' })
const errorToasts = (page: Page): Locator => toasts(page).getByRole('alert')
const spendFields = (page: Page): Locator =>
  page.getByTestId('retirement-lifestyles').getByLabel("Monthly spending in today's money", {
    exact: true,
  })

/** The card of the goal called `name`. */
function card(page: Page, name: string): Locator {
  return page.getByTestId('retirement-goal-card').filter({
    has: page.getByTestId('retirement-goal-name').getByText(name, { exact: true }),
  })
}

/** Every retirement write the page sends over the network (local-first sends none). */
function watchWrites(page: Page): string[] {
  const writes: string[] = []
  page.on('request', (request) => {
    if (
      ['POST', 'PUT'].includes(request.method()) &&
      /\/api\/retirement(-goals|\/settings)\b/.test(request.url())
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

type Plan = Record<string, unknown>

async function storedPlan(page: Page): Promise<Plan> {
  return (await viaApp<{ settings: Plan }>(page, 'GET', '/api/retirement/settings')).settings
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

for (const mode of MODES) {
  // Pull requests run the cases tagged `@smoke`, and the ones tagged `cloudSmoke` signed in only:
  // a case that sends nothing runs the same code in both modes. Main runs every case in both.
  const cloudSmoke = mode.name === 'cloud' ? ' @smoke' : ''
  test.describe(`the retirement goal dialog and plan, ${mode.name}`, () => {
    /** In the name of every goal a case makes, so the sweep can find it. */
    let stamp = ''
    /**
     * The plan as the case found it, to put back once it is done: the fixture profile is shared
     * by every spec and outlives a local run (cloud only; local-first's goes with its browser).
     */
    let planBefore: Plan | null = null

    test.beforeEach(async ({ page }) => {
      test.setTimeout(120_000)
      stamp = `${Date.now().toString(36)}${test.info().parallelIndex}`
      planBefore = null
      await mode.goto(page)
    })

    test.afterEach(async ({ page }) => {
      if (mode.name !== 'cloud') return
      if (planBefore) await viaApp(page, 'PUT', '/api/retirement/settings', planBefore)
      const goals = (
        await viaApp<{ goals: { id: number; name: string }[] }>(
          page,
          'GET',
          '/api/retirement-goals'
        )
      ).goals
      for (const goal of goals.filter((g) => g.name.includes(stamp))) {
        await viaApp(page, 'DELETE', `/api/retirement-goals/${goal.id}`)
      }
    })

    /** Remember the plan before a case saves one. */
    async function keepPlan(page: Page): Promise<void> {
      if (mode.name === 'cloud') planBefore = await storedPlan(page)
    }

    // Both cases save the same plan, which signed in is the shared fixture profile's: one at a
    // time, or one's save lands between the other's save and its check.
    test.describe('the plan', () => {
      test.describe.configure({ mode: 'default' })

      test(`a plan value outside its range is marked at its field, level with the one beside it, and nothing is saved until it is fixed${cloudSmoke}`, async ({
        page,
      }) => {
        await keepPlan(page)
        const writes = watchWrites(page)
        const swr = page.getByTestId('retirement-input-swr')
        await expect(saveButton(page)).toHaveText('Saved', { timeout: 20_000 })

        await swr.fill('0')
        await saveButton(page).click()

        await expect(swr).toHaveAttribute('aria-invalid', 'true')
        await expect(swr).toHaveAccessibleDescription(
          'Enter a withdrawal rate from 0.1 to 20 percent, like 4.'
        )
        await expect(swr).toBeFocused()
        await expect(page.getByLabel('Withdrawal rate (%)', { exact: true })).toBeFocused()
        // The message under it moves neither control in the row out of line.
        const marked = await swr.boundingBox()
        const beside = await page.getByTestId('retirement-input-life').boundingBox()
        expect(Math.abs((marked?.y ?? 0) - (beside?.y ?? 1))).toBeLessThanOrEqual(1)
        expect(writes).toEqual([])
        await expect(errorToasts(page)).toHaveCount(0)

        await swr.fill('4.5')
        await expect(swr).not.toHaveAttribute('aria-invalid', 'true')
        await saveButton(page).click()

        await expect(toasts(page).getByText('Saved your retirement assumptions.')).toBeVisible()
        await expect(saveButton(page)).toHaveText('Saved')
        await expect(saveButton(page)).toHaveAttribute('aria-disabled', 'true')
        expect((await storedPlan(page)).safeWithdrawalRatePct).toBe(4.5)
        await expect(errorToasts(page)).toHaveCount(0)
      })

      test('a lifestyle costing nothing is marked under its own row, and goes with the row', async ({
        page,
      }) => {
        await keepPlan(page)
        const writes = watchWrites(page)
        await expect(saveButton(page)).toHaveText('Saved', { timeout: 20_000 })
        const before = await spendFields(page).count()

        await page.getByTestId('retirement-add-lifestyle').click()
        await expect(spendFields(page)).toHaveCount(before + 1)
        const added = spendFields(page).nth(before)
        await added.fill('0')
        await saveButton(page).click()

        await expect(added).toHaveAttribute('aria-invalid', 'true')
        await expect(added).toHaveAccessibleDescription(
          "Enter what this lifestyle costs a month in today's money, more than zero."
        )
        await expect(added).toBeFocused()
        await expect(spendFields(page).first()).not.toHaveAttribute('aria-invalid', 'true')
        expect(writes).toEqual([])

        await page
          .getByTestId('retirement-lifestyles')
          .getByRole('button', { name: 'Remove lifestyle' })
          .nth(before)
          .click()
        await expect(spendFields(page)).toHaveCount(before)
        await expect(
          page.getByTestId('retirement-lifestyles').locator('[aria-invalid="true"]')
        ).toHaveCount(0)
        await saveButton(page).click()

        await expect(toasts(page).getByText('Saved your retirement assumptions.')).toBeVisible()
        await expect(errorToasts(page)).toHaveCount(0)
      })
    })

    test('a goal without its figures is marked at each field, focused, and nothing is sent', async ({
      page,
    }) => {
      const writes = watchWrites(page)
      await page.getByTestId('add-retirement-goal-btn').click()
      await expect(dialog(page)).toBeVisible()

      await submitGoal(page)

      for (const [label, said] of [
        ['Goal Name', 'Give the goal a name.'],
        ['Target Amount', 'Enter the amount you want to retire with.'],
        ['Current Age', 'Enter your age as a whole number from 18 to 100.'],
        ['Retirement Age', 'Enter the age you want to retire at, a whole number from 18 to 100.'],
        [
          'Expected Annual Return (%)',
          'Enter the return you expect each year, like 7, or 0 for none.',
        ],
      ] as const) {
        await expect(field(page, label)).toHaveAttribute('aria-invalid', 'true')
        await expect(field(page, label)).toHaveAccessibleDescription(said)
      }
      await expect(field(page, 'Goal Name')).toBeFocused()

      await field(page, 'Goal Name').fill(`zz-goal-${stamp}`)
      await field(page, 'Target Amount').fill('0')
      await field(page, 'Current Age').fill('38')
      await field(page, 'Retirement Age').fill('60')
      await field(page, 'Expected Annual Return (%)').fill('25')
      await submitGoal(page)

      await expect(field(page, 'Goal Name')).not.toHaveAttribute('aria-invalid', 'true')
      await expect(field(page, 'Target Amount')).toHaveAccessibleDescription(
        'Enter a target more than zero.'
      )
      await expect(field(page, 'Expected Annual Return (%)')).toHaveAccessibleDescription(
        'Enter a return from 0 to 20.'
      )
      await expect(field(page, 'Target Amount')).toBeFocused()
      expect(writes).toEqual([])
      await expect(errorToasts(page)).toHaveCount(0)
    })

    test('a goal is added at 0 %, changed and deleted, and each step names it', async ({
      page,
    }) => {
      const errors = watchErrors(page)
      const name = `zz-goal-${stamp}`

      await page.getByTestId('add-retirement-goal-btn').click()
      await field(page, 'Goal Name').fill(name)
      await field(page, 'Target Amount').fill('750000')
      await field(page, 'Current Amount').fill('42000,50')
      await field(page, 'Current Age').fill('38')
      await field(page, 'Retirement Age').fill('60')
      await field(page, 'Expected Annual Return (%)').fill('0')
      await submitGoal(page)

      await expect(dialog(page)).toHaveCount(0)
      await expect(
        toasts(page).getByText(`Added "${name}" to your retirement goals.`)
      ).toBeVisible()
      await expect(card(page, name)).toBeVisible()

      // Opened for editing at 0 %, where it used to open at 7 %.
      await card(page, name).getByTestId('retirement-goal-edit-btn').click()
      await expect(field(page, 'Goal Name')).toHaveValue(name)
      await expect(field(page, 'Expected Annual Return (%)')).toHaveValue('0')
      await field(page, 'Goal Name').fill(`${name}-renamed`)
      await submitGoal(page)

      await expect(dialog(page)).toHaveCount(0)
      await expect(toasts(page).getByText(`Saved your changes to "${name}-renamed".`)).toBeVisible()
      await expect(card(page, `${name}-renamed`)).toBeVisible()

      await card(page, `${name}-renamed`).getByTestId('retirement-goal-delete-btn').click()
      await page.getByTestId('confirm-accept').click()

      await expect(toasts(page).getByText('Goal deleted successfully')).toBeVisible()
      await expect(card(page, `${name}-renamed`)).toHaveCount(0)
      await expect(errorToasts(page)).toHaveCount(0)
      expect(errors).toEqual([])
    })

    test('a goal another tab deleted is said in the dialog, which keeps what was typed @smoke', async ({
      page,
    }) => {
      const errors = watchErrors(page)
      const name = `zz-gone-${stamp}`
      await page.getByTestId('add-retirement-goal-btn').click()
      await field(page, 'Goal Name').fill(name)
      await field(page, 'Target Amount').fill('500000')
      await field(page, 'Current Age').fill('40')
      await field(page, 'Retirement Age').fill('67')
      await field(page, 'Expected Annual Return (%)').fill('5')
      await submitGoal(page)
      await expect(card(page, name)).toBeVisible()
      const goals = (
        await viaApp<{ goals: { id: number; name: string }[] }>(
          page,
          'GET',
          '/api/retirement-goals'
        )
      ).goals
      const id = goals.find((goal) => goal.name === name)?.id
      expect(id, 'the goal just added').toBeDefined()

      await card(page, name).getByTestId('retirement-goal-edit-btn').click()
      await field(page, 'Goal Name').fill(`${name}-renamed`)
      await deleteElsewhere(page, mode, `/api/retirement-goals/${id}`)
      await submitGoal(page)

      // The same words from either runtime, in the dialog, which stays open on what was typed.
      await expect(page.getByTestId('retirement-form-notice')).toHaveText(
        'Retirement goal not found'
      )
      await expect(dialog(page)).toBeVisible()
      await expect(field(page, 'Goal Name')).toHaveValue(`${name}-renamed`)
      await expect(errorToasts(page)).toHaveCount(0)
      expect(errors).toEqual([])
    })
  })
}
