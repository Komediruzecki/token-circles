/**
 * Vertical markers on the retirement chart for the month each lifestyle becomes
 * affordable.
 *
 * The dashed target lines already show what each lifestyle costs, and the cards above
 * already give the date, but neither tells you where on the curve the two meet. This
 * draws that meeting point as a line with the lifestyle's name on a pill at the top,
 * in the same colour as its target line so the pairing needs no legend.
 *
 * A Chart.js plugin rather than an HTML overlay: it redraws with the chart on every
 * data change, resize and theme swap, and clips to the plot area for free. The cost is
 * doing text truncation by hand, which `fitLabel` below covers.
 *
 * Stateless by construction — the markers arrive through `options.plugins.lifestyleMarkers`,
 * because Chart.tsx reuses one plugin instance across updates.
 */
import type { Chart, Plugin } from 'chart.js/auto'

export interface LifestyleMarker {
  /**
   * Where on the x axis, in dataset-index units. The chart plots one point a year
   * while crossings land on a month, so this is deliberately fractional.
   */
  x: number
  label: string
  /** Matches the lifestyle's dashed target line. */
  color: string
}

export interface LifestyleMarkerOptions {
  markers: LifestyleMarker[]
}

const PILL_PAD_X = 6
const PILL_PAD_Y = 3
const PILL_GAP = 6
const PILL_RADIUS = 6
const MAX_PILL_WIDTH = 120
const FONT = '600 10px system-ui, -apple-system, sans-serif'

/** Trims a label until it and an ellipsis fit, so a long lifestyle name cannot spill. */
function fitLabel(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text
  let n = text.length
  while (n > 0 && ctx.measureText(`${text.slice(0, n)}…`).width > maxWidth) n--
  return n === 0 ? '…' : `${text.slice(0, n)}…`
}

/**
 * Black or white, whichever reads on the pill. The palette spans mint to violet, so a
 * single fixed text colour is unreadable on one end or the other.
 */
function textOn(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex)
  if (!m) return '#0b1020'
  const n = parseInt(m[1], 16)
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  // Rec. 601 luma is enough to choose between two extremes.
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? '#0b1020' : '#ffffff'
}

function withAlpha(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex)
  if (!m) return hex
  const n = parseInt(m[1], 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  // roundRect is recent enough that a canvas without it is worth handling rather than
  // letting the whole chart throw.
  if (typeof ctx.roundRect === 'function') {
    ctx.beginPath()
    ctx.roundRect(x, y, w, h, r)
    return
  }
  const radius = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + w, y, x + w, y + h, radius)
  ctx.arcTo(x + w, y + h, x, y + h, radius)
  ctx.arcTo(x, y + h, x, y, radius)
  ctx.arcTo(x, y, x + w, y, radius)
  ctx.closePath()
}

/** A marker with its resolved horizontal pixel, before pills are stacked. */
type ResolvedMarker = LifestyleMarker & { lineX: number }

interface PlacedPill {
  marker: LifestyleMarker
  /** Where the line goes: the crossing itself, not the pill. */
  lineX: number
  left: number
  width: number
  text: string
  row: number
}

/**
 * Lays pills out left to right, dropping to a new row whenever one would overlap the
 * last pill placed in every row above it. Two lifestyles a few months apart is the
 * normal case, not the exception, so overlapping labels would be the default look.
 */
function layout(
  ctx: CanvasRenderingContext2D,
  markers: ResolvedMarker[],
  area: { left: number; right: number }
): PlacedPill[] {
  const rowEnds: number[] = []
  return [...markers]
    .sort((a, b) => a.x - b.x)
    .map((marker) => {
      const text = fitLabel(ctx, marker.label, MAX_PILL_WIDTH - PILL_PAD_X * 2)
      const width = ctx.measureText(text).width + PILL_PAD_X * 2
      const lineX = marker.lineX
      // Centred on the line, then pushed back inside the plot area at either edge.
      const left = Math.min(Math.max(lineX - width / 2, area.left), area.right - width)
      let row = rowEnds.findIndex((end) => left >= end + PILL_GAP)
      if (row === -1) row = rowEnds.length
      rowEnds[row] = left + width
      return { marker, lineX, left, width, text, row }
    })
}

export const lifestyleMarkersPlugin: Plugin = {
  id: 'lifestyleMarkers',

  afterDatasetsDraw(chart: Chart, _args: unknown, opts: LifestyleMarkerOptions) {
    const markers = opts?.markers
    if (!markers || markers.length === 0) return
    const scale = chart.scales.x
    const area = chart.chartArea
    if (!scale || !area) return

    const ctx = chart.ctx
    ctx.save()
    ctx.font = FONT
    ctx.textBaseline = 'middle'

    // Resolve pixel positions first: a crossing beyond the plotted horizon has no line
    // to draw and must not take a pill slot either.
    const visible = markers
      .map((marker) => ({ marker, lineX: scale.getPixelForValue(marker.x) }))
      .filter(({ lineX }) => Number.isFinite(lineX) && lineX >= area.left && lineX <= area.right)
      .map(({ marker, lineX }) => ({ ...marker, lineX }))

    const pillHeight = 10 + PILL_PAD_Y * 2
    for (const pill of layout(ctx, visible, area)) {
      const top = area.top + pill.row * (pillHeight + 4)
      const color = pill.marker.color

      // The line starts under its own pill so the label stays legible.
      ctx.beginPath()
      ctx.setLineDash([4, 4])
      ctx.lineWidth = 1.5
      ctx.strokeStyle = withAlpha(color, 0.75)
      ctx.moveTo(pill.lineX, top + pillHeight)
      ctx.lineTo(pill.lineX, area.bottom)
      ctx.stroke()
      ctx.setLineDash([])

      // A stub connecting a pill to a line it is not centred on, at the plot edges.
      if (Math.abs(pill.left + pill.width / 2 - pill.lineX) > 1) {
        ctx.beginPath()
        ctx.strokeStyle = withAlpha(color, 0.55)
        ctx.moveTo(pill.left + pill.width / 2, top + pillHeight / 2)
        ctx.lineTo(pill.lineX, top + pillHeight)
        ctx.stroke()
      }

      roundRect(ctx, pill.left, top, pill.width, pillHeight, PILL_RADIUS)
      ctx.fillStyle = color
      ctx.fill()

      ctx.fillStyle = textOn(color)
      ctx.textAlign = 'left'
      ctx.fillText(pill.text, pill.left + PILL_PAD_X, top + pillHeight / 2 + 0.5)
    }

    ctx.restore()
  },
}
