/**
 * Export Chart Button Component
 * Button with icons to export chart as PNG or SVG
 */
import { exportChartAsPNG, exportChartAsSVG } from '../utils/chartExport'
import {
  loadChartExportSettings,
  resolveBackgroundColor,
} from '../utils/chartExportSettings'
import styles from './ExportChartButton.module.css'

export interface ExportChartButtonProps {
  chart: any
  filename: string
  variant?: 'icon' | 'inline'
}

export default function ExportChartButton(props: ExportChartButtonProps) {
  const handleExportPNG = () => {
    if (!props.chart) return
    const settings = loadChartExportSettings()
    const bg = resolveBackgroundColor(settings.background)
    exportChartAsPNG(props.chart, props.filename, bg)
  }

  const handleExportSVG = () => {
    if (!props.chart) return
    const settings = loadChartExportSettings()
    const bg = resolveBackgroundColor(settings.background)
    exportChartAsSVG(props.chart, props.filename, bg)
  }

  if (props.variant === 'inline') {
    return (
      <div class={styles.inlineWrapper}>
        <button class={styles.exportBtn} onclick={handleExportPNG} title="Export as PNG">
          <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width={2}
              d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
            />
          </svg>
        </button>
        <button class={styles.exportBtn} onclick={handleExportSVG} title="Export as SVG">
          <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width={2}
              d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01"
            />
          </svg>
        </button>
      </div>
    )
  }

  return (
    <button class={styles.exportBtn} onclick={handleExportPNG}>
      <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width={2}
          d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
        />
      </svg>
      <span>Export</span>
    </button>
  )
}
