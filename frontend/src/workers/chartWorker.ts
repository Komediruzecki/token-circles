/**
 * Chart Worker — renders Chart.js charts on OffscreenCanvas in a background
 * thread. Keeps the main thread responsive during PDF report generation.
 *
 * Charts are styled to the Token Circles "Orbital Observatory" brand: the
 * caller (clientPdfReports.ts) passes the resolved grid/text colors + doughnut
 * cutout from brandPalette.pdfReportTheme, and labels render in Inter (loaded
 * here as a FontFace so the worker's canvas has it). Backgrounds stay
 * transparent — the PDF paints the brand ground behind the image.
 */
/* eslint-disable no-restricted-globals */
import { FONT_URLS } from '../core/reportFonts'
import type { ChartData } from 'chart.js'

interface ChartRequest {
  id: number
  chartType: 'doughnut' | 'bar' | 'line'
  chartData: ChartData
  width: number
  height: number
  dark: boolean
  /** Brand grid-line color (rgba). */
  grid?: string
  /** Brand axis/label text color. */
  text?: string
  /** Doughnut cutout ratio, e.g. "66%". */
  cutout?: string
}

interface ChartResponse {
  id: number
  blob: Blob | null
  error?: string
}

const FONT_FAMILY = "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif"

// Load Inter into the worker's font set once so chart labels match the app.
// Resolves even on failure — Chart.js then falls back to the system stack.
let _fontsReady: Promise<void> | null = null

function ensureFonts(): Promise<void> {
  if (!_fontsReady) {
    _fontsReady = (async () => {
      const fontSet = (self as unknown as { fonts?: { add(f: unknown): void } }).fonts
      const FontFaceCtor = (
        globalThis as unknown as { FontFace?: new (...a: unknown[]) => unknown }
      ).FontFace
      if (!fontSet || !FontFaceCtor) return
      try {
        const faces = [
          new FontFaceCtor('Inter', `url(${FONT_URLS.interRegular})`, { weight: '400' }),
          new FontFaceCtor('Inter', `url(${FONT_URLS.interSemiBold})`, { weight: '600' }),
        ] as { load(): Promise<unknown> }[]
        await Promise.all(faces.map((f) => f.load()))
        faces.forEach((f) => {
          fontSet.add(f)
        })
      } catch {
        // fall back to the system sans stack
      }
    })()
  }
  return _fontsReady
}

self.onmessage = async (e: MessageEvent<ChartRequest>) => {
  const { id, chartType, chartData, width, height, dark, grid, text, cutout } = e.data

  try {
    const canvas = new OffscreenCanvas(width, height)
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      self.postMessage({ id, blob: null, error: 'No 2d context' } satisfies ChartResponse)
      return
    }

    await ensureFonts()
    const { default: Chart } = await import('chart.js/auto')
    Chart.defaults.font.family = FONT_FAMILY

    // Brand colors come from the caller (pdfReportTheme); fall back to neutral
    // greys if an older caller omits them.
    const textColor = text ?? (dark ? '#9fb0d6' : '#5a6788')
    const gridColor = grid ?? (dark ? 'rgba(159,176,214,0.14)' : 'rgba(16,24,48,0.1)')
    const isPie = chartType === 'doughnut'

    const chart = new Chart(ctx as unknown as CanvasRenderingContext2D, {
      type: chartType,
      data: chartData,
      options: {
        responsive: false,
        maintainAspectRatio: false,
        animation: false,
        layout: isPie ? { padding: { left: 0, right: 0, top: 0, bottom: 0 } } : undefined,
        ...(isPie && cutout ? { cutout } : {}),
        plugins: {
          legend: { display: false },
          tooltip: { enabled: false },
        },
        scales: isPie
          ? {}
          : {
              x: {
                grid: { color: gridColor, drawBorder: false },
                ticks: { color: textColor, font: { size: 10, family: FONT_FAMILY } },
              },
              y: {
                grid: { color: gridColor, drawBorder: false },
                ticks: {
                  color: textColor,
                  font: { size: 10, family: FONT_FAMILY },
                  callback: (v: string | number) => v as number,
                },
              },
            },
      } as any,
    })

    const blob = await canvas.convertToBlob({ type: 'image/png' })
    chart.destroy()
    self.postMessage({ id, blob } satisfies ChartResponse)
  } catch (err) {
    self.postMessage({
      id,
      blob: null,
      error: err instanceof Error ? err.message : String(err),
    } satisfies ChartResponse)
  }
}
