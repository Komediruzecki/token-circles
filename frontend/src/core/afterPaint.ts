/**
 * Run `fn` once the browser has painted what is on screen now: a frame, then a task. Falls back to
 * a task where there are no frames. Getting started and the circles work their numbers out this
 * way, so the page a person opened paints before the arithmetic starts.
 */
export function afterPaint(fn: () => void): void {
  if (typeof requestAnimationFrame === 'undefined') {
    setTimeout(fn, 0)
    return
  }
  requestAnimationFrame(() => setTimeout(fn, 0))
}
