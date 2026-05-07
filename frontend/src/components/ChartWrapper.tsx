/**
 * Chart Wrapper Component
 * Wrapper for Chart.js with reactive updates and export functionality
 */
import { createContext, createEffect, createSignal, onCleanup } from 'solid-js'
import ChartContainer from './ChartContainer.module.css'
import ExportChartButton from './ExportChartButton'
import type * as ChartJS from 'chart.js/auto'

export const ThemeContext = createContext<() => 'light' | 'dark'>(() => 'light' as 'light' | 'dark')

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
  const getTheme = () => {
    const el = document.documentElement
    const dataTheme = el.getAttribute('data-theme')
    return (dataTheme === 'dark' ? 'dark' : 'light') as 'light' | 'dark'
  }

  const [chartInstance, setChartInstance] = createSignal<ChartJS.Chart | undefined>(undefined)
  const [isDark] = createSignal(getTheme())

  let canvasRef: HTMLCanvasElement | null = null

  createEffect(() => {
    const isDarkValue = isDark()
    if (canvasRef === null) return

    import('chart.js/auto')
      .then(({ default: ChartJS }) => {
        // Destroy existing chart
        const existingChart = chartInstance()
        if (existingChart) {
          existingChart.destroy()
        }

        // Create new chart
        const ctx = canvasRef?.getContext('2d')
        if (!ctx) return

        const options = props.options || {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              labels: {
                color: isDarkValue ? '#E5E7EB' : '#374151',
                font: { size: 12 },
                padding: 15,
                usePointStyle: true,
              },
            },
            tooltip: {
              backgroundColor: isDarkValue ? 'rgba(59, 130, 246, 0.2)' : 'rgba(59, 130, 246, 0.1)',
              titleColor: isDarkValue ? '#E5E7EB' : '#374151',
              bodyColor: isDarkValue ? '#E5E7EB' : '#374151',
              borderColor: isDarkValue ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)',
              borderWidth: 1,
              padding: 10,
              cornerRadius: 8,
              displayColors: true,
              usePointStyle: true,
            },
          },
          scales:
            props.type === 'doughnut' || props.type === 'pie' || props.type === 'polarArea'
              ? {}
              : {
                  x: {
                    grid: {
                      color: isDarkValue ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)',
                      drawBorder: false,
                    },
                    ticks: { color: isDarkValue ? '#E5E7EB' : '#374151' },
                  },
                  y: {
                    grid: {
                      color: isDarkValue ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)',
                      drawBorder: false,
                    },
                    ticks: {
                      color: isDarkValue ? '#E5E7EB' : '#374151',
                      callback: (value: number) => value.toLocaleString() as any,
                    },
                  },
                },
          animation: {
            duration: 750,
            easing: 'easeInOutQuad',
          },
        }

        const newChart = new ChartJS(ctx, {
          type: props.type,
          data: props.data,
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
    <div class={ChartContainer.chartContainer} classList={{ [heightClass]: !!heightClass }} style={heightStyle}>
      {props.showExport && props.filename && (
        <ExportChartButton filename={props.filename} chart={chartInstance()} />
      )}
      <canvas ref={(canvas: HTMLCanvasElement) => (canvasRef = canvas)} />
    </div>
  )
}

interface ThemeContextValue {
  (): 'light' | 'dark'
}

export type { ThemeContextValue }
