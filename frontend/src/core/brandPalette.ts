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

// ── PDF report theme ─────────────────────────────────────────────────────────
// The generated PDFs (clientPdfReports.ts + chartWorker.ts) can't read the CSS
// custom properties — jsPDF draws to its own canvas and the chart worker runs
// off-DOM. So the "Orbital Observatory" (dark) and "Dawn" (light) grounds are
// resolved to concrete values here, mirroring styles/themes/orbit-dark.css and
// dawn-light.css. Keep these in sync with those files.

export type RGB = [number, number, number]

/** Parse a #rrggbb (or #rgb) hex to an [r,g,b] tuple for jsPDF's numeric APIs. */
export function hexToRgb(hex: string): RGB {
  const h = hex.replace('#', '').trim()
  const full =
    h.length === 3
      ? h
          .split('')
          .map((c) => c + c)
          .join('')
      : h
  const n = parseInt(full, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** An rgba() string from a hex + alpha — for translucent chart fills. */
export function hexA(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

export interface PdfReportTheme {
  dark: boolean
  /** Page ground. */
  bg: string
  /** Card / panel fill (summary boxes, tables). */
  surface: string
  /** Slightly raised fill (table headers, zebra rows). */
  surfaceElev: string
  border: string
  /** Zebra stripe / hovered row fill (distinct from surface + surfaceElev). */
  zebra: string
  textPrimary: string
  textSecondary: string
  /** Chart grid lines (rgba). */
  grid: string
  /** Dotted orbit track (budget-bar-bg). */
  track: string
  /** Semantic money — never decoration. */
  income: string
  expense: string
  transfer: string
  /** Azure action / net-worth trend. */
  net: string
  accentWarm: string
  /** [r,g,b] tuples for jsPDF setFillColor/setTextColor/setDrawColor. */
  rgb: {
    bg: RGB
    surface: RGB
    surfaceElev: RGB
    border: RGB
    textPrimary: RGB
    textSecondary: RGB
    income: RGB
    expense: RGB
    transfer: RGB
    net: RGB
    accentWarm: RGB
    zebra: RGB
  }
}

const DARK = {
  bg: '#0a0e1c',
  surface: '#131c39',
  surfaceElev: '#0e1430', // --table-header-bg
  border: '#26324f',
  zebra: '#172443', // --table-hover
  textPrimary: '#eaf0ff',
  textSecondary: '#9fb0d6',
  // grid: --chart-grid is rgba(159,176,214,0.08) on screen; nudged up so it
  // still reads at PDF scale.
  grid: 'rgba(159, 176, 214, 0.14)',
  track: '#1e2949', // --budget-bar-bg
  income: '#7dffb0',
  expense: '#ff9d9d',
  transfer: '#93b4ff',
  net: '#6e9bff', // --primary
  accentWarm: '#f0a860',
} as const

const LIGHT = {
  bg: '#f7f9ff',
  surface: '#ffffff',
  surfaceElev: '#f2f5fd', // --table-header-bg
  border: '#dde4f5',
  zebra: '#f7f9ff', // --table-hover
  textPrimary: '#101830',
  textSecondary: '#5a6788',
  grid: 'rgba(16, 24, 48, 0.10)',
  track: '#e4eaf8', // --budget-bar-bg
  income: '#14985a',
  expense: '#d64550',
  transfer: '#5468d4',
  net: '#3b6fe0', // --primary-strong (deep azure for contrast on light)
  accentWarm: '#d97f2e',
} as const

/** Resolve the orbit (dark) or dawn (light) palette for a PDF report. */
export function pdfReportTheme(dark: boolean): PdfReportTheme {
  const c = dark ? DARK : LIGHT
  return {
    dark,
    ...c,
    rgb: {
      bg: hexToRgb(c.bg),
      surface: hexToRgb(c.surface),
      surfaceElev: hexToRgb(c.surfaceElev),
      border: hexToRgb(c.border),
      textPrimary: hexToRgb(c.textPrimary),
      textSecondary: hexToRgb(c.textSecondary),
      income: hexToRgb(c.income),
      expense: hexToRgb(c.expense),
      transfer: hexToRgb(c.transfer),
      net: hexToRgb(c.net),
      accentWarm: hexToRgb(c.accentWarm),
      zebra: hexToRgb(c.zebra),
    },
  }
}

/** income (>= 0) or expense (< 0) tuple, for signed money in jsPDF. */
export function moneyRgb(theme: PdfReportTheme, n: number): RGB {
  return n >= 0 ? theme.rgb.income : theme.rgb.expense
}
