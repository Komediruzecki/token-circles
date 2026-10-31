/**
 * Progress's addresses: `#progress/<n>` opens circle n, `#progress/prints` the page at its prints;
 * anything else is the page.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  circleFromHash,
  circleHash,
  isProgressHash,
  openPrints,
  PRINTS_HASH,
  sectionFromHash,
} from '../progressRoute'

describe("Progress's addresses", () => {
  it('reads the circle a path opens, with or without a query', () => {
    expect(circleFromHash('#progress/1')).toBe(1)
    expect(circleFromHash('#progress/7')).toBe(7)
    expect(circleFromHash('progress/4')).toBe(4)
    expect(circleFromHash('#progress/4?period=2026-10')).toBe(4)
  })

  it('reads the page itself for anything that is not a circle from 1 to 7', () => {
    for (const hash of [
      '#progress',
      '#progress/',
      '#progress/0',
      '#progress/8',
      '#progress/04',
      '#progress/4/checks',
      '#progress/four',
      '#loans/4',
      '',
    ]) {
      expect(circleFromHash(hash)).toBeNull()
    }
  })

  it('writes the address of a circle, and of the page', () => {
    expect(circleHash(3)).toBe('#progress/3')
    expect(circleHash(null)).toBe('#progress')
  })

  it("tells Progress's addresses from other pages'", () => {
    expect(isProgressHash('#progress')).toBe(true)
    expect(isProgressHash('#progress/2?period=2026-10')).toBe(true)
    expect(isProgressHash('#progresses')).toBe(false)
    expect(isProgressHash('#budgets')).toBe(false)
  })
})

describe('the prints address', () => {
  afterEach(() => {
    window.location.hash = ''
  })

  it('names the Prints section, with or without a query, and is no circle', () => {
    expect(sectionFromHash('#progress/prints')).toBe('prints')
    expect(sectionFromHash('progress/prints?period=2026-10')).toBe('prints')
    expect(circleFromHash('#progress/prints')).toBeNull()
    expect(isProgressHash(PRINTS_HASH)).toBe(true)
    for (const hash of [
      '#progress',
      '#progress/3',
      '#progress/prints/2',
      '#prints',
      '#loans/prints',
    ]) {
      expect(sectionFromHash(hash)).toBeNull()
    }
  })

  it('opens Progress at its prints, and asked again from there tells the page again', () => {
    window.location.hash = '#dashboard'
    openPrints()
    expect(window.location.hash).toBe(PRINTS_HASH)
    const heard = vi.fn()
    window.addEventListener('hashchange', heard)
    openPrints()
    window.removeEventListener('hashchange', heard)
    expect(heard).toHaveBeenCalledTimes(1)
    expect(window.location.hash).toBe(PRINTS_HASH)
  })
})
