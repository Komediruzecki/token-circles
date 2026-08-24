/**
 * The budget block on a category card.
 *
 * It used to be four rows — "Spent / amount", a bar, "… limit", "… remaining" — and the row
 * carrying "limit" drew its own `border-top` directly beneath a bar of almost the same weight.
 * The result read as one horizontal divider painted twice, and it cost a budgeted category three
 * lines more than an unbudgeted one.
 *
 * Both are layout facts, invisible to a test that only reads text. These measure boxes.
 */
import { expect, test, type Locator } from '@playwright/test'
import { getByTestId, login, navigateToRoute } from './test-helpers'

/** The first category card that actually has a budget, so a meter is rendered. */
async function budgetedCard(page: import('@playwright/test').Page): Promise<Locator> {
  const cards = getByTestId(page, 'category-spending')
  await expect(cards.first()).toBeVisible({ timeout: 10000 })
  const count = await cards.count()
  for (let i = 0; i < count; i++) {
    const card = cards.nth(i)
    if ((await card.getByTestId('category-remaining').count()) > 0) return card
  }
  throw new Error('no budgeted category in the fixture')
}

test.describe('a category card with a budget', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await navigateToRoute(page, 'categories')
  })

  test('draws one divider, not two', async ({ page }) => {
    const card = await budgetedCard(page)

    const borders = await card.evaluate((root) => {
      const drawn: string[] = []
      for (const el of [root, ...root.querySelectorAll('*')]) {
        const cs = getComputedStyle(el)
        if (parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== 'none') {
          drawn.push(`${el.className || el.tagName}`)
        }
      }
      return drawn
    })

    // The block's own rule, separating it from the category header above. Nothing inside it adds
    // a second one under the bar.
    expect(borders).toHaveLength(1)
  })

  test('keeps the budget on one row instead of three', async ({ page }) => {
    const card = await budgetedCard(page)
    const note = card.getByTestId('category-remaining')
    await expect(note).toBeVisible()

    const [header, meter, noteBox] = await Promise.all([
      card.locator('> div').first().boundingBox(),
      card.locator('[role="img"]').boundingBox(),
      note.boundingBox(),
    ])

    // The bar and what-is-left share a row: same vertical centre, side by side.
    expect(
      Math.abs(meter!.y + meter!.height / 2 - (noteBox!.y + noteBox!.height / 2))
    ).toBeLessThan(6)
    expect(noteBox!.x).toBeGreaterThan(meter!.x + meter!.width - 1)

    // Two rows total — the whole block is not much taller than the header plus the meter.
    const blockHeight = (await card.boundingBox())!.height
    expect(blockHeight).toBeLessThan(header!.height + meter!.height + 40)
  })

  test('shows the limit beside the amount it bounds, and what is left beside the bar', async ({
    page,
  }) => {
    const card = await budgetedCard(page)

    // "€0.00 of €500.00" — the limit rides with the spend rather than taking its own line.
    await expect(card).toContainText(/of\s*[^\s]*\d/)
    await expect(card.getByTestId('category-remaining')).toHaveText(/(left|over)$/)
    // The old wording took two whole rows to say the same thing.
    await expect(card).not.toContainText('remaining')
    await expect(card).not.toContainText('limit')
  })

  test('fills the bar in proportion, and never past full', async ({ page }) => {
    const card = await budgetedCard(page)
    const meter = card.locator('[role="img"]')
    const fillWidth = await meter.evaluate((el) => {
      const fill = el.firstElementChild as HTMLElement
      return fill.getBoundingClientRect().width / el.getBoundingClientRect().width
    })
    expect(fillWidth).toBeGreaterThanOrEqual(0)
    expect(fillWidth).toBeLessThanOrEqual(1.001)

    // The bar is a capsule, and slim — it is a reading aid, not a row of its own.
    const box = (await meter.boundingBox())!
    expect(box.height).toBeLessThanOrEqual(14)
    expect(box.width).toBeGreaterThan(40)
  })
})

test.describe('on a phone', () => {
  test.use({ viewport: { width: 360, height: 760 } })

  test('the card does not overflow sideways', async ({ page }) => {
    await login(page)
    await navigateToRoute(page, 'categories')
    const card = await budgetedCard(page)
    const box = (await card.boundingBox())!

    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(360 + 1)
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
    ).toBe(false)
  })
})
