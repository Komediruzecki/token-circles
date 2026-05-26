/**
 * Chart Component
 * Wrapper for Chart.js integration with SolidJS
 */
import { createEffect, ErrorBoundary, onCleanup } from 'solid-js'
import type * as ChartJS from 'chart.js/auto'

export interface ChartProps {
  id?: string
  type: 'line' | 'bar' | 'doughnut' | 'pie' | 'polarArea' | 'radar' | 'bubble' | 'scatter'
  data: ChartJS.ChartData
  options?: ChartJS.ChartOptions
  height?: number
  width?: string
  onReady?: (chart: ChartJS.Chart) => void
}

export default function Chart(props: ChartProps) {
  let canvasRef: HTMLCanvasElement | null = null

  createEffect(() => {
    if (canvasRef === null) return

    // Capture props synchronously so SolidJS tracks them as dependencies
    const chartType = props.type
    const chartData = props.data
    const chartOptions = props.options
    const onReady = props.onReady

    let cancelled = false

    // Lazy load Chart.js to avoid import issues
    import('chart.js/auto')
      .then(({ default: ChartJS }) => {
        if (cancelled) return

        // Destroy existing chart
        const existingChart = (canvasRef as HTMLCanvasElement & { chartInstance?: ChartJS.Chart })
          .chartInstance
        if (existingChart !== undefined) {
          existingChart.destroy()
        }

        // Create new chart
        const ctx = canvasRef?.getContext('2d')
        if (!ctx) return
        const chart = new ChartJS(ctx, {
          type: chartType,
          data: chartData,
          options: {
            responsive: true,
            maintainAspectRatio: false,
            ...chartOptions,
          },
        })
        ;(canvasRef as HTMLCanvasElement & { chartInstance?: ChartJS.Chart }).chartInstance = chart
        onReady?.(chart)
      })
      .catch((_err: unknown) => {
        if (!cancelled) console.error('Failed to load Chart.js')
      })

    onCleanup(() => {
      cancelled = true
      const existingChart = (canvasRef as HTMLCanvasElement & { chartInstance?: ChartJS.Chart })
        .chartInstance
      if (existingChart !== undefined) {
        existingChart.destroy()
        delete (canvasRef as HTMLCanvasElement & { chartInstance?: ChartJS.Chart }).chartInstance
      }
    })

    onCleanup(() => {
      const existingChart = (canvasRef as HTMLCanvasElement & { chartInstance?: ChartJS.Chart })
        .chartInstance
      if (existingChart !== undefined) {
        existingChart.destroy()
        delete (canvasRef as HTMLCanvasElement & { chartInstance?: ChartJS.Chart }).chartInstance
      }
    })
  })

  return (
    <ErrorBoundary
      fallback={(_err) => (
        <div
          style={{
            display: 'flex',
            'align-items': 'center',
            'justify-content': 'center',
            padding: '2rem',
            'min-height': '150px',
            color: 'var(--text-secondary, #6b7280)',
            'font-size': '0.875rem',
          }}
        >
          Chart failed to load
        </div>
      )}
    >
      <div
        style={{
          height: props.height ? `${props.height}px` : '300px',
          width: '100%',
          position: 'relative',
        }}
      >
        <canvas
          id={props.id}
          ref={(canvas: HTMLCanvasElement) => {
            canvasRef = canvas
          }}
          style={{
            height: props.height ? `${props.height}px` : '300px',
            width: props.width || '100%',
          }}
        />
      </div>
    </ErrorBoundary>
  )
}
