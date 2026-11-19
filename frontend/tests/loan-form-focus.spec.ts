import { expect, test } from '@playwright/test'
import { login, navigateToRoute } from './test-helpers'

/**
 * The loan form takes focus when it opens and gives it back when it shuts. Its name field had
 * `autofocus`, which the browser applies only while a page loads, not to a dialog put on the page
 * later: focus stayed on the button that opened the form, behind the dialog.
 */
test.describe('the loan form takes focus, and gives it back @smoke', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await navigateToRoute(page, 'loans')
  })

  test('Add a loan focuses the name; Escape gives focus back to the add button', async ({
    page,
  }) => {
    const add = page.getByTestId('add-loan-btn')
    await add.click()
    const dialog = page.getByTestId('loans-modal')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByLabel('Name', { exact: true })).toBeFocused()

    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(add).toBeFocused()
  })

  test("Edit from a card's menu focuses the name; Cancel gives focus back to the menu's button", async ({
    page,
  }) => {
    const trigger = page.getByTestId('loans-item-menu').first()
    await trigger.click()
    await page.getByTestId('loans-item-edit').click()
    const dialog = page.getByTestId('loans-modal')
    const name = dialog.getByLabel('Name', { exact: true })
    await expect(name).toBeFocused()
    await expect(name).not.toHaveValue('')

    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).toBeHidden()
    await expect(trigger).toBeFocused()
  })
})
