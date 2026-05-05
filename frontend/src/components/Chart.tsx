/**
 * Chart Component
 * Wrapper for Chart.js integration with SolidJS
 */
import { createEffect, onCleanup } from 'solid-js'
import type * as ChartJS from 'chart.js/auto'

export interface ChartProps {
  id?: string
  type: 'line' | 'bar' | 'doughnut' | 'pie' | 'polarArea' | 'radar' | 'bubble' | 'scatter'
  data: ChartJS.ChartData
  options?: ChartJS.ChartOptions
  height?: number
  width?: string
}

export default function Chart(props: ChartProps) {
  let canvasRef: HTMLCanvasElement | null = null

  createEffect(() => {
    if (canvasRef === null) return

    // Lazy load Chart.js to avoid import issues
    import('chart.js/auto')
      .then(({ default: ChartJS }) => {
        // Destroy existing chart
        const existingChart = (canvasRef as HTMLCanvasElement & { chartInstance?: ChartJS.Chart })
          .chartInstance
        if (existingChart !== undefined) {
          existingChart.destroy()
        }

        // Create new chart
        const ctx = canvasRef?.getContext('2d')
        if (!ctx) return
        ;(canvasRef as HTMLCanvasElement & { chartInstance?: ChartJS.Chart }).chartInstance =
          new ChartJS(ctx, {
            type: props.type,
            data: props.data,
            options: {
              responsive: true,
              maintainAspectRatio: false,
              ...props.options,
            },
          })
      })
      .catch((_err: unknown) => {
        console.error('Failed to load Chart.js')
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
    <div style={{ height: '100%', width: '100%', overflow: 'hidden' }}>
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
  )
}
