/**
 * Where the tour's tip sits, decided without a DOM.
 *
 * On a 390x844 phone the tip is about 207px tall, and the engine used to assume 140. Worse, a
 * target wider than 75% of the screen got a tip centred on the screen before any side was tried,
 * so on a phone almost every step's tip sat on top of the thing it described. The walk measured
 * it on main (2026-11-01): see frontend/scripts/walk-tours.mjs, which now fails a step whose tip
 * covers its target when the screen has room for both.
 */
import { describe, expect, it } from 'vitest'
import { placeTip } from '../spotlightPlacement'
import type { TipRect } from '../spotlightPlacement'

const PHONE = { width: 390, height: 844 }
const DESKTOP = { width: 1280, height: 800 }
// The tip measured on a phone by the walk: 320px wide (CSS), 187-227px tall depending on copy.
const TIP = { width: 320, height: 207 }

const rect = (top: number, left: number, width: number, height: number): TipRect => ({
  top,
  left,
  width,
  height,
})

/** Rows and columns the tip shares with the target, as an area. */
const overlap = (
  tip: { top: number; left: number },
  size: { width: number; height: number },
  t: TipRect
): number => {
  const w = Math.min(tip.left + size.width, t.left + t.width) - Math.max(tip.left, t.left)
  const h = Math.min(tip.top + size.height, t.top + t.height) - Math.max(tip.top, t.top)
  return w > 0 && h > 0 ? w * h : 0
}

const onScreen = (
  tip: { top: number; left: number },
  size: { width: number; height: number },
  vp: { width: number; height: number }
): boolean =>
  tip.top >= 0 &&
  tip.left >= 0 &&
  tip.top + size.height <= vp.height &&
  tip.left + size.width <= vp.width

describe('placeTip on a phone, full-width target', () => {
  it('puts the tip below a full-width target when there is room below', () => {
    // The first-week Prints seal: 340 of 390px wide, 278-614 tall. 222px are left below it.
    const target = rect(278, 25, 340, 336)
    const p = placeTip({ viewport: PHONE, target, tip: TIP, preferred: 'bottom' })
    expect(p.placement).toBe('bottom')
    expect(p.top).toBe(278 + 336 + 8)
    expect(overlap(p, TIP, target)).toBe(0)
    expect(onScreen(p, TIP, PHONE)).toBe(true)
  })

  it('puts the tip above a full-width target when only the space above is big enough', () => {
    const target = rect(400, 25, 340, 400) // ends at 800: 44px below, 400px above
    const p = placeTip({ viewport: PHONE, target, tip: TIP, preferred: 'bottom' })
    expect(p.placement).toBe('top')
    expect(p.top).toBe(400 - 8 - 207)
    expect(overlap(p, TIP, target)).toBe(0)
  })

  it('honours the step’s preferred side when it fits, even with room on the other', () => {
    const target = rect(300, 25, 340, 200)
    const p = placeTip({ viewport: PHONE, target, tip: TIP, preferred: 'top' })
    expect(p.placement).toBe('top')
    expect(p.top).toBe(300 - 8 - 207)
  })

  it('covers the bottom edge when nothing fits and the bottom hides less', () => {
    // 30-770: 18px above and 74px below, neither enough. Pinned to the top of the screen the tip
    // would hide 12 + 207 - 30 = 189 rows; pinned to the bottom, 770 - 625 = 145.
    const target = rect(30, 0, 390, 740)
    const p = placeTip({ viewport: PHONE, target, tip: TIP, preferred: 'bottom' })
    expect(p.placement).toBe('over')
    expect(p.top).toBe(844 - 12 - 207)
    expect(overlap(p, TIP, target)).toBe(320 * 145)
  })

  it('covers the top edge when nothing fits and the top hides less', () => {
    // 100-840: pinned to the top it hides 219 - 100 = 119 rows, pinned to the bottom 207.
    const target = rect(100, 0, 390, 740)
    const p = placeTip({ viewport: PHONE, target, tip: TIP, preferred: 'bottom' })
    expect(p.placement).toBe('over')
    expect(p.top).toBe(12)
    expect(overlap(p, TIP, target)).toBe(320 * 119)
  })

  it('never covers a target when the screen has room for the tip beside it', () => {
    // Sweep a full-width band up and down the phone, at several heights.
    const covered: string[] = []
    for (let height = 40; height <= 600; height += 40) {
      for (let top = 0; top + height <= PHONE.height; top += 20) {
        const target = rect(top, 25, 340, height)
        const roomAbove = top - 8 - 12 >= TIP.height
        const roomBelow = PHONE.height - (top + height) - 8 - 12 >= TIP.height
        if (!roomAbove && !roomBelow) continue
        const p = placeTip({ viewport: PHONE, target, tip: TIP, preferred: 'bottom' })
        if (overlap(p, TIP, target) > 0 || !onScreen(p, TIP, PHONE)) {
          covered.push(`${top}+${height} -> ${p.placement} at ${p.top}`)
        }
      }
    }
    expect(covered).toEqual([])
  })
})

