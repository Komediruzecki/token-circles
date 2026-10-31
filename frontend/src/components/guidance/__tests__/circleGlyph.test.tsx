/** One circle's ring in each state (design.md 1.4, circles part 2). */
import { render } from 'solid-js/web'
import { afterEach, describe, expect, it } from 'vitest'
import CircleGlyph from '../CircleGlyph'
import type { CircleGlyphProps } from '../CircleGlyph'

let host: HTMLDivElement | undefined
let dispose: (() => void) | undefined
afterEach(() => {
  dispose?.()
  host?.remove()
})

function draw(props: CircleGlyphProps): SVGSVGElement {
  host = document.createElement('div')
  document.body.appendChild(host)
  dispose = render(() => <CircleGlyph {...props} />, host)
  return host.querySelector('svg')!
}

const arcs = (svg: SVGSVGElement) => svg.querySelectorAll('path')
const dot = (svg: SVGSVGElement) => svg.querySelector('[data-now]')

describe('the ring', () => {
  it('is solid once the circle is reached', () => {
    const svg = draw({ circle: 2, state: 'reached', measure: 1, size: 36 })
    const rings = svg.querySelectorAll('circle')
    expect(rings).toHaveLength(2)
    expect(rings[1].getAttribute('stroke')).toMatch(/^url\(#circle-ring-/)
    expect(dot(svg)).toBeNull()
    expect(svg.getAttribute('aria-hidden')).toBe('true')
    expect(svg.textContent).toBe('2')
  })

  it('draws the circle being worked on to its measure, with the dot at the end', () => {
    const svg = draw({ circle: 4, state: 'current', measure: 2 / 3, size: 40 })
    expect(arcs(svg)).toHaveLength(1)
    expect(dot(svg)!.getAttribute('fill')).toBe('var(--circle-now)')
    // Two thirds round: the dot sits low on the left, at 240 degrees from twelve o'clock.
    expect(Number(dot(svg)!.getAttribute('cx'))).toBeLessThan(20)
    expect(Number(dot(svg)!.getAttribute('cy'))).toBeGreaterThan(20)
  })

  it('never closes the ring of a circle not reached', () => {
    const svg = draw({ circle: 5, state: 'current', measure: 1, size: 40 })
    // An arc of a full turn ends where it starts, and draws nothing: it stops just short.
    const [start, end] = (arcs(svg)[0].getAttribute('d') ?? '')
      .split('A')
      .map((part) => part.replace('M', '').trim().split(' ').slice(-2).join(' '))
    expect(start).not.toBe(end)
  })

  it('draws Clear picture short of a year as twelve segments, one per month on file', () => {
    const svg = draw({ circle: 1, state: 'current', measure: 7 / 12, months: 7, size: 36 })
    expect(svg.querySelectorAll('[data-segment]')).toHaveLength(12)
    expect(svg.querySelectorAll('[data-segment="on"]')).toHaveLength(7)
    expect(dot(svg)).not.toBeNull()
  })

  it('draws a faint arc for a circle further out once its measure is above zero', () => {
    const svg = draw({ circle: 6, state: 'later', measure: 0.3, size: 40 })
    expect(arcs(svg)).toHaveLength(1)
    expect(arcs(svg)[0].getAttribute('stroke-opacity')).toBe('0.55')
    expect(dot(svg)).toBeNull()
    expect(
      draw({ circle: 6, state: 'later', measure: 0, size: 40 }).querySelector('path')
    ).toBeNull()
  })

  it('draws the dotted orbit only for a measure not known', () => {
    for (const state of ['current', 'later'] as const) {
      const svg = draw({ circle: 3, state, measure: null, size: 36 })
      expect(arcs(svg)).toHaveLength(0)
      expect(dot(svg)).toBeNull()
      expect(svg.querySelectorAll('circle')).toHaveLength(1)
    }
  })

  it("draws the next step's 20 px chip on a faint solid track, with no number", () => {
    const small = draw({ circle: 3, state: 'current', measure: 0.5, size: 20 })
    expect(small.querySelector('text')).toBeNull()
    const track = small.querySelector('circle')!
    expect(track.getAttribute('stroke')).toBe('var(--ring-track)')
    // Dots a pixel apart blur into a grey ring this small: one faint line instead.
    expect(track.getAttribute('stroke-dasharray')).toBeNull()
    expect(small.getAttribute('data-track')).toBe('solid')
    // 24 px and under is the chip's size; above it, a row's, with the dotted orbit and the number.
    expect(
      draw({ circle: 3, state: 'later', measure: null, size: 24 }).querySelector('text')
    ).toBeNull()
    expect(
      draw({ circle: 3, state: 'later', measure: null, size: 25 }).getAttribute('data-track')
    ).toBe('dotted')
    const row = draw({ circle: 3, state: 'later', measure: null, size: 36 })
    expect(row.querySelector('circle')!.getAttribute('stroke-dasharray')).toBe('0.6 3.4')
    expect(row.getAttribute('data-track')).toBe('dotted')
    expect(row.querySelector('text')!.textContent).toBe('3')
  })

  it('gives each ring its own gradient', () => {
    host = document.createElement('div')
    document.body.appendChild(host)
    dispose = render(
      () => (
        <>
          <CircleGlyph circle={1} state="reached" measure={1} size={36} />
          <CircleGlyph circle={2} state="reached" measure={1} size={36} />
        </>
      ),
      host
    )
    const ids = [...host.querySelectorAll('linearGradient')].map((g) => g.id)
    expect(new Set(ids).size).toBe(2)
  })
})
