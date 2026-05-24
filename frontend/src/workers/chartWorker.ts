/**
 * Chart Worker — renders Chart.js charts on OffscreenCanvas in a background thread.
 * Keeps the main thread responsive during PDF report generation.
 */
/* eslint-disable no-restricted-globals */
import type { ChartData } from 'chart.js'

interface ChartRequest {
  id: number
  chartType: 'doughnut' | 'bar' | 'line'
  chartData: ChartData
  width: number
  height: number
  dark: boolean
}

interface ChartResponse {
  id: number
  blob: Blob | null
  error?: string
}

self.onmessage = async (e: MessageEvent<ChartRequest>) => {
  const { id, chartType, chartData, width, height, dark } = e.data

  try {
    const canvas = new OffscreenCanvas(width, height)
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      self.postMessage({ id, blob: null, error: 'No 2d context' } satisfies ChartResponse)
      return
    }

    const { default: Chart } = await import('chart.js/auto')

    const textColor = dark ? '#E5E7EB' : '#374151'
    const gridColor = dark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'
    const isPie = chartType === 'doughnut'

    const chart = new Chart(ctx as any, {
      type: chartType,
      data: chartData,
      options: {
        responsive: false,
        maintainAspectRatio: false,
        animation: false,
        layout: isPie ? { padding: { left: 0, right: 0, top: 0, bottom: 0 } } : undefined,
        plugins: {
          legend: { display: false },
          tooltip: { enabled: false },
        },
        scales: isPie
          ? {}
          : {
              x: {
                grid: { color: gridColor, drawBorder: false },
                ticks: { color: textColor, font: { size: 10 } },
              },
              y: {
                grid: { color: gridColor, drawBorder: false },
                ticks: {
                  color: textColor,
                  font: { size: 10 },
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
