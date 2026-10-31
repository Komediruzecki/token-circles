/**
 * Scroll to an element and keep it there while the page above it fills in
 * (core/scrollAndHold.ts), until the person moves the page themselves.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { scrollAndHold } from '../scrollAndHold'

/** An element whose top is wherever the page last put it; scrolling to it puts it at 18 px. */
function section(top: number) {
  const el = document.createElement('div')
  let at = top
  el.getBoundingClientRect = () => ({ top: at, bottom: at + 40, height: 40 }) as DOMRect
  const scroll = vi.fn(() => {
    at = 18
  })
  el.scrollIntoView = scroll
  return {
    el,
    scroll,
    push: (by: number) => {
      at += by
    },
  }
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('scrollAndHold', () => {
  it('scrolls to it at once, and again each time the page pushes it down', () => {
    const s = section(900)
    scrollAndHold(() => s.el)
    expect(s.scroll).toHaveBeenCalledTimes(1)
    expect(s.scroll).toHaveBeenCalledWith({ block: 'start' })
    vi.advanceTimersByTime(500)
    expect(s.scroll).toHaveBeenCalledTimes(1)
    s.push(320)
    vi.advanceTimersByTime(100)
    expect(s.scroll).toHaveBeenCalledTimes(2)
  })

  it('waits for an element that is not there yet', () => {
    const s = section(900)
    let there = false
    scrollAndHold(() => (there ? s.el : null))
    vi.advanceTimersByTime(4000)
    expect(s.scroll).not.toHaveBeenCalled()
    there = true
    vi.advanceTimersByTime(100)
    expect(s.scroll).toHaveBeenCalledTimes(1)
    // Held for 3 s from when it was found, not from the start.
    s.push(200)
    vi.advanceTimersByTime(2800)
    expect(s.scroll).toHaveBeenCalledTimes(2)
  })

  it("lets go after 3 s, or at once on the person's own scroll, tap or key", () => {
    for (const end of ['time', 'wheel', 'touchstart', 'pointerdown', 'keydown']) {
      const s = section(900)
      scrollAndHold(() => s.el)
      if (end === 'time') vi.advanceTimersByTime(3000)
      else window.dispatchEvent(new Event(end))
      s.push(300)
      vi.advanceTimersByTime(1000)
      expect(s.scroll, end).toHaveBeenCalledTimes(1)
      expect(vi.getTimerCount(), end).toBe(0)
    }
  })

  it('gives up on an element that never comes', () => {
    scrollAndHold(() => null)
    vi.advanceTimersByTime(10_000)
    expect(vi.getTimerCount()).toBe(0)
  })
})
