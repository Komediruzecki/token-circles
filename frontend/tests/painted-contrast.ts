/**
 * The setup wizard's text, read against what the screen actually paints behind it.
 *
 * A computed colour says nothing about the sky, the haze or a token that drifts behind a line, so
 * this measures pixels instead: every line of text in the panel is made transparent, the screen is
 * captured, and each pixel inside the line's box is the ground that line's colour is composited
 * over. The orbit field moves, so its animations are paused and the capture is repeated at several
 * points around their orbits; the worst pixel at any of them is the line's ratio.
 */
import type { Page } from '@playwright/test'

/** A line of text and the lowest contrast found behind it. */
export interface PaintedLine {
  /** Its text, cut at 48 characters. */
  what: string
  /** The lowest ratio over every pixel of its line box, at every sampled point of the orbits. */
  ratio: number
  /** What WCAG AA asks of it: 3 for large text (24 px, or 18.66 px bold), else 4.5. */
  need: number
  /**
   * How much the orbit field changes the pixels behind it: the largest change in any colour
   * channel when the field is hidden. 0 when the field paints nothing there.
   */
  field: number
}

const PANEL = '[data-test-id="onboarding-panel"]'
const FIELD = '[data-test-id="onboarding-backdrop"]'
const HIDE_TEXT = 'painted-contrast-hide-text'
const HIDE_FIELD = 'painted-contrast-hide-field'

/**
 * Every visible line of text in the wizard's panel, with the lowest contrast the screen paints
 * behind it. A line partly scrolled out of the middle, or in the edge it fades at, is left out:
 * it is measured where it shows whole. Text in a disabled control is left out, as WCAG does.
 *
 * `fade` is the height, in px, of the middle's faded edges (its data-more-above and
 * data-more-below cues).
 */
