/**
 * The chart's lifestyle markers.
 *
 * Canvas work is normally left untested because the output is pixels, but almost
 * everything that can go wrong here is decided before a pixel is drawn: which markers are
 * on the plot at all, where each pill sits so two do not print on top of each other, and
 * how a long lifestyle name is cut. So the tests drive the plugin with a recording
 * context and assert on the calls.
 */
import { describe, expect, it } from 'vitest'
import { lifestyleMarkersPlugin } from '../lifestyleMarkers'
import type { LifestyleMarker } from '../lifestyleMarkers'

interface Recorded {
  fillTexts: { text: string; x: number; y: number }[]
  moveTos: { x: number; y: number }[]
  lineTos: { x: number; y: number }[]
  fillStyles: string[]
  rects: { x: number; y: number; w: number; h: number }[]
}

/**
 * A 2d context that records rather than paints. measureText is 6px a character, which is
 * arbitrary but fixed, so truncation is decided by a stable rule instead of a font.
 */
function recordingCtx(): CanvasRenderingContext2D & { recorded: Recorded } {
  const recorded: Recorded = {
    fillTexts: [],
    moveTos: [],
    lineTos: [],
    fillStyles: [],
    rects: [],
  }
  const ctx = {
    recorded,
    font: '',
    textBaseline: '' as CanvasTextBaseline,
    textAlign: '' as CanvasTextAlign,
    lineWidth: 0,
    strokeStyle: '',
    _fillStyle: '',
    get fillStyle() {
      return this._fillStyle
    },
    set fillStyle(v: string) {
      this._fillStyle = v
      recorded.fillStyles.push(v)
    },
    save() {},
    restore() {},
    beginPath() {},
    closePath() {},
    stroke() {},
    fill() {},
    setLineDash() {},
    moveTo(x: number, y: number) {
      recorded.moveTos.push({ x, y })
    },
    lineTo(x: number, y: number) {
      recorded.lineTos.push({ x, y })
    },
    arcTo() {},
    roundRect(x: number, y: number, w: number, h: number) {
      recorded.rects.push({ x, y, w, h })
    },
    measureText(text: string) {
      return { width: text.length * 6 } as TextMetrics
    },
    fillText(text: string, x: number, y: number) {
      recorded.fillTexts.push({ text, x, y })
    },
  }
  return ctx as unknown as CanvasRenderingContext2D & { recorded: Recorded }
}

/** A chart just real enough for the plugin: a linear x scale over the plot area. */
function fakeChart(ctx: CanvasRenderingContext2D, opts: { pixelsPerUnit?: number } = {}) {
  const area = { left: 40, right: 640, top: 10, bottom: 260 }
  const perUnit = opts.pixelsPerUnit ?? 10
  return {
    ctx,
    chartArea: area,
    scales: {
      x: { getPixelForValue: (v: number) => area.left + v * perUnit },
    },
  } as never
}

const draw = (markers: LifestyleMarker[], chart = fakeChart(recordingCtx())) => {
  ;(lifestyleMarkersPlugin.afterDatasetsDraw as any)(chart, {}, { markers })

  return ((chart as any).ctx as ReturnType<typeof recordingCtx>).recorded
}

const marker = (over: Partial<LifestyleMarker> = {}): LifestyleMarker => ({
  x: 10,
  label: 'Zagreb',
  color: '#6e9bff',
  ...over,
})

