/**
 * Scroll-to-zoom, pinch and drag-to-pan for a Chart.js chart on a category x axis.
 *
 * A sixty-year projection drawn across half a screen puts a decade in a centimetre, which
 * is the complaint this answers: the shape is there but nothing can be read off it.
 *
 * Done by moving the x scale's `min`/`max` — which a category scale reads as point indices
 * — rather than by adding chartjs-plugin-zoom. The scale already redraws its ticks from
 * whatever range it is given, so the axis relabels itself as you go, and the alternative
 * meant a new dependency for behaviour that is a hundred lines of arithmetic.
 *
 * The arithmetic is separated from the DOM below so the awkward parts — anchoring on the
 * pointer, clamping at the ends, deciding when a gesture should fall through to the page —
 * can be tested without a canvas.
 */
import { createSignal, onCleanup } from 'solid-js'
import type * as ChartJS from 'chart.js/auto'

/** Visible span of the x axis, in point indices. Null means the whole thing. */
export interface ChartWindow {
  min: number
  max: number
}

/** Fewest points that stay on screen. Below about this the chart stops being a line. */
export const MIN_VISIBLE_POINTS = 4
/** One wheel notch. Gentle enough that a trackpad's many small deltas are not violent. */
export const ZOOM_STEP = 1.18

const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi)

/**
 * The window after zooming by `factor` about `anchor`.
 *
 * Returns null once the whole axis fits again, so "not zoomed" has one representation
 * rather than two that have to be kept in step.
 */
export function zoomWindow(
  current: ChartWindow | null,
  total: number,
  factor: number,
  anchor: number,
  minSpan = MIN_VISIBLE_POINTS
): ChartWindow | null {
  const full = Math.max(0, total - 1)
  if (full <= 0) return null
  const from = current ?? { min: 0, max: full }
  const span = from.max - from.min
  if (span <= 0) return null

  const nextSpan = clamp(span * factor, Math.min(minSpan, full), full)
  if (nextSpan >= full) return null

  // Keep whatever sits under the pointer under the pointer: the point of anchoring is
  // that you zoom into the part you are looking at, not into the middle.
  const at = clamp(anchor, from.min, from.max)
  const ratio = (at - from.min) / span
  const min = clamp(at - ratio * nextSpan, 0, full - nextSpan)
  return { min, max: min + nextSpan }
}

/** The window after sliding `delta` points, stopped at either end rather than wrapping. */
export function panWindow(
  current: ChartWindow | null,
  total: number,
  delta: number
): ChartWindow | null {
  if (!current) return null
  const full = Math.max(0, total - 1)
  const span = current.max - current.min
  const min = clamp(current.min + delta, 0, Math.max(0, full - span))
  return { min, max: min + span }
}

/** Keeps a window valid when the projection itself gets longer or shorter underneath it. */
export function clampWindow(current: ChartWindow | null, total: number): ChartWindow | null {
  if (!current) return null
  const full = Math.max(0, total - 1)
  if (full <= 0) return null
  const span = Math.min(current.max - current.min, full)
  if (span >= full) return null
  const min = clamp(current.min, 0, full - span)
  return { min, max: min + span }
}

export interface ChartZoom {
  /** The window to hand the x scale, or null for the full range. */
  window: () => ChartWindow | null
  zoomed: () => boolean
  reset: () => void
  /** Pass to Chart's `onReady`, so gestures can anchor on real pixel positions. */
  onReady: (chart: ChartJS.Chart) => void
  /** Ref for the element wrapping the canvas. */
  attach: (el: HTMLElement) => void
}

/**
 * @param total How many points the axis has now. Read reactively, so a projection that
 *              changes length re-clamps the window instead of leaving it out of bounds.
 */
