/**
 * The 3 Nov design review's accessibility findings, measured on the screen at 390x844.
 *
 * - D2: the phone Dashboard's controls were under 44px: Toggle sidebar 36x36, Views and Refresh
 *   39 tall, the period arrows 34x34 and the month 34 tall, the pills 33 (with "All" alone on
 *   the month row), "See all" 58x25, the info buttons 24x24, the card links 18 tall and Show more
 *   36.
 * - D3: the Import page's columns view: the mapping selects 38 tall, the Expense, Income and
 *   Account toggles 28, the row checkboxes 13x13, and the expected-columns samples cut by an
 *   ellipsis.
 * - D6: the sign-in stages: the buttons 37 tall, the links about 20 and Privacy and Terms 17.
 * - A toast's action was 27 tall.
 * - D8: badge names and dates, "primary", the tagline and the Settings "General" label were 9.5
 *   to 11px.
 * - D1: words in a brand colour in the light theme, from 2.58:1 to 4.40:1.
 * - Quick entry: the bar's fields were 19 to 24 tall and its toggles 28; the guided sheet a tap
 *   opens had Close 30x30, Cancel, Back and Next 35 to 40, and its date and note fields 20.
 * - The profile menu's checkboxes were 16x16 with no name; the Import preview's had no name.
 * - The guided sheet's date and note fields had no name: the words beside them were plain text.
 *
 * A target is measured by its hit area, not its box: the pixels across its middle where a tap
 * lands on it (elementFromPoint), so a ring drawn by ::before counts and a neighbour on top does
 * not. Contrast is the element's colour, through its opacity, over the backgrounds behind it.
 */
import { expect, test } from '@playwright/test'
import { bootApp, openSignIn } from './boot'
import { E2E_BASE } from './e2e-constants'
import { gotoServerless } from './test-helpers'
import type { Locator, Page } from '@playwright/test'

const PHONE = { width: 390, height: 844 }

test.use({ viewport: PHONE, hasTouch: true, isMobile: true })

/**
 * The width and height of the area a tap lands on `target`: its box, grown by a `::before` ring
 * drawn outside it, when a tap a pixel inside each edge of that area, across its middle, lands on
 * the target. When one does not (a neighbour on top, an ancestor clipping the ring), it is 0 that
 * way, so a covered or clipped target fails.
 */
async function hitArea(target: Locator): Promise<{ w: number; h: number }> {
  return target.evaluate((el) => {
    el.scrollIntoView({ block: 'center', inline: 'center' })
    const r = el.getBoundingClientRect()
    let [top, right, bottom, left] = [r.top, r.right, r.bottom, r.left]
    const ring = getComputedStyle(el, '::before')
    if (ring.content !== 'none' && ring.position === 'absolute') {
      const px = (v: string) => (v.endsWith('px') ? parseFloat(v) : 0)
      top = Math.min(top, r.top + px(ring.top))
      left = Math.min(left, r.left + px(ring.left))
      bottom = Math.max(bottom, r.bottom - px(ring.bottom))
      right = Math.max(right, r.right - px(ring.right))
    }
    const cx = r.left + r.width / 2
    const cy = r.top + r.height / 2
    const lands = (x: number, y: number) => {
      const at = document.elementFromPoint(x, y)
      return at !== null && (at === el || el.contains(at))
    }
    const across = lands(left + 1, cy) && lands(right - 1, cy) && lands(cx, cy)
    const down = lands(cx, top + 1) && lands(cx, bottom - 1)
    const round = (v: number) => Math.round(v * 10) / 10
    return { w: across ? round(right - left) : 0, h: down ? round(bottom - top) : 0 }
  })
}

async function expectFingertip(target: Locator, name: string) {
  await expect(target, name).toBeVisible()
  const { w, h } = await hitArea(target)
  expect(h, `${name}: hit area ${w}x${h}`).toBeGreaterThanOrEqual(44)
  expect(w, `${name}: hit area ${w}x${h}`).toBeGreaterThanOrEqual(44)
}

