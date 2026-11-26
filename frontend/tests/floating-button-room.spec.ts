/**
 * Every page leaves room for the floating add button.
 *
 * The button is fixed in the bottom-right corner, over the page. With no room kept for it, the end
 * of a page's last row sat under it: the "View all" link on Accounts, the storage line in Settings,
 * the empty note under Connected sources on Import. The content ran 54 px below the button's top on
 * every page (measured 19 Nov 2026).
 *
 * So, with a page scrolled to its end, its content ends above the button and nothing of the page
 * is painted under it. The room comes from `.main` in components/Layout.module.css, computed from
 * the same two values that size and place the button.
 *
 * Local-first with the example data, which fills each of these pages past one screen.
 */
import { expect, test } from '@playwright/test'
import { gotoServerless, login } from './test-helpers'
import type { Page, TestInfo } from '@playwright/test'

/** The setup wizard can open over local-first's example data: leave it if it shows up. */
async function leaveOnboarding(page: Page): Promise<void> {
  await page.addLocatorHandler(page.getByTestId('onboarding-wizard'), async () => {
    await page.getByTestId('onboarding-skip').click()
    const confirm = page.getByTestId('confirm-accept')
    if (await confirm.isVisible({ timeout: 2_000 }).catch(() => false)) await confirm.click()
  })
}

/**
 * To the true end of the page: content that arrives late can lengthen it after the first jump, so
 * keep jumping until the height has held for twenty frames (about a third of a second).
 */
async function scrollToEnd(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        let last = -1
        let held = 0
        let frames = 0
        const tick = () => {
          const height = document.documentElement.scrollHeight
          window.scrollTo(0, height)
          held = height === last ? held + 1 : 0
          last = height
          frames += 1
          if (held >= 20 || frames > 900) resolve()
          else requestAnimationFrame(tick)
        }
        tick()
      })
  )
}

interface Room {
  /** Where the page's content ends: the bottom of `main` less its bottom padding. */
  contentEnd: number
  buttonTop: number
  /** What the page paints under the button, asked at nine points inside its circle. */
  under: string[]
}

async function roomForTheButton(page: Page): Promise<Room> {
  return page.evaluate(() => {
    const button = document.querySelector<HTMLElement>('button[aria-label="Quick add entry"]')!
    const main = document.querySelector('main')!
    const box = button.getBoundingClientRect()
    const contentEnd =
      main.getBoundingClientRect().bottom - parseFloat(window.getComputedStyle(main).paddingBottom)

    const cx = box.left + box.width / 2
    const cy = box.top + box.height / 2
    const r = box.width / 2
    const under = new Set<string>()
    // Out of the way while asking, so the page answers and not the button.
    button.style.visibility = 'hidden'
    for (const [dx, dy] of [
      [0, 0],
      [0.7, 0],
      [-0.7, 0],
      [0, 0.7],
      [0, -0.7],
      [0.5, 0.5],
      [-0.5, 0.5],
      [0.5, -0.5],
      [-0.5, -0.5],
    ]) {
      const el = document.elementFromPoint(cx + dx * r, cy + dy * r)
      if (!el || el === main || !main.contains(el)) continue
      const ownText = Array.from(el.childNodes).some(
        (n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim() !== ''
      )
      // Text, a control or a drawing. A card's empty padding is not content.
      if (ownText || el.closest('button, a, input, select, label, svg, img, canvas'))
        under.add(`${el.tagName.toLowerCase()}: ${(el.textContent ?? '').trim().slice(0, 30)}`)
    }
    button.style.visibility = ''
    return { contentEnd, buttonTop: box.top, under: [...under] }
  })
}

/** The pages to check, by the header each shows once it is up. */
async function checkPages(page: Page, pages: [route: string, header: string][]): Promise<void> {
  await leaveOnboarding(page)
  await gotoServerless(page, pages[0][0], pages[0][1])
  for (const [route, header] of pages) {
    await test.step(route, async () => {
      await page.evaluate((hash) => {
        window.location.hash = hash
      }, route)
      await expect(page.getByTestId(header)).toBeVisible({ timeout: 30_000 })
      await scrollToEnd(page)

      const room = await roomForTheButton(page)
      // The page is longer than the screen, or there would be nothing to hide.
      expect(
        await page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight)
      ).toBe(true)
      expect(room.contentEnd, `${route}: the content ends above the button`).toBeLessThanOrEqual(
        room.buttonTop
      )
      expect(room.under, `${route}: nothing of the page is under the button`).toEqual([])
    })
  }
}

test.describe('room for the floating add button, on a desktop', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('Analytics and Import end above it @smoke', async ({ page }) => {
    test.setTimeout(90_000)
    await checkPages(page, [
      ['analytics', 'analytics-header'],
      ['import', 'import-header'],
    ])
  })
})

test.describe('room for the floating add button, on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('Accounts, Settings and Import end above it @smoke', async ({ page }) => {
    test.setTimeout(90_000)
    await checkPages(page, [
      ['accounts', 'accounts-header'],
      ['settings', 'settings-header'],
      ['import', 'import-header'],
    ])
  })
})

/**
 * What a press at the button's centre reaches: `button` for the button itself, or the test id of
 * the nearest element around what it reaches instead.
 */
