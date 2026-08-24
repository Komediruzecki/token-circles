/**
 * The icon gallery, from the button that opens it to the value it leaves in the field.
 *
 * The component's own unit tests cover what the gallery offers and how it closes. What they cannot
 * cover is the wiring: that the button is reachable from inside the category modal, that the panel
 * actually lands ON TOP of that modal rather than behind it, and that a click writes the key into
 * the field the form submits. Every one of those is a real way this could ship looking finished
 * and do nothing.
 */
import { expect, test } from '@playwright/test'
import { getByTestId, login, navigateToRoute } from './test-helpers'

test.describe('Category icon gallery', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await navigateToRoute(page, 'categories')
    await getByTestId(page, 'add-category-btn').click()
    await expect(getByTestId(page, 'category-modal-title')).toBeVisible()
  })

  test('picking an icon fills the field and closes the gallery', async ({ page }) => {
    const field = page.locator('input[placeholder="e.g., food, home, car"]')
    await expect(field).toHaveValue('')

    await getByTestId(page, 'category-icon-browse').click()

    const gallery = getByTestId(page, 'icon-picker-grid')
    await expect(gallery).toBeVisible()

    await getByTestId(page, 'icon-picker-item-utensils').click()

    await expect(gallery).toBeHidden()
    await expect(field).toHaveValue('utensils')
    // The category form is still open behind it, with everything else the user had typed.
    await expect(getByTestId(page, 'category-modal-title')).toBeVisible()
  })

  test('the gallery sits above the category modal, not behind it', async ({ page }) => {
    await getByTestId(page, 'category-icon-browse').click()
    const item = getByTestId(page, 'icon-picker-item-home')
    await expect(item).toBeVisible()

    // toBeVisible() passes for an element covered by another one. This is the check that the
    // stacking order is right: Playwright refuses to click through an overlay.
    await item.click({ timeout: 5000 })
    await expect(page.locator('input[placeholder="e.g., food, home, car"]')).toHaveValue('home')
  })

  test('the filter narrows the list', async ({ page }) => {
    await getByTestId(page, 'category-icon-browse').click()
    const items = page.locator('[data-test-id^="icon-picker-item-"]')
    const total = await items.count()
    expect(total).toBeGreaterThan(20)

    await getByTestId(page, 'icon-picker-filter').fill('circle')
    await expect(items).not.toHaveCount(total)
    expect(await items.count()).toBeGreaterThan(0)

    await getByTestId(page, 'icon-picker-filter').fill('zzzz')
    await expect(getByTestId(page, 'icon-picker-empty')).toBeVisible()
  })

  test('closing the gallery leaves the half-filled form alone', async ({ page }) => {
    const name = page.locator('input[placeholder="e.g., Food, Rent"]')
    await name.fill('Coffee')

    await getByTestId(page, 'category-icon-browse').click()
    await expect(getByTestId(page, 'icon-picker-grid')).toBeVisible()
    await getByTestId(page, 'icon-picker-close').click()

    await expect(getByTestId(page, 'icon-picker-grid')).toBeHidden()
    await expect(getByTestId(page, 'category-modal-title')).toBeVisible()
    await expect(name).toHaveValue('Coffee')
  })

  test('Escape closes the gallery without closing the category modal', async ({ page }) => {
    const name = page.locator('input[placeholder="e.g., Food, Rent"]')
    await name.fill('Coffee')

    await getByTestId(page, 'category-icon-browse').click()
    await expect(getByTestId(page, 'icon-picker-grid')).toBeVisible()
    await page.keyboard.press('Escape')

    await expect(getByTestId(page, 'icon-picker-grid')).toBeHidden()
    await expect(getByTestId(page, 'category-modal-title')).toBeVisible()
    await expect(name).toHaveValue('Coffee')
  })
})