/** Contrast of the element's text over what is behind it; `size` is its font size in px. */
async function contrastOf(target: Locator): Promise<{ ratio: number; size: number }> {
  return target.evaluate((el) => {
    type C = { r: number; g: number; b: number; a: number }
    const parse = (s: string): C | null => {
      const m = /rgba?\(([^)]+)\)/.exec(s)
      if (!m) return null
      const p = m[1]
        .split(/[ ,/]+/)
        .filter(Boolean)
        .map(Number)
      return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }
    }
    const over = (top: C, under: C): C => ({
      r: top.r * top.a + under.r * (1 - top.a),
      g: top.g * top.a + under.g * (1 - top.a),
      b: top.b * top.a + under.b * (1 - top.a),
      a: 1,
    })
    const lum = (c: C) => {
      const f = (v: number) => {
        const s = v / 255
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
      }
      return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b)
    }
    const layers: C[] = []
    for (let e: Element | null = el; e; e = e.parentElement) {
      const c = parse(getComputedStyle(e).backgroundColor)
      if (c && c.a > 0) {
        layers.push(c)
        if (c.a >= 1) break
      }
    }
    let ground: C = { r: 255, g: 255, b: 255, a: 1 }
    for (const layer of layers.reverse()) ground = over(layer, ground)
    let opacity = 1
    for (let e: Element | null = el; e; e = e.parentElement)
      opacity *= Number(getComputedStyle(e).opacity)
    const ink = parse(getComputedStyle(el).color)!
    const text = over({ ...ink, a: ink.a * opacity }, ground)
    const [hi, lo] = [lum(text), lum(ground)].sort((a, b) => b - a)
    return {
      ratio: Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100,
      size: parseFloat(getComputedStyle(el).fontSize),
    }
  })
}

async function expectReadable(target: Locator, name: string) {
  const { ratio } = await contrastOf(target)
  expect(ratio, `${name}: ${ratio}:1`).toBeGreaterThanOrEqual(4.5)
}

async function fontSize(target: Locator): Promise<number> {
  return target.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
}

/** Every match, after the first is on the page: a loop over none would prove nothing. */
async function each(target: Locator, what: string): Promise<Locator[]> {
  await expect(target.first(), what).toBeAttached({ timeout: 15_000 })
  return target.all()
}

/**
 * The font size of every match, read in one pass: a badge list re-renders when an evaluation
 * lands, and an element read on its own after that was detached (its size read NaN).
 */
async function sizesOf(target: Locator, what: string): Promise<{ text: string; size: number }[]> {
  await expect(target.first(), what).toBeAttached({ timeout: 15_000 })
  return target.evaluateAll((els) =>
    els.map((el) => ({
      text: (el.textContent ?? '').trim(),
      size: parseFloat(getComputedStyle(el).fontSize),
    }))
  )
}

async function lightTheme(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('finance-theme', 'light')
  })
}

/**
 * Let the app's badge evaluation finish, then clear the toasts it raised. On a fresh database the
 * fixture earns its badges on the first page it opens, and on a phone that toast is a banner across
 * the top for 9 s, over Toggle sidebar and the period bar: CI on one core read "Toggle sidebar: hit
 * area 0x0", and locally, with the badges cleared and the run on one core, a period pill read 0x0.
 * Targets are measured with no toast up; a toast's own action is measured in its own test.
 */
async function noToasts(page: Page) {
  await page.evaluate(
    async ([badgesPath, toastsPath]) => {
      type Badges = { refreshAchievements: () => Promise<unknown> }
      type Toasts = { toasts: () => { id: number }[]; removeToast: (id: number) => void }
      // Joins the evaluation the app started, and resolves once it has saved and announced.
      await ((await import(/* @vite-ignore */ badgesPath)) as Badges).refreshAchievements()
      const store = (await import(/* @vite-ignore */ toastsPath)) as Toasts
      for (const item of store.toasts()) store.removeToast(item.id)
    },
    ['/src/core/achievementsStore.ts', '/src/core/toastStore.ts']
  )
  await expect(page.locator('[class*="toastContainer"] > *')).toHaveCount(0)
}