describe('lifestyle markers', () => {
  it('draws a labelled line for each lifestyle that is reached', () => {
    const rec = draw([marker({ x: 5, label: 'Zagreb' }), marker({ x: 30, label: 'Zurich' })])
    expect(rec.fillTexts.map((f) => f.text)).toEqual(['Zagreb', 'Zurich'])
    // A vertical line each: same x at both ends, running down to the axis.
    expect(rec.moveTos).toHaveLength(2)
    expect(rec.moveTos[0].x).toBe(90)
    expect(rec.lineTos[0]).toEqual({ x: 90, y: 260 })
  })

  it('draws nothing at all when there is nothing to mark', () => {
    expect(draw([]).fillTexts).toEqual([])
  })

  it('tolerates being handed no options, as it is before the first projection', () => {
    const ctx = recordingCtx()

    const call = () =>
      (lifestyleMarkersPlugin.afterDatasetsDraw as any)(fakeChart(ctx), {}, undefined)
    expect(call).not.toThrow()
    expect(ctx.recorded.fillTexts).toEqual([])
  })

  it('skips a crossing that falls outside the plotted horizon', () => {
    // Beyond the right edge, and before the left edge: neither has a line to sit on.
    const rec = draw([marker({ x: 200, label: 'Later' }), marker({ x: -5, label: 'Earlier' })])
    expect(rec.fillTexts).toEqual([])
  })

  it('stacks pills that would otherwise overlap', () => {
    // Two lifestyles reached a few months apart is the normal case, not the exception.
    const rec = draw([marker({ x: 5, label: 'Lean' }), marker({ x: 6, label: 'Comfortable' })])
    expect(rec.fillTexts).toHaveLength(2)
    const [first, second] = rec.fillTexts
    expect(second.y).toBeGreaterThan(first.y)
  })

  it('keeps pills on one row when they clear each other', () => {
    const rec = draw([marker({ x: 2, label: 'Lean' }), marker({ x: 40, label: 'Rich' })])
    const [first, second] = rec.fillTexts
    expect(second.y).toBe(first.y)
  })

  it('orders pills left to right whatever order the lifestyles arrive in', () => {
    const rec = draw([marker({ x: 40, label: 'Late' }), marker({ x: 2, label: 'Early' })])
    expect(rec.fillTexts.map((f) => f.text)).toEqual(['Early', 'Late'])
  })

  it('cuts a long name with an ellipsis rather than letting it run', () => {
    const rec = draw([marker({ label: 'A very long lifestyle name that will not fit at all' })])
    const drawn = rec.fillTexts[0].text
    expect(drawn.endsWith('…')).toBe(true)
    expect(drawn.length).toBeLessThan('A very long lifestyle name that will not fit at all'.length)
    expect(drawn.startsWith('A very long')).toBe(true)
  })

  it('leaves a name that fits exactly as it is', () => {
    expect(draw([marker({ label: 'Zagreb' })]).fillTexts[0].text).toBe('Zagreb')
  })

  it('keeps a pill inside the plot when its line is at the very edge', () => {
    const rec = draw([marker({ x: 0, label: 'Now' })])
    expect(rec.rects[0].x).toBeGreaterThanOrEqual(40)
    const right = draw([marker({ x: 60, label: 'End' })])
    expect(right.rects[0].x + right.rects[0].w).toBeLessThanOrEqual(640)
  })

  it('paints each pill in its own lifestyle colour', () => {
    const rec = draw([
      marker({ x: 5, label: 'A', color: '#59d2a2' }),
      marker({ x: 40, label: 'B', color: '#d98ce0' }),
    ])
    expect(rec.fillStyles).toContain('#59d2a2')
    expect(rec.fillStyles).toContain('#d98ce0')
  })

  it('picks label ink that reads on the pill under it', () => {
    // Mint is light, violet is dark: a single fixed text colour is unreadable on one.
    const light = draw([marker({ color: '#59d2a2' })])
    const dark = draw([marker({ color: '#3b2a6e' })])
    expect(light.fillStyles).toContain('#0b1020')
    expect(dark.fillStyles).toContain('#ffffff')
  })

  it('falls back to dark ink for a colour it cannot read', () => {
    expect(draw([marker({ color: 'rebeccapurple' })]).fillStyles).toContain('#0b1020')
  })

  it('works on a canvas with no roundRect', () => {
    const ctx = recordingCtx() as unknown as Record<string, unknown>
    delete ctx.roundRect
    const rec = draw([marker()], fakeChart(ctx as unknown as CanvasRenderingContext2D))
    expect(rec.fillTexts[0].text).toBe('Zagreb')
  })

  it('does nothing without a scale or a plot area to draw in', () => {
    const ctx = recordingCtx()
    const call = () =>
      (lifestyleMarkersPlugin.afterDatasetsDraw as any)(
        { ctx, chartArea: undefined, scales: {} },
        {},
        { markers: [marker()] }
      )
    expect(call).not.toThrow()
    expect(ctx.recorded.fillTexts).toEqual([])
  })
})
