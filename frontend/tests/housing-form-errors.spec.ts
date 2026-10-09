/**
 * The Housing dialog, in both storage modes: an expense without a name or an amount is marked at
 * each field, in the words both runtimes use, and nothing is sent; a good one is added, with a
 * toast that names it.
 *
 * The dialog said "Failed to save housing expense" in a toast whatever was wrong, and the
 * browser's own bubble said the rest. Now it checks with the rules both runtimes run
 * (shared/housingSchema.ts) before it sends anything, and marks the field.
 *
 * No body the dialog can send is refused by the runtime alone: the runtime runs the same check,
 * and a housing expense names no category or account another tab could delete. So the refusal
 * from the runtime is the Worker's answer stubbed at the network, signed in only, as a newer
 * Worker would refuse an amount: it is marked at the amount.
 *
 * Every other case runs signed in (the Worker) and local-first (the IndexedDB router). Main runs
 * them all; none is `@smoke`.
 */
import { expect, test } from '@playwright/test'
import {
  caseStamp,
  errorToasts,
  MODES,
  money,
  sweepProfiles,
  toasts,
  watchErrors,
  watchWrites,
} from './form-errors-helpers'
import type { Locator, Page } from '@playwright/test'

const header = (page: Page): Locator => page.getByTestId('housing-header')
const dialog = (page: Page): Locator => page.getByTestId('housing-modal')
const nameField = (page: Page): Locator => page.getByTestId('housing-property-input')
const amountField = (page: Page): Locator => page.getByTestId('housing-amount-input')
const dueDayField = (page: Page): Locator => page.getByTestId('housing-due-day-input')
const submit = (page: Page) => page.getByTestId('housing-submit-btn').click()

for (const mode of MODES) {
  test.describe(`the housing dialog, ${mode.name}`, () => {
    /** In the name of everything a case makes, so the sweep can find it. */
    let stamp = ''

    test.beforeEach(() => {
      test.setTimeout(120_000)
      stamp = caseStamp()
    })

    test.afterEach(async ({ page }) => {
      await sweepProfiles(page, mode, stamp)
    })

    test('an expense without a name or an amount is marked at each and nothing is sent, and a good one is added', async ({
      page,
    }) => {
      const errors = watchErrors(page)
      await mode.open(page, 'housing', header, `zz-housing-${stamp}`)
      const writes = watchWrites(page, /^\/api\/housing/)
      const name = `zz-home-${stamp}`

      await page.getByTestId('add-housing-btn').click()
      await expect(dialog(page)).toBeVisible()
      await submit(page)

      await expect(nameField(page)).toHaveAttribute('aria-invalid', 'true')
      await expect(nameField(page)).toHaveAccessibleDescription('Name the property or the payment.')
      await expect(amountField(page)).toHaveAccessibleDescription('Enter the monthly amount.')
      await expect(nameField(page)).toBeFocused()

      await nameField(page).fill(name)
      await amountField(page).fill('0')
      await dueDayField(page).fill('32')
      await submit(page)

      await expect(nameField(page)).not.toHaveAttribute('aria-invalid', 'true')
      await expect(amountField(page)).toHaveAccessibleDescription('Enter an amount more than zero.')
      await expect(dueDayField(page)).toHaveAccessibleDescription(
        'Enter a day of the month from 1 to 31.'
      )
      await expect(amountField(page)).toBeFocused()
      expect(writes).toEqual([])
      await expect(errorToasts(page)).toHaveCount(0)

      // A comma for the cents, and a due day the dialog reads.
      await amountField(page).fill('850,50')
      await dueDayField(page).fill('5')
      await submit(page)

      await expect(dialog(page)).toHaveCount(0)
      await expect(toasts(page).getByText(`Added "${name}" to your housing costs.`)).toBeVisible()
      const card = page.getByTestId('housing-card').filter({ hasText: name })
      await expect(card.getByTestId('housing-card-amount')).toContainText(await money(page, 850.5))
      await expect(errorToasts(page)).toHaveCount(0)
      expect(errors).toEqual([])
    })
  })
}

test.describe('the housing dialog, cloud, a refusal from the Worker', () => {
  let stamp = ''

  test.beforeEach(() => {
    test.setTimeout(120_000)
    stamp = caseStamp()
  })

  test.afterEach(async ({ page }) => {
    await sweepProfiles(page, MODES[0], stamp)
  })

  test("an amount the Worker refuses is marked at the amount in the Worker's words, and the dialog stays open", async ({
    page,
  }) => {
    await MODES[0].open(page, 'housing', header, `zz-housing-${stamp}`)
    // The Worker's refusal, as a newer one would answer: a 400 that names the field.
    await page.route('**/api/housing', async (route) => {
      if (route.request().method() !== 'POST') return route.continue()
      return route.fulfill({
        status: 400,
        json: {
          error: 'Enter an amount below one trillion.',
          fields: { monthly_amount: 'Enter an amount below one trillion.' },
        },
      })
    })

    await page.getByTestId('add-housing-btn').click()
    await nameField(page).fill(`zz-home-${stamp}`)
    await amountField(page).fill('850')
    await submit(page)

    await expect(amountField(page)).toHaveAttribute('aria-invalid', 'true')
    await expect(amountField(page)).toHaveAccessibleDescription(
      'Enter an amount below one trillion.'
    )
    await expect(amountField(page)).toBeFocused()
    await expect(nameField(page)).not.toHaveAttribute('aria-invalid', 'true')
    await expect(dialog(page)).toBeVisible()
    await expect(errorToasts(page)).toHaveCount(0)
  })
})
