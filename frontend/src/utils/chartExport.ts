/**
 * Chart Export Utilities
 * PNG and SVG export for Chart.js charts
 */
import type * as ChartJS from 'chart.js/auto'

export function exportChartAsPNG(
  chart: ChartJS.Chart,
  filename: string,
  backgroundColor?: string | null
): void {
  const canvas = chart.canvas as HTMLCanvasElement
  if (backgroundColor) {
    // Create a temporary canvas to layer background + chart
    const tempCanvas = document.createElement('canvas')
    tempCanvas.width = canvas.width
    tempCanvas.height = canvas.height
    const ctx = tempCanvas.getContext('2d')!
    ctx.fillStyle = backgroundColor
    ctx.fillRect(0, 0, tempCanvas.width, tempCanvas.height)
    ctx.drawImage(canvas, 0, 0)
    const link = document.createElement('a')
    link.download = `${filename}.png`
    link.href = tempCanvas.toDataURL('image/png')
    link.click()
  } else {
    const link = document.createElement('a')
    link.download = `${filename}.png`
    link.href = canvas.toDataURL('image/png')
    link.click()
  }
}

export function exportChartAsSVG(
  chart: ChartJS.Chart,
  filename: string,
  backgroundColor?: string | null
): void {
  try {
    const canvas = chart.canvas as HTMLCanvasElement
    const width = canvas.width
    const height = canvas.height
    const dataUrl = canvas.toDataURL('image/png')

    const svgContent = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  ${backgroundColor ? `<rect width="100%" height="100%" fill="${backgroundColor}"/>` : ''}
  <image x="0" y="0" width="${width}" height="${height}" xlink:href="${dataUrl}"/>
</svg>`

    const blob = new Blob([svgContent], { type: 'image/svg+xml;charset=utf-8' })
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

export function downloadBlob(blob: Blob, filename: string): void {
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
