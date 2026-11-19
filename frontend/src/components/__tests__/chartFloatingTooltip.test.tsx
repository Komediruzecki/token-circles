/**
 * A chart's tooltip is a floating surface too (UI-28), drawn on the canvas where no stylesheet
 * reaches. Chart.js paints it 80% black with no edge: 1.22:1 on an Orbit card, nothing marking
 * where it ends. These check that every chart paints it from the theme's floating pair instead,
 * read off its own canvas, and that nothing in front of Chart.js paints over that.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { paintTooltipsAsFloating } from '../chartFloatingTooltip'

const fake = vi.hoisted(() => {
  class FakeChart {
    static readonly defaults = { plugins: { tooltip: {} as Record<string, unknown> } }
    static readonly configs: Array<{
      options?: { plugins?: { tooltip?: Record<string, unknown> } }
    }> = []
    constructor(_ctx: unknown, config: (typeof FakeChart.configs)[number]) {
      FakeChart.configs.push(config)
    }
    destroy() {}
    update() {}
  }
  return { FakeChart }
})
vi.mock('chart.js/auto', () => ({ default: fake.FakeChart }))

import Chart from '../Chart'
import ChartWrapper from '../ChartWrapper'

type Scripted = (context: { chart: { canvas: HTMLCanvasElement | null } }) => string

const DATA = { labels: ['Jan', 'Feb'], datasets: [{ label: 'Spent', data: [1, 2] }] }

beforeEach(() => {
  fake.FakeChart.defaults.plugins.tooltip = {}
  fake.FakeChart.configs.length = 0
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as never)
})
let dispose: (() => void) | undefined
afterEach(() => {
  dispose?.()
  dispose = undefined
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})
const mount = (view: () => unknown) => {
  const host = document.createElement('div')
  document.body.append(host)
  dispose = render(view as never, host)
}

describe('paintTooltipsAsFloating', () => {
  const install = () => {
    const ChartJS = { defaults: { plugins: { tooltip: {} as Record<string, unknown> } } }
    paintTooltipsAsFloating(ChartJS as never)
    return ChartJS.defaults.plugins.tooltip
  }

  it("paints the surface, edge and text from the tokens on the chart's own canvas", () => {
    const tooltip = install()
    const canvas = document.createElement('canvas')
    canvas.style.setProperty('--surface-floating', '#202329')
    canvas.style.setProperty('--border-floating', '#5e656d')
    canvas.style.setProperty('--text-primary', '#e6edf3')
    document.body.append(canvas)
    const at = (key: string) => (tooltip[key] as Scripted)({ chart: { canvas } })
    expect(at('backgroundColor')).toBe('#202329')
    expect(at('borderColor')).toBe('#5e656d')
    expect(tooltip.borderWidth).toBe(1)
    expect([at('titleColor'), at('bodyColor'), at('footerColor')]).toEqual([
      '#e6edf3',
      '#e6edf3',
      '#e6edf3',
    ])
  })

  it('falls back to what Chart.js painted before when a token is missing', () => {
    const tooltip = install()
    const canvas = document.createElement('canvas')
    document.body.append(canvas)
    const at = (key: string) => (tooltip[key] as Scripted)({ chart: { canvas } })
    expect(at('backgroundColor')).toBe('rgba(0, 0, 0, 0.8)')
    expect(at('bodyColor')).toBe('#fff')
  })
})

describe('every chart paints its tooltip as a floating surface', () => {
  it('Chart installs the floating tooltip before it draws', async () => {
    mount(() => <Chart type="bar" data={DATA} />)
    await vi.waitFor(() => {
      expect(fake.FakeChart.configs).toHaveLength(1)
    })
    expect(typeof fake.FakeChart.defaults.plugins.tooltip.backgroundColor).toBe('function')
    expect(typeof fake.FakeChart.defaults.plugins.tooltip.borderColor).toBe('function')
  })

  it('ChartWrapper installs it too, and its own defaults leave the surface and edge to it', async () => {
    mount(() => <ChartWrapper type="line" data={DATA} />)
    await vi.waitFor(() => {
      expect(fake.FakeChart.configs).toHaveLength(1)
    })
    expect(typeof fake.FakeChart.defaults.plugins.tooltip.backgroundColor).toBe('function')
    const own = fake.FakeChart.configs[0].options?.plugins?.tooltip ?? {}
    expect(own.backgroundColor).toBeUndefined()
    expect(own.borderColor).toBeUndefined()
  })
})