export function createChartZoom(total: () => number): ChartZoom {
  const [window_, setWindow] = createSignal<ChartWindow | null>(null)
  let chart: ChartJS.Chart | undefined
  let host: HTMLElement | undefined
  /** Live pointers, by id, so one gesture can tell a drag from a pinch. */
  const pointers = new Map<number, number>()
  let lastPinchDistance = 0
  let lastPanX = 0

  const view = () => clampWindow(window_(), total())

  /**
   * Which point sits under a client x, from the scale itself. Falling back to the middle
   * of the view keeps a gesture working when the chart has not reported in yet.
   */
  const anchorAt = (clientX: number): number => {
    const scale = chart?.scales?.x
    const canvas = chart?.canvas
    if (!scale || !canvas) {
      const v = view()
      return v ? (v.min + v.max) / 2 : total() / 2
    }
    const value = scale.getValueForPixel(clientX - canvas.getBoundingClientRect().left)
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      const v = view()
      return v ? (v.min + v.max) / 2 : total() / 2
    }
    return value
  }

  const applyZoom = (factor: number, clientX: number) => {
    setWindow(zoomWindow(view(), total(), factor, anchorAt(clientX)))
  }

  const onWheel = (e: WheelEvent) => {
    const zoomingOut = e.deltaY > 0
    // Already showing everything and asked for more: the gesture has nothing to do here,
    // so let it scroll the page instead of swallowing it. Without this the chart is a
    // trap — you reach it and can never scroll past.
    if (zoomingOut && view() === null) return
    e.preventDefault()
    applyZoom(zoomingOut ? ZOOM_STEP : 1 / ZOOM_STEP, e.clientX)
  }

  const distance = () => {
    const [a, b] = [...pointers.values()]
    return Math.abs(a - b)
  }
  const midpoint = () => {
    const [a, b] = [...pointers.values()]
    return (a + b) / 2
  }

  const onPointerDown = (e: PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    pointers.set(e.pointerId, e.clientX)
    if (pointers.size === 2) lastPinchDistance = distance()
    if (pointers.size === 1) lastPanX = e.clientX
  }

  const onPointerMove = (e: PointerEvent) => {
    if (!pointers.has(e.pointerId)) return
    pointers.set(e.pointerId, e.clientX)

    if (pointers.size === 2) {
      const next = distance()
      if (lastPinchDistance > 0 && next > 0) {
        // Fingers apart zooms in, so the factor is the inverse of the distance ratio.
        applyZoom(lastPinchDistance / next, midpoint())
      }
      lastPinchDistance = next
      e.preventDefault()
      return
    }

    // A one-finger drag pans, but only once there is somewhere to pan to. Otherwise the
    // chart would eat a scroll gesture on a phone.
    const v = view()
    if (!v || pointers.size !== 1) return
    const scale = chart?.scales?.x
    if (!scale) return
    const pointsPerPixel = (v.max - v.min) / Math.max(1, scale.width)
    const dx = e.clientX - lastPanX
    lastPanX = e.clientX
    if (dx === 0) return
    setWindow(panWindow(v, total(), -dx * pointsPerPixel))
    e.preventDefault()
  }

  const endPointer = (e: PointerEvent) => {
    pointers.delete(e.pointerId)
    if (pointers.size < 2) lastPinchDistance = 0
    if (pointers.size === 1) lastPanX = [...pointers.values()][0]
  }

  /** Double click or double tap is the gesture people try first to undo a zoom. */
  const onDoubleClick = () => setWindow(null)

  const attach = (el: HTMLElement) => {
    host = el
    // Registered by hand rather than through JSX: wheel has to be non-passive to be able
    // to preventDefault, and touch-action has to be off for a pinch to reach us at all.
    el.style.touchAction = 'pan-y'
    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('pointerdown', onPointerDown)
    el.addEventListener('pointermove', onPointerMove)
    el.addEventListener('pointerup', endPointer)
    el.addEventListener('pointercancel', endPointer)
    el.addEventListener('pointerleave', endPointer)
    el.addEventListener('dblclick', onDoubleClick)
  }

  onCleanup(() => {
    if (!host) return
    host.removeEventListener('wheel', onWheel)
    host.removeEventListener('pointerdown', onPointerDown)
    host.removeEventListener('pointermove', onPointerMove)
    host.removeEventListener('pointerup', endPointer)
    host.removeEventListener('pointercancel', endPointer)
    host.removeEventListener('pointerleave', endPointer)
    host.removeEventListener('dblclick', onDoubleClick)
  })

  return {
    window: view,
    zoomed: () => view() !== null,
    reset: () => setWindow(null),
    onReady: (c) => {
      chart = c
    },
    attach,
  }
}
