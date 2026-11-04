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
 *
 * On a phone with a home indicator the page runs under it (viewport-fit=cover), so the button
 * stands on the safe-area inset and the strip grows by the same amount.
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

/**
 * The controls among `selectors` that a toast lies over: at the centre of each, or 3 px in from a
 * corner, the topmost element is inside the Notifications region.
 */
async function underAToast(page: Page, selectors: string[]): Promise<string[]> {
  return page.evaluate((selectors) => {
    const hits: string[] = []
    for (const selector of selectors) {
      for (const el of Array.from(document.querySelectorAll<HTMLElement>(selector))) {
        const b = el.getBoundingClientRect()
        if (b.width === 0 || b.height === 0 || b.bottom <= 0 || b.top >= innerHeight) continue
        const points = [
          [b.left + b.width / 2, b.top + b.height / 2],
          [b.left + 3, b.top + 3],
          [b.right - 3, b.top + 3],
          [b.left + 3, b.bottom - 3],
          [b.right - 3, b.bottom - 3],
        ]
        const covered = points.some(([x, y]) =>
          document.elementFromPoint(x, y)?.closest('[role="region"][aria-label="Notifications"]')
        )
        const name = el.getAttribute('aria-label') ?? el.dataset.testId ?? el.innerText.trim()
        if (covered) hits.push(`${name.slice(0, 40)} ${JSON.stringify(b.toJSON())}`)
      }
    }
    return hits
  }, selectors)
}

/** The toasts on screen that nothing lies over: at its centre, the topmost element is the toast. */
async function toastsOnTop(page: Page): Promise<number> {
  return page.evaluate(() => {
    const region = document.querySelector('[role="region"][aria-label="Notifications"]')!
    return Array.from(region.children).filter((toast) => {
      const b = toast.getBoundingClientRect()
      const top = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2)
      return b.top >= 0 && b.bottom <= innerHeight && toast.contains(top)
    }).length
  })
}

test("at 390, a badge toast and the history toast cover none of the app's own controls", async ({
  page,
}) => {
  // Phones laid the toasts across the top, so on the first run the history toast ("20 badges and
  // 26 prints from your history so far") lay over the menu button for its 9 s, then over each
  // page's own buttons beside it: Views and Refresh, Add account, the period bar once it pins.
  // With the drawer open they lay over its toggle as well.
  test.setTimeout(120_000)
  await page.addInitScript(() => {
    localStorage.setItem('finance-sticky-period-bar', 'true')
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`${E2E_BASE}/#dashboard`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
  await expect(page.getByTestId('dashboard-header')).toBeVisible({ timeout: 60_000 })
  await expect(page.getByTestId('period-bar')).toBeVisible()
  const toasts = page.getByRole('region', { name: 'Notifications' })
  // The demo's first run earns a run of badges at once and says so; wait for that toast, then put
  // a badge toast beside it, both as core/achievementsStore.ts raises them. The two share a
  // channel, so the app shows one at a time; both are up here, for the tallest pair.
  const history = toasts.locator(':scope > *').filter({ hasText: 'from your history so far.' })
  await expect(history).toBeVisible({ timeout: 30_000 })
  const said = (await history.innerText()).split('\n')[0].trim()
  const label = (await history.locator('button').first().innerText()).trim()
  await page.evaluate(
    async ({ said, label }) => {
      const store = (await import('/src/core/toastStore.ts' as string)) as {
        addToast: (message: string, type: string, opts: unknown) => void
      }
      // Up for the whole check: the app takes them down after 9 s.
      const up = { durationMs: 120_000 }
      store.addToast(said, 'success', {
        ...up,
        channel: 'achievements',
        action: { label, onClick: () => {} },
      })
      store.addToast('Badge unlocked: First budget.', 'success', {
        ...up,
        action: { label: 'See badges', onClick: () => {} },
      })
    },
    { said, label }
  )
  await expect(toasts.locator(':scope > *')).toHaveCount(2)
  await settledBox(toasts.locator(':scope > *').last())

  const chrome = ['button[aria-label="Toggle sidebar"]', 'button[aria-label="Quick add entry"]']
  const top = ['[data-test-id="dashboard-header"] button', '[data-test-id="period-bar"] button']
  expect(await toastsOnTop(page), 'both toasts on screen, and on top').toBe(2)
  expect(await underAToast(page, [...chrome, ...top]), 'Dashboard at rest').toEqual([])

  // Scrolled: the period bar pins under the menu button.
  await page.evaluate(() => window.scrollTo(0, 600))
  await expect
    .poll(async () => Math.round((await page.getByTestId('period-bar').boundingBox())!.y), {
      timeout: 10_000,
    })
    .toBeLessThan(80)
  expect(await toastsOnTop(page)).toBe(2)
  expect(await underAToast(page, [...chrome, ...top]), 'Dashboard, the period bar pinned').toEqual(
    []
  )

  await page.evaluate(() => {
    window.location.hash = 'accounts'
  })
  await expect(page.getByTestId('accounts-header')).toBeVisible({ timeout: 30_000 })
  await expect(toasts.locator(':scope > *')).toHaveCount(2)
  expect(
    await underAToast(page, [...chrome, '[data-test-id="add-account-btn"]']),
    'Accounts at rest'
  ).toEqual([])

  // The drawer open: its links and its toggle, now at its top right.
  await page.getByRole('button', { name: 'Toggle sidebar' }).click()
  await expect(page.locator('[data-test-id^="nav-link-"]').first()).toBeInViewport()
  await page.waitForTimeout(400)
  expect(
    await underAToast(page, ['[data-test-id^="nav-link-"]', 'button[aria-label="Toggle sidebar"]']),
    'the drawer open'
  ).toEqual([])
})

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

test.describe('on a phone with a home indicator (a 34 px bottom inset)', () => {
  // viewport-fit=cover runs the page under an iPhone's home indicator, a strip the system keeps
  // for its swipe home; controls belong above it. Chromium's inset override stands in for the phone.
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Emulation.setSafeAreaInsetsOverride', {
      insets: {
        top: 47,
        topMax: 47,
        left: 0,
        leftMax: 0,
        bottom: 34,
        bottomMax: 34,
        right: 0,
        rightMax: 0,
      },
    })
  })

  test('the quick add button stands above the inset', async ({ page }) => {
    test.setTimeout(90_000)
    await page.goto(`${E2E_BASE}/#settings`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await expect(page.getByTestId('settings-header')).toBeVisible({ timeout: 30_000 })
    const fab = await settledBox(page.getByRole('button', { name: 'Quick add entry' }))
    // 16 px off the bottom on a phone, counted from the top of the inset.
    expect(844 - (fab.y + fab.height)).toBeGreaterThanOrEqual(34 + 16)
  })

  test('a control scrolled into view from below, and the end of the page, stay clear of it', async ({
    page,
  }) => {
    test.setTimeout(90_000)
    await page.goto(`${E2E_BASE}/#settings`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await expect(page.getByTestId('settings-header')).toBeVisible({ timeout: 30_000 })
    await page.waitForTimeout(1000)
    const fab = await settledBox(page.getByRole('button', { name: 'Quick add entry' }))
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
    await toTheEnd(page)
    expect(await under(page, 'Quick add entry'), '#settings at its end').toEqual([])
  })
})
