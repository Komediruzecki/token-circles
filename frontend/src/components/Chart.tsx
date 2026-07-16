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
  let chart: ChartJS.Chart | undefined
  let chartType: ChartProps['type'] | undefined

  createEffect(() => {
    if (canvasRef === null) return

    // Capture props synchronously so SolidJS tracks them as dependencies
    const type = props.type
    const chartData = props.data
    const chartOptions = props.options
    const onReady = props.onReady

    let cancelled = false

    // Lazy load Chart.js to avoid import issues
    import('chart.js/auto')
      .then(({ default: ChartJSCtor }) => {
        if (cancelled || canvasRef === null) return

        const mergedOptions = {
          responsive: true,
          maintainAspectRatio: false,
          ...chartOptions,
        }

        // Same chart type → update the live instance in place. Destroy/recreate blanked
        // the canvas (plus an async-import gap) on every data change, so stepping the
        // focus period made every chart on the page flash and re-animate from zero.
        // 'none' skips the update tween too: rapid period-stepping reads as calm data
        // changes instead of every chart re-animating at once (creation still animates).
        if (chart !== undefined && chartType === type) {
          chart.data = chartData
          chart.options = mergedOptions
          chart.update('none')
          onReady?.(chart)
          return
        }

        chart?.destroy()
        const ctx = canvasRef.getContext('2d')
        if (!ctx) return
        chart = new ChartJSCtor(ctx, {
          type,
          data: chartData,
          options: mergedOptions,
        })
        chartType = type
        onReady?.(chart)
      })
      .catch((_err: unknown) => {
        if (!cancelled) console.error('Failed to load Chart.js')
      })

    // Only cancel the in-flight load on re-run; the instance itself lives until unmount.
    onCleanup(() => {
      cancelled = true
    })
  })

  // Component disposal: tear the chart down once.
  onCleanup(() => {
    chart?.destroy()
    chart = undefined
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
