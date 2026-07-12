/**
 * Token Circles categorical palette — the "constellation".
 * Azure-anchored with warm dawn and mint counterpoints, tuned to read on
 * both the Orbit (dark) and Dawn (light) grounds. Used wherever a series
 * of categories needs distinct colors and no per-item color is defined
 * (charts, swatches, orbit rings). Prefer a category's own stored color
 * when it has one; fall back to this palette by index.
 */
export const CATEGORY_PALETTE = [
  '#6e9bff', // azure
  '#f0a860', // dawn
  '#59d2a2', // mint
  '#e0708a', // rose
  '#93b4ff', // azure bright
  '#e8c268', // amber
  '#4fb3d9', // cyan
  '#c9a0ff', // violet
  '#7182a8', // mist (also the "Other" bucket)
  '#3b6fe0', // azure deep
]

/** Neutral color for an aggregated "Other" bucket. */
export const OTHER_COLOR = '#7182a8'

/** Pick a palette color by index (wraps). */
export const paletteColor = (i: number) => CATEGORY_PALETTE[i % CATEGORY_PALETTE.length]
