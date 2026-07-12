/**
 * Token Circles brand mark ("Orbit"): luminous core, open orbital ring,
 * one warm dawn satellite. Same vector as the landing site nav glyph.
 */

interface LogoProps {
  size?: number
}

export function LogoMark(props: LogoProps) {
  const size = () => props.size ?? 28
  return (
    <svg viewBox="0 0 96 96" width={size()} height={size()} role="img" aria-label="Token Circles">
      <defs>
        <linearGradient id="tc-mark" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#93b4ff" />
          <stop offset="1" stop-color="#3b6fe0" />
        </linearGradient>
      </defs>
      <circle
        cx="48"
        cy="48"
        r="37"
        fill="none"
        stroke="url(#tc-mark)"
        stroke-width="2.8"
        opacity="0.4"
      />
      <circle
        cx="48"
        cy="48"
        r="25"
        fill="none"
        stroke="url(#tc-mark)"
        stroke-width="3.6"
        opacity="0.75"
        stroke-dasharray="118 28"
        transform="rotate(-24 48 48)"
      />
      <circle cx="48" cy="48" r="10.5" fill="url(#tc-mark)" />
      <circle cx="74" cy="21" r="4.5" fill="var(--accent-warm, #f0a860)" />
    </svg>
  )
}
