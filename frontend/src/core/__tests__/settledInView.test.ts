/**
 * Motion waits for a settled view (core/settledInView.ts): 70% of the element on screen for
 * 500 ms, or 3 s after any of it showed, so what waits on it never stays hidden.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { shareInView, whenSettledInView } from '../settledInView'

/** An element whose box is `top` px from the viewport's top, 400 px tall, 400 px wide. */
function box(top: number): { el: HTMLDivElement; move: (to: number) => void } {
  const el = document.createElement('div')
  let at = top
  el.getBoundingClientRect = () =>
    ({ top: at, bottom: at + 400, left: 0, right: 400, width: 400, height: 400 }) as DOMRect
  return {
    el,
    move: (to) => {
      at = to
      window.dispatchEvent(new Event('scroll'))
    },
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('innerHeight', 800)
  vi.stubGlobal('innerWidth', 1000)
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('shareInView', () => {
  it('measures how much of the box is on screen', () => {
    expect(shareInView(box(100).el)).toBe(1)
    expect(shareInView(box(600).el)).toBe(0.5)
    expect(shareInView(box(900).el)).toBe(0)
  })
})

describe('whenSettledInView', () => {
  it('goes ahead once 70% has stayed in view for 500 ms', () => {
    const ready = vi.fn()
    whenSettledInView(box(100).el, ready)
    vi.advanceTimersByTime(30 + 499)
    expect(ready).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(ready).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(10_000)
    expect(ready).toHaveBeenCalledTimes(1)
  })

  it('starts the wait again when the box leaves before the 500 ms are up', () => {
    const ready = vi.fn()
    const { el, move } = box(100)
    whenSettledInView(el, ready, { fallbackMs: 60_000 })
    vi.advanceTimersByTime(30 + 300)
    move(1200)
    vi.advanceTimersByTime(400)
    expect(ready).not.toHaveBeenCalled()
    move(100)
    vi.advanceTimersByTime(499)
    expect(ready).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(ready).toHaveBeenCalledTimes(1)
  })

  it('goes ahead 3 s after any of it showed, even if never 70%', () => {
    const ready = vi.fn()
    whenSettledInView(box(640).el, ready)
    vi.advanceTimersByTime(30 + 2999)
    expect(ready).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(ready).toHaveBeenCalledTimes(1)
  })

  it('waits while none of it is on screen, and notices it on the heartbeat', () => {
    const ready = vi.fn()
    const box2 = box(2000)
    whenSettledInView(box2.el, ready)
    vi.advanceTimersByTime(10_000)
    expect(ready).not.toHaveBeenCalled()
    // Moved into view without a scroll event: the heartbeat finds it.
    box2.el.getBoundingClientRect = () =>
      ({ top: 0, bottom: 400, left: 0, right: 400, width: 400, height: 400 }) as DOMRect
    vi.advanceTimersByTime(900 + 500)
    expect(ready).toHaveBeenCalledTimes(1)
  })

  it('never goes ahead once stopped', () => {
    const ready = vi.fn()
    const stop = whenSettledInView(box(100).el, ready)
    stop()
    vi.advanceTimersByTime(10_000)
    expect(ready).not.toHaveBeenCalled()
  })
})
