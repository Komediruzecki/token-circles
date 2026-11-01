/**
 * The Spotlight component's side of tip placement: what it feeds placeTip, and when it scrolls.
 *
 * placeTip itself is covered in spotlightPlacement.test.ts. These pin the two things only the
 * component can get wrong: it must measure the tip it renders rather than assume a size, and it
 * must bring a step's target into view once, when the step starts, not again on every scroll.
 * The old one did both wrong: a 140px tip on a phone where the real one is about 207px, and a
 * scroll handler that pulled the page back to any target taller than the screen, so a user could
 * not scroll through it while its step was open.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  endSpotlight,
  setSpotlightActive,
  setSpotlightStep,
  setTourSteps,
} from '../../core/spotlightStore'
import Spotlight from '../Spotlight'
import type { SpotlightStep } from '../../core/spotlightStore'

const settle = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

const PHONE = { width: 390, height: 844 }

let host: HTMLDivElement | undefined
let dispose: (() => void) | undefined
let scrollCalls: string[]
const anchors: HTMLElement[] = []
const saved = { w: window.innerWidth, h: window.innerHeight }

/** jsdom has no layout: give an anchor the rect a phone would. */
const anchor = (key: string, r: { top: number; left: number; width: number; height: number }) => {
  const el = document.createElement('div')
  el.setAttribute('data-tour', key)
  el.getBoundingClientRect = () =>
    ({
      ...r,
      x: r.left,
      y: r.top,
      right: r.left + r.width,
      bottom: r.top + r.height,
      toJSON: () => r,
    }) as DOMRect
  document.body.appendChild(el)
  anchors.push(el)
  return el
}

const step = (key: string, placement: SpotlightStep['placement'] = 'bottom'): SpotlightStep => ({
  targetSelector: `[data-tour="${key}"]`,
  title: `Step on ${key}`,
  description: 'Copy long enough to wrap onto a few lines in a 320px tip.',
  placement,
})

/** The rendered tip: the element holding the step counter. */
const tipEl = (): HTMLElement => {
  const counter = Array.from(host!.querySelectorAll('div')).find((d) =>
    /^Step \d+ of \d+$/.test(d.textContent?.trim() ?? '')
  )
  return counter!.parentElement as HTMLElement
}

const start = (steps: SpotlightStep[]) => {
  setTourSteps(steps)
  setSpotlightStep(0)
  setSpotlightActive(true)
  host = document.createElement('div')
  document.body.appendChild(host)
  dispose = render(() => <Spotlight />, host)
}

beforeEach(() => {
  scrollCalls = []
  Element.prototype.scrollIntoView = function (this: Element) {
    scrollCalls.push(this.getAttribute('data-tour') ?? '?')
  }
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: PHONE.width })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: PHONE.height })
})

afterEach(() => {
  dispose?.()
  dispose = undefined
  host?.remove()
  host = undefined
  for (const a of anchors.splice(0)) a.remove()
  endSpotlight()
  setSpotlightActive(false)
  setTourSteps([])
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: saved.w })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: saved.h })
  vi.restoreAllMocks()
})

describe('Spotlight measures its tip', () => {
  it('places the tip by the height it measures, not a guessed one', async () => {
    // A full-width card ending at 640: 844 - 640 - 8 - 12 = 184px below. A 150px tip fits there,
    // the 247px fallback would not. So 'below' proves the measured height was used.
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(150)
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(320)
    anchor('card', { top: 340, left: 25, width: 340, height: 300 })
    start([step('card')])
    await settle(150)
    expect(tipEl().style.top).toBe(`${340 + 300 + 8}px`)
    // A phone: the tip is pinned 16px in, not centred under the card at 35px.
    expect(tipEl().style.left).toBe('16px')
  })

  it('centres the tip under its target on a wider screen', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 })
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(150)
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(320)
    anchor('card', { top: 200, left: 600, width: 100, height: 40 })
    start([step('card')])
    await settle(150)
    expect(tipEl().style.top).toBe('248px')
    expect(tipEl().style.left).toBe('490px')
  })

  it('falls back to a tall tip when it cannot measure one', async () => {
    // jsdom lays nothing out, so offsetHeight is 0 here, as it would be for an unrendered tip.
    // 184px below is not enough for the 247px fallback; 340 - 8 - 247 = 85 above is fine.
    anchor('card', { top: 340, left: 25, width: 340, height: 300 })
    start([step('card')])
    await settle(150)
    expect(tipEl().style.top).toBe(`${340 - 8 - 247}px`)
  })
})

describe('Spotlight scrolls a target into view once per step', () => {
  it('does not pull the page back when the user scrolls during a step', async () => {
    // Taller than the screen, so it can never sit 80px clear of both edges.
    anchor('tall', { top: -200, left: 25, width: 340, height: 1200 })
    start([step('tall')])
    await settle(150)
    const atStart = scrollCalls.length
    expect(atStart).toBeGreaterThan(0)
    for (let i = 0; i < 3; i++) window.dispatchEvent(new Event('scroll'))
    await settle(50)
    expect(scrollCalls.length).toBe(atStart)
  })

  it('still repositions the tip on scroll', async () => {
    const el = anchor('card', { top: 100, left: 95, width: 200, height: 100 })
    start([step('card')])
    await settle(150)
    expect(tipEl().style.top).toBe(`${100 + 100 + 8}px`)
    el.getBoundingClientRect = () =>
      ({ top: 60, left: 95, width: 200, height: 100, right: 295, bottom: 160 }) as DOMRect
    window.dispatchEvent(new Event('scroll'))
    await settle(20)
    expect(tipEl().style.top).toBe(`${60 + 100 + 8}px`)
  })

  it('scrolls again for the next step’s target', async () => {
    anchor('first', { top: 900, left: 25, width: 340, height: 100 })
    anchor('second', { top: 1400, left: 25, width: 340, height: 100 })
    start([step('first'), step('second')])
    await settle(150)
    expect(scrollCalls).toContain('first')
    setSpotlightStep(1)
    await settle(150)
    expect(scrollCalls).toContain('second')
  })

  it('leaves a target that is already in view where it is', async () => {
    anchor('card', { top: 200, left: 25, width: 340, height: 100 })
    start([step('card')])
    await settle(150)
    expect(scrollCalls).toEqual([])
  })
})