test.describe('the phone Dashboard @smoke', () => {
  test('every control is a fingertip, and "All" sits in the pill row', async ({ page }) => {
    await page.goto(`${E2E_BASE}/#dashboard`)
    await expect(page.getByTestId('dashboard-views')).toBeVisible({ timeout: 30_000 })
    await noToasts(page)

    await expectFingertip(page.getByRole('button', { name: 'Toggle sidebar' }), 'Toggle sidebar')
    await expectFingertip(page.getByTestId('dashboard-views'), 'Views')
    await expectFingertip(page.getByTestId('dashboard-refresh'), 'Refresh')
    await expectFingertip(page.getByTestId('period-prev'), 'Previous period')
    await expectFingertip(page.getByTestId('period-label'), 'the month')
    await expectFingertip(page.getByTestId('period-next'), 'Next period')

    const pills = page.locator('[data-test-id^="period-pill-"]')
    await expect(pills).toHaveCount(6)
    for (const pill of await pills.all())
      await expectFingertip(pill, `pill ${await pill.innerText()}`)
    // Read in one pass: the bar can re-render between two separate reads, and a pill read on its
    // own then had no box.
    const tops = await pills.evaluateAll((els) =>
      els.map((el) => Math.round(el.getBoundingClientRect().y))
    )
    expect(new Set(tops).size, `the six pills share one row: ${tops.join(', ')}`).toBe(1)

    await expectFingertip(page.getByTestId('badges-see-all'), 'See all')
    for (const info of await each(page.locator('[class*="metric-label"] button'), 'info'))
      await expectFingertip(info, 'an info button')
    for (const link of await each(page.locator('[class*="panelMore"]'), 'card links'))
      await expectFingertip(link, `card link ${await link.innerText()}`)
    await expectFingertip(page.getByTestId('dashboard-show-more'), 'Show more')
  })

  test('words are 12px and up, and brand-coloured words read 4.5:1 in the light theme', async ({
    page,
  }) => {
    await lightTheme(page)
    await page.goto(`${E2E_BASE}/#dashboard`)
    await expect(page.getByTestId('dashboard-views')).toBeVisible({ timeout: 30_000 })
    await noToasts(page)

    const rail = page.getByTestId('badge-rail')
    await expect(rail.locator('li').first()).toBeVisible()
    for (const { text, size } of await sizesOf(rail.locator('li span'), 'item'))
      expect(size, `badge "${text}"`).toBeGreaterThanOrEqual(12)
    expect(await fontSize(page.getByText('Your money, in clear orbit')), 'the tagline').toBe(12)

    for (const trend of await each(page.locator('[class*="trendDelta"]'), 'trend'))
      await expectReadable(trend, `trend ${await trend.innerText()}`)
    for (const kpi of await each(page.locator('[class*="metric-value"]'), 'kpi'))
      await expectReadable(kpi, `KPI ${await kpi.innerText()}`)
    await expectReadable(page.getByTestId('dashboard-refresh'), 'Refresh')
    for (const link of await each(page.locator('[class*="panelMore"]'), 'link'))
      await expectReadable(link, `card link ${await link.innerText()}`)
    for (const label of await each(page.locator('[class*="sidebarGroupHeader"] > span'), 'label'))
      await expectReadable(label, `sidebar group ${await label.textContent()}`)

    await page.getByRole('button', { name: 'Toggle sidebar' }).click()
    await page.getByTestId('profile-dropdown-btn').click()
    const primary = page.getByText('primary', { exact: true })
    await expect(primary).toBeVisible()
    expect(await fontSize(primary), '"primary"').toBeGreaterThanOrEqual(12)
    await expectReadable(primary, '"primary"')
  })

  test('quick entry is fingertips: the guided sheet a tap opens and the bar behind ⌘K', async ({
    page,
  }) => {
    await page.goto(`${E2E_BASE}/#dashboard`)
    await expect(page.getByTestId('dashboard-views')).toBeVisible({ timeout: 30_000 })
    await noToasts(page)

    // A tap on the plus opens the guided sheet: amount, then category, then the summary.
    await page.getByRole('button', { name: 'Quick add entry' }).click()
    const sheet = page.getByRole('dialog', { name: 'Add transaction' })
    const sheetButton = (name: string) => sheet.getByRole('button', { name, exact: true })
    await expect(sheet).toBeVisible()
    for (const name of ['Close', 'Expense', 'Income', 'Cancel'])
      await expectFingertip(sheetButton(name), `the sheet's ${name}`)
    await sheetButton('4').click()
    await expectFingertip(sheetButton('Next'), "the sheet's Next")
    await sheetButton('Next').click()
    await sheet.locator('[class*="catChip"]').first().click()
    const next = sheetButton('Next')
    if (await next.isVisible()) await next.click()
    // Found by their labels: each field is named by the word beside it.
    await expectFingertip(sheet.getByLabel('Date', { exact: true }), "the sheet's date")
    await expectFingertip(sheet.getByLabel('Note', { exact: true }), "the sheet's note")
    await expectFingertip(sheetButton('Back'), "the sheet's Back")
    await sheetButton('Close').click()
    await expect(
      page.locator('[class*="overlay"]:has([aria-label="Add transaction"])')
    ).not.toHaveClass(/open/)

    // The one-line bar, on a phone with a keyboard.
    await page.keyboard.press('Control+k')
    const bar = page.getByRole('textbox', { name: 'Quick entry' })
    await expect(bar).toBeVisible()
    // The bar scales in from 0.99; measure it once it has landed.
    await bar.evaluate((el) =>
      Promise.all(
        el
          .closest('[role="dialog"]')!
          .getAnimations({ subtree: true })
          .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
          .map((a) => a.finished)
      )
    )
    await expectFingertip(bar, 'the bar')
    for (const name of ['Category', 'Account'])
      await expectFingertip(page.getByRole('combobox', { name }), `the bar's ${name}`)
    const commandBar = page.getByRole('dialog', { name: 'Quick entry command bar' })
    await expectFingertip(commandBar.getByLabel('Date', { exact: true }), "the bar's date")
    for (const name of ['Expense', 'Income', 'Add entry'])
      await expectFingertip(page.getByRole('button', { name, exact: true }), `the bar's ${name}`)
  })

  test("the profile menu's checkboxes are fingertips and say which profile", async ({ page }) => {
    await page.goto(`${E2E_BASE}/#dashboard`)
    await expect(page.getByTestId('dashboard-views')).toBeVisible({ timeout: 30_000 })
    await noToasts(page)
    await page.getByRole('button', { name: 'Toggle sidebar' }).click()
    await page.getByTestId('profile-dropdown-btn').click()
    const rows = await each(page.locator('[data-profile-id]'), 'profile rows')
    for (const row of rows) {
      const name = (await row.locator('span').first().innerText()).trim()
      const box = row.getByRole('checkbox', { name: `Include ${name}`, exact: true })
      await expect(box, `the ${name} checkbox`).toBeVisible()
      await expectFingertip(row.locator('label'), `the ${name} checkbox`)
    }
  })

  test("a toast's action is a fingertip", async ({ page }) => {
    await page.goto(`${E2E_BASE}/#dashboard`)
    await expect(page.getByTestId('dashboard-views')).toBeVisible({ timeout: 30_000 })
    await noToasts(page)
    // The app's own toast store, through the dev server's module graph: the same instance the
    // app renders from.
    await page.evaluate(async (path) => {
      type Store = { addToast: (message: string, type: string, opts: object) => void }
      const store = (await import(/* @vite-ignore */ path)) as Store
      store.addToast('New badge', 'success', {
        durationMs: 60_000,
        action: { label: 'See badges', onClick: () => undefined },
      })
    }, '/src/core/toastStore.ts')
    await expectFingertip(page.getByRole('button', { name: 'See badges' }), 'See badges')
  })
})

