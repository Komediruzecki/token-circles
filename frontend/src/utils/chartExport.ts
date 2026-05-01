/**
 * Chart Export Utilities
 * PNG and SVG export for Chart.js charts
 */
import type * as ChartJS from 'chart.js/auto'

export function exportChartAsPNG(chart: ChartJS.Chart, filename: string): void {
  const canvas = chart.canvas
  const link = document.createElement('a')
  link.download = `${filename}.png`
  link.href = canvas.toDataURL('image/png')
  link.click()
}

export function exportChartAsSVG(canvasEl: HTMLCanvasElement, filename: string): void {
  try {
    const svgData = new XMLSerializer().serializeToString(canvasEl)
    const blob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.download = `${filename}.svg`
    link.href = url
    link.click()
    URL.revokeObjectURL(url)
  } catch (error) {
    console.error('Failed to export SVG:', error)
  }
}

export function downloadBlob(blob: Blob, filename: string, mimeType: string = 'text/plain'): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
