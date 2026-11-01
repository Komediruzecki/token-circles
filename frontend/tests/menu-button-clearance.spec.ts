/**
 * Up to 768 px the menu button is fixed at the top left (x and y 12 to 48). `.main`'s top padding
 * clears it only at the top of the page, so a section scrolled to the top with
 * `scrollIntoView({ block: 'start' })`, a fragment or an element taking focus landed with its
 * heading under the button. On main that is Tags' "Add rule" / "N rules" button, which scrolls the
 * Rules divider (`#tags-sec-rules`) to the top; SectionRail does the same, but only shows from
 * 1280 px. The root's `scroll-padding-top` (Layout.module.css) keeps whatever lands at the top
 * below the button.
 *
 * At 390, a phone, and at 700, where the button still shows: a 640 px breakpoint would miss it.
 * Local-first, so it needs no account; the tag is made in the page.
 */
import { expect, test } from '@playwright/test'
import { E2E_BASE } from './test-helpers'
import type { Locator } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('finance_storage_mode', 'serverless')
  })
})

/** Settled when the box reads the same twice in a row: a smooth scroll has stopped. */
async function settledBox(locator: Locator) {
  let last = ''
  await expect
    .poll(
      async () => {
        const now = JSON.stringify(await locator.boundingBox())
        const same = now === last
        last = now
        return same
      },
      { timeout: 10_000, intervals: [250] }
    )
    .toBe(true)
  return (await locator.boundingBox())!
}

for (const width of [390, 700]) {
  test(`at ${width}, Tags' "Add rule" lands the Rules heading clear of the menu button`, async ({
    page,
  }) => {
    test.setTimeout(90_000)
    await page.setViewportSize({ width, height: 852 })
    await page.goto(`${E2E_BASE}/#tags`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    const newTag = page.getByRole('button', { name: '+ New tag' })
    await expect(newTag).toBeVisible({ timeout: 30_000 })

    await newTag.click()
    await page.getByTestId('tag-name-input').fill(`Scroll check ${width}`)
    await page.getByTestId('tag-form').getByRole('button', { name: 'Create' }).click()
    const addRule = page.locator('[data-test-id^="tag-rules-"]').first()
    await expect(addRule).toBeVisible({ timeout: 10_000 })

    const menu = page.getByRole('button', { name: 'Toggle sidebar' })
    await expect(menu).toBeVisible()
    await addRule.click()

    const heading = page.locator('#tags-sec-rules').getByRole('heading', { name: 'Rules' })
    await expect(heading).toBeVisible()
    const h = await settledBox(heading)
    const m = (await menu.boundingBox())!
    // It did scroll to the top: otherwise clearing the button would prove nothing.
    expect(h.y, 'the Rules heading near the top of the screen').toBeLessThan(120)
    const overlap = {
      x: Math.min(h.x + h.width, m.x + m.width) - Math.max(h.x, m.x),
      y: Math.min(h.y + h.height, m.y + m.height) - Math.max(h.y, m.y),
    }
    expect(
      overlap.x <= 0 || overlap.y <= 0,
      `the heading ${JSON.stringify(h)} and the menu button ${JSON.stringify(m)}`
    ).toBe(true)
  })
}