describe('placeTip with the tip pinned across a phone', () => {
  // At 480px and under the tip spans the screen 16px in from the left, whatever the target.
  const pinned = { viewport: PHONE, tip: TIP, pinnedLeft: 16 }

  it('keeps the pinned left edge above and below', () => {
    const below = placeTip({ ...pinned, target: rect(100, 200, 120, 40), preferred: 'bottom' })
    expect(below).toEqual({ placement: 'bottom', top: 148, left: 16 })
    const above = placeTip({ ...pinned, target: rect(600, 200, 120, 40), preferred: 'top' })
    expect(above).toEqual({ placement: 'top', top: 600 - 8 - 207, left: 16 })
  })

  it('never puts it beside a target, where the pin would drag it back over the target', () => {
    // A narrow target on the left with room to its right: unpinned that is a 'right' placement.
    const target = rect(300, 10, 40, 100)
    expect(
      placeTip({ viewport: PHONE, tip: { width: 300, height: 207 }, target, preferred: 'right' })
        .placement
    ).toBe('right')
    const p = placeTip({ ...pinned, target, preferred: 'right' })
    expect(p.placement).toBe('bottom')
    expect(p.left).toBe(16)
  })

  it('covers a top or bottom edge, not a side, when nothing fits', () => {
    // Narrow and full height: pinned, only the top or bottom edge of the screen is an option.
    const p = placeTip({ ...pinned, target: rect(10, 300, 80, 830), preferred: 'right' })
    expect(p.placement).toBe('over')
    expect(p.left).toBe(16)
  })
})

describe('placeTip uses the tip’s real height', () => {
  it('lifts a tip placed above by its measured height, not 140px', () => {
    // The Loans "What if" step on desktop: 94x48 at 647,405, preferred top. A 227px tip lifted
    // by 140 sat on the button it was describing.
    const target = rect(405, 647, 94, 48)
    const tip = { width: 320, height: 227 }
    const p = placeTip({ viewport: DESKTOP, target, tip, preferred: 'top' })
    expect(p.placement).toBe('top')
    expect(p.top).toBe(405 - 8 - 227)
    expect(overlap(p, tip, target)).toBe(0)
  })

  it('does not place a tip below when its real height would run off the screen', () => {
    // Ends at 625: 844 - 625 - 8 - 12 = 199px below, enough for the old 140px guess but not
    // for the real 207px tip, which would run 8px off the bottom of the screen.
    const target = rect(600, 25, 340, 25)
    const p = placeTip({ viewport: PHONE, target, tip: TIP, preferred: 'bottom' })
    expect(p.placement).toBe('top')
    expect(onScreen(p, TIP, PHONE)).toBe(true)
  })
})

describe('placeTip keeps the screen margin', () => {
  it('needs the 12px screen margin below as well as the 8px gap', () => {
    // 844 - 12 - 207 - 8 = 617: a target ending at 617 just fits below, one at 618 does not.
    const fits = placeTip({ viewport: PHONE, target: rect(500, 25, 340, 117), tip: TIP })
    expect(fits.placement).toBe('bottom')
    const short = placeTip({ viewport: PHONE, target: rect(500, 25, 340, 118), tip: TIP })
    expect(short.placement).not.toBe('bottom')
  })

  it('needs the 12px screen margin above as well as the 8px gap', () => {
    // 12 + 207 + 8 = 227: a target starting at 227 just fits above, one at 226 does not.
    const fits = placeTip({
      viewport: PHONE,
      target: rect(227, 25, 340, 600),
      tip: TIP,
      preferred: 'top',
    })
    expect(fits.placement).toBe('top')
    const short = placeTip({
      viewport: PHONE,
      target: rect(226, 25, 340, 600),
      tip: TIP,
      preferred: 'top',
    })
    expect(short.placement).not.toBe('top')
  })

  it('needs the 12px screen margin to the right as well as the 8px gap', () => {
    // A full-height column, so only the sides are in play. 1280 - 12 - 320 - 8 = 940.
    const at = (left: number) =>
      placeTip({
        viewport: DESKTOP,
        target: rect(20, left, 240, 760),
        tip: TIP,
        preferred: 'right',
      })
    expect(at(700).placement).toBe('right')
    expect(at(701).placement).not.toBe('right')
  })

  it('needs the 12px screen margin to the left as well as the 8px gap', () => {
    // 12 + 320 + 8 = 340: a column starting at 340 just fits a tip to its left.
    const at = (left: number) =>
      placeTip({ viewport: DESKTOP, target: rect(20, left, 600, 760), tip: TIP, preferred: 'left' })
    expect(at(340).placement).toBe('left')
    expect(at(339).placement).not.toBe('left')
  })

  it('sits a tip as wide as a small phone flush with it, not off its left edge', () => {
    // 320px screens exist (iPhone SE, first generation): no room for the 12px margins either side.
    const p = placeTip({
      viewport: { width: 320, height: 568 },
      target: rect(100, 20, 120, 40),
      tip: TIP,
      preferred: 'bottom',
    })
    expect(p).toEqual({ placement: 'bottom', top: 148, left: 0 })
  })

  it('keeps a tip below a target near the screen edge inside the screen', () => {
    const target = rect(100, 0, 60, 40) // a button hard against the left edge
    const p = placeTip({ viewport: PHONE, target, tip: TIP, preferred: 'bottom' })
    expect(p.placement).toBe('bottom')
    expect(p.left).toBe(12)
  })
})

