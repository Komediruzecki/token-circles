/**
 * The phone floors the circles' parts keep (circles part 2, measured at 390 px): every target 48 px
 * both ways, and every piece of text 12 px or more as drawn, SVG text by the size its drawing
 * scales it to. A native input is measured by the label it sits in.
 */
import type { Page } from '@playwright/test'

export interface Floors {
  /** Targets under 48 px, as "<text> <width>x<height>". */
  targets: string[]
  /** Text under 12 px, as "<text> <size>px". */
  text: string[]
}

/** What under `roots` falls below the floors; both lists empty when nothing does. */
export async function phoneFloors(page: Page, roots: string[]): Promise<Floors> {
  return page.evaluate((selectors) => {
    const shown = (el: Element): boolean => {
      const box = el.getBoundingClientRect()
      return (
        box.width > 0 &&
        box.height > 0 &&
        el.checkVisibility({
          contentVisibilityAuto: true,
          opacityProperty: true,
          visibilityProperty: true,
        })
      )
    }
    const targets: string[] = []
    const text: string[] = []
    for (const selector of selectors) {
      for (const root of document.querySelectorAll(selector)) {
        if (!shown(root)) continue
        for (const el of root.querySelectorAll(
          'a[href], button, input, select, textarea, summary'
        )) {
          if (!shown(el)) continue
          const box = (el.closest('label') ?? el).getBoundingClientRect()
          if (box.width < 48 || box.height < 48) {
            const words = (el.textContent ?? '').trim().slice(0, 40)
            targets.push(`${words} ${Math.round(box.width)}x${Math.round(box.height)}`)
          }
        }
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const words = (node.textContent ?? '').trim()
          const el = node.parentElement
          if (!words || !el || !shown(el)) continue
          let px = parseFloat(window.getComputedStyle(el).fontSize)
          const svg = el.closest('svg')
          const drawn = svg?.viewBox.baseVal?.width
          if (svg && drawn) px *= svg.getBoundingClientRect().width / drawn
          if (px < 11.995) text.push(`${words.slice(0, 40)} ${px.toFixed(2)}px`)
        }
      }
    }
    return { targets, text }
  }, roots)
}

/** How far the page scrolls sideways, in px: 0 when it does not. */
export function sideways(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
}
