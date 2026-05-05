/**
 * D3HeatmapChart Component
 * D3-based calendar heatmap for daily spending visualization
 */
import * as d3 from 'd3'
import { createEffect, onCleanup, onMount } from 'solid-js'

interface Props {
  data: Map<string, number>
  year: number
  type: 'income' | 'expense'
  height?: number
}

export default function D3HeatmapChart(props: Props) {
  let containerRef: HTMLDivElement | undefined

  const renderHeatmap = () => {
    const container = containerRef
    if (!container) return

    const width = container.clientWidth || 800
    const height = props.height || 160
    const margin = { top: 20, right: 20, bottom: 10, left: 40 }

    d3.select(container).selectAll('svg').remove()

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
        ? d3.scaleSequential([0, maxVal], d3.interpolateReds)
        : d3.scaleSequential([0, maxVal], d3.interpolateGreens)

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

    // Cells
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
        return val > 0 ? colorFn(val) : 'var(--bg-secondary, rgba(128,128,128,0.1))'
      })
      .append('title')
      .text((d: Date) => {
        const val = getValue(d)
        return `${d3.timeFormat('%b %d, %Y')(d)}: ${d3.format(',.2f')(val)}`
      })

    // Legend
    const legendX = margin.left
    const legendY = height - 5
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

  onMount(() => {
    renderHeatmap()
    const observer = new ResizeObserver(() => { renderHeatmap(); })
    if (containerRef) observer.observe(containerRef)
    onCleanup(() => { observer.disconnect(); })
  })

  createEffect(() => {
    if (props.data) renderHeatmap()
  })

  return <div ref={containerRef} style={{ width: '100%' }} />
}
