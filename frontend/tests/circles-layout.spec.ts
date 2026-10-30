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

  test("a circle's head at every width: the pill beside the name while both fit, under it only when they don't", async ({
    page,
  }) => {
    await aSpaceOnly(page)
    await aYear(page)
    const seen: string[] = []
    for (const width of [320, 360, 390, 1280]) {
      await page.setViewportSize({ width, height: 844 })
      for (const circle of [1, 2, 3, 4, 5, 6, 7]) {
        await go(page, `progress/${circle}`)
        const view = page.getByTestId('circle-view')
        await expect(view.locator('header p').first()).toHaveText(`Circle ${circle} of 7`, {
          timeout: 30_000,
        })
        await expect(view.locator('header span[data-state]')).toBeVisible()
        const at = await view.locator('header').evaluate((head) => {
          const title = head.querySelector<HTMLElement>('#circle-view-title')!
          const pill = head.querySelector<HTMLElement>('span[data-state]')!
          const line = [...head.querySelectorAll('p')].at(-1)!
          // The name's width on one line, whatever the heading wraps it to now.
          const style = title.getAttribute('style')
          title.style.whiteSpace = 'nowrap'
          title.style.width = 'max-content'
          const name = title.getBoundingClientRect().width
          if (style === null) title.removeAttribute('style')
          else title.setAttribute('style', style)
          const t = title.getBoundingClientRect()
          const p = pill.getBoundingClientRect()
          return {
            room: head.getBoundingClientRect().right - t.left,
            name,
            pill: p.width,
            title: { left: t.left, right: t.right, top: t.top, bottom: t.bottom },
            box: { left: p.left, top: p.top, bottom: p.bottom, middle: (p.top + p.bottom) / 2 },
            lineTop: line.getBoundingClientRect().top,
            lineHeight: parseFloat(getComputedStyle(title).lineHeight),
          }
        })
        const where = `circle ${circle} at ${width}: ${JSON.stringify(at)}`
        // Never under the circle's line: the pill belongs to the name.
        expect(at.box.bottom, where).toBeLessThanOrEqual(at.lineTop + 0.5)
        const beside =
          at.box.left >= at.title.right &&
          at.box.middle >= at.title.top &&
          at.box.middle <= at.title.top + at.lineHeight
        // Under the name, at its start, before the circle's line.
        const under =
          at.box.top >= at.title.bottom - 0.5 && Math.abs(at.box.left - at.title.left) <= 0.5
        if (at.name + at.pill + 24 <= at.room) {
          expect(beside, `beside the name: ${where}`).toBe(true)
          seen.push(`${circle}@${width} beside`)
        } else if (at.name + at.pill > at.room) {
          expect(under, `under the name: ${where}`).toBe(true)
          seen.push(`${circle}@${width} under`)
        } else {
          // Within a gap of fitting: either place, never anywhere else.
          expect(beside || under, `beside or under the name: ${where}`).toBe(true)
        }
      }
    }
    // Phone and desktop: every circle's name has room for its pill (circle 4 at 390 is the case
    // that dropped "You're here" under the line, beside about 150 px free). At 320 some don't.
    for (const width of [390, 1280]) {
      for (const circle of [1, 2, 3, 4, 5, 6, 7])
        expect(seen).toContain(`${circle}@${width} beside`)
    }
    expect(seen.filter((s) => s.endsWith('under')).length).toBeGreaterThan(0)
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
