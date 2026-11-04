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

type ToastStore = {
  toasts: () => { id: number; message: string }[]
  addToast: (message: string, type: string, opts: unknown) => void
  removeToast: (id: number) => void
}

/** The quick add sheet, opened from the floating button, its keypad settled where it rests. */
async function openTheSheet(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: 'Quick add entry' }).click()
  const sheet = page.getByRole('dialog', { name: 'Add transaction' })
  await settledBox(sheet.getByRole('button', { name: '0', exact: true }))
  return sheet
}

/** The sheet's last step for 42.00 in its first category, settled: its Add button. */
async function toTheLastStep(sheet: Locator): Promise<Locator> {
  for (const key of ['4', '2']) await sheet.getByRole('button', { name: key, exact: true }).click()
  await sheet.getByRole('button', { name: 'Next', exact: true }).click()
  await sheet.getByTestId('orbit-category').first().click()
  const add = sheet.getByRole('button', { name: /^Add / })
  await settledBox(add)
  return add
}

/** A tap at the middle of `target`, on whatever lies there, the way a finger lands. */
async function tapTheMiddleOf(page: Page, target: Locator): Promise<void> {
  const b = (await target.boundingBox())!
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2)
}

test.describe('at 390, the toasts while the quick add sheet or a form is open', () => {
  // Above the quick add button the toasts lay over the lower half of whatever was open: the
  // sheet's keypad and its Add button, a form's last fields. While a dialog is open they show at
  // the top of the screen instead, above its overlay (Toast.module.css), and back above the
  // button once it closes.
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`${E2E_BASE}/#transactions`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await expect(page.getByTestId('transactions-header')).toBeVisible({ timeout: 60_000 })
    // The demo's first run says what it earned from its history. Let it, then take it down, so
    // only the toasts each check raises are up.
    const toasts = page.getByRole('region', { name: 'Notifications' })
    await expect(
      toasts.locator(':scope > *').filter({ hasText: 'from your history so far.' })
    ).toBeVisible({ timeout: 30_000 })
    await page.evaluate(async () => {
      const store = (await import('/src/core/toastStore.ts' as string)) as ToastStore
      for (const shown of store.toasts()) store.removeToast(shown.id)
    })
    await expect(toasts.locator(':scope > *')).toHaveCount(0)
    // The sheet, the command bar and this page's form stay in the page while closed: none of them
    // may say it is open now, or the toasts would leave the quick add button for good.
    await expect(page.locator('[aria-modal="true"]'), 'no dialog open at rest').toHaveCount(0)
  })

  test('with "Entry added" up, the sheet opened again takes 1, 8, 0 as 180.00', async ({
    page,
  }) => {
    test.setTimeout(120_000)
    const toasts = page.getByRole('region', { name: 'Notifications' })
    let sheet = await openTheSheet(page)
    await (await toTheLastStep(sheet)).click()
    const added = toasts.locator(':scope > *').filter({ hasText: 'Entry added' })
    await expect(added).toBeVisible()
    // The app takes it down after 5 s. Hold the same toast up for the whole check, so a slow run
    // cannot pass because it had already gone.
    await page.evaluate(async () => {
      const store = (await import('/src/core/toastStore.ts' as string)) as ToastStore
      for (const shown of store.toasts()) {
        if (shown.message === 'Entry added') store.removeToast(shown.id)
      }
      store.addToast('Entry added', 'success', { durationMs: 120_000 })
    })
    await expect(added).toHaveCount(1)

    // The next entry straight away, each key tapped at its middle.
    sheet = await openTheSheet(page)
    for (const key of ['1', '8', '0']) {
      await tapTheMiddleOf(page, sheet.getByRole('button', { name: key, exact: true }))
    }
    await expect(added, 'still up after the taps').toBeVisible()
    await expect(sheet.getByText(/^€180\.00$/), 'the amount the keys spell').toBeVisible()
    expect(
      await underAToast(page, ['[role="dialog"][aria-label="Add transaction"] button']),
      "the sheet's buttons"
    ).toEqual([])

    // Closed again, the toast goes back down to just above the quick add button.
    await sheet.getByRole('button', { name: 'Close' }).click()
    const fab = (await page.getByRole('button', { name: 'Quick add entry' }).boundingBox())!
    await expect
      .poll(async () => {
        const b = (await added.boundingBox())!
        return b.y > 844 / 2 && b.y + b.height <= fab.y
      })
      .toBe(true)
  })

  test("the sheet's own failed-save toast covers none of its last step's buttons", async ({
    page,
  }) => {
    test.setTimeout(120_000)
    const sheet = await openTheSheet(page)
    const add = await toTheLastStep(sheet)
    // Local-first keeps the entry in IndexedDB: the write is refused, as a full disk refuses it.
    await page.evaluate(() => {
      const refuse = () => {
        throw new DOMException('The disk is full.', 'QuotaExceededError')
      }
      IDBObjectStore.prototype.add = refuse
      IDBObjectStore.prototype.put = refuse
    })
    await add.click()
    const failed = page.getByRole('region', { name: 'Notifications' }).getByRole('alert')
    await expect(failed.first()).toBeVisible()
    await settledBox(failed.first())
    await expect(add, 'the sheet stays on its last step').toBeVisible()
    expect(await toastsOnTop(page), 'the toast on top').toBeGreaterThanOrEqual(1)
    expect(
      await underAToast(page, [
        '[role="dialog"][aria-label="Add transaction"] button',
        '[role="dialog"][aria-label="Add transaction"] input',
      ]),
      "the last step's buttons and fields"
    ).toEqual([])
  })

  test('with the Add transaction form open, two toasts cover none of its lower controls', async ({
    page,
  }) => {
    test.setTimeout(120_000)
    await page.getByTestId('add-transaction-btn').click()
    await settledBox(page.getByTestId('tx-save-btn'))
    await page.evaluate(async () => {
      const store = (await import('/src/core/toastStore.ts' as string)) as ToastStore
      store.addToast('Could not save: the amount must be a number above zero.', 'error', {
        durationMs: 120_000,
      })
      store.addToast('Badge unlocked: First budget.', 'success', {
        durationMs: 120_000,
        action: { label: 'See badges', onClick: () => {} },
      })
    })
    const toasts = page.getByRole('region', { name: 'Notifications' })
    await expect(toasts.locator(':scope > *')).toHaveCount(2)
    await settledBox(toasts.locator(':scope > *').last())
    expect(await toastsOnTop(page), 'both toasts on top').toBe(2)
    // What the stack lay over above the quick add button: the account, the advanced options, the
    // form's own buttons.
    const lower = ['tx-account', 'tx-advanced-toggle', 'tx-cancel-btn', 'tx-save-btn']
    expect(
      await underAToast(
        page,
        lower.map((id) => `[data-test-id="${id}"]`)
      ),
      'the lower half of the form'
    ).toEqual([])
  })
})

