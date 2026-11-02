/**
 * Every print's thumbnail (core/prints/thumbs.ts): a `data:` image in PAPER's literal colours,
 * drawn once per set of shares, and drawn in turn, at most two to a task.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SAMPLE_SLOTS } from '../../../../shared/fixtures/sealSample'
import * as seal from '../../../../shared/prints/seal'
import { inTurn, PER_TASK, thumbSrc } from '../prints/thumbs'

vi.mock('../../../../shared/prints/seal', async (load) => {
  const actual = await load<typeof seal>()
  return { ...actual, drawSeal: vi.fn(actual.drawSeal) }
})

describe('thumbSrc', () => {
  it('is an image of the print on paper that needs no theme', () => {
    const src = thumbSrc(SAMPLE_SLOTS)
    expect(src.startsWith('data:image/svg+xml;utf8,')).toBe(true)
    const svg = decodeURIComponent(src.slice('data:image/svg+xml;utf8,'.length))
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true)
    expect(svg).toContain(seal.PAPER.ground!)
    // CSS variables do not resolve inside an <img>: none may be left in it.
    expect(svg).not.toContain('var(')
  })

  it('draws each set of shares once', () => {
    const draw = vi.mocked(seal.drawSeal)
    draw.mockClear()
    const twin = SAMPLE_SLOTS.map((slot) => (slot ? { ...slot } : null))
    const shifted = [...SAMPLE_SLOTS.slice(1), null]
    thumbSrc(shifted)
    thumbSrc(twin.slice(1).concat(null))
    expect(draw).toHaveBeenCalledTimes(1)
    expect(draw).toHaveBeenCalledWith(shifted, { palette: seal.PAPER, detail: 'thumb' })
  })
})

describe('inTurn', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it(`runs at most ${PER_TASK} jobs a task, in order`, () => {
    const ran: number[] = []
    for (let i = 0; i < 5; i++) inTurn(() => ran.push(i))
    expect(ran).toEqual([])
    vi.advanceTimersToNextTimer()
    expect(ran).toEqual([0, 1])
    vi.advanceTimersToNextTimer()
    expect(ran).toEqual([0, 1, 2, 3])
    vi.advanceTimersToNextTimer()
    expect(ran).toEqual([0, 1, 2, 3, 4])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('never runs a cancelled job, and leaves no timer once all are cancelled', () => {
    const ran: string[] = []
    inTurn(() => ran.push('a'))
    const cancelB = inTurn(() => ran.push('b'))
    inTurn(() => ran.push('c'))
    cancelB()
    vi.runAllTimers()
    expect(ran).toEqual(['a', 'c'])
    const cancelD = inTurn(() => ran.push('d'))
    cancelD()
    expect(vi.getTimerCount()).toBe(0)
  })
})
