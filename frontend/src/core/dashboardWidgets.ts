/**
 * What the dashboard can show, in what order, and which of those are on by default.
 *
 * One list, two readers: the page renders from it and the Views dialog edits it. They used to
 * hold a copy each, and the copies could disagree — a widget added to one but not the other
 * either renders with no way to switch it off, or has a switch that turns nothing off. The
 * migration in `loadWidgetPrefs` is the same story: it lives here so both readers get it.
 */

export const WIDGET_STORAGE_KEY = 'dashboard_widgets'

/** Page order, top to bottom. Some ids render at a fixed spot (see Dashboard.tsx). */
export const DEFAULT_WIDGET_ORDER = [
  'badges',
  'metrics',
  'deck-sankey',
  'deck-heatmap',
  'deck-radar',
  'deck-trends',
  'deck-portfolio',
  'deck-transactions',
  'category-chart',
  'recent-transactions',
  'upcoming-bills',
  'savings-rate',
  'budget-alerts',
  'recurring-insights',
  'income-vs-expenses',
]

/** "Reset Default" turns everything on, which is not the same as the first-run set below. */
export const ALL_WIDGET_IDS = DEFAULT_WIDGET_ORDER

/** First run: enough to be useful without being a wall. */
export const DEFAULT_VISIBLE = [
  'badges',
  'metrics',
  'deck-sankey',
  'deck-heatmap',
  'deck-radar',
  'deck-trends',
  'deck-portfolio',
  'deck-transactions',
  'category-chart',
  'upcoming-bills',
  'budget-alerts',
]

export interface WidgetPrefs {
  visible: string[]
  order: string[]
}

export function loadWidgetPrefs(): WidgetPrefs {
  const saved = localStorage.getItem(WIDGET_STORAGE_KEY)
  if (saved) {
    try {
      const parsed = JSON.parse(saved)
      const visible: string[] =
        parsed.visibleWidgets && Array.isArray(parsed.visibleWidgets)
          ? parsed.visibleWidgets
          : [...DEFAULT_VISIBLE]
      const order: string[] =
        parsed.widgetOrder && Array.isArray(parsed.widgetOrder) && parsed.widgetOrder.length > 0
          ? parsed.widgetOrder
          : [...DEFAULT_WIDGET_ORDER]
      // Widgets added after the user saved their layout: splice them in (a saved
      // order that predates a widget would otherwise hide it forever). An id
      // missing from the saved order is new — user-hidden ids stay in order.
      const newIds = DEFAULT_WIDGET_ORDER.filter((id) => !order.includes(id))
      for (const id of newIds) {
        order.splice(DEFAULT_WIDGET_ORDER.indexOf(id), 0, id)
        if (DEFAULT_VISIBLE.includes(id) && !visible.includes(id)) visible.push(id)
      }
      return { visible, order }
    } catch {
      /* ignore */
    }
  }
  return { visible: [...DEFAULT_VISIBLE], order: [...DEFAULT_WIDGET_ORDER] }
}