test('at rest, no page holds a dialog that says it is open or that an update waits for', async ({
  page,
}) => {
  // Some dialogs stay in the page while closed (the quick add sheet, the command bar, Bills'
  // subscription catalog and scan, Transactions' form, Auto Categorize, Reconciliation). One that
  // said aria-modal="true" while closed would keep the toasts at the top for good, on its page and,
  // as pages stay mounted, on every page after it.
  //
  // The update reload waits while a dialog is open (appVersion.ts `userIsMidEntry`), and it reads
  // a dialog's own computed style. One given role="dialog" that is hidden only by its parent's
  // display: none reads as open, and the update would wait for good the same way.
  test.setTimeout(150_000)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`${E2E_BASE}/#dashboard`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
  await expect(page.getByTestId('dashboard-header')).toBeVisible({ timeout: 60_000 })
  const pages = [
    'dashboard',
    'transactions',
    'budgets',
    'loans',
    'goals',
    'bills',
    'progress',
    'rentBuy',
    'compound',
    'emergency',
    'import',
    'accounts',
    'categories',
    'settings',
    'retirement',
    'housing',
    'analytics',
    'counterparties',
    'portfolio',
    'tags',
  ]
  const open: string[] = []
  const waiting: string[] = []
  for (const name of pages) {
    await page.evaluate((hash) => {
      window.location.hash = hash
    }, name)
    // Mounted, its reads landed and its dialogs rendered.
    await page.waitForTimeout(1500)
    const labels = await page
      .locator('[aria-modal="true"]')
      .evaluateAll((els) =>
        els.map(
          (el) =>
            el.getAttribute('aria-label') ||
            document
              .getElementById(el.getAttribute('aria-labelledby') ?? '')
              ?.textContent?.trim() ||
            el.tagName
        )
      )
    for (const label of labels) open.push(`#${name}: ${label}`)
    // Asked with nothing focused: a focused field is the other thing it waits for.
    const waits = await page.evaluate(async () => {
      ;(document.activeElement as HTMLElement | null)?.blur()
      const version = (await import('/src/core/appVersion.ts' as string)) as {
        userIsMidEntry: () => boolean
      }
      return version.userIsMidEntry()
    })
    if (waits) waiting.push(`#${name}`)
  }
  expect.soft(open, 'dialogs that say they are open, with every page mounted').toEqual([])
  expect(waiting, 'pages where an update waits for a dialog nobody opened').toEqual([])
})

// The forms each page opens over itself, by the button a person taps and the heading that names
// the form. Every one of them sends the toasts to the top while it is open, the same way.
const FORMS = [
  { hash: 'accounts', opener: 'add-account-btn', name: 'Add Account' },
  { hash: 'bills', opener: 'add-bill-btn', name: 'Add Bill' },
  { hash: 'categories', opener: 'add-category-btn', name: 'Add Category' },
  { hash: 'portfolio', opener: 'add-holding-btn', name: 'Add Holding' },
  { hash: 'dashboard', opener: 'dashboard-views', name: 'Dashboard Views' },
] as const

for (const form of FORMS) {
  test(`at 390, ${form.name} on #${form.hash} sends a toast to the top while it is open`, async ({
    page,
  }) => {
    test.setTimeout(90_000)
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`${E2E_BASE}/#${form.hash}`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await expect(page.getByTestId(`${form.hash}-header`)).toBeVisible({ timeout: 60_000 })
    await expect(page.locator('[aria-modal="true"]'), 'no dialog open at rest').toHaveCount(0)

    await page.getByTestId(form.opener).click()
    const dialog = page.getByRole('dialog', { name: form.name })
    await expect(dialog).toHaveAttribute('aria-modal', 'true')
    await page.evaluate(async () => {
      const store = (await import('/src/core/toastStore.ts' as string)) as ToastStore
      store.addToast('Could not save: the amount must be a number above zero.', 'error', {
        durationMs: 120_000,
      })
    })
    const toasts = page.getByRole('region', { name: 'Notifications' })
    const region = await settledBox(toasts)
    expect(region.y, 'the toasts at the top of the screen').toBeLessThan(60)
    expect(await toastsOnTop(page), 'every toast on top').toBe(
      await toasts.locator(':scope > *').count()
    )
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