test.describe('the phone Progress @smoke', () => {
  test('Toggle sidebar is a fingertip here too, and the badge names and dates are 12px', async ({
    page,
  }) => {
    await page.goto(`${E2E_BASE}/#progress`)
    await expect(page.getByTestId('progress-header')).toBeVisible({ timeout: 30_000 })
    await noToasts(page)
    await expectFingertip(page.getByRole('button', { name: 'Toggle sidebar' }), 'Toggle sidebar')
    const timeline = page.getByTestId('badge-timeline')
    const words = timeline.locator('li [class*="when"], li [class*="name"]')
    for (const { text, size } of await sizesOf(words, 'timeline words'))
      expect(size, `"${text}"`).toBeGreaterThanOrEqual(12)
  })
})

test.describe('the phone Settings @smoke', () => {
  test('the section labels are 12px, and the moved tag reads in the light theme', async ({
    page,
  }) => {
    await lightTheme(page)
    await page.goto(`${E2E_BASE}/#settings`)
    await expect(page.getByTestId('settings-header')).toBeVisible({ timeout: 30_000 })
    await noToasts(page)
    const tabs = page.locator('[data-test-id^="settings-tab-"] small')
    expect(await tabs.count()).toBeGreaterThan(0)
    for (const tab of await tabs.all())
      expect(await fontSize(tab), `"${await tab.innerText()}"`).toBeGreaterThanOrEqual(12)
    await expectReadable(page.getByText('PDF reports moved to Exports'), 'the moved tag')
  })
})

