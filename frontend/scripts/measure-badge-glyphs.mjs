/**
 * Prints the offset that puts each badge glyph dead centre on (24,24) in its own 48-unit box.
 *
 * The glyphs are drawn by hand, so their ink lands where the paths happen to fall — a shallow
 * arc with dots under it sits in the lower half of its box, and the medallion then renders it
 * visibly low. `BadgeMedallion` cannot measure anything: it builds the share card as a string,
 * with no DOM to ask. So the numbers are measured here, once, and pasted into GLYPH_OFFSET in
 * badgeGlyphs.ts.
 *
 * It measures *ink*, not geometry: each glyph is rasterised at 480x480 with the same stroke the
 * app uses and the alpha channel is scanned, so round caps and joins count. Re-run it after
 * touching any glyph:
 *
 *   node scripts/measure-badge-glyphs.mjs
 */
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { chromium } from '@playwright/test'

const SRC = 'src/components/badgeGlyphs.ts'
const PX = 480 // 10 device pixels per glyph unit
const UNITS = 48

// Node strips the annotations, so the browser gets the real table rather than a copy of it that
// could drift. GLYPH_OFFSET is cut out first: measuring must see the glyphs as authored.
const module = stripTypeScriptTypes(
  readFileSync(SRC, 'utf8')
    .split('\n')
    .filter((l) => !l.startsWith('import type'))
    .join('\n')
    .replace(/\n\/\*[\s\S]*?\*\/\nexport const GLYPH_OFFSET[\s\S]*?\n}\n/, '\n')
    .replace(/\nexport const GLYPH_OFFSET[\s\S]*?\n}\n/, '\n')
)

const browser = await chromium.launch({ args: ['--class=agent-browser'] })
const page = await browser.newPage()
const rows = await page.evaluate(
  async ([code, px, units]) => {
    const { BADGE_GLYPHS } = await import(`data:text/javascript,${encodeURIComponent(code)}`)
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = px
    const ctx = canvas.getContext('2d')
    const out = []
    for (const [id, markup] of Object.entries(BADGE_GLYPHS)) {
      const svg =
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${units} ${units}" width="${px}" height="${px}">` +
        `<g fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${markup}</g></svg>`
      const img = new Image()
      await new Promise((ok, fail) => {
        img.onload = ok
        img.onerror = fail
        img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
      })
      ctx.clearRect(0, 0, px, px)
      ctx.drawImage(img, 0, 0)
      const { data } = ctx.getImageData(0, 0, px, px)
      let x0 = px
      let y0 = px
      let x1 = -1
      let y1 = -1
      for (let y = 0; y < px; y++) {
        for (let x = 0; x < px; x++) {
          if (data[(y * px + x) * 4 + 3] > 20) {
            if (x < x0) x0 = x
            if (x > x1) x1 = x
            if (y < y0) y0 = y
            if (y > y1) y1 = y
          }
        }
      }
      const scale = px / units
      out.push({
        id,
        dx: units / 2 - (x0 + x1 + 1) / 2 / scale,
        dy: units / 2 - (y0 + y1 + 1) / 2 / scale,
        w: (x1 - x0 + 1) / scale,
        h: (y1 - y0 + 1) / scale,
      })
    }
    return out
  },
  [module, PX, UNITS]
)
await browser.close()

const round = (n) => Math.round(n * 100) / 100
const shifted = rows.filter((r) => Math.abs(round(r.dx)) >= 0.05 || Math.abs(round(r.dy)) >= 0.05)
console.log(`${rows.length} glyphs, ${shifted.length} need a nudge\n`)
console.log(
  'export const GLYPH_OFFSET: Partial<Record<AchievementId, readonly [number, number]>> = {'
)
for (const r of shifted) {
  const key = /^[a-z][\w$]*$/i.test(r.id) ? r.id : `'${r.id}'`
  console.log(`  ${key}: [${round(r.dx)}, ${round(r.dy)}],`)
}
console.log('}')
