/**
 * Waiting for an element to reach the screen, two ways. `whenSettledInView` calls `ready` once
 * `el` has been at least `ratio` in view for `dwellMs`, so motion waits for a settled view instead
 * of playing while the page flies past, or `fallbackMs` after any of it first came into view, so
 * whatever waits on it can never stay hidden. `whenNearScreen` calls `ready` once `el` is within a
 * screen of the viewport, so work for it is done just before it is needed.
 *
 * Plain rect checks on scroll (in the capture phase, so inner scrollers count), on resize and on a
 * 900 ms heartbeat, as OrbitalDivider does: IntersectionObserver and requestAnimationFrame are
 * suspended in throttled and background tabs. Each returns a function that stops waiting.
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

/** Calls `check` on scroll (capture phase), on resize and on the heartbeat; returns stop. */
function watch(check: () => void): () => void {
  window.addEventListener('scroll', check, { passive: true, capture: true })
  window.addEventListener('resize', check)
  const heartbeat = setInterval(check, HEARTBEAT_MS)
  return () => {
    window.removeEventListener('scroll', check, true)
    window.removeEventListener('resize', check)
    clearInterval(heartbeat)
  }
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
    unwatch()
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

  const unwatch = watch(check)
  // One tick first, so a seal already on screen when it mounts is measured once laid out.
  const kickoff = setTimeout(check, 30)
  return () => {
    done = true
    stop()
  }
}

/** Whether any of `el` lies within one screen's height and width of the viewport. */
export function nearScreen(el: Element): boolean {
  const r = el.getBoundingClientRect()
  if (r.width <= 0 || r.height <= 0) return false
  const h = window.innerHeight
  const w = window.innerWidth
  return r.bottom > -h && r.top < 2 * h && r.right > -w && r.left < 2 * w
}

/** Elements waiting to come near the screen. They share one watch, stopped when none wait. */
const waiting = new Map<Element, () => void>()
let unwatchWaiting: (() => void) | null = null
let kick: ReturnType<typeof setTimeout> | undefined

function checkWaiting(): void {
  kick = undefined
  for (const [el, ready] of [...waiting]) {
    if (!waiting.has(el) || !nearScreen(el)) continue
    waiting.delete(el)
    ready()
  }
  if (waiting.size === 0) stopWaiting()
}

function stopWaiting(): void {
  unwatchWaiting?.()
  unwatchWaiting = null
  clearTimeout(kick)
  kick = undefined
}

export function whenNearScreen(el: Element, ready: () => void): () => void {
  waiting.set(el, ready)
  unwatchWaiting ??= watch(checkWaiting)
  // Measured once laid out, a tick after the last one to arrive.
  kick ??= setTimeout(checkWaiting, 30)
  return () => {
    waiting.delete(el)
    if (waiting.size === 0) stopWaiting()
  }
}
