/**
 * D3HeatmapChart Component
 * D3-based calendar heatmap for daily spending visualization
 * with HTML tooltip and click drill-down
 */
import { createEffect, onCleanup, onMount } from 'solid-js'
import type * as D3 from 'd3'

let d3Module: typeof D3 | null = null

async function getD3() {
  if (!d3Module) d3Module = await import('d3')
  return d3Module
}

interface Props {
  data: Map<string, number>
  year: number
  type: 'income' | 'expense'
  height?: number
  onDayClick?: (dateStr: string, amount: number) => void
}

export default function D3HeatmapChart(props: Props) {
  let containerRef: HTMLDivElement | undefined
  let tooltipEl: HTMLDivElement | undefined

  const formatCurrency = (amount: number): string => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'EUR' }).format(amount)
  }

  const ensureTooltip = () => {
    if (!tooltipEl || !tooltipEl.parentNode) {
      tooltipEl = document.createElement('div')
      tooltipEl.id = 'heatmap-tooltip'
      tooltipEl.style.cssText =
        'position:fixed;display:none;background:var(--card-bg,#1f2937);color:var(--text,#e5e7eb);padding:6px 10px;border-radius:6px;font-size:12px;pointer-events:none;z-index:9999;box-shadow:0 2px 8px rgba(0,0,0,0.3);border:1px solid var(--border,#374151);white-space:nowrap;'
      document.body.appendChild(tooltipEl)
    }
  }

  const renderHeatmap = async () => {
    const container = containerRef
    if (!container) return

    const width = container.clientWidth || 800
    if (width <= 0) return
    const height = props.height || 160
    const margin = { top: 20, right: 20, bottom: 10, left: 40 }

    const d3 = await getD3()
    d3.select(container).selectAll('svg').remove()

    ensureTooltip()

    const svg = d3
      .select(container)
      .append('svg')
      .attr('width', width)
      .attr('height', height)
      .attr('viewBox', [0, 0, width, height])

    const cellSize = Math.min(14, (width - margin.left - margin.right) / 53)

    const startDate = d3.timeYear.floor(new Date(props.year, 0, 1))
    const endDate = d3.timeYear.ceil(new Date(props.year, 11, 31))

    const day = d3.timeDays(startDate, endDate)

    const maxVal = d3.max(Array.from(props.data.values())) || 1

    const colorFn =
      props.type === 'expense'
        ? (d3.scaleSequentialPow([0, maxVal], d3.interpolateReds) as any).exponent(0.4)
        : (d3.scaleSequentialPow([0, maxVal], d3.interpolateGreens) as any).exponent(0.4)

    const getValue = (date: Date) => {
      const dateStr = d3.timeFormat('%Y-%m-%d')(date)
      return props.data.get(dateStr) || 0
    }

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`)

    // Month labels
    const monthLabels = d3.timeMonths(startDate, endDate)
    g.selectAll('.month-label')
      .data(monthLabels)
      .join('text')
      .attr('class', 'month-label')
      .attr('x', (d: Date) => {
        const firstDayOfMonth = d3.timeMonday.count(d3.timeYear(d), d)
        return firstDayOfMonth * cellSize
      })
      .attr('y', -5)
      .attr('font-size', '10px')
      .attr('fill', 'var(--text-secondary)')
      .text((d: Date) => d3.timeFormat('%b')(d))

    // Day labels
    const dayLabels = ['Mon', '', 'Wed', '', 'Fri', '', '']
    dayLabels.forEach((label, i) => {
      g.append('text')
        .attr('x', -8)
        .attr('y', i * cellSize + cellSize * 0.8)
        .attr('font-size', '9px')
        .attr('fill', 'var(--text-secondary)')
        .attr('text-anchor', 'end')
        .text(label)
    })

    // Cells with mouse events
    g.selectAll('.cell')
      .data(day)
      .join('rect')
      .attr('class', 'cell')
      .attr('width', cellSize - 1.5)
      .attr('height', cellSize - 1.5)
      .attr('x', (d: Date) => d3.timeWeek.count(d3.timeYear(d), d) * cellSize)
      .attr('y', (d: Date) => (d.getDay() === 0 ? 6 * cellSize : (d.getDay() - 1) * cellSize))
      .attr('rx', 2)
      .attr('fill', (d: Date) => {
        const val = getValue(d)
        return val > 0 ? colorFn(val) : '#ffffff'
      })
      .on('mouseover', (event: MouseEvent, d: Date) => {
        if (!tooltipEl) return
        const val = getValue(d)
        const dateLabel = d3.timeFormat('%b %d, %Y')(d)
        const amountLabel = formatCurrency(val)
        tooltipEl.innerHTML =
          val > 0 ? `${dateLabel}: ${amountLabel} ${props.type}` : `${dateLabel}: No ${props.type}`
        tooltipEl.style.display = 'block'
        tooltipEl.style.left = `${event.clientX + 12}px`
        tooltipEl.style.top = `${event.clientY - 40}px`
      })
      .on('mousemove', (event: MouseEvent) => {
        if (!tooltipEl) return
        tooltipEl.style.left = `${event.clientX + 12}px`
        tooltipEl.style.top = `${event.clientY - 40}px`
      })
      .on('mouseout', () => {
        if (!tooltipEl) return
        tooltipEl.style.display = 'none'
      })
      .on('click', (_event: MouseEvent, d: Date) => {
        const dateStr = d3.timeFormat('%Y-%m-%d')(d)
        const val = getValue(d)
        if (props.onDayClick) props.onDayClick(dateStr, val)
      })

    // Legend
    const legendX = margin.left
    const legendY = height - 16
    const legendWidth = 120
    const legendHeight = 10

    svg
      .append('g')
      .attr('transform', `translate(${legendX},${legendY})`)
      .selectAll('.legend-cell')
      .data([0, 0.25, 0.5, 0.75, 1])
      .join('rect')
      .attr('x', (_: number, i: number) => i * (legendWidth / 5))
      .attr('width', legendWidth / 5 - 1)
      .attr('height', legendHeight)
      .attr('fill', (t: number) => colorFn(t * maxVal))

    svg
      .append('g')
      .attr('transform', `translate(${legendX},${legendY})`)
      .append('text')
      .attr('x', legendWidth + 6)
      .attr('y', legendHeight - 1)
      .attr('font-size', '10px')
      .attr('fill', 'var(--text-secondary)')
      .text(d3.format(',.0f')(maxVal))
  }

  // Create tooltip element and render heatmap
  onMount(() => {
    ensureTooltip()
    renderHeatmap()
    const observer = new ResizeObserver(() => {
      renderHeatmap()
    })
    if (containerRef) observer.observe(containerRef)
    onCleanup(() => {
      observer.disconnect()
      if (tooltipEl && tooltipEl.parentNode) {
        tooltipEl.parentNode.removeChild(tooltipEl)
      }
    })
  })

  createEffect(() => {
    if (props.data && props.year && props.type) renderHeatmap()
  })

  return <div ref={containerRef} style={{ width: '100%' }} />
}
