/**
 * SankeyChart Component
 * D3-based Sankey diagram for budget → spending flow visualization
 */
import { sankey, sankeyLinkHorizontal } from 'd3-sankey'
import { createEffect, onCleanup, onMount } from 'solid-js'
import type * as D3 from 'd3'

let d3Module: typeof D3 | null = null

async function getD3() {
  if (!d3Module) d3Module = await import('d3')
  return d3Module
}

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

/** Sankey node enriched by d3-sankey layout (includes positioning props) */
interface SankeyNodeDatum extends SankeyNode {
  x0: number
  x1: number
  y0: number
  y1: number
  value?: number
  index?: number
  sourceLinks?: SankeyLinkDatum[]
  targetLinks?: SankeyLinkDatum[]
}

/** Sankey link enriched by d3-sankey layout (includes width + positioning) */
interface SankeyLinkDatum {
  source: SankeyNodeDatum | number | string
  target: SankeyNodeDatum | number | string
  value: number
  sourceCategory?: string
  targetCategory?: string
  width: number
  y0: number
  y1: number
  index?: number
}

interface Props {
  data: { nodes: SankeyNode[]; links: SankeyLink[] }
  height?: number
  width?: number
}

export default function SankeyChart(props: Props) {
  let containerRef: HTMLDivElement | undefined
  let resizeDebounce: ReturnType<typeof setTimeout> | undefined

  const renderSankey = async () => {
    const container = containerRef
    if (!container) return

    // A Sankey needs at least one link to lay out. With no nodes/links (an empty
    // or budget-less month), clear any previous diagram and bail — feeding
    // d3-sankey a graph it can't resolve throws and would surface as a crash.
    if (!props.data?.nodes?.length || !props.data?.links?.length) {
      container.replaceChildren()
      return
    }

    const d3 = await getD3()

    const width = props.width || container.clientWidth || 800
    if (width <= 0) return
    const height = props.height || 400
    const margin = { top: 10, right: 20, bottom: 10, left: 20 }

    // Clear previous
    d3.select(container).selectAll('svg').remove()

    const svg = d3
      .select(container)
      .append('svg')
      .attr('width', width)
      .attr('height', height)
      .attr('viewBox', [0, 0, width, height])

    const sankeyGenerator = sankey<SankeyNodeDatum, SankeyLinkDatum>()
      // Links reference nodes by their `name` string, so key nodes by name.
      // Without this, d3-sankey defaults to indexing by `node.index` and throws
      // "missing: <name>" the moment any link is present.
      .nodeId((d) => d.name)
      .nodeWidth(20)
      .nodePadding(10)
      .extent([
        [margin.left, margin.top],
        [width - margin.right, height - margin.bottom],
      ])

    // Brand palette (Orbit theme): azure source, dawn categories, mint actuals.
    const categoryColors: Record<string, string> = {
      budget: '#6e9bff',
      category: '#f0a860',
      actual: '#59d2a2',
      savings: '#4fb3d9',
    }

    let laidOut: ReturnType<typeof sankeyGenerator>
    try {
      laidOut = sankeyGenerator({
        nodes: props.data.nodes.map(
          (d) => ({ ...d, x0: 0, x1: 0, y0: 0, y1: 0 }) satisfies SankeyNodeDatum
        ),
        links: props.data.links.map(
          (d) => ({ ...d, width: 0, y0: 0, y1: 0 }) satisfies SankeyLinkDatum
        ),
      })
    } catch (err) {
      // Malformed graph (unknown node reference or a cycle). Don't let it bubble
      // up as an unhandled rejection / app crash — just leave the area blank.
      console.warn('Sankey layout failed', err)
      d3.select(container).selectAll('svg').remove()
      return
    }
    const { nodes, links } = laidOut

    // Draw links. Each flow carries its category's own color (target node
    // first — budget→category; then source — category→actual), so the
    // category hue travels the whole path instead of a muddy uniform tint.
    const link = svg
      .append('g')
      .attr('fill', 'none')
      .attr('stroke-opacity', 0.45)
      .selectAll('path')
      .data(links)
      .join('path')
      .attr('d', sankeyLinkHorizontal())
      .attr('stroke', (d: SankeyLinkDatum) => {
        const targetNode = typeof d.target === 'object' ? (d.target as SankeyNodeDatum) : null
        const sourceNode = typeof d.source === 'object' ? (d.source as SankeyNodeDatum) : null
        const targetCat: string = targetNode?.category || d.targetCategory || ''
        return targetNode?.color || sourceNode?.color || categoryColors[targetCat] || '#6e9bff'
      })
      .attr('stroke-width', (d: SankeyLinkDatum) => Math.max(1, d.width))

    link.append('title').text((d: SankeyLinkDatum) => {
      const srcName =
        typeof d.source === 'object' ? (d.source as SankeyNodeDatum).name : String(d.source)
      const tgtName =
        typeof d.target === 'object' ? (d.target as SankeyNodeDatum).name : String(d.target)
      return `${srcName} → ${tgtName}\n${d3.format(',.2f')(d.value)}`
    })

    // Draw nodes
    const node = svg
      .append('g')
      .selectAll('rect')
      .data(nodes)
      .join('rect')
      .attr('x', (d: SankeyNodeDatum) => d.x0)
      .attr('y', (d: SankeyNodeDatum) => d.y0)
      .attr('height', (d: SankeyNodeDatum) => Math.max(0, d.y1 - d.y0))
      .attr('width', (d: SankeyNodeDatum) => d.x1 - d.x0)
      .attr('fill', (d: SankeyNodeDatum) => d.color || categoryColors[d.category] || '#7182a8')
      .attr('rx', 3)

    node
      .append('title')
      .text((d: SankeyNodeDatum) => `${d.name}\n${d3.format(',.2f')(d.value || 0)}`)

    // Draw labels
    svg
      .append('g')
      .selectAll('text')
      .data(nodes)
      .join('text')
      .attr('x', (d: SankeyNodeDatum) => (d.x0 < width / 2 ? d.x1 + 6 : d.x0 - 6))
      .attr('y', (d: SankeyNodeDatum) => (d.y0 + d.y1) / 2)
      .attr('dy', '0.35em')
      .attr('text-anchor', (d: SankeyNodeDatum) => (d.x0 < width / 2 ? 'start' : 'end'))
      .attr('fill', 'var(--text)')
      .attr('font-size', '11px')
      .text((d: SankeyNodeDatum) => d.name)
  }

  onMount(() => {
    const observer = new ResizeObserver(() => {
      clearTimeout(resizeDebounce)
      resizeDebounce = setTimeout(() => {
        renderSankey()
      }, 150)
    })
    if (containerRef) observer.observe(containerRef)
    onCleanup(() => {
      clearTimeout(resizeDebounce)
      observer.disconnect()
    })
  })

  // Reactive render on data change — also handles initial render
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
