/**
 * The circles as drawn (circles part 2, from the visual pass): a circle's head keeps its pill on its
 * first row at desktop width and its heading as wide as the name, a link inside running text keeps
 * a 48 px target without spreading the lines apart, and "You're here" reads as the current
 * circle's colour, opaque and at 4.5:1 or more, in both themes. Local-first, on the workspace in
 * circles-fixture.ts.
 */
import { expect, test } from '@playwright/test'
import { aSpaceOnly, aYear, go } from './circles-fixture'
import type { Locator, Page } from '@playwright/test'

const DESKTOP = { width: 1280, height: 800 }
const PHONE = { width: 390, height: 844 }

/**
 * The tops of the lines a paragraph's words sit on, and its line height. Read from the text itself,
 * so a link's padded box does not count as a line.
 */
async function lineTops(paragraph: Locator): Promise<{ tops: number[]; lineHeight: number }> {
  return paragraph.evaluate((p) => {
    const tops = new Set<number>()
    const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent?.trim()) continue
      const range = document.createRange()
      range.selectNodeContents(node)
      for (const rect of range.getClientRects()) {
        if (rect.width > 0) tops.add(Math.round(rect.top * 2) / 2)
      }
    }
    return {
      tops: [...tops].sort((a, b) => a - b),
      lineHeight: parseFloat(window.getComputedStyle(p).lineHeight),
    }
  })
}

/** The largest step from one line's top to the next. */
const widestGap = (tops: number[]): number =>
  Math.max(...tops.slice(1).map((top, i) => top - tops[i]))

/** A note in running text: two lines or more, spaced as the paragraph says, and a 48 px Change. */
async function spacedLikeItsParagraph(note: Locator): Promise<void> {
  await expect(note).toBeVisible({ timeout: 30_000 })
  const { tops, lineHeight } = await lineTops(note)
  expect(tops.length).toBeGreaterThanOrEqual(2)
  expect(widestGap(tops)).toBeLessThanOrEqual(lineHeight + 1)
  const change = await note.getByRole('link', { name: 'Change' }).boundingBox()
  expect(change!.height).toBeGreaterThanOrEqual(48)
  expect(change!.width).toBeGreaterThanOrEqual(48)
}

/**
 * The colours "You're here" is drawn in: its background laid over every background behind it, as
 * sRGB 0 to 255, its text colour, and the contrast between the two.
 */
async function drawnColours(pill: Locator): Promise<{
  background: number[]
  alpha: number
  contrast: number
}> {
  return pill.evaluate((el) => {
    const rgba = (css: string): number[] => {
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = 1
      const ctx = canvas.getContext('2d')!
      ctx.clearRect(0, 0, 1, 1)
      ctx.fillStyle = css
      ctx.fillRect(0, 0, 1, 1)
      const d = ctx.getImageData(0, 0, 1, 1).data
      return [d[0], d[1], d[2], d[3] / 255]
    }
    // The backgrounds from the nearest opaque one down to the pill's own.
    const layers: string[] = []
    for (let node: Element | null = el; node; node = node.parentElement) {
      const bg = window.getComputedStyle(node).backgroundColor
      layers.unshift(bg)
      if (rgba(bg)[3] === 1) break
    }
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1
    const ctx = canvas.getContext('2d')!
    for (const bg of layers) {
      ctx.fillStyle = bg
      ctx.fillRect(0, 0, 1, 1)
    }
    const d = ctx.getImageData(0, 0, 1, 1).data
    const background = [d[0], d[1], d[2]]
    const text = rgba(window.getComputedStyle(el).color)
    const luminance = ([r, g, b]: number[]) => {
      const lin = (v: number) => {
        const c = v / 255
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
      }
      return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
    }
    const [hi, lo] = [luminance(background), luminance(text)].sort((a, b) => b - a)
    return {
      background,
      alpha: rgba(window.getComputedStyle(el).backgroundColor)[3],
      contrast: (hi + 0.05) / (lo + 0.05),
    }
  })
}

async function inTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.evaluate((t) => {
    localStorage.setItem('finance-theme', t)
  }, theme)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme, { timeout: 30_000 })
}

test.describe('The circles as drawn', () => {
  test.beforeEach(() => {
    test.setTimeout(150_000)
  })

  test("a circle's head at desktop width: the pill on its first row, the heading as wide as its name", async ({
    page,
  }) => {
    await aSpaceOnly(page)
    await aYear(page)
    await page.setViewportSize(DESKTOP)
    await go(page, 'progress/4')
    const view = page.getByTestId('circle-view')
    const head = view.locator('header').first()
    const pill = head.locator('span[data-state]')
    await expect(pill).toHaveText("You're here", { timeout: 30_000 })
    const glyph = (await head.locator('svg').first().boundingBox())!
    const box = (await pill.boundingBox())!
    // On the glyph's row, to the right of the name: not a row of its own under the head.
    expect(box.y).toBeLessThan(glyph.y + glyph.height)
    const title = view.locator('#circle-view-title')
    const words = await title.evaluate((h) => {
      const range = document.createRange()
      range.selectNodeContents(h)
      return range.getBoundingClientRect().width
    })
    const heading = (await title.boundingBox())!
    expect(heading.x + heading.width).toBeLessThan(box.x)
    // The focus outline follows the heading's box: as wide as the name, not the column.
    expect(heading.width).toBeLessThanOrEqual(Math.ceil(words) + 1)
  })

  test('a link inside running text at phone width: a 48 px Change, and the lines as the paragraph spaces them', async ({
    page,
  }) => {
    await aSpaceOnly(page)
    await aYear(page)
    await page.setViewportSize(PHONE)
    await go(page, 'progress/4')
    await spacedLikeItsParagraph(page.getByTestId('circle-compare-region'))
    await go(page, 'dashboard')
    await spacedLikeItsParagraph(page.getByTestId('savings-gauge-region'))
  })

  test("You're here in both themes: the current circle's colour, opaque, and 4.5:1", async ({
    page,
  }) => {
    await aSpaceOnly(page)
    for (const theme of ['light', 'dark'] as const) {
      await inTheme(page, theme)
      await go(page, 'progress')
      const pill = page.locator(
        '[data-circle-row][data-state="current"] span[data-state="current"]'
      )
      await expect(pill).toHaveText("You're here", { timeout: 30_000 })
      const drawn = await drawnColours(pill)
      expect(drawn.alpha, theme).toBe(1)
      expect(drawn.contrast, theme).toBeGreaterThanOrEqual(4.5)
      // Warm, from --circle-now: over the navy card, a thin tint read grey-violet.
      const [red, , blue] = drawn.background
      expect(red - blue, `${theme}: ${drawn.background.join(', ')}`).toBeGreaterThanOrEqual(10)
    }
  })
})