export async function paintedContrast(
  page: Page,
  { phases = 6, fade = 20 }: { phases?: number; fade?: number } = {}
): Promise<PaintedLine[]> {
  // Settle what is still arriving: the panel's rise, the progress arc, a step's entrance.
  await page.locator(PANEL).evaluate(async (panel) => {
    await Promise.all(
      panel
        .getAnimations({ subtree: true })
        .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
        .map((a) => a.finished)
    )
  })

  const count = await page.evaluate(
    ({ PANEL, fade }) => {
      const panel = document.querySelector<HTMLElement>(PANEL)!
      const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!
      /** A CSS colour as [r, g, b, alpha], read back from a canvas pixel. */
      const rgba = (color: string): number[] => {
        ctx.clearRect(0, 0, 1, 1)
        ctx.fillStyle = '#010203'
        ctx.fillStyle = color
        if (ctx.fillStyle === '#010203') throw new Error(`the canvas cannot read ${color}`)
        ctx.fillRect(0, 0, 1, 1)
        const [r, g, b, a] = Array.from(ctx.getImageData(0, 0, 1, 1).data)
        return [r, g, b, a / 255]
      }
      const lines: { what: string; color: number[]; need: number; rects: number[][] }[] = []
      const walker = document.createTreeWalker(panel, NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const what = (node.textContent ?? '').replace(/\s+/g, ' ').trim()
        const el = node.parentElement
        if (!what || !el) continue
        if (el.closest('svg, select, option, button:disabled, [aria-disabled="true"]')) continue
        const style = window.getComputedStyle(el)
        if (style.visibility !== 'visible') continue
        let opacity = 1
        for (let n: HTMLElement | null = el; n; n = n.parentElement) {
          opacity *= parseFloat(window.getComputedStyle(n).opacity)
        }
        const color = rgba(style.color)
        color[3] *= opacity
        if (color[3] === 0) continue
        const size = parseFloat(style.fontSize)
        const large = size >= 24 || (size >= 18.66 && parseInt(style.fontWeight, 10) >= 700)

        // Where the line shows: inside every box that clips it, and clear of a faded edge.
        const clips: { left: number; top: number; right: number; bottom: number }[] = []
        for (let n: HTMLElement | null = el; n; n = n.parentElement) {
          const s = window.getComputedStyle(n)
          if (s.overflowX === 'visible' && s.overflowY === 'visible' && s.clipPath === 'none') {
            continue
          }
          const box = n.getBoundingClientRect()
          const left = box.left + n.clientLeft
          const top = box.top + n.clientTop
          const clip = { left, top, right: left + n.clientWidth, bottom: top + n.clientHeight }
          if (n.hasAttribute('data-more-above')) clip.top += fade
          if (n.hasAttribute('data-more-below')) clip.bottom -= fade
          clips.push(clip)
        }
        clips.push({ left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight })
        const range = document.createRange()
        range.selectNodeContents(node)
        const rects: number[][] = []
        for (const r of Array.from(range.getClientRects())) {
          if (r.width < 2 || r.height < 6) continue
          const top = Math.max(r.top, ...clips.map((c) => c.top))
          const bottom = Math.min(r.bottom, ...clips.map((c) => c.bottom))
          const left = Math.max(r.left, ...clips.map((c) => c.left))
          const right = Math.min(r.right, ...clips.map((c) => c.right))
          // Partly hidden top or bottom: measured where it shows whole.
          if (top > r.top + 0.5 || bottom < r.bottom - 0.5 || right - left < 2) continue
          rects.push([Math.ceil(left), Math.ceil(top), Math.floor(right), Math.floor(bottom)])
        }
        if (rects.length > 0) {
          lines.push({ what: what.slice(0, 48), color, need: large ? 3 : 4.5, rects })
        }
      }
      ;(window as unknown as { __painted: unknown }).__painted = { lines, base: null }
      return lines.length
    },
    { PANEL, fade }
  )
  if (count === 0) return []

  /** Capture the screen and fold it into each line's worst: `base` keeps it as the field-free ground. */
  const sample = async (base: boolean) => {
    const png = (await page.screenshot({ scale: 'css' })).toString('base64')
    await page.evaluate(
      async ({ png, base }) => {
        const img = new Image()
        img.src = `data:image/png;base64,${png}`
        await img.decode()
        const canvas = document.createElement('canvas')
        canvas.width = img.naturalWidth
        canvas.height = img.naturalHeight
        const ctx = canvas.getContext('2d', { willReadFrequently: true })!
        ctx.drawImage(img, 0, 0)
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
        const state = (
          window as unknown as {
            __painted: {
              lines: {
                color: number[]
                rects: number[][]
                ratio?: number
                field?: number
              }[]
              base: Uint8ClampedArray | null
            }
          }
        ).__painted
        if (base) {
          state.base = data
          return
        }
        const lin = Array.from({ length: 256 }, (_, v) => {
          const c = v / 255
          return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
        })
        const lum = (r: number, g: number, b: number) =>
          0.2126 * lin[r] + 0.7152 * lin[g] + 0.0722 * lin[b]
        for (const line of state.lines) {
          const [tr, tg, tb, ta] = line.color
          let worst = line.ratio ?? Infinity
          let field = line.field ?? 0
          for (const [x0, y0, x1, y1] of line.rects) {
            for (let y = y0; y < y1; y++) {
              for (let x = x0; x < x1; x++) {
                const i = (y * canvas.width + x) * 4
                const br = data[i]
                const bg = data[i + 1]
                const bb = data[i + 2]
                const back = lum(br, bg, bb)
                const fore = lum(
                  Math.round(ta * tr + (1 - ta) * br),
                  Math.round(ta * tg + (1 - ta) * bg),
                  Math.round(ta * tb + (1 - ta) * bb)
                )
                const ratio = (Math.max(back, fore) + 0.05) / (Math.min(back, fore) + 0.05)
                if (ratio < worst) worst = ratio
                if (state.base) {
                  const d = Math.max(
                    Math.abs(br - state.base[i]),
                    Math.abs(bg - state.base[i + 1]),
                    Math.abs(bb - state.base[i + 2])
                  )
                  if (d > field) field = d
                }
              }
            }
          }
          line.ratio = worst
          line.field = field
        }
      },
      { png, base }
    )
  }

  const style = (id: string, css: string) =>
    page.evaluate(
      ({ id, css }) => {
        const el = document.createElement('style')
        el.id = id
        el.textContent = css
        document.head.append(el)
      },
      { id, css }
    )
  const unstyle = (id: string) => page.evaluate((id) => document.getElementById(id)?.remove(), id)

  // The text goes transparent, and with it a caret, a placeholder and an underline.
  await style(
    HIDE_TEXT,
    `${PANEL} *, ${PANEL} *::before, ${PANEL} *::after, ${PANEL} *::placeholder {
      color: transparent !important;
      -webkit-text-fill-color: transparent !important;
      text-shadow: none !important;
      caret-color: transparent !important;
    }`
  )
  try {
    // The ground with no orbit field at all, for the field's share of each line's ground.
    const fieldShows = await page.evaluate((FIELD) => {
      const field = document.querySelector(FIELD)
      return !!field && window.getComputedStyle(field).display !== 'none'
    }, FIELD)
    if (fieldShows) {
      await style(HIDE_FIELD, `${FIELD} { visibility: hidden !important; }`)
      await sample(true)
      await unstyle(HIDE_FIELD)
    }
    // The field's orbits, stopped at evenly spaced points; a field that does not move, once.
    const moving = await page.evaluate(
      (FIELD) =>
        document.getAnimations().filter((a) => {
          const target = (a.effect as KeyframeEffect | null)?.target
          return !!target && !!document.querySelector(FIELD)?.contains(target)
        }).length,
      FIELD
    )
    for (let k = 0; k < (moving > 0 ? phases : 1); k++) {
      await page.evaluate(
        ({ FIELD, phase }) => {
          const field = document.querySelector(FIELD)
          for (const a of document.getAnimations()) {
            const target = (a.effect as KeyframeEffect | null)?.target
            if (!target || !field?.contains(target)) continue
            a.pause()
            a.currentTime = Number(a.effect!.getComputedTiming().duration) * phase
          }
          // Two frames: the paused positions are painted before the capture.
          return new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve))
          )
        },
        { FIELD, phase: k / phases }
      )
      await sample(false)
    }
  } finally {
    await unstyle(HIDE_TEXT)
    await page.evaluate((FIELD) => {
      const field = document.querySelector(FIELD)
      for (const a of document.getAnimations()) {
        const target = (a.effect as KeyframeEffect | null)?.target
        if (target && field?.contains(target)) a.play()
      }
    }, FIELD)
  }

  return page.evaluate(() => {
    const state = (
      window as unknown as {
        __painted: {
          lines: { what: string; need: number; ratio?: number; field?: number }[]
        }
      }
    ).__painted
    return state.lines.map((line) => ({
      what: line.what,
      ratio: Math.floor((line.ratio ?? Infinity) * 100) / 100,
      need: line.need,
      field: line.field ?? 0,
    }))
  })
}
