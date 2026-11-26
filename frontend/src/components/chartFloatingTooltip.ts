/**
 * A chart's tooltip is a floating surface (UI-28), but Chart.js draws it on the canvas, where no
 * stylesheet reaches, in colours of its own: 80% black with no edge. On an Orbit card that is a
 * near-black box on near-black, 1.22:1, with nothing to say where it ends.
 *
 * These defaults paint it like every other floating surface, from the theme's
 * `--surface-floating` and `--border-floating`, read off the chart's own canvas each time it is
 * drawn: a theme switch needs no rebuild, and a chart inside `.instrument-deck` gets the deck's
 * pair. The text takes `--text-primary`, since Chart.js's white would vanish on Dawn's white.
 * A chart that sets its own tooltip colours still wins over these.
 */
import type { Chart, ChartType, ScriptableTooltipContext } from 'chart.js/auto'

type TooltipContext = Pick<ScriptableTooltipContext<ChartType>, 'chart'>

/** A theme token as the chart's canvas sees it, or what Chart.js painted before when there is none. */
function token(context: TooltipContext, name: string, otherwise: string): string {
  const canvas = context.chart.canvas as HTMLCanvasElement | null
  return (canvas && window.getComputedStyle(canvas).getPropertyValue(name).trim()) || otherwise
}

export function paintTooltipsAsFloating(ChartJS: Pick<typeof Chart, 'defaults'>): void {
  const tooltip = ChartJS.defaults.plugins.tooltip
  const ink = (context: TooltipContext) => token(context, '--text-primary', '#fff')
  tooltip.backgroundColor = (context) => token(context, '--surface-floating', 'rgba(0, 0, 0, 0.8)')
  tooltip.borderColor = (context) => token(context, '--border-floating', 'rgba(0, 0, 0, 0)')
  tooltip.borderWidth = 1
  tooltip.titleColor = ink
  tooltip.bodyColor = ink
  tooltip.footerColor = ink
}