test.describe('the phone Import columns view @smoke', () => {
  const PASTED_CSV = [
    'Date,Description,Amount,Category,Type',
    '2026-07-01,A11y Test Salary,2000.00,Salary,income',
    '2026-07-02,A11y Test Groceries,-52.30,Groceries,expense',
  ].join('\n')

  test('selects, toggles and row checkboxes are fingertips, and the samples wrap', async ({
    page,
  }) => {
    await lightTheme(page)
    await gotoServerless(page, 'import', 'import-header')
    await noToasts(page)

    const samples = page.locator('[data-test-id="import-expected-columns"] td')
    expect(await samples.count()).toBeGreaterThan(0)
    for (const cell of await samples.all()) {
      const clipped = await cell.evaluate((td) => td.scrollWidth > td.clientWidth + 1)
      expect(clipped, `"${await cell.innerText()}" fits its cell`).toBe(false)
    }
    await expectReadable(page.locator('button[class*="tab"][class*="active"]').first(), 'tab')

    await page.getByTestId('import-tab-paste-csv').click()
    await page.getByTestId('import-paste-textarea').fill(PASTED_CSV)
    await page.getByTestId('import-paste-parse').click()
    await page.getByTestId('import-continue-mapping').click()

    for (const key of ['date', 'description', 'amount'])
      await expectFingertip(page.getByTestId(`import-map-${key}`), `the ${key} select`)
    for (const required of await each(page.locator('[class*="required"]'), 'required'))
      await expectReadable(required, 'a required asterisk')
    for (const name of ['Expense', 'Income', 'Account']) {
      const toggle = page.getByRole('button', { name, exact: true }).first()
      await expectFingertip(toggle, `the ${name} toggle`)
    }
    // One of each pill on: Salary is income, Groceries an expense, and one taken as an account.
    await page.getByRole('button', { name: 'Account', exact: true }).last().click()
    for (const active of await each(page.locator('[class*="Active"][class*="pill"]'), 'active'))
      await expectReadable(active, `the ${await active.innerText()} pill, on`)

    await page.getByTestId('import-continue-preview').click()
    const boxes = page.locator('table input[type="checkbox"]')
    await expect(boxes.first()).toBeVisible({ timeout: 15_000 })
    for (const box of await boxes.all())
      await expectFingertip(box.locator('xpath=..'), "a row's checkbox")

    // Each box says what it does: select every row, or import this one (its row in the file).
    await expect(page.getByRole('checkbox', { name: 'Select all rows', exact: true })).toBeVisible()
    for (const name of [
      'Import row 2: 2026-07-01 · A11y Test Salary · 2000.00',
      'Import row 3: 2026-07-02 · A11y Test Groceries · -52.30',
    ])
      await expect(page.getByRole('checkbox', { name, exact: true }), name).toBeVisible()
  })
})

test.describe('the phone sign-in @smoke', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test('every stage has fingertip buttons and links, and the version reads on one line', async ({
    page,
    context,
  }) => {
    await bootApp(context, 'server')
    await openSignIn(page, 'server', E2E_BASE)
    const footer = page.getByTestId('sign-in-footer')
    const button = (name: string) => page.getByRole('button', { name, exact: true })

    const footerTargets = async (stage: string) => {
      const links = await footer.locator('a').all()
      expect(links.length, `${stage}: Contact support, Privacy, Terms`).toBe(3)
      for (const link of links)
        await expectFingertip(link, `${stage}: footer "${await link.innerText()}"`)
    }

    // Sign in.
    await expectFingertip(page.locator('button[type="submit"]'), 'Sign in')
    for (const name of ['Continue with Google', 'Email me a sign-in code', 'Create one'])
      await expectFingertip(button(name), name)
    await expectFingertip(button('Continue with no account'), 'Continue with no account')
    await expectFingertip(button('Forgot password?'), 'Forgot password?')
    await footerTargets('sign in')
    const version = footer.locator('span').last()
    await expectReadable(version, 'the version')
    const lines = await version.evaluate((el) => {
      const range = document.createRange()
      range.selectNodeContents(el)
      return new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size
    })
    expect(lines, 'the version on one line').toBe(1)

    // Forgot password.
    await button('Forgot password?').click()
    await expectFingertip(page.locator('button[type="submit"]'), 'Send reset link')
    await expectFingertip(button('Back to sign in'), 'Back to sign in')
    await footerTargets('forgot password')

    // Create account.
    await button('Back to sign in').click()
    await button('Create one').click()
    await expectFingertip(page.locator('button[type="submit"]'), 'Create account')
    await expectFingertip(button('Sign in'), 'Sign in, the link')
    await footerTargets('create account')

    // Email me a sign-in code.
    await button('Sign in').click()
    await button('Email me a sign-in code').click()
    await expectFingertip(page.locator('button[type="submit"]').first(), 'Email me a code')
    await footerTargets('email code')
  })
})
