/**
 * Calls `ready` once: when `el` has been at least `ratio` in view for `dwellMs`, so motion waits
 * for a settled view instead of playing while the page flies past, or `fallbackMs` after any of it
 * first came into view, so whatever waits on this can never stay hidden.
 *
 * Plain rect checks on scroll (in the capture phase, so inner scrollers count), on resize and on a
 * 900 ms heartbeat, as OrbitalDivider does: IntersectionObserver and requestAnimationFrame are
 * suspended in throttled and background tabs. Returns a function that stops waiting.
 */
export interface SettledOptions {
  /** How much of the element must be on screen, 0 to 1. */
  ratio?: number
  /** How long it must stay that way, in ms. */
  dwellMs?: number
  /** How long after it first shows at all to go ahead anyway, in ms. */
  fallbackMs?: number
}

const HEARTBEAT_MS = 900

/** The share of `el`'s box inside the viewport, 0 when it has no box (hidden, not laid out). */
export function shareInView(el: Element): number {
  const r = el.getBoundingClientRect()
  if (r.width <= 0 || r.height <= 0) return 0
  const h = Math.max(0, Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0))
  const w = Math.max(0, Math.min(r.right, window.innerWidth) - Math.max(r.left, 0))
  return (h * w) / (r.width * r.height)
}

export function whenSettledInView(
  el: Element,
  ready: () => void,
  { ratio = 0.7, dwellMs = 500, fallbackMs = 3000 }: SettledOptions = {}
): () => void {
  let done = false
  let dwell: ReturnType<typeof setTimeout> | undefined
  let fallback: ReturnType<typeof setTimeout> | undefined

  const stop = (): void => {
    window.removeEventListener('scroll', check, true)
    window.removeEventListener('resize', check)
    clearInterval(heartbeat)
    clearTimeout(kickoff)
    clearTimeout(dwell)
    clearTimeout(fallback)
  }
  const fire = (): void => {
    if (done) return
    done = true
    stop()
    ready()
  }

  function check(): void {
    if (done) return
    const share = shareInView(el)
    if (share > 0 && fallback === undefined) fallback = setTimeout(fire, fallbackMs)
    if (share >= ratio) {
      if (dwell === undefined) {
        dwell = setTimeout(() => {
          dwell = undefined
          if (shareInView(el) >= ratio) fire()
          else check()
        }, dwellMs)
      }
    } else if (dwell !== undefined) {
      clearTimeout(dwell)
      dwell = undefined
    }
  }

  window.addEventListener('scroll', check, { passive: true, capture: true })
  window.addEventListener('resize', check)
  // One tick first, so a seal already on screen when it mounts is measured once laid out.
  const kickoff = setTimeout(check, 30)
  const heartbeat = setInterval(check, HEARTBEAT_MS)
  return () => {
    done = true
    stop()
  }
}
