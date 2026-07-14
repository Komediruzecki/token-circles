import { describe, expect, it } from 'vitest'
import { hexA, hexToRgb, moneyRgb, pdfReportTheme } from '../../brandPalette'
import {
  buildCashFlowLine,
  buildCategoryDoughnut,
  buildCategoryOrbitsSvg,
  buildIncomeExpenseBar,
  computeOrbitRings,
} from '../reportCharts'
import type { CategoryDatum } from '../reportCharts'

// The PDF reports (clientPdfReports.ts) can't read the theme CSS vars, so the
// palette + chart shapes are resolved here as pure data. These tests lock in the
// brand colors and the empty/edge behavior without needing a canvas.

const dark = pdfReportTheme(true)
const light = pdfReportTheme(false)

describe('brandPalette PDF theme', () => {
  it('hexToRgb parses long and short hex', () => {
    expect(hexToRgb('#6e9bff')).toEqual([110, 155, 255])
    expect(hexToRgb('6e9bff')).toEqual([110, 155, 255])
    expect(hexToRgb('#fff')).toEqual([255, 255, 255])
    expect(hexToRgb('#000')).toEqual([0, 0, 0])
  })

  it('hexA emits an rgba string', () => {
    expect(hexA('#6e9bff', 0.12)).toBe('rgba(110, 155, 255, 0.12)')
  })

  it('resolves the orbit (dark) ground and semantic money colors', () => {
    expect(dark.dark).toBe(true)
    expect(dark.bg).toBe('#0a0e1c')
    expect(dark.income).toBe('#7dffb0')
    expect(dark.expense).toBe('#ff9d9d')
    expect(dark.net).toBe('#6e9bff')
    expect(dark.rgb.income).toEqual([125, 255, 176])
  })

  it('resolves the dawn (light) ground with deep azure for contrast', () => {
    expect(light.dark).toBe(false)
    expect(light.bg).toBe('#f7f9ff')
    expect(light.income).toBe('#14985a')
    expect(light.expense).toBe('#d64550')
    expect(light.net).toBe('#3b6fe0')
  })

  it('moneyRgb picks income for >= 0 and expense for < 0', () => {
    expect(moneyRgb(dark, 5)).toEqual(dark.rgb.income)
    expect(moneyRgb(dark, 0)).toEqual(dark.rgb.income)
    expect(moneyRgb(dark, -1)).toEqual(dark.rgb.expense)
  })
})

describe('computeOrbitRings', () => {
  const rows: CategoryDatum[] = [
    { name: 'Rent', color: '#aaa', total: 100 },
    { name: 'Food', color: '#bbb', total: 50 },
    { name: 'Fun', color: '#ccc', total: 25 },
  ]

  it('sorts by amount and computes shares that sum to 1', () => {
    const { total, rings } = computeOrbitRings(rows)
    expect(total).toBe(175)
    expect(rings.map((r) => r.name)).toEqual(['Rent', 'Food', 'Fun'])
    expect(rings.reduce((s, r) => s + r.share, 0)).toBeCloseTo(1, 10)
    expect(rings[0].share).toBeCloseTo(100 / 175, 10)
  })

  it('folds the tail past maxRings into a neutral Other bucket', () => {
    const { rings } = computeOrbitRings(rows, 2)
    expect(rings).toHaveLength(3)
    const other = rings[rings.length - 1]
    expect(other.name).toBe('Other (1)')
    expect(other.amount).toBe(25)
    expect(other.color).toBe('#7182a8') // OTHER_COLOR
  })

  it('falls back to the constellation palette when a row has no color', () => {
    const { rings } = computeOrbitRings([{ name: 'X', total: 10 }])
    expect(rings[0].color).toBe('#6e9bff') // paletteColor(0)
  })

  it('drops non-positive rows and returns empty on zero total', () => {
    expect(computeOrbitRings([]).rings).toEqual([])
    expect(computeOrbitRings([{ name: 'Z', total: 0 }]).total).toBe(0)
    const { rings } = computeOrbitRings([
      { name: 'A', total: 10 },
      { name: 'B', total: -5 },
    ])
    expect(rings.map((r) => r.name)).toEqual(['A'])
  })
})

describe('buildCategoryOrbitsSvg', () => {
  const rows: CategoryDatum[] = [
    { name: 'Rent', color: '#ff0000', total: 100 },
    { name: 'Food', color: '#00ff00', total: 50 },
  ]

  it('returns empty string for no data', () => {
    expect(buildCategoryOrbitsSvg([], { theme: dark })).toBe('')
    expect(buildCategoryOrbitsSvg([{ name: 'z', total: 0 }], { theme: dark })).toBe('')
  })

  it('emits an svg with one glowing arc per ring in category colors', () => {
    const svg = buildCategoryOrbitsSvg(rows, { theme: dark })
    expect(svg.startsWith('<svg')).toBe(true)
    expect(svg).toContain('stroke="#ff0000"')
    expect(svg).toContain('stroke="#00ff00"')
    // two category arcs, each preceded by a track circle
    expect(svg.match(/filter="url\(#co-glow\)"/g)).toHaveLength(2)
    expect(svg).toContain('url(#co-core)')
    // core glow uses the theme's azure
    expect(svg).toContain(`stop-color="${dark.net}"`)
  })
})

describe('Chart.js config builders', () => {
  const rows: CategoryDatum[] = [
    { name: 'Rent', color: '#abc', total: 100 },
    { name: 'NoColor', total: 40 },
  ]

  it('doughnut keeps category colors, falls back to palette, separates on the ground', () => {
    const cfg = buildCategoryDoughnut(rows, dark)
    const ds = cfg.datasets[0]
    // second row has no color → palette slot by its index (paletteColor(1))
    expect(ds.backgroundColor).toEqual(['#abc', '#f0a860'])
    expect(ds.borderColor).toBe(dark.bg)
    expect(ds.data).toEqual([100, 40])
  })

  it('income/expense bars use the semantic money colors', () => {
    const cfg = buildIncomeExpenseBar(
      [
        { month: 'Jan', income: 10, expense: 4 },
        { month: 'Feb', income: 8, expense: 9 },
      ],
      light
    )
    expect(cfg.datasets[0].label).toBe('Income')
    expect(cfg.datasets[0].borderColor).toBe(light.income)
    expect(cfg.datasets[1].label).toBe('Expenses')
    expect(cfg.datasets[1].borderColor).toBe(light.expense)
    expect(cfg.datasets[0].data).toEqual([10, 8])
  })

  it('cash-flow line uses azure net trend and fills under the curve', () => {
    const cfg = buildCashFlowLine(['Jan', 'Feb'], [5, -3], dark)
    const ds = cfg.datasets[0]
    expect(ds.borderColor).toBe(dark.net)
    expect(ds.backgroundColor).toBe(hexA(dark.net, 0.12))
    expect(ds.fill).toBe(true)
    expect(ds.data).toEqual([5, -3])
  })
})
