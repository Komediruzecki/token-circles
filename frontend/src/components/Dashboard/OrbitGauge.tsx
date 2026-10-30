/**
 * OrbitGauge — circular ring gauge in the brand's orbital language.
 * A dotted "orbit" track with a glowing progress arc and a goal tick;
 * the value sits in the luminous core. SVG only. A band (the typical
 * range where the person lives, on Dashboard's savings gauge) is a wide
 * soft arc under the progress arc.
 */
import { Show } from 'solid-js'

export interface OrbitGaugeProps {
  /** 0–100 (values outside are clamped for the arc, shown verbatim in the core) */
  value: number
  /** Optional goal marker, 0–100 */
  goal?: number
  label?: string
  size?: number
  /** A range on the same 0–100 scale, drawn under the progress arc. */
  band?: { from: number; to: number }
  /** The core's text in place of the value to one decimal, e.g. a floored "13.8". */
  valueText?: string
  /** The whole gauge in words, in place of "{label}: {value}%". */
  ariaLabel?: string
}

export default function OrbitGauge(props: OrbitGaugeProps) {
  const R = 44
  const C = 2 * Math.PI * R
  const clamped = () => Math.max(0, Math.min(100, props.value))
  const dash = () => `${(clamped() / 100) * C} ${C}`
  const goalAngle = () => ((props.goal ?? 0) / 100) * 360 - 90
  const goalX = () => 60 + Math.cos((goalAngle() * Math.PI) / 180) * R
  const goalY = () => 60 + Math.sin((goalAngle() * Math.PI) / 180) * R
  const met = () => props.goal !== undefined && props.value >= props.goal
  const clamp = (v: number) => Math.max(0, Math.min(100, v))
  // The caption renders at 12 px or more, whatever the size (compact-ui TYPE-01).
  const captionSize = () => String(Math.max(7.5, (12 * 120) / (props.size ?? 132)))
  const bandFrom = () => (props.band ? (clamp(props.band.from) / 100) * C : 0)
  const bandLength = () =>
    props.band ? (Math.max(0, clamp(props.band.to) - clamp(props.band.from)) / 100) * C : 0

  return (
    <svg
      viewBox="0 0 120 120"
      width={props.size ?? 132}
      height={props.size ?? 132}
      role="img"
      aria-label={props.ariaLabel ?? `${props.label ?? 'Gauge'}: ${props.value.toFixed(1)}%`}
    >
      <defs>
        <linearGradient id="og-arc" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="var(--primary-hover, #93b4ff)" />
          <stop offset="1" stop-color="var(--primary, #6e9bff)" />
        </linearGradient>
        <radialGradient id="og-core" cx="50%" cy="42%" r="60%">
          <stop offset="0%" stop-color="var(--primary)" stop-opacity="0.16" />
          <stop offset="100%" stop-color="var(--primary)" stop-opacity="0" />
        </radialGradient>
      </defs>

      {/* dotted orbit track */}
      <circle
        cx="60"
        cy="60"
        r={R}
        fill="none"
        stroke="var(--budget-bar-bg)"
        stroke-width="3"
        stroke-dasharray="1 5"
        stroke-linecap="round"
      />
      {/* band: the typical range, a wide soft arc */}
      <Show when={props.band}>
        <circle
          cx="60"
          cy="60"
          r={R}
          fill="none"
          stroke="var(--band-mid)"
          stroke-width="13"
          stroke-dasharray={`${bandLength()} ${C}`}
          stroke-dashoffset={-bandFrom()}
          transform="rotate(-90 60 60)"
          data-test-id="gauge-band"
        />
      </Show>
      {/* progress arc */}
      <circle
        cx="60"
        cy="60"
        r={R}
        fill="none"
        stroke="url(#og-arc)"
        stroke-width="4.5"
        stroke-linecap="round"
        stroke-dasharray={dash()}
        transform="rotate(-90 60 60)"
        style={{ transition: 'stroke-dasharray 0.6s cubic-bezier(0.22, 1, 0.36, 1)' }}
      />
      {/* goal tick — dawn satellite */}
      <Show when={props.goal !== undefined}>
        <circle
          cx={goalX()}
          cy={goalY()}
          r="4"
          data-test-id="gauge-goal"
          fill={met() ? 'var(--text-positive)' : 'var(--accent-warm, #f0a860)'}
          stroke="var(--card-bg)"
          stroke-width="1.5"
        />
      </Show>

      {/* luminous core + value */}
      <circle cx="60" cy="60" r="34" fill="url(#og-core)" />
      <text
        x="60"
        y="60"
        text-anchor="middle"
        font-size="19"
        font-weight="600"
        font-family="var(--font-display)"
        fill="var(--text)"
      >
        {props.valueText ?? props.value.toFixed(1)}%
      </text>
      <Show when={props.label}>
        <text
          x="60"
          y="77"
          text-anchor="middle"
          font-size={captionSize()}
          letter-spacing="1.2"
          fill="var(--text-secondary)"
        >
          {props.label!.toUpperCase()}
        </text>
      </Show>
    </svg>
  )
}
