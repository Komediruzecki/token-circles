import { render } from 'solid-js/web'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { JSX } from 'solid-js'

vi.mock('../../core/appStore', () => ({ setPage: vi.fn() }))
vi.mock('../../core/achievementsStore', () => ({
  unlocks: () => (globalThis as never as { __rail: RailState }).__rail.unlocks,
  streak: () => (globalThis as never as { __rail: RailState }).__rail.streak,
}))

interface RailState {
  unlocks: Array<{ id: string; earnedOn: string; unlockedAt: string }>
  streak: number
}
const state: RailState = { unlocks: [], streak: 0 }
;(globalThis as never as { __rail: RailState }).__rail = state

import { setPage } from '../../core/appStore'
import BadgeRail, { streakLabel } from '../BadgeRail'

let host: HTMLDivElement
let dispose: (() => void) | undefined
afterEach(() => {
  dispose?.()
  host?.remove()
  vi.mocked(setPage).mockClear()
})
const mount = (el: () => JSX.Element): HTMLDivElement => {
  host = document.createElement('div')
  document.body.appendChild(host)
  dispose = render(el, host)
  return host
}

describe('BadgeRail', () => {
  it('lists earned badges newest first, keyboard reachable, and opens Progress', () => {
    state.streak = 2
    state.unlocks = [
      { id: 'first-entry', earnedOn: '2026-07-01', unlockedAt: '2026-07-02T00:00:00.000Z' },
      { id: 'one-month', earnedOn: '2026-08-01', unlockedAt: '2026-08-03T00:00:00.000Z' },
    ]
    const c = mount(() => <BadgeRail />)
    const items = [...c.querySelectorAll('[data-rail-item]')]
    expect(items).toHaveLength(2)
    expect(items[0].textContent).toContain('One month')
    expect(items[1].textContent).toContain('First entry')
    expect(c.textContent).toContain('2 months tracked')
    const list = c.querySelector('ul[aria-label]') as HTMLElement
    expect(list.getAttribute('tabindex')).toBe('0')
    ;(c.querySelector('[data-test-id="badges-see-all"]') as HTMLButtonElement).click()
    expect(setPage).toHaveBeenCalledWith('progress')
  })

  it('scrolls the shelf sideways on a wheel, and stops when unmounted', () => {
    state.streak = 1
    state.unlocks = [
      { id: 'first-entry', earnedOn: '2026-07-01', unlockedAt: '2026-07-02T00:00:00.000Z' },
    ]
    const c = mount(() => <BadgeRail />)
    const shelf = c.querySelector('ul[aria-label]') as HTMLElement
    // jsdom lays nothing out, so the strip has to be told it overflows.
    Object.defineProperty(shelf, 'scrollWidth', { value: 900, configurable: true })
    Object.defineProperty(shelf, 'clientWidth', { value: 300, configurable: true })
    const roll = (): boolean => {
      const e = new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true })
      shelf.dispatchEvent(e)
      return e.defaultPrevented
    }
    expect(roll()).toBe(true)
    expect(shelf.scrollLeft).toBe(120)
    // The listener is registered through onCleanup in the ref callback; disposing must drop it.
    dispose?.()
    dispose = undefined
    expect(roll()).toBe(false)
    expect(shelf.scrollLeft).toBe(120)
  })

  it('says what will appear before the first badge is earned', () => {
    state.streak = 0
    state.unlocks = []
    const c = mount(() => <BadgeRail />)
    expect(c.querySelector('[data-test-id="badge-rail-empty"]')).not.toBeNull()
    expect(c.querySelectorAll('[data-rail-item]')).toHaveLength(0)
    expect(c.textContent).toContain('Start a streak')
  })

  it('pluralises the streak', () => {
    expect(streakLabel(0)).toBe('Start a streak')
    expect(streakLabel(1)).toBe('1 month tracked')
    expect(streakLabel(9)).toBe('9 months tracked')
  })
})
