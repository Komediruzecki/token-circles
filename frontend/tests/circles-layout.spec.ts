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

/**
 * Where an orbit divider's arc is drawn: per screenshot column, the mean row of the pixels that
 * change when the arc is hidden (null where nothing changes), with the planets hidden in both
 * shots. Scaled to CSS pixels.
 */
async function arcDrawn(page: Page, orbit: Locator): Promise<(number | null)[]> {
  const planets = orbit.locator('span')
  const hide = (what: Locator, hidden: boolean) =>
    what.evaluateAll((all, h) => {
      for (const e of all) (e as HTMLElement).style.visibility = h ? 'hidden' : ''
    }, hidden)
  await hide(planets, true)
  const shown = (await orbit.screenshot()).toString('base64')
  await hide(orbit.locator('path'), true)
  const bare = (await orbit.screenshot()).toString('base64')
  await hide(orbit.locator('path'), false)
  await hide(planets, false)
  const css = (await orbit.boundingBox())!.width
  return page.evaluate(
    async ({ a, b, css }) => {
      const pixels = async (src: string) => {
        const image = new Image()
        image.src = `data:image/png;base64,${src}`
        await image.decode()
        const canvas = document.createElement('canvas')
        canvas.width = image.width
        canvas.height = image.height
        const context = canvas.getContext('2d')!
        context.drawImage(image, 0, 0)
        return context.getImageData(0, 0, image.width, image.height)
      }
      const [x, y] = [await pixels(a), await pixels(b)]
      const scale = x.width / css
      const rows: (number | null)[] = []
      for (let column = 0; column < css; column++) {
        let sum = 0
        let n = 0
        const at = Math.round(column * scale)
        for (let row = 0; row < x.height; row++) {
          const i = (row * x.width + at) * 4
          const d =
            Math.abs(x.data[i] - y.data[i]) +
            Math.abs(x.data[i + 1] - y.data[i + 1]) +
            Math.abs(x.data[i + 2] - y.data[i + 2])
          if (d > 6) {
            sum += row
            n++
          }
        }
        rows.push(n ? sum / n / scale : null)
      }
      return rows
    },
    { a: shown, b: bare, css }
  )
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

  test('"Your next step" on Progress: the spaced-out sans label Dashboard and the circle view use', async ({
    page,
  }) => {
    await aSpaceOnly(page)
    await aYear(page)
    await page.setViewportSize(DESKTOP)
    const label = async (selector: string) => {
      const element = page.locator(selector).first()
      await expect(element).toBeVisible({ timeout: 30_000 })
      return element.evaluate((e) => {
        const style = getComputedStyle(e)
        return {
          font: style.fontFamily,
          size: style.fontSize,
          weight: style.fontWeight,
          caps: style.textTransform,
          spaced: parseFloat(style.letterSpacing) > 0,
          body: getComputedStyle(document.body).fontFamily,
        }
      })
    }
    const step = '[data-test-id="next-step-card"] [id]:is(h2, h3)'
    await go(page, 'dashboard')
    const dashboard = await label(`[data-test-id="dashboard-container"] ${step}`)
    await go(page, 'progress')
    // Progress gives the card an h2, which the app's headings set in the display face.
    const progress = await label(`[data-tour="progress-next-step"] ${step}`)
    expect(
      await page
        .locator(`[data-tour="progress-next-step"] ${step}`)
        .first()
        .evaluate((e) => e.tagName)
    ).toBe('H2')
    await go(page, 'progress/4')
    const circle = await label('[data-test-id="circle-view"] header p')
    expect(progress.font).toBe(progress.body)
    expect(progress.font).toBe(circle.font)
    expect(progress).toEqual(dashboard)
    expect(progress).toMatchObject({ caps: 'uppercase', spaced: true })
  })

  test('the orbit beside "Your seven circles": one arc with its dots on it, or none, never a row of its own', async ({
    page,
  }) => {
    await aSpaceOnly(page)
    await aYear(page)
    await go(page, 'progress')
    const divider = page.getByTestId('progress-divider-circles')
    const label = divider.locator('h2')
    await expect(label).toHaveText('Your seven circles', { timeout: 30_000 })
    // The meta beside the label comes with the circles; measured before it, the orbit moves.
    await expect(divider).toContainText('Circle 4 of 7', { timeout: 30_000 })
    const orbit = divider.locator('[aria-hidden="true"]:has(svg)')
    // Drawn in as it would be: the reveal runs to its end (the smallest dot's drift never ends).
    await expect
      .poll(() =>
        orbit.evaluate(
          (o) =>
            o
              .getAnimations({ subtree: true })
              .filter((a) => a.effect?.getTiming().iterations !== Infinity).length
        )
      )
      .toBe(0)
    const drawn: string[] = []
    for (const width of [1280, 390, 360, 320]) {
      await page.setViewportSize({ width, height: 844 })
      const head = (await label.boundingBox())!
      const box = (await orbit.boundingBox())!
      const where = `${width}: label ${JSON.stringify(head)}, orbit ${JSON.stringify(box)}`
      // On the label's row, to its right: never a row of its own.
      const middle = (b: { y: number; height: number }) => b.y + b.height / 2
      expect(Math.abs(middle(box) - middle(head)), where).toBeLessThanOrEqual(4)
      expect(box.x, where).toBeGreaterThan(head.x + head.width)
      if (!(await orbit.locator('svg').isVisible())) {
        // Too little room beside the label for an arc: none at all, dots included.
        for (const planet of await orbit.locator('span').all()) await expect(planet).toBeHidden()
        drawn.push(`${width} none`)
        continue
      }
      const rows = await arcDrawn(page, orbit)
      // One stroke: no gap in it between the faded ends.
      let gap = 0
      let widest = 0
      for (const row of rows.slice(Math.ceil(rows.length * 0.15), Math.floor(rows.length * 0.85))) {
        gap = row === null ? gap + 1 : 0
        widest = Math.max(widest, gap)
      }
      expect(widest, `${where}: the widest gap in the arc`).toBeLessThanOrEqual(1)
      // Each dot sits on the line.
      for (const planet of await orbit.locator('span').all()) {
        const dot = (await planet.boundingBox())!
        const column = Math.round(dot.x + dot.width / 2 - box.x)
        const row = rows[column]
        expect(row, `${where}: the line under the dot at ${column}`).not.toBeNull()
        expect(
          Math.abs(row! - (middle(dot) - box.y)),
          `${where}: the dot at ${column}`
        ).toBeLessThanOrEqual(2)
      }
      drawn.push(`${width} arc`)
    }
    // The mock's phone draws the arc beside the heading; so does this one at 390. At 320,
    // "Circle 4 of 7" leaves too little room beside the label, and the arc is left out.
    expect(drawn).toEqual(['1280 arc', '390 arc', '360 arc', '320 none'])
  })

  test("every section heading's orbit on a phone: beside its label or left out, never a row of its own", async ({
    page,
  }) => {
    await aSpaceOnly(page)
    await aYear(page)
    const seen: string[] = []
    // Analytics and the emergency fund page have headings too long to leave room for an arc at
    // 320 and 360; Progress has the circles' heading. Each page waits for its last heading.
    const pages = [
      { hash: 'analytics', last: 'Top Categories Breakdown' },
      { hash: 'emergency', last: 'Coverage by Fund Level' },
      { hash: 'progress', last: 'Your seven circles' },
    ]
    for (const width of [360, 320]) {
      await page.setViewportSize({ width, height: 844 })
      for (const { hash, last } of pages) {
        await go(page, hash)
        await expect(page.locator('h2', { hasText: last }).locator('visible=true')).toHaveCount(1, {
          timeout: 30_000,
        })
        const placed = await page.evaluate(() =>
          // The divider's orbit: the only SVG drawn with this box, stretched to its track.
          [...document.querySelectorAll('svg[viewBox="0 0 100 24"][preserveAspectRatio="none"]')]
            .map((svg) => {
              const orbit = svg.parentElement as HTMLElement
              const label = orbit.parentElement?.querySelector('h2') as HTMLElement
              const l = label.getBoundingClientRect()
              const o = orbit.getBoundingClientRect()
              return {
                label: label.textContent,
                shown: l.width > 0,
                arc: o.width > 0 && getComputedStyle(svg).display !== 'none',
                beside: Math.abs(o.top + o.height / 2 - (l.top + l.height / 2)) <= 4,
              }
            })
            .filter((one) => one.shown)
        )
        expect(placed.length, `${hash} at ${width}`).toBeGreaterThan(0)
        for (const one of placed) {
          const where = `${hash} at ${width}: ${one.label}`
          if (one.arc) expect(one.beside, where).toBe(true)
          seen.push(`${one.arc ? 'arc' : 'none'} ${where}`)
        }
      }
    }
    // Both happen: arcs beside their labels, and headings with no room left for one.
    expect(seen.some((one) => one.startsWith('arc'))).toBe(true)
    expect(seen.some((one) => one.startsWith('none'))).toBe(true)
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
