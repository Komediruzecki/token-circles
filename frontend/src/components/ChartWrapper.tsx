/**
 * Chart Wrapper Component
 * Wrapper for Chart.js with reactive updates and export functionality
 */
import { createEffect, createSignal, onCleanup } from 'solid-js'
import ChartContainer from './ChartContainer.module.css'
import ExportChartButton from './ExportChartButton'
import type * as ChartJS from 'chart.js/auto'

export interface ChartWrapperProps {
  type: 'line' | 'bar' | 'doughnut' | 'pie' | 'polarArea' | 'radar' | 'bubble' | 'scatter'
  data: ChartJS.ChartData
  options?: ChartJS.ChartOptions
  height?: number
  variant?: 'tall' | 'medium' | 'short'
  showExport?: boolean
  filename?: string
  onReady?: (chart: ChartJS.Chart) => void
}

export default function ChartWrapper(props: ChartWrapperProps) {
  const [chartInstance, setChartInstance] = createSignal<ChartJS.Chart | undefined>(undefined)

  let canvasRef: HTMLCanvasElement | null = null
  let cancelled = false

  // Watch for theme changes via MutationObserver
  const [isDark, setIsDark] = createSignal(
    document.documentElement.getAttribute('data-theme') === 'dark'
  )

  const themeObserver = new MutationObserver(() => {
    const dark = document.documentElement.getAttribute('data-theme') === 'dark'
    setIsDark(dark)
  })
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  })

  onCleanup(() => {
    themeObserver.disconnect()
  })

  createEffect(() => {
    const dark = isDark()
    // Read props BEFORE async to track dependencies
    const chartType = props.type
    const chartData = props.data

    if (canvasRef === null) return

    import('chart.js/auto')
      .then(({ default: ChartJS }) => {
        if (cancelled) return

        // Destroy existing chart
        const existingChart = chartInstance()
        if (existingChart) {
          existingChart.destroy()
        }

        // Create new chart
        const ctx = canvasRef?.getContext('2d')
        if (!ctx) return

        const textColor = dark ? '#E5E7EB' : '#374151'
        const gridColor = dark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)'
        const tooltipBg = dark ? 'rgba(59, 130, 246, 0.2)' : 'rgba(59, 130, 246, 0.1)'
        const tooltipBorder = dark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)'
        const isPieOrDoughnut =
          chartType === 'doughnut' || chartType === 'pie' || chartType === 'polarArea'
        const options = props.options || {
          responsive: true,
          maintainAspectRatio: false,
          layout: isPieOrDoughnut
            ? {
                padding: {
                  left: 0,
                  right: 0,
                  top: 0,
                  bottom: 0,
                },
              }
            : undefined,
          plugins: {
            legend: {
              position: isPieOrDoughnut ? 'right' : 'top',
              align: isPieOrDoughnut ? 'center' : 'center',
              labels: {
                color: textColor,
                font: { size: 12 },
                padding: isPieOrDoughnut ? 20 : 15,
                usePointStyle: true,
                boxWidth: 12,
                boxHeight: 12,
              },
            },
            tooltip: {
              backgroundColor: tooltipBg,
              titleColor: textColor,
              bodyColor: textColor,
              borderColor: tooltipBorder,
              borderWidth: 1,
              padding: 10,
              cornerRadius: 8,
              displayColors: true,
              usePointStyle: true,
            },
          },
          scales:
            chartType === 'doughnut' || chartType === 'pie' || chartType === 'polarArea'
              ? {}
              : {
                  x: {
                    grid: {
                      color: gridColor,
                      drawBorder: false,
                    },
                    ticks: { color: textColor },
                  },
                  y: {
                    grid: {
                      color: gridColor,
                      drawBorder: false,
                    },
                    ticks: {
                      color: textColor,
                      callback: (value: number) => value.toLocaleString() as any,
                    },
                  },
                },
          animation: {
            duration: 750,
            easing: 'easeInOutQuad' as const,
          },
        }

        const newChart = new ChartJS(ctx, {
          type: chartType,
          data: chartData,
          options: options as any,
        })

        setChartInstance(newChart)
        props.onReady?.(newChart)
      })
      .catch((err: unknown) => {
        console.error('Failed to load Chart.js:', err)
      })
  })

  onCleanup(() => {
    cancelled = true
    const existingChart = chartInstance()
    if (existingChart) {
      existingChart.destroy()
    }
  })

  const heightClass =
    props.variant === 'tall'
      ? ChartContainer.chartTall
      : props.variant === 'medium'
        ? ChartContainer.chartMedium
        : props.variant === 'short'
          ? ChartContainer.chartShort
          : ''

  const heightStyle = props.height ? `height: ${props.height}px` : undefined

  return (
    <div
      class={ChartContainer.chartContainer}
      classList={{ [heightClass]: !!heightClass }}
      style={heightStyle}
    >
      {props.showExport && props.filename && (
        <ExportChartButton filename={props.filename} chart={chartInstance()} />
      )}
      <canvas ref={(canvas: HTMLCanvasElement) => (canvasRef = canvas)} />
    </div>
  )
}
