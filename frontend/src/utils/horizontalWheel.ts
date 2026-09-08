/**
 * A wheel over a sideways strip should move the strip, not the page.
 *
 * Two things make this behave rather than annoy:
 *
 * 1. **It hands the scroll back at the ends.** `preventDefault` is only called while the strip
 *    can still move the way the wheel is pointing, so the last badge is not a wall the page
 *    scroll cannot get past — the pointer does not have to leave the strip.
 * 2. **A sideways gesture is left alone.** A trackpad already scrolls this element with
 *    `deltaX`; only the vertical part is redirected, so the two do not fight.
 *
 * Registered `{ passive: false }` on purpose: Chrome makes wheel listeners passive by default
 * and a passive listener cannot `preventDefault` at all.
 */

/** A wheel notch in `DOM_DELTA_LINE` mode is a line count, not pixels (Firefox reports 3). */
const PIXELS_PER_LINE = 16

/** Attaches the handler; returns the function that removes it. */
export function scrollHorizontallyOnWheel(el: HTMLElement): () => void {
  const onWheel = (e: WheelEvent): void => {
    if (e.ctrlKey) return // pinch-to-zoom, not a scroll
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return // already scrolling us sideways
    const scale =
      e.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? PIXELS_PER_LINE
        : e.deltaMode === WheelEvent.DOM_DELTA_PAGE
          ? el.clientWidth
          : 1
    const delta = e.deltaY * scale
    if (delta === 0) return
    const max = el.scrollWidth - el.clientWidth
    if (max <= 0) return // nothing to scroll: leave the page alone
    // Within a pixel of the end, in the direction asked for — the page takes over from here.
    if (delta < 0 ? el.scrollLeft <= 0 : el.scrollLeft >= max - 1) return
    e.preventDefault()
    el.scrollLeft = Math.min(max, Math.max(0, el.scrollLeft + delta))
  }
  el.addEventListener('wheel', onWheel, { passive: false })
  return () => {
    el.removeEventListener('wheel', onWheel)
  }
}
