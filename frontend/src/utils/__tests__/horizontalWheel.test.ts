import { afterEach, describe, expect, it } from 'vitest'
import { scrollHorizontallyOnWheel } from '../horizontalWheel'

/** jsdom lays nothing out, so the scroll geometry has to be stated. */
const strip = (scrollWidth: number, clientWidth: number, scrollLeft = 0): HTMLElement => {
  const el = document.createElement('div')
  Object.defineProperty(el, 'scrollWidth', { value: scrollWidth, configurable: true })
  Object.defineProperty(el, 'clientWidth', { value: clientWidth, configurable: true })
  el.scrollLeft = scrollLeft
  document.body.appendChild(el)
  return el
}

const wheel = (el: HTMLElement, init: WheelEventInit): boolean => {
  const e = new WheelEvent('wheel', { ...init, bubbles: true, cancelable: true })
  el.dispatchEvent(e)
  return e.defaultPrevented
}

afterEach(() => {
  document.body.replaceChildren()
})

describe('scrollHorizontallyOnWheel', () => {
  it('turns a vertical wheel into sideways movement', () => {
    const el = strip(1000, 400)
    scrollHorizontallyOnWheel(el)
    expect(wheel(el, { deltaY: 120 })).toBe(true)
    expect(el.scrollLeft).toBe(120)
  })

  it('scrolls back up the strip', () => {
    const el = strip(1000, 400, 300)
    scrollHorizontallyOnWheel(el)
    expect(wheel(el, { deltaY: -120 })).toBe(true)
    expect(el.scrollLeft).toBe(180)
  })

  it('hands the page its scroll back at either end', () => {
    const start = strip(1000, 400, 0)
    scrollHorizontallyOnWheel(start)
    expect(wheel(start, { deltaY: -120 })).toBe(false)
    expect(start.scrollLeft).toBe(0)

    const end = strip(1000, 400, 600)
    scrollHorizontallyOnWheel(end)
    expect(wheel(end, { deltaY: 120 })).toBe(false)
    expect(end.scrollLeft).toBe(600)
  })

  it('leaves the page alone when there is nothing to scroll', () => {
    const el = strip(400, 400)
    scrollHorizontallyOnWheel(el)
    expect(wheel(el, { deltaY: 120 })).toBe(false)
  })

  it('does not fight a trackpad already scrolling sideways, or a pinch zoom', () => {
    const el = strip(1000, 400)
    scrollHorizontallyOnWheel(el)
    expect(wheel(el, { deltaX: 90, deltaY: 10 })).toBe(false)
    expect(wheel(el, { deltaY: 120, ctrlKey: true })).toBe(false)
    expect(el.scrollLeft).toBe(0)
  })

  it('reads a line-mode notch as pixels', () => {
    const el = strip(1000, 400)
    scrollHorizontallyOnWheel(el)
    wheel(el, { deltaY: 3, deltaMode: WheelEvent.DOM_DELTA_LINE })
    expect(el.scrollLeft).toBe(48)
  })

  it('clamps to the far end rather than overshooting', () => {
    const el = strip(1000, 400, 500)
    scrollHorizontallyOnWheel(el)
    wheel(el, { deltaY: 5000 })
    expect(el.scrollLeft).toBe(600)
  })

  it('detaches', () => {
    const el = strip(1000, 400)
    scrollHorizontallyOnWheel(el)()
    expect(wheel(el, { deltaY: 120 })).toBe(false)
    expect(el.scrollLeft).toBe(0)
  })
})