describe('placeTip on desktop', () => {
  it('centres a tip under a small target, as it always did', () => {
    const target = rect(200, 600, 100, 40)
    const p = placeTip({ viewport: DESKTOP, target, tip: TIP, preferred: 'bottom' })
    expect(p).toEqual({ placement: 'bottom', top: 248, left: 490 })
  })

  it('puts a tip beside a tall narrow target', () => {
    // A sidebar-like column: no room above or below, plenty to the right.
    const target = rect(20, 20, 200, 760)
    const p = placeTip({ viewport: DESKTOP, target, tip: TIP, preferred: 'right' })
    expect(p.placement).toBe('right')
    expect(p.left).toBe(228)
    expect(overlap(p, TIP, target)).toBe(0)
    expect(onScreen(p, TIP, DESKTOP)).toBe(true)
  })

  it('falls back to the top when a target near the bottom has no room below', () => {
    const target = rect(700, 400, 200, 60)
    const p = placeTip({ viewport: DESKTOP, target, tip: TIP, preferred: 'bottom' })
    expect(p).toEqual({ placement: 'top', top: 700 - 8 - 207, left: 340 })
  })
})

/*
 * A target taller than the screen is scrolled to its start, which on a phone lands 48px down,
 * under the strip kept for the menu button. The walk measured Holdings, the category list and
 * Retirement's assumptions there: the tip took the top edge, because the strip is not target and
 * so the top edge hid less, and it sat on the heading the scroll had just shown.
 */
describe('placeTip over a target scrolled to its start', () => {
  const pinned = { viewport: PHONE, tip: TIP, pinnedLeft: 16 }
  // Holdings on a phone: 867px tall, its top at 48.
  const tall = rect(48, 14, 362, 867)

  it('covers it from the bottom edge, leaving its start on show', () => {
    const p = placeTip({ ...pinned, target: tall, preferred: 'top', fromStart: true })
    expect(p).toEqual({ placement: 'over', top: 844 - 12 - 207, left: 16 })
    expect(p.top).toBeGreaterThan(tall.top + 100)
  })

  it('took the top edge without it, because the top hides less', () => {
    // Pinned to the top the tip hides 219 - 48 = 171 rows; pinned to the bottom, 207.
    const p = placeTip({ ...pinned, target: tall, preferred: 'top' })
    expect(p.top).toBe(12)
  })

  it('still sits beside it when there is a side with room', () => {
    // Desktop, Retirement's assumptions: 1188px tall at x 290, so 278px to its left is too narrow
    // for a 320px tip and it covers the left edge, hiding 42 columns rather than a full width.
    const target = rect(0, 290, 940, 1188)
    const p = placeTip({ viewport: DESKTOP, tip: TIP, target, preferred: 'top', fromStart: true })
    expect(p.placement).toBe('over')
    expect(p.left).toBe(12)
  })

  it('leaves a target that fits alone', () => {
    // The case above where the top edge hides less: fromStart is only ever set for a tall target.
    const target = rect(100, 0, 390, 740)
    const p = placeTip({ viewport: PHONE, target, tip: TIP, preferred: 'bottom', fromStart: false })
    expect(p.top).toBe(12)
  })
})
