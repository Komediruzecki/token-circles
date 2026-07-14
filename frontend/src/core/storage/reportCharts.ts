/**
 * Pure chart/data builders for the PDF reports — no canvas, no DOM, no jsPDF.
 *
 * These turn report rows into Token Circles "Orbital Observatory" visuals:
 *  - Category breakdowns → concentric orbit rings (buildCategoryOrbitsSvg), the
 *    brand hero, rasterized on the main thread by clientPdfReports.ts.
 *  - A branded Chart.js doughnut fallback (buildCategoryDoughnut) for when SVG
 *    rasterization fails.
 *  - Income-vs-expense bars and the net cash-flow line in semantic money colors.
 *
 * Kept side-effect-free so the color/shape logic is unit-testable without a
 * headless canvas (reportCharts.test.ts).
 */
import { hexA, OTHER_COLOR, paletteColor } from '../brandPalette'
import type { ChartData } from 'chart.js'
import type { PdfReportTheme } from '../brandPalette'

export interface CategoryDatum {
  name: string
  color?: string | null
  total: number
}

export interface MonthlyDatum {
  month: string
  income: number
  expense: number
}

// ── Orbit rings (brand hero) ─────────────────────────────────────────────────

export interface OrbitRing {
  name: string
  color: string
  amount: number
  share: number
}

const ORBIT = { C: 130, R_OUTER: 104, R_STEP: 13, STROKE: 7.5, VIEW: 260 } as const

/**
 * Collapse category rows into orbit rings: top `maxRings` by amount, the tail
 * folded into a neutral "Other" bucket. Mirrors the in-app CategoryOrbits so
 * the PDF reads the same. Amounts must be positive magnitudes.
 */
export function computeOrbitRings(
  rows: CategoryDatum[],
  maxRings = 6
): { total: number; rings: OrbitRing[] } {
  const sorted = [...(rows || [])].filter((r) => r.total > 0).sort((a, b) => b.total - a.total)
  const total = sorted.reduce((s, r) => s + r.total, 0)
  if (total <= 0) return { total: 0, rings: [] }
  const top = sorted.slice(0, maxRings)
  const rest = sorted.slice(maxRings)
  const rings: OrbitRing[] = top.map((r, i) => ({
    name: r.name || 'Uncategorized',
    color: r.color || paletteColor(i),
    amount: r.total,
    share: r.total / total,
  }))
  if (rest.length) {
    const restAmount = rest.reduce((s, r) => s + r.total, 0)
    rings.push({
      name: `Other (${rest.length})`,
      color: OTHER_COLOR,
      amount: restAmount,
      share: restAmount / total,
    })
  }
  return { total, rings }
}

/**
 * A self-contained SVG string for the orbit-ring hero (tracks + glowing arcs +
 * core glow, no text — the total/label are drawn over it in embedded Inter by
 * the caller, since <img>-rasterized SVG can't see document fonts). Returns ''
 * for empty/zero data so the caller can skip it.
 */
export function buildCategoryOrbitsSvg(
  rows: CategoryDatum[],
  opts: { theme: PdfReportTheme; maxRings?: number }
): string {
  const { rings } = computeOrbitRings(rows, opts.maxRings ?? 6)
  if (rings.length === 0) return ''
  const { theme } = opts
  const { C, R_OUTER, R_STEP, STROKE, VIEW } = ORBIT

  const arcs = rings
    .map((row, i) => {
      const r = R_OUTER - i * R_STEP
      const circ = 2 * Math.PI * r
      const dash = `${Math.max(0.02, row.share) * circ} ${circ}`
      return (
        `<circle cx="${C}" cy="${C}" r="${r}" fill="none" stroke="${theme.track}" ` +
        `stroke-width="2" stroke-dasharray="1 5" stroke-linecap="round"/>` +
        `<circle cx="${C}" cy="${C}" r="${r}" fill="none" stroke="${row.color}" ` +
        `stroke-width="${STROKE}" stroke-linecap="round" stroke-dasharray="${dash}" ` +
        `transform="rotate(-90 ${C} ${C})" filter="url(#co-glow)" opacity="0.94"/>`
      )
    })
    .join('')

  const coreR = Math.max(8, R_OUTER - rings.length * R_STEP - 4)

  // Explicit width/height (not just viewBox) so Firefox/WebKit give the SVG an
  // intrinsic size when it's rasterized through an <img>.
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${VIEW}" height="${VIEW}" ` +
    `viewBox="0 0 ${VIEW} ${VIEW}">` +
    `<defs>` +
    `<filter id="co-glow" x="-60%" y="-60%" width="220%" height="220%">` +
    `<feGaussianBlur stdDeviation="2.2" result="b"/>` +
    `<feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>` +
    `</filter>` +
    `<radialGradient id="co-core" cx="50%" cy="44%" r="60%">` +
    `<stop offset="0%" stop-color="${theme.net}" stop-opacity="0.18"/>` +
    `<stop offset="100%" stop-color="${theme.net}" stop-opacity="0"/>` +
    `</radialGradient>` +
    `</defs>${arcs}<circle cx="${C}" cy="${C}" r="${coreR}" fill="url(#co-core)"/>` +
    `</svg>`
  )
}

// ── Chart.js configs (rendered by chartWorker.ts) ────────────────────────────

/** Branded doughnut — the orbit-ring fallback. Colors keep category identity. */
export function buildCategoryDoughnut(
  rows: CategoryDatum[],
  theme: PdfReportTheme
): ChartData<'doughnut'> {
  return {
    labels: rows.map((r) => r.name),
    datasets: [
      {
        data: rows.map((r) => r.total),
        backgroundColor: rows.map((r, i) => r.color || paletteColor(i)),
        // Separate arcs against the page ground for an orbital, ringed read.
        borderColor: theme.bg,
        borderWidth: 2,
        borderRadius: 6,
        spacing: 2,
        hoverOffset: 0,
      },
    ],
  }
}

/** Cutout ratio for the branded doughnut (thin ring, like the orbits). */
export const DOUGHNUT_CUTOUT = '66%'

/** Income vs expenses bars in semantic money colors. */
export function buildIncomeExpenseBar(
  monthly: MonthlyDatum[],
  theme: PdfReportTheme
): ChartData<'bar'> {
  return {
    labels: monthly.map((m) => m.month),
    datasets: [
      {
        label: 'Income',
        data: monthly.map((m) => m.income),
        backgroundColor: hexA(theme.income, theme.dark ? 0.8 : 0.85),
        borderColor: theme.income,
        borderWidth: 1,
        borderRadius: 3,
        borderSkipped: false,
      },
      {
        label: 'Expenses',
        data: monthly.map((m) => m.expense),
        backgroundColor: hexA(theme.expense, theme.dark ? 0.8 : 0.85),
        borderColor: theme.expense,
        borderWidth: 1,
        borderRadius: 3,
        borderSkipped: false,
      },
    ],
  }
}

/** Cumulative net cash-flow line in azure (the action/trend color). */
export function buildCashFlowLine(
  labels: string[],
  data: number[],
  theme: PdfReportTheme
): ChartData<'line'> {
  return {
    labels,
    datasets: [
      {
        label: 'Cash Flow',
        data,
        borderColor: theme.net,
        backgroundColor: hexA(theme.net, 0.12),
        fill: true,
        tension: 0.35,
        pointRadius: 2,
        pointBackgroundColor: theme.net,
        borderWidth: 2,
      },
    ],
  }
}
