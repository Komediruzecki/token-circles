/**
 * Chart zoom.
 *
 * The window arithmetic is where this can quietly go wrong — an anchor that drifts, a
 * range that walks off the end of the data, a "zoomed out" state with two representations
 * that disagree. All of that is decided before any pixel moves, so it is tested here
 * directly rather than through a canvas.
 */
import { describe, expect, it } from 'vitest'
import { clampWindow, MIN_VISIBLE_POINTS, panWindow, zoomWindow } from '../chartZoom'

/** 61 points is a sixty-year projection at one point a year: indices 0..60. */
const TOTAL = 61
const FULL = TOTAL - 1

describe('zoomWindow', () => {
  it('narrows the range when zooming in', () => {
    const w = zoomWindow(null, TOTAL, 1 / 2, 30)!
    expect(w.max - w.min).toBeCloseTo(FULL / 2, 6)
  })

  it('keeps the point under the pointer under the pointer', () => {
    // Anchored at 45, three quarters along: it must stay three quarters along after.
    const w = zoomWindow(null, TOTAL, 1 / 2, 45)!
    const ratioBefore = 45 / FULL
    const ratioAfter = (45 - w.min) / (w.max - w.min)
    expect(ratioAfter).toBeCloseTo(ratioBefore, 6)
  })

  it('anchors on repeated zooms, so the point stays put as you keep scrolling', () => {
    let w = zoomWindow(null, TOTAL, 1 / 1.18, 20)
    for (let i = 0; i < 8; i++) w = zoomWindow(w, TOTAL, 1 / 1.18, 20)
    expect(w!.min).toBeLessThanOrEqual(20)
    expect(w!.max).toBeGreaterThanOrEqual(20)
  })

  it('reports the whole axis as no window rather than as a full-width one', () => {
    // One representation of "not zoomed", so nothing has to keep two in step.
    expect(zoomWindow(null, TOTAL, 2, 30)).toBeNull()
    expect(zoomWindow({ min: 10, max: 40 }, TOTAL, 10, 30)).toBeNull()
  })

  it('stops narrowing at a span that is still a chart', () => {
    let w: ReturnType<typeof zoomWindow> = null
    for (let i = 0; i < 60; i++) w = zoomWindow(w, TOTAL, 1 / 2, 30)
    expect(w!.max - w!.min).toBeCloseTo(MIN_VISIBLE_POINTS, 6)
  })

  it('does not run off either end when the anchor is at the edge', () => {
    const atStart = zoomWindow(null, TOTAL, 1 / 4, 0)!
    expect(atStart.min).toBe(0)
    const atEnd = zoomWindow(null, TOTAL, 1 / 4, FULL)!
    expect(atEnd.max).toBeCloseTo(FULL, 6)
  })

  it('clamps an anchor from outside the current view', () => {
    const w = zoomWindow({ min: 10, max: 20 }, TOTAL, 1 / 2, 55)!
    expect(w.min).toBeGreaterThanOrEqual(10)
    expect(w.max).toBeLessThanOrEqual(20)
  })

  it('has nothing to do on an axis with no room on it', () => {
    expect(zoomWindow(null, 1, 0.5, 0)).toBeNull()
    expect(zoomWindow(null, 0, 0.5, 0)).toBeNull()
  })

  it('never produces a reversed or empty range', () => {
    let w: ReturnType<typeof zoomWindow> = null
    for (const [factor, anchor] of [
      [0.5, 0],
      [0.5, 60],
      [3, 30],
      [0.1, 12],
      [0.9, 59],
    ] as [number, number][]) {
      w = zoomWindow(w, TOTAL, factor, anchor)
      if (w) {
        expect(w.max).toBeGreaterThan(w.min)
        expect(w.min).toBeGreaterThanOrEqual(0)
        expect(w.max).toBeLessThanOrEqual(FULL)
      }
    }
  })
})

describe('panWindow', () => {
  it('slides the window without changing how much is visible', () => {
    const w = panWindow({ min: 10, max: 20 }, TOTAL, 5)!
    expect(w).toEqual({ min: 15, max: 25 })
  })

  it('stops at the start rather than showing what is not there', () => {
    expect(panWindow({ min: 3, max: 13 }, TOTAL, -50)).toEqual({ min: 0, max: 10 })
  })

  it('stops at the end', () => {
    expect(panWindow({ min: 40, max: 50 }, TOTAL, 500)).toEqual({ min: 50, max: 60 })
  })

  it('has nothing to pan when the whole axis is showing', () => {
    expect(panWindow(null, TOTAL, 5)).toBeNull()
  })
})

describe('clampWindow', () => {
  it('pulls a window back inside a projection that got shorter', () => {
    // Planning to 70 instead of 90 shortens the axis under whatever was being looked at.
    const w = clampWindow({ min: 45, max: 55 }, 31)!
    expect(w.max).toBeLessThanOrEqual(30)
    expect(w.max - w.min).toBe(10)
  })

  it('drops the window entirely when the projection no longer overflows it', () => {
    expect(clampWindow({ min: 0, max: 40 }, 20)).toBeNull()
  })

  it('leaves a window that still fits alone', () => {
    expect(clampWindow({ min: 5, max: 15 }, TOTAL)).toEqual({ min: 5, max: 15 })
  })

  it('passes through the un-zoomed state', () => {
    expect(clampWindow(null, TOTAL)).toBeNull()
  })

  it('survives an axis that has emptied out', () => {
    expect(clampWindow({ min: 1, max: 4 }, 0)).toBeNull()
  })
})
