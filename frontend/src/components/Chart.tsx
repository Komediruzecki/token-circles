/**
 * Chart Component
 * Wrapper for Chart.js integration with SolidJS
 */
import { createSignal, onCleanup } from 'solid-js'

export interface ChartProps {
  type: 'line' | 'bar' | 'doughnut' | 'pie' | 'polarArea' | 'radar' | 'bubble' | 'scatter'
  data: any
  options?: any
  height?: number
  width?: string
}

export default function Chart(props: ChartProps) {
  let canvasRef: HTMLCanvasElement | null = null

  createEffect(() => {
    if (!canvasRef) return

    // Lazy load Chart.js to avoid import issues
    import('chart.js/auto').then(({ default: Chart }) => {
      // Destroy existing chart
      const existingChart = canvasRef.chartInstance
      if (existingChart) {
        existingChart.destroy()
      }

      // Create new chart
      const ctx = canvasRef.getContext('2d')
      if (!ctx) return

      canvasRef.chartInstance = new Chart(ctx, {
        type: props.type,
        data: props.data,
        options: {
          responsive: true,
          maintainAspectRatio: false,
          ...props.options
        }
      })
    })

    onCleanup(() => {
      const existingChart = canvasRef?.chartInstance
      if (existingChart) {
        existingChart.destroy()
        delete canvasRef!.chartInstance
      }
    })
  })

  return (
    <canvas
      ref={canvas => {
        canvasRef = canvas
      }}
      height={props.height}
      width={props.width}
    />
  )
}
