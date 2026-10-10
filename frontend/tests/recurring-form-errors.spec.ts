/**
 * The Recurring section's dialog on Transactions, in both storage modes: a recurring transaction
 * without a description or an amount is marked at each field and nothing is sent, and a category
 * deleted in another tab is marked at the category, in the runtime's words.
 *
 * The dialog said what the transaction rules or zod said, in a toast ("Transaction amount must be
 * a positive number", "Validation failed"), with nothing marked, and the Worker saved a rule with
 * no description. Now it checks with the rules both runtimes run (shared/recurringSchema.ts)
 * before it sends anything, and marks the field.
 *
 * Every case runs signed in (the Worker) and local-first (the IndexedDB router). Pull requests
 * run the `@smoke` one; main runs them all.
 */
import { expect, test } from '@playwright/test'
import {
  caseStamp,
  elsewhere,
  errorToasts,
  MODES,
  REFUSAL_LOGGED,
  sweepProfiles,
  viaApp,
  watchErrors,
  watchWrites,
} from './form-errors-helpers'
import type { Locator, Page } from '@playwright/test'

interface Rule {
  id: number
  description: string
}

const header = (page: Page): Locator => page.getByTestId('transactions-header')
const dialog = (page: Page): Locator => page.getByTestId('recurring-modal')
const descriptionField = (page: Page): Locator => page.getByTestId('recurring-form-description')
const amountField = (page: Page): Locator => page.getByTestId('recurring-form-amount')
const categoryField = (page: Page): Locator => page.getByTestId('recurring-form-category')
const submit = (page: Page) => page.getByTestId('recurring-form-submit').click()

/** The Recurring section's Add button, beside its heading. */
const addButton = (page: Page): Locator =>
  page
    .getByRole('heading', { name: 'Recurring Transactions' })
    .locator('xpath=..')
    .getByRole('button', { name: 'Add', exact: true })

for (const mode of MODES) {
  test.describe(`the recurring dialog, ${mode.name}`, () => {
    /** In the name of everything a case makes, so the sweep can find it. */
    let stamp = ''

    test.beforeEach(() => {
      test.setTimeout(120_000)
      stamp = caseStamp()
    })

    test.afterEach(async ({ page }) => {
      await sweepProfiles(page, mode, stamp)
    })

    test('a rule without a description or an amount is marked at each and nothing is sent, and a category deleted in another tab is marked at the category @smoke', async ({
      page,
    }) => {
      const errors = watchErrors(page, REFUSAL_LOGGED)
      const profileId = await mode.open(page, 'transactions', header, `zz-recurring-${stamp}`)
      const writes = watchWrites(page, /^\/api\/recurring/)
      const name = `zz-recur-${stamp}`
      const category = `zz-recur-cat-${stamp}`

      await addButton(page).click()
      await expect(dialog(page)).toBeVisible()
      await submit(page)

      await expect(descriptionField(page)).toHaveAttribute('aria-invalid', 'true')
      await expect(descriptionField(page)).toHaveAccessibleDescription(
        'Describe the payment, like Rent or Salary.'
      )
      await expect(amountField(page)).toHaveAccessibleDescription('Enter the amount.')
      await expect(descriptionField(page)).toBeFocused()
      expect(writes).toEqual([])
      await expect(errorToasts(page)).toHaveCount(0)

      // A category added through the app reaches the dialog's list; deleted in another tab, it
      // does not leave it.
      const { id } = await viaApp<{ id: number }>(page, 'POST', '/api/categories', {
        name: category,
        type: 'expense',
        color: '#0ea5e9',
        icon: 'tag',
      })
      await expect(categoryField(page).locator('option', { hasText: category })).toHaveCount(1, {
        timeout: 15_000,
      })
      await descriptionField(page).fill(name)
      await amountField(page).fill('25,50')
      await categoryField(page).selectOption({ label: category })
      await elsewhere(page, mode, 'DELETE', `/api/categories/${String(id)}`, profileId)
      await submit(page)

      await expect(categoryField(page)).toHaveAttribute('aria-invalid', 'true')
      await expect(categoryField(page)).toHaveAccessibleDescription(
        'Choose a category from the list, or leave it blank.'
      )
      await expect(categoryField(page)).toBeFocused()
      await expect(descriptionField(page)).not.toHaveAttribute('aria-invalid', 'true')
      await expect(dialog(page)).toBeVisible()
      await expect(errorToasts(page)).toHaveCount(0)
      const rules = await viaApp<Rule[]>(page, 'GET', '/api/recurring')
      expect(rules.filter((rule) => rule.description === name)).toEqual([])
      expect(errors).toEqual([])
    })
  })
}
