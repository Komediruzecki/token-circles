/**
 * Scrolls an element to the top of the view, and keeps it there while the page above it is still
 * filling in: Progress opened at `#progress/prints` draws its circles, advice and the shelf as the
 * badges' snapshot arrives, and each one would carry the section further down.
 *
 * The element is checked every 100 ms. Once it is there, it is scrolled to, and again whenever it
 * has moved, for `forMs`; an element that never turns up is given up on after `waitMs`. The
 * person's own scroll, tap or key ends it at once, so it never fights them.
 */
const EVERY_MS = 100
const PERSON = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const

export function scrollAndHold(
  target: () => Element | null,
  { forMs = 3000, waitMs = 10_000 }: { forMs?: number; waitMs?: number } = {}
): () => void {
  let at: number | null = null
  let end = setTimeout(stop, waitMs)
  const place = (): void => {
    const el = target()
    if (!el) return
    const top = el.getBoundingClientRect().top
    if (at !== null && Math.abs(top - at) < 1) return
    if (at === null) {
      clearTimeout(end)
      end = setTimeout(stop, forMs)
    }
    el.scrollIntoView({ block: 'start' })
    at = el.getBoundingClientRect().top
  }
  const tick = setInterval(place, EVERY_MS)
  for (const type of PERSON) window.addEventListener(type, stop, { capture: true, passive: true })
  place()

  function stop(): void {
    clearInterval(tick)
    clearTimeout(end)
    for (const type of PERSON) window.removeEventListener(type, stop, { capture: true })
  }
  return stop
}
