/**
 * SankeyChart Component
 * D3-based Sankey diagram for budget → spending flow visualization
 */
import * as d3 from 'd3'
import { sankey, sankeyLinkHorizontal } from 'd3-sankey'
import { createEffect, onCleanup, onMount } from 'solid-js'

interface SankeyNode {
  name: string
  category: string
  color?: string
}

interface SankeyLink {
  source: string | number
  target: string | number
  value: number
  sourceCategory?: string
  targetCategory?: string
}

interface Props {
  data: { nodes: SankeyNode[]; links: SankeyLink[] }
  height?: number
  width?: number
}

export default function SankeyChart(props: Props) {
  let containerRef: HTMLDivElement | undefined
  let svgRef: SVGSVGElement | undefined

  const renderSankey = () => {
    const container = containerRef
    if (!container || !props.data?.nodes?.length) return

    const width = props.width || container.clientWidth || 800
    const height = props.height || 400
    const margin = { top: 10, right: 20, bottom: 10, left: 20 }

    // Clear previous
    if (svgRef) {
      svgRef.innerHTML = ''
    }
    d3.select(container).selectAll('svg').remove()

    const svg = d3
      .select(container)
      .append('svg')
      .attr('width', width)
      .attr('height', height)
      .attr('viewBox', [0, 0, width, height])

    svgRef = svg.node() as SVGSVGElement

    const sankeyGenerator = sankey()
      .nodeWidth(20)
      .nodePadding(10)
      .extent([
        [margin.left, margin.top],
        [width - margin.right, height - margin.bottom],
      ])
      .nodeId((d: any) => d.name)

    // Color scheme
    const categoryColors: Record<string, string> = {
      budget: '#6366f1',
      category: '#f59e0b',
      actual: '#10b981',
      savings: '#06b6d4',
    }

    const { nodes, links } = sankeyGenerator({
      nodes: props.data.nodes.map((d) => ({ ...d })),
      links: props.data.links.map((d) => ({ ...d })),
    })

    // Draw links
    const link = svg
      .append('g')
      .attr('fill', 'none')
      .attr('stroke-opacity', 0.4)
      .selectAll('path')
      .data(links)
      .join('path')
      .attr('d', sankeyLinkHorizontal())
      .attr('stroke', (d: any) => {
        const targetCat = d.target?.category || d.targetCategory
        return categoryColors[targetCat] || '#6366f1'
      })
      .attr('stroke-width', (d: any) => Math.max(1, d.width))

    link
      .append('title')
      .text(
        (d: any) =>
          `${d.source?.name || d.source} → ${d.target?.name || d.target}\n${d3.format(',.2f')(d.value)}`
      )

    // Draw nodes
    const node = svg
      .append('g')
      .selectAll('rect')
      .data(nodes)
      .join('rect')
      .attr('x', (d: any) => d.x0)
      .attr('y', (d: any) => d.y0)
      .attr('height', (d: any) => Math.max(0, d.y1 - d.y0))
      .attr('width', (d: any) => d.x1 - d.x0)
      .attr('fill', (d: any) => d.color || categoryColors[d.category] || '#6b7280')
      .attr('rx', 3)

    node.append('title').text((d: any) => `${d.name}\n${d3.format(',.2f')(d.value || 0)}`)

    // Draw labels
    svg
      .append('g')
      .selectAll('text')
      .data(nodes)
      .join('text')
      .attr('x', (d: any) => (d.x0 < width / 2 ? d.x1 + 6 : d.x0 - 6))
      .attr('y', (d: any) => (d.y0 + d.y1) / 2)
      .attr('dy', '0.35em')
      .attr('text-anchor', (d: any) => (d.x0 < width / 2 ? 'start' : 'end'))
      .attr('fill', 'var(--text)')
      .attr('font-size', '11px')
      .text((d: any) => d.name)
  }

  onMount(() => {
    renderSankey()
    const observer = new ResizeObserver(() => {
      renderSankey()
    })
    if (containerRef) observer.observe(containerRef)
    onCleanup(() => {
      observer.disconnect()
    })
  })

  createEffect(() => {
    if (props.data) renderSankey()
  })

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: `${props.height || 400}px`,
        overflow: 'hidden',
      }}
    />
  )
}
