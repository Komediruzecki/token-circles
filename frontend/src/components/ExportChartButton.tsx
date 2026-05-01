/**
 * Export Chart Button Component
 * Button with icons to export chart as PNG or SVG
 */
import { downloadBlob } from '../utils/chartExport'
import styles from './ExportChartButton.module.css'

export interface ExportChartButtonProps {
  chart: any
  filename: string
  variant?: 'icon' | 'inline'
}

export default function ExportChartButton({
  chart,
  filename,
  variant = 'icon'
}: ExportChartButtonProps) {
  const handleExportPNG = () => {
    if (!chart) return
    downloadBlob(new Blob([chart.toBase64Image()]), `${filename}.png`)
  }

  const handleExportSVG = () => {
    const canvas = chart.canvas
    if (!canvas) return
    downloadBlob(
      new Blob([canvas.outerHTML], { type: 'image/svg+xml;charset=utf-8' }),
      `${filename}.svg`
    )
  }

  if (variant === 'inline') {
    return (
      <div class={styles.inlineWrapper}>
        <button
          class={styles.exportBtn}
          onClick={handleExportPNG}
          title="Export as PNG"
        >
          <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
        </button>
        <button
          class={styles.exportBtn}
          onClick={handleExportSVG}
          title="Export as SVG"
        >
          <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
          </svg>
        </button>
      </div>
    )
  }

  return (
    <button class={styles.exportBtn} onClick={handleExportPNG}>
      <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
      </svg>
      <span>Export</span>
    </button>
  )
}
