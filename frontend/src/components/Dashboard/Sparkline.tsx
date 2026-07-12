/**
 * Sparkline — tiny inline SVG trend line with a soft area fill.
 * Used inside metric cards; purely presentational, no chart.js overhead.
 */
import { createMemo, createUniqueId, Show } from 'solid-js'

export interface SparklineProps {
  data: number[]
  /** Any CSS color, including var(--token). Defaults to the theme primary. */
  color?: string
  height?: number
  /** Adds a soft neon glow around the line (Direction A trend panels). */
  glow?: boolean
}

export default function Sparkline(props: SparklineProps) {
  const uid = createUniqueId()
  const W = 100
  const H = 30
  const points = createMemo(() => {
    const d = props.data
    if (!d || d.length < 2) return null
    const min = Math.min(...d)
    const max = Math.max(...d)
    const span = max - min || 1
    return d.map((v, i) => ({
      x: (i / (d.length - 1)) * W,
      y: H - 3 - ((v - min) / span) * (H - 6),
    }))
  })
  const linePath = () =>
    points()!
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
      .join(' ')
  const areaPath = () => `${linePath()} L${W} ${H} L0 ${H} Z`
  const color = () => props.color || 'var(--primary)'

  return (
    <Show when={points()}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        style={{ width: '100%', height: `${props.height ?? 30}px`, display: 'block' }}
        aria-hidden="true"
      >
        <Show when={props.glow}>
          <filter id={`spark-glow-${uid}`} x="-40%" y="-120%" width="180%" height="340%">
            <feGaussianBlur stdDeviation="1.6" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </Show>
        <path d={areaPath()} fill={color()} opacity="0.12" />
        <path
          d={linePath()}
          fill="none"
          stroke={color()}
          stroke-width="1.6"
          stroke-linejoin="round"
          stroke-linecap="round"
          vector-effect="non-scaling-stroke"
          filter={props.glow ? `url(#spark-glow-${uid})` : undefined}
        />
        <circle
          cx={points()![points()!.length - 1].x}
          cy={points()![points()!.length - 1].y}
          r="2.2"
          fill={color()}
        />
      </svg>
    </Show>
  )
}
