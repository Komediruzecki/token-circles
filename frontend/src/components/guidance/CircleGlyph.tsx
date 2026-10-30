/**
 * One circle's ring, as the ledger and Your next step draw it (design.md 1.4, circles part 2): a
 * dotted orbit; solid from `--ring-a` to `--ring-b` once reached; for the circle being worked on, an
 * arc to its measure with a dot in `--circle-now` at the end of it (Clear picture short of a year:
 * twelve segments, one per month on file); for a circle further out, a faint arc once its measure
 * is above zero. A measure not known draws the dotted orbit only.
 *
 * Decorative: the row's link carries the words, so the glyph is `aria-hidden`.
 */
import { createUniqueId, For, Show } from 'solid-js'
import type { JSX } from 'solid-js'
import type { CircleNumber } from '../../../../shared/guidance/circles'
import type { RowState } from '../../../../shared/guidance/ledger'

const C = 20
const R = 15

/** The point at `deg` degrees clockwise from twelve o'clock. */
function polar(deg: number): [number, number] {
  const t = ((deg - 90) * Math.PI) / 180
  return [C + R * Math.cos(t), C + R * Math.sin(t)]
}

const f2 = (n: number): string => n.toFixed(2)

/** An arc of the orbit from `a0` to `a1` degrees. */
function arc(a0: number, a1: number): string {
  const [x0, y0] = polar(a0)
  const [x1, y1] = polar(a1)
  const large = a1 - a0 > 180 ? 1 : 0
  return `M${f2(x0)} ${f2(y0)}A${R} ${R} 0 ${large} 1 ${f2(x1)} ${f2(y1)}`
}

export interface CircleGlyphProps {
  circle: CircleNumber
  state: RowState
  /** How far along the circle's figure is, 0 to 1; null when it is not known. */
  measure: number | null
  /** Clear picture short of a year: the months on file, drawn as twelve segments. */
  months?: number | null
  /** 36 in a phone row, 40 on desktop, 52 in the circle's header, 20 in Your next step's chip. */
  size: number
  class?: string
}

export default function CircleGlyph(props: CircleGlyphProps): JSX.Element {
  const gradient = `circle-ring-${createUniqueId()}`
  const months = () => (props.months === null || props.months === undefined ? null : props.months)
  const share = () => (props.measure === null ? null : Math.max(0, Math.min(1, props.measure)))
  /** Where the current circle's dot sits, in degrees. */
  const dotAt = () => {
    const n = months()
    if (n !== null) return n === 0 ? 0 : n * 30 - 4
    return Math.min(share() ?? 0, 0.999) * 360
  }
  const dot = () => polar(dotAt())

  return (
    <svg
      class={props.class}
      viewBox="0 0 40 40"
      width={props.size}
      height={props.size}
      aria-hidden="true"
      data-circle-glyph={props.state}
    >
      <defs>
        <linearGradient id={gradient} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="var(--ring-a)" />
          <stop offset="1" stop-color="var(--ring-b)" />
        </linearGradient>
      </defs>
      <circle
        cx={C}
        cy={C}
        r={R}
        fill="none"
        stroke="var(--ring-track)"
        stroke-width="2"
        stroke-dasharray="0.6 3.4"
        stroke-linecap="round"
      />
      <Show when={props.state === 'reached'}>
        <circle cx={C} cy={C} r={R} fill="none" stroke={`url(#${gradient})`} stroke-width="3.6" />
      </Show>
      <Show when={props.state === 'current' && (months() !== null || share() !== null)}>
        <Show
          when={months() !== null}
          fallback={
            <Show when={(share() ?? 0) > 0}>
              <path
                d={arc(0, Math.min(share() ?? 0, 0.999) * 360)}
                fill="none"
                stroke={`url(#${gradient})`}
                stroke-width="3.6"
                stroke-linecap="round"
              />
            </Show>
          }
        >
          <For each={Array.from({ length: 12 }, (_, i) => i)}>
            {(i) => (
              <path
                d={arc(i * 30 + 4, (i + 1) * 30 - 4)}
                fill="none"
                stroke={i < (months() ?? 0) ? `url(#${gradient})` : 'var(--ring-track)'}
                stroke-width="3.6"
                stroke-linecap="round"
                data-segment={i < (months() ?? 0) ? 'on' : 'off'}
              />
            )}
          </For>
        </Show>
        <circle
          cx={f2(dot()[0])}
          cy={f2(dot()[1])}
          r="3.6"
          fill="var(--circle-now)"
          stroke="var(--card-bg)"
          stroke-width="1.4"
          data-now
        />
      </Show>
      <Show when={props.state === 'later' && (share() ?? 0) > 0}>
        <path
          d={arc(0, Math.max(share() ?? 0, 0.02) * 360)}
          fill="none"
          stroke="var(--ring-a)"
          stroke-opacity="0.55"
          stroke-width="2.4"
          stroke-linecap="round"
        />
      </Show>
      <Show when={props.size >= 26}>
        <text
          x={C}
          y="24.7"
          text-anchor="middle"
          font-size="13.5"
          font-weight="600"
          fill={props.state === 'later' ? 'var(--text-secondary)' : 'var(--text)'}
        >
          {props.circle}
        </text>
      </Show>
    </svg>
  )
}
