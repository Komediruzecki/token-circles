/** Progress's addresses: `#progress/<n>` opens circle n; anything else is the page. */
import { describe, expect, it } from 'vitest'
import { circleFromHash, circleHash, isProgressHash } from '../progressRoute'

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
