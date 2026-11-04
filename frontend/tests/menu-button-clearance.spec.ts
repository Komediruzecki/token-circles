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
 *
 * The quick add button floats at the bottom right at every width (Layout.module.css `.fab`).
 * `.main`'s bottom padding was 12 to 24 px, so the end of a page could never be scrolled out from
 * under it: Import's "No saved sheets yet" note, the last line of Settings. The page now ends far
 * enough below its last line, and the root's `scroll-padding-bottom` keeps whatever is scrolled
 * into view at the bottom, a control taking focus among them, above the button.
 */
import { expect, test } from '@playwright/test'
import { E2E_BASE } from './test-helpers'
import type { Locator, Page } from '@playwright/test'

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

/** The visible text and controls in the page whose boxes overlap the button named `label`. */
async function under(page: Page, label: string): Promise<string[]> {
  return page.evaluate((name) => {
    const button = document.querySelector(`button[aria-label="${name}"]`)!
    const b = button.getBoundingClientRect()
    const hits: string[] = []
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('main *'))) {
      const style = getComputedStyle(el)
      if (style.visibility === 'hidden' || Number(style.opacity) === 0) continue
      const control = el.matches('a, button, input, select, textarea')
      const text = Array.from(el.childNodes).some(
        (n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim() !== ''
      )
      if (!control && !text) continue
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) continue
      // Scrolled out of view inside an inner scroller is not under the button.
      let clipped = false
      for (let n = el.parentElement; n && !clipped; n = n.parentElement) {
        if (getComputedStyle(n).overflow === 'visible') continue
        const c = n.getBoundingClientRect()
        clipped = r.bottom <= c.top || r.top >= c.bottom || r.right <= c.left || r.left >= c.right
      }
      if (clipped) continue
      const x = Math.min(r.right, b.right) - Math.max(r.left, b.left)
      const y = Math.min(r.bottom, b.bottom) - Math.max(r.top, b.top)
      if (x > 0 && y > 0) hits.push(`${el.tagName} "${el.innerText.trim().slice(0, 40)}"`)
    }
    return hits
  }, label)
}

/** Scrolled as far down as the page goes, and settled there. */
async function toTheEnd(page: Page): Promise<void> {
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          window.scrollTo(0, document.documentElement.scrollHeight)
          return (
            Math.ceil(window.scrollY + window.innerHeight) >= document.documentElement.scrollHeight
          )
        }),
      { timeout: 10_000, intervals: [250] }
    )
    .toBe(true)
}

for (const width of [390, 1280]) {
  test(`at ${width}, the end of a page scrolls out from under the quick add button`, async ({
    page,
  }) => {
    test.setTimeout(90_000)
    await page.setViewportSize({ width, height: width < 768 ? 844 : 800 })
    for (const [hash, ready] of [
      ['import', 'import-header'],
      ['settings', 'settings-header'],
    ] as const) {
      await page.goto(`${E2E_BASE}/#${hash}`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
      await expect(page.getByTestId(ready)).toBeVisible({ timeout: 30_000 })
      // Sections below the header render as their reads land.
      await page.waitForTimeout(1000)
      await expect(page.getByRole('button', { name: 'Quick add entry' })).toBeVisible()
      await toTheEnd(page)
      expect(await under(page, 'Quick add entry'), `#${hash} at its end`).toEqual([])
    }
  })

  test(`at ${width}, a control scrolled into view from below lands above the quick add button`, async ({
    page,
  }) => {
    test.setTimeout(90_000)
    await page.setViewportSize({ width, height: width < 768 ? 844 : 800 })
    await page.goto(`${E2E_BASE}/#settings`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await expect(page.getByTestId('settings-header')).toBeVisible({ timeout: 30_000 })
    await page.waitForTimeout(1000)
    const fab = (await page.getByRole('button', { name: 'Quick add entry' }).boundingBox())!
    // The last control on the page, brought up from below the way the prints shelf brings a
    // print into view ('nearest'): its bottom edge stops at the root's scroll-padding-bottom.
    await page.evaluate(() => window.scrollTo(0, 0))
    const box = await page.evaluate(async () => {
      const visible = Array.from(
        document.querySelectorAll<HTMLElement>('main button, main a[href], main input, main select')
      ).filter((el) => el.getBoundingClientRect().height > 0)
      const last = visible[visible.length - 1]
      last.scrollIntoView({ block: 'nearest' })
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      const r = last.getBoundingClientRect()
      return { top: Math.round(r.top), bottom: Math.round(r.bottom), scrolled: window.scrollY }
    })
    expect(box.scrolled, 'it was below the screen').toBeGreaterThan(0)
    expect(
      box.bottom,
      `the control ${JSON.stringify(box)} and the button at ${fab.y}`
    ).toBeLessThanOrEqual(fab.y)
  })
}
