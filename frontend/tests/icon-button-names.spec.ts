/**
 * Every button on Budgets and Categories has a name, and a card's buttons name the category they
 * act on.
 *
 * A probe read bare "button" (20 to 24px icons) on these pages, and every card's delete said only
 * "Delete category". The delete on a Budgets card deletes the category, as on Categories, so both
 * read "Delete the <name> category"; Budgets' Set budget and Edit name it too.
 *
 * Categories' edit button is left to fix/older-papercuts, which names it "Edit <name>"; until that
 * lands it is the one button this check skips.
 */
import { expect, test } from '@playwright/test'
import { E2E_BASE } from './e2e-constants'
import type { Locator, Page } from '@playwright/test'

const SIZES = [
  { width: 390, height: 844 },
  { width: 1280, height: 800 },
]

async function everyButtonNamed(page: Page, where: string) {
  const buttons = page.locator('main button:visible:not([data-test-id="edit-category-btn"])')
  await expect(buttons.first()).toBeVisible({ timeout: 30_000 })
  const all = await buttons.all()
  expect(all.length, `${where}: buttons found`).toBeGreaterThan(5)
  for (const button of all) await expect(button, `${where}: a button`).toHaveAccessibleName(/\S/)
  await expect(page.getByRole('button', { name: 'Delete category', exact: true })).toHaveCount(0)
}

async function namesItsCategory(card: Locator, buttons: string[]) {
  for (const label of buttons)
    await expect(card.getByRole('button', { name: label, exact: true }), label).toHaveCount(1)
}

for (const size of SIZES) {
  test.describe(`icon buttons at ${size.width} @smoke`, () => {
    test.use({ viewport: size, hasTouch: size.width < 768, isMobile: size.width < 768 })

    test('Budgets: every button is named, and a card names its category', async ({ page }) => {
      await page.goto(`${E2E_BASE}/#budgets`)
      const actions = page.getByTestId('budgets-category-actions').first()
      await expect(actions).toBeVisible({ timeout: 30_000 })
      await everyButtonNamed(page, 'Budgets')
      const card = actions.locator('xpath=ancestor::div[h3 or .//h3][1]/..')
      const name = (await card.locator('h3').first().innerText()).trim()
      await namesItsCategory(card, [
        `Set budget for ${name}`,
        `Edit ${name}`,
        `Delete the ${name} category`,
      ])
    })

    test('Categories: every button is named, and a card names its category', async ({ page }) => {
      await page.goto(`${E2E_BASE}/#categories`)
      const card = page.getByTestId('category-card').first()
      await expect(card).toBeVisible({ timeout: 30_000 })
      await everyButtonNamed(page, 'Categories')
      const name = (await card.getByTestId('category-name').innerText()).trim()
      await namesItsCategory(card, [`Delete the ${name} category`])
    })
  })
}
