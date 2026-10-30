/**
 * The orbit beside a section heading (OrbitalDivider, shared by every section heading in the app):
 * one continuous arc with its dots on it, or none at all, and never on a row of its own. Runs in
 * serverless mode, where the app seeds its demo data on first load, so every heading renders.
 *
 * Ported from circles-layout.spec.ts on the circles part 2 branch to pages that exist on main.
 */
import { expect, test } from '@playwright/test'
import { gotoServerless } from './test-helpers'
import type { Locator, Page } from '@playwright/test'

/** A hash route inside the already-loaded app, without a reload. */
async function go(page: Page, hash: string): Promise<void> {
  await page.evaluate((h) => {
    window.location.hash = h
  }, hash)
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

/**
 * A divider's orbit at 1280, 390, 360 and 320: on its label's row and to its right every time, and
 * either one continuous arc with each dot on it ("arc") or nothing at all, dots included ("none").
 */
async function orbitAtEachWidth(page: Page, divider: Locator): Promise<string[]> {
  const label = divider.locator('h2')
  const orbit = divider.locator('div[aria-hidden="true"]:has(> svg)')
  await orbit.scrollIntoViewIfNeeded()
  // Drawn in as it would be: the divider reveals once it is on screen (a class it adds to itself),
  // and the reveal runs to its end (the smallest dot's drift never ends).
  await expect(divider).toHaveClass(/inView/, { timeout: 10_000 })
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
    await orbit.scrollIntoViewIfNeeded()
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
  return drawn
}

test.describe('The orbit beside a section heading', () => {
  test.beforeEach(() => {
    test.setTimeout(120_000)
  })

  test('one arc with its dots on it, or none, never a row of its own, at 1280 to 320 @smoke', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 844 })
    await gotoServerless(page, 'analytics', 'analytics-header')
    // A short heading leaves room for the arc at every width, down to 320.
    const savings = page.locator('#analytics-sec-savings')
    await expect(savings.locator('h2')).toHaveText('Savings Rate', { timeout: 30_000 })
    expect(await orbitAtEachWidth(page, savings)).toEqual([
      '1280 arc',
      '390 arc',
      '360 arc',
      '320 arc',
    ])
    // A heading with a count beside it leaves too little room at 320, and the arc is left out.
    await page.setViewportSize({ width: 1280, height: 844 })
    await go(page, 'progress')
    const earned = page.getByTestId('progress-divider-earned')
    await expect(earned.locator('h2')).toHaveText('What you have earned', { timeout: 30_000 })
    await expect(earned).toContainText(/\d+ of \d+/, { timeout: 30_000 })
    expect(await orbitAtEachWidth(page, earned)).toEqual([
      '1280 arc',
      '390 arc',
      '360 arc',
      '320 none',
    ])
  })

  test("every section heading's orbit on a phone: beside its label or left out, never a row of its own @smoke", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 844 })
    await gotoServerless(page, 'analytics', 'analytics-header')
    const seen: string[] = []
    // Analytics and the emergency fund page have headings too long to leave room for an arc at
    // 320 and 360; Progress has headings with a count beside them. Each page waits for its last
    // heading.
    const pages = [
      { hash: 'analytics', last: 'Recent Transactions' },
      { hash: 'emergency', last: 'Coverage Levels' },
      { hash: 'progress', last: 'Every badge' },
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
})