async function pressAtButton(page: Page): Promise<{ reaches: string; x: number; y: number }> {
  return page.evaluate(() => {
    const button = document.querySelector<HTMLElement>('button[aria-label="Quick add entry"]')!
    const box = button.getBoundingClientRect()
    const x = box.left + box.width / 2
    const y = box.top + box.height / 2
    const el = document.elementFromPoint(x, y)
    const reaches =
      el && button.contains(el)
        ? 'button'
        : (el?.closest('[data-test-id]')?.getAttribute('data-test-id') ?? el?.tagName ?? 'nothing')
    return { reaches, x, y }
  })
}

/**
 * The button floats over the page, and under whatever opens over the page: a dialog's backdrop,
 * the phone's drawer. It sat at z-index 1400, over every dialog's backdrop at 1000 and the
 * drawer's at 99, so a press there opened the Guided Orbit over the dialog (19 Nov 2026).
 */
test.describe('the floating add button, under what opens over the page', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('a dialog covers it, and a press there reaches the dialog @smoke', async ({ page }) => {
    await leaveOnboarding(page)
    await gotoServerless(page, 'loans', 'add-loan-btn')
    expect((await pressAtButton(page)).reaches, 'over the page').toBe('button')

    await page.getByTestId('add-loan-btn').click()
    const dialog = page.getByTestId('loans-modal')
    await expect(dialog).toBeVisible()
    const { reaches, x, y } = await pressAtButton(page)
    expect(reaches, 'under the dialog').toBe('loans-modal')

    // The press lands on the dialog's backdrop, which shuts it; the Guided Orbit stays shut. Shut,
    // the orbit stays on the page to fade, so it is told by its aria-modal, set only while open.
    await page.mouse.click(x, y)
    await expect(dialog).toBeHidden()
    await expect(page.locator('[role="dialog"][aria-label="Add transaction"]')).toHaveCount(1)
    await expect(
      page.locator('[role="dialog"][aria-label="Add transaction"][aria-modal="true"]')
    ).toHaveCount(0)
  })
})

test.describe('the floating add button, under the drawer on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('the open drawer covers it @smoke', async ({ page }) => {
    await leaveOnboarding(page)
    await gotoServerless(page, 'loans', 'add-loan-btn')
    expect((await pressAtButton(page)).reaches, 'over the page').toBe('button')

    await page.getByRole('button', { name: 'Toggle sidebar' }).click()
    await expect(page.locator('nav').first()).toBeInViewport()
    expect((await pressAtButton(page)).reaches, 'under the drawer').not.toBe('button')
  })
})

interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

/**
 * The passkey offer and the button, as they stand after a sign-in: their boxes, the screen's size,
 * and a capture of the corner they share. Saved before anything is asserted, so a failing run
 * still leaves both.
 */
async function offerAndButton(
  page: Page,
  testInfo: TestInfo
): Promise<{ offer: Box; button: Box; width: number; height: number }> {
  // The offer shows once after a sign-in, on a device that can hold a passkey, to an account with
  // none: the flag the login leaves, and an empty list whatever the fixture account holds.
  await page.addInitScript(() => {
    sessionStorage.setItem('fm:offer-passkey', '1')
  })
  await page.route('**/api/auth/passkeys', (route) => route.fulfill({ json: { passkeys: [] } }))
  await login(page)
  await expect(page.getByTestId('passkey-nudge')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Quick add entry' })).toBeVisible()

  const boxes = await page.evaluate(() => {
    const box = (el: Element) => {
      const r = el.getBoundingClientRect()
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }
    }
    return {
      offer: box(document.querySelector('[data-test-id="passkey-nudge"]')!),
      button: box(document.querySelector('button[aria-label="Quick add entry"]')!),
      width: window.innerWidth,
      height: window.innerHeight,
    }
  })
  await testInfo.attach('boxes.json', {
    body: JSON.stringify(boxes, null, 2),
    contentType: 'application/json',
  })
  await page.screenshot({ path: testInfo.outputPath('offer-and-button.png') })
  return boxes
}

/**
 * The passkey offer stood in the button's corner, under it: the button (z 90) sat over the offer's
 * Add passkey and Not now (z 60), its whole box inside the offer's at 1440 and at 390 px wide
 * (measured 26 Nov 2026). The offer sits above the button, its right edge on the button's, and the
 * button stays where it was.
 */
async function offerClearsButton(page: Page, testInfo: TestInfo, size: number, offset: number) {
  const { offer, button, width, height } = await offerAndButton(page, testInfo)
  // The button stays where it is: its size, and its gap from the right and bottom edges.
  expect(Math.round(button.right - button.left), 'button width').toBe(size)
  expect(Math.round(width - button.right), 'button gap from the right edge').toBe(offset)
  expect(Math.round(height - button.bottom), 'button gap from the bottom edge').toBe(offset)
  // The offer ends above the button, clear of the halo drawn round it (8 px when hovered).
  expect(offer.bottom, 'the offer ends above the button').toBeLessThanOrEqual(button.top - 8)
  expect(Math.round(offer.right), "the offer's right edge on the button's").toBe(
    Math.round(button.right)
  )
  expect(offer.left, 'the offer is on the screen').toBeGreaterThanOrEqual(0)
}

test.describe('the passkey offer, clear of the button, on a desktop', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('sits above the button @smoke', async ({ page }, testInfo) => {
    await offerClearsButton(page, testInfo, 56, 22)
  })
})

test.describe('the passkey offer, clear of the button, on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('sits above the button @smoke', async ({ page }, testInfo) => {
    await offerClearsButton(page, testInfo, 52, 16)
  })
})
