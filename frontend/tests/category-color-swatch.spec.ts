/**
 * Picking a colour must not save and close the form.
 *
 * The colour swatches are `<button>`s inside the category `<form>`, and a button with no `type`
 * defaults to `type="submit"`. So clicking a swatch submitted the form: the category was saved
 * and the modal closed, mid-edit, before the name or the icon had been touched. It read as the
 * modal auto-closing rather than as a swatch that was secretly the Save button.
 *
 * `src/__tests__/formButtonType.test.ts` guards the attribute across the whole app. These two
 * drive the actual forms, because the attribute is a means and staying open is the end.
 */
import { expect, test } from '@playwright/test'
import { getByTestId, login, navigateToRoute } from './test-helpers'

test.describe('the category form on the Categories page', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await navigateToRoute(page, 'categories')
  })

  test('stays open when a colour is picked while editing', async ({ page }) => {
    const card = getByTestId(page, 'category-card').first()
    await expect(card).toBeVisible({ timeout: 10000 })
    const name = await card.getByTestId('category-name').textContent()

    await card.getByTestId('edit-category-btn').click()
    const modal = getByTestId(page, 'category-modal-overlay')
    await expect(modal).toBeVisible()
    await expect(getByTestId(page, 'category-modal-title')).toContainText('Edit')

    // Every swatch, not just one: the bug is per-button, and the active one is a no-op click
    // that would pass on its own.
    const swatches = modal.getByTestId('category-color-swatch')
    const count = await swatches.count()
    expect(count).toBeGreaterThan(2)
    for (let i = 0; i < count; i++) {
      await swatches.nth(i).click()
      await expect(modal, `the modal closed after clicking swatch ${i}`).toBeVisible()
    }

    // Still editing the same category, with everything still in the form.
    await expect(getByTestId(page, 'category-modal-title')).toContainText('Edit')
    await expect(modal.locator('input[type="text"]').first()).toHaveValue(name?.trim() ?? '')
  })

  test('stays open when a colour is picked while adding', async ({ page }) => {
    await getByTestId(page, 'add-category-btn').click()
    const modal = getByTestId(page, 'category-modal-overlay')
    await expect(modal).toBeVisible()

    const nameField = modal.locator('input[type="text"]').first()
    await nameField.fill('Colour test')

    /*
     * Watch the request rather than the modal. Submitting closes the modal only once the POST
     * has come back, so an immediate `toBeVisible()` passes in the gap — this test did exactly
     * that against the buggy build, and would have shipped saying nothing.
     */
    const saves: string[] = []
    page.on('request', (r) => {
      if (r.method() === 'POST' && r.url().includes('/api/categories')) saves.push(r.url())
    })

    const swatches = modal.getByTestId('category-color-swatch')
    const count = await swatches.count()
    expect(count).toBeGreaterThan(2)
    for (let i = 0; i < count; i++) await swatches.nth(i).click()

    await expect(modal).toBeVisible()
    await expect(nameField).toHaveValue('Colour test')
    expect(saves, 'picking a colour saved the category').toEqual([])
  })

  test('the colour is applied, not merely not-saved', async ({ page }) => {
    await getByTestId(page, 'add-category-btn').click()
    const modal = getByTestId(page, 'category-modal-overlay')
    const swatch = modal.getByTestId('category-color-swatch').nth(2)
    await swatch.click()

    // The pick still registers: the swatch marks itself chosen. type="button" must stop the
    // submit without stopping the handler.
    await expect(swatch.locator('svg')).toBeVisible()
  })
})

test.describe('the category form on the Budgets page', () => {
  test('stays open when a colour is picked', async ({ page }) => {
    await login(page)
    await navigateToRoute(page, 'budgets')

    await page.getByRole('button', { name: 'Add Category' }).first().click()
    const modal = getByTestId(page, 'budgets-category-modal')
    await expect(modal).toBeVisible()

    const nameField = modal.locator('input[type="text"]').first()
    await nameField.fill('Colour test')

    const swatches = modal.getByTestId('category-color-swatch')
    const count = await swatches.count()
    expect(count).toBeGreaterThan(2)
    for (let i = 0; i < count; i++) {
      await swatches.nth(i).click()
      await expect(modal, `the modal closed after clicking swatch ${i}`).toBeVisible()
    }
    await expect(nameField).toHaveValue('Colour test')
  })
})
