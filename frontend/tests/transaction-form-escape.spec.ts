import { expect, test } from '@playwright/test'
import { login, navigateToRoute } from './test-helpers'

/**
 * Escape shuts Transactions' entry form, and focus goes back to "Add transaction". Reproduced on
 * 19 Nov 2026: the form had no Escape at all, so one Escape and then a second left it open, with
 * focus on the add button behind it or in one of its fields. Something open over the form takes
 * the first Escape for itself, and the form the next.
 */
test.describe("Escape and Transactions' entry form @smoke", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await navigateToRoute(page, 'transactions')
  })

  test('Escape shuts the form with focus still on Add transaction, where opening leaves it', async ({
    page,
  }) => {
    const add = page.getByTestId('add-transaction-btn')
    await add.click()
    const form = page.getByTestId('tx-modal')
    await expect(form).toBeVisible()
    await expect(add).toBeFocused()

    await page.keyboard.press('Escape')
    await expect(form).toBeHidden()
    await expect(add).toBeFocused()
  })

  test('Escape typed in the amount shuts the form, and focus goes back to Add transaction', async ({
    page,
  }) => {
    const add = page.getByTestId('add-transaction-btn')
    await add.click()
    const form = page.getByTestId('tx-modal')
    await expect(form).toBeVisible()
    const amount = page.getByTestId('tx-amount')
    await amount.fill('12.34')
    await expect(amount).toBeFocused()

    await page.keyboard.press('Escape')
    await expect(form).toBeHidden()
    await expect(add).toBeFocused()
  })

  test('an open (i) panel in the form takes the first Escape, the form the second', async ({
    page,
  }) => {
    await page.getByTestId('add-transaction-btn').click()
    const form = page.getByTestId('tx-modal')
    await expect(form).toBeVisible()
    await form.getByRole('button', { name: /^How much money moved/ }).click()
    const panel = page.getByRole('tooltip')
    await expect(panel).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(panel).toBeHidden()
    await expect(form).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(form).toBeHidden()
  })

  test('the keyboard shortcuts over the form take the first Escape, the form the second', async ({
    page,
  }) => {
    const add = page.getByTestId('add-transaction-btn')
    await add.click()
    const form = page.getByTestId('tx-modal')
    await expect(form).toBeVisible()
    // Focus is still on the add button behind the form, so "?" is not typing.
    await page.keyboard.type('?')
    const list = page.getByTestId('shortcuts-modal')
    await expect(list).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(list).toBeHidden()
    await expect(form).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(form).toBeHidden()
    await expect(add).toBeFocused()
  })
})
