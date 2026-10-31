/**
 * Prints on Progress as drawn (first week, phase 4): one column on a phone and the seal beside its
 * words on a desktop, nothing past the screen's edge down to 320 px with 26 prints, text and
 * controls at the circles' sizes, a focused print's whole ring inside the phone's strip, the
 * seal's marks at 3:1 on the card in both themes, and the engraving: it waits for the seal to be
 * in view, always finishes, and never runs under reduced motion. Local-first, on the example
 * profiles (every month from January 2000) or a new space.
 *
 * The app clips sideways overflow (`overflow-x: clip` on html, body and `.main`), so the page
 * itself never scrolls sideways: a part too wide is cut off at the screen's edge instead. These
 * tests measure the right edge of every part of the shelf, except the prints inside the strip,
 * which scroll within it.
 */
import { expect, test } from '@playwright/test'
import { aSpaceOnly, go } from './circles-fixture'
import { aMonth, monthsBack, write } from './prints-fixture'
import { gotoServerless } from './test-helpers'
import type { Page } from '@playwright/test'

const PHONE = { width: 390, height: 844 }
const DESKTOP = { width: 1280, height: 800 }

/** The example profile's prints, on Progress at its Prints section. */
async function examplePrints(page: Page): Promise<void> {
  await gotoServerless(page, 'progress/prints', 'progress-header')
  await expect(page.getByTestId('prints-seal')).toHaveAttribute('data-kind', 'print', {
    timeout: 60_000,
  })
}

async function inTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.evaluate((t) => {
    localStorage.setItem('finance-theme', t)
  }, theme)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme, { timeout: 30_000 })
  await expect(page.getByTestId('prints-seal')).toBeVisible({ timeout: 60_000 })
}

/** Boxes of the shelf's parts, its right-most edge, and its smallest text and control. */
async function measure(page: Page) {
  return page.getByTestId('progress-prints').evaluate((body) => {
    const rect = (id: string) => {
      const r = body.querySelector(`[data-test-id="${id}"]`)!.getBoundingClientRect()
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right }
    }
    const strip = body.querySelector('[data-test-id="prints-every"]')
    let rightmost = body.getBoundingClientRect().right
    for (const el of body.querySelectorAll('*')) {
      if (strip && el !== strip && strip.contains(el)) continue
      rightmost = Math.max(rightmost, el.getBoundingClientRect().right)
    }
    let smallestText = Infinity
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const el = node.parentElement!
      if (!node.textContent?.trim() || el.closest('details:not([open]) > :not(summary)')) continue
      smallestText = Math.min(smallestText, parseFloat(getComputedStyle(el).fontSize))
    }
    const controls = [...body.querySelectorAll('button, summary')].map((el) => {
      const r = el.getBoundingClientRect()
      return { name: el.textContent?.trim() || el.getAttribute('aria-label'), h: r.height }
    })
    return {
      eyebrow: rect('prints-eyebrow'),
      figure: rect('prints-figure'),
      readout: rect('prints-readout'),
      rightmost,
      smallestText,
      shortest: controls.reduce((a, b) => (b.h < a.h ? b : a)),
      viewport: window.innerWidth,
    }
  })
}

/** WCAG contrast of two `rgb(...)` colours. */
function contrast(a: string, b: string): number {
  const lum = (c: string) => {
    const [r, g, bl] = (c.match(/[\d.]+/g) ?? []).slice(0, 3).map((v) => {
      const s = Number(v) / 255
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl
  }
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

test.describe('Prints as drawn', () => {
  test.beforeEach(() => {
    test.setTimeout(120_000)
  })

  test('the prints at 390 in both themes: one column, nothing past the screen, text 12 px or more, controls 48 px', async ({
    page,
  }) => {
    await page.setViewportSize(PHONE)
    await examplePrints(page)
    for (const theme of ['light', 'dark'] as const) {
      await inTheme(page, theme)
      // Open, so the month list's own lines are measured too.
      await page.getByTestId('prints-months').locator('summary').click()
      await expect(page.getByTestId('prints-months')).toHaveAttribute('open', '')
      const m = await measure(page)
      expect(m.figure.top, `${theme}: the seal under its words`).toBeGreaterThanOrEqual(
        m.eyebrow.bottom
      )
      expect(m.readout.top, `${theme}: the words to read under the seal`).toBeGreaterThanOrEqual(
        m.figure.bottom
      )
      expect(m.rightmost, `${theme}: the right edge`).toBeLessThanOrEqual(m.viewport + 0.5)
      expect(m.smallestText, theme).toBeGreaterThanOrEqual(12)
      expect(m.shortest.h, `${theme}: ${String(m.shortest.name)}`).toBeGreaterThanOrEqual(48)
    }
  })

  test('the prints at 1280 in both themes: the seal beside its words, earlier prints in a grid', async ({
    page,
  }) => {
    await page.setViewportSize(DESKTOP)
    await examplePrints(page)
    for (const theme of ['light', 'dark'] as const) {
      await inTheme(page, theme)
      await page.getByTestId('progress-prints').scrollIntoViewIfNeeded()
      const m = await measure(page)
      expect(m.figure.right, `${theme}: the seal left of its words`).toBeLessThanOrEqual(
        m.eyebrow.left
      )
      expect(m.readout.left, theme).toBeGreaterThanOrEqual(m.figure.right)
      const tops = await page
        .getByTestId('prints-every')
        .getByRole('button')
        .evaluateAll((all) => all.map((b) => Math.round(b.getBoundingClientRect().top)))
      const rows = new Set(tops)
      expect(rows.size, `${theme}: rows of prints`).toBeGreaterThan(1)
      expect(tops.filter((t) => t === tops[0]).length, `${theme}: prints in a row`).toBeGreaterThan(
        4
      )
    }
  })

  test('nothing past the screen at 320, 360 and 390 with 26 prints: the strip scrolls inside itself', async ({
    page,
  }) => {
    await page.setViewportSize(PHONE)
    await examplePrints(page)
    for (const width of [320, 360, 390]) {
      await page.setViewportSize({ width, height: 844 })
      await page.getByTestId('prints-every').scrollIntoViewIfNeeded()
      const m = await measure(page)
      const strip = await page.getByTestId('prints-every').evaluate((el) => ({
        holds: el.scrollWidth,
        shows: el.clientWidth,
      }))
      expect(m.rightmost, `${width}: the right edge`).toBeLessThanOrEqual(width + 0.5)
      expect(strip.holds, `${width}: the strip`).toBeGreaterThan(strip.shows)
    }
  })

  // On a phone the strip scrolls sideways, and a box that scrolls clips what its children draw
  // outside it: the focus ring is drawn 3 px outside the print. Inside the print it would sit on
  // the cream paper, at 1.84:1 in the dark theme, so the ring stays outside, pressed print or not.
  test('a print focused from the keyboard at 390 shows its whole ring: first, pressed, after a scroll, last', async ({
    page,
  }) => {
    await page.setViewportSize(PHONE)
    await examplePrints(page)
    const strip = page.getByTestId('prints-every')
    const thumbs = strip.getByRole('button')
    await strip.scrollIntoViewIfNeeded()
    /** The focused print's ring: how far it reaches outside the print, and past each of the
     * strip's clipping edges (more than 0 is cut off). */
    const ring = () =>
      page.evaluate(() => {
        const thumb = document.activeElement as HTMLElement
        const box = thumb.closest('[data-test-id="prints-every"]')!
        const style = getComputedStyle(thumb)
        const out = parseFloat(style.outlineOffset) + parseFloat(style.outlineWidth)
        const t = thumb.getBoundingClientRect()
        const s = box.getBoundingClientRect()
        const top = s.top + box.clientTop
        const left = s.left + box.clientLeft
        return {
          from: thumb.dataset.from,
          keyboard: thumb.matches(':focus-visible'),
          pressed: thumb.getAttribute('aria-pressed'),
          out,
          past: {
            top: top - (t.top - out),
            left: left - (t.left - out),
            bottom: t.bottom + out - (top + box.clientHeight),
            right: t.right + out - (left + box.clientWidth),
          },
        }
      })
    const fits = (r: Awaited<ReturnType<typeof ring>>, which: string) => {
      expect(r.keyboard, `${which}: focus from the keyboard`).toBe(true)
      expect.soft(r.out, `${which}: the ring outside the print`).toBeGreaterThan(0)
      for (const [side, past] of Object.entries(r.past)) {
        expect.soft(past, `${which}: the ring's ${side} edge`).toBeLessThanOrEqual(0)
      }
    }

    // Feature the second print, so the first, at the strip's left edge, is not pressed.
    await thumbs.nth(1).click()
    await expect(thumbs.nth(0)).toHaveAttribute('aria-pressed', 'false')
    await page.keyboard.press('Shift+Tab')
    const first = await ring()
    expect(first.from).toBe(await thumbs.nth(0).getAttribute('data-from'))
    fits(first, 'the first print')

    await page.keyboard.press('Tab')
    const pressed = await ring()
    expect(pressed.pressed).toBe('true')
    fits(pressed, 'the pressed print')

    // Scrolled along, the strip snaps to a print's start, which stops 5 px in from its edge. The
    // first print wholly in view there takes the focus (still shown, as the last focus was).
    await strip.evaluate((el) => {
      const [a, b] = el.querySelectorAll('button')
      el.scrollLeft = 3 * (b.getBoundingClientRect().left - a.getBoundingClientRect().left) + 2
    })
    expect(await strip.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0)
    await strip.evaluate((el) => {
      const edge = el.getBoundingClientRect().left + el.clientLeft
      const all = [...el.querySelectorAll('button')]
      all.find((b) => b.getBoundingClientRect().left >= edge)?.focus({ preventScroll: true })
    })
    fits(await ring(), 'the first print in view once the strip has scrolled')

    await thumbs.last().focus()
    await page.keyboard.press('Shift+Tab')
    await page.keyboard.press('Tab')
    const last = await ring()
    expect(last.from).toBe(await thumbs.last().getAttribute('data-from'))
    fits(last, 'the last print')
  })

  test("the seal's marks hold 3:1 on their ground in both themes", async ({ page }) => {
    await page.setViewportSize(PHONE)
    await aSpaceOnly(page)
    // Five months that keep money and one that spends more than came in: ink, band and copper.
    await write(page, [
      ...monthsBack(7, 3).flatMap((m) => aMonth(m)),
      ...aMonth(monthsBack(2, 2)[0], 4, 3000, 4000),
    ])
    await go(page, 'progress/prints')
    await expect(page.getByTestId('prints-seal')).toHaveAttribute('data-months', '6', {
      timeout: 30_000,
    })
    for (const theme of ['light', 'dark'] as const) {
      await inTheme(page, theme)
      const colours = await page.getByTestId('progress-prints').evaluate((body) => {
        const stroke = (sel: string) => getComputedStyle(body.querySelector(sel)!).stroke
        return {
          ground: getComputedStyle(body).backgroundColor,
          ink: stroke('.seal-petal path'),
          band: stroke('.seal-band[style*="seal-band"] path'),
          copper: stroke('.seal-band[style*="seal-copper"] path'),
        }
      })
      for (const mark of ['ink', 'band', 'copper'] as const) {
        expect(
          contrast(colours[mark], colours.ground),
          `${theme} ${mark}: ${colours[mark]} on ${colours.ground}`
        ).toBeGreaterThanOrEqual(3)
      }
    }
  })

  test('reduced motion: the print arrives finished, with no animation running', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.setViewportSize(PHONE)
    await examplePrints(page)
    const figure = page.getByTestId('prints-figure')
    for (let i = 0; i < 6; i++) {
      const state = await figure.evaluate((el) => ({
        engraving: el.getAttribute('data-engraving'),
        running: el.getAnimations({ subtree: true }).length,
      }))
      expect(state).toEqual({ engraving: null, running: 0 })
      await page.waitForTimeout(250)
    }
  })

  test('the engraving waits until the seal is in view, then always finishes', async ({ page }) => {
    await page.setViewportSize(PHONE)
    await gotoServerless(page, 'progress', 'progress-header')
    const figure = page.getByTestId('prints-figure')
    await expect(figure).toHaveAttribute('data-engraving', 'armed', { timeout: 60_000 })
    // Out of view, it waits: nothing is drawn while the page is elsewhere, past the 3 s fallback
    // too, which only starts once some of the seal has been seen.
    await page.waitForTimeout(3500)
    expect(await figure.getAttribute('data-engraving')).toBe('armed')
    await figure.scrollIntoViewIfNeeded()
    await expect(figure).toHaveAttribute('data-engraving', 'engraving', { timeout: 5_000 })
    await expect(figure).not.toHaveAttribute('data-engraving', /./, { timeout: 5_000 })
    expect(await figure.evaluate((el) => el.getAnimations({ subtree: true }).length)).toBe(0)
  })
})
