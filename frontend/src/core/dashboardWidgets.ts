/**
 * What the dashboard can show, in what order, and which of those are on by default.
 *
 * One list, two readers: the page renders from it and the Views dialog edits it. They used to
 * hold a copy each, and the copies could disagree — a widget added to one but not the other
 * either renders with no way to switch it off, or has a switch that turns nothing off. The
 * migration in `loadWidgetPrefs` is the same story: it lives here so both readers get it.
 */

export const WIDGET_STORAGE_KEY = 'dashboard_widgets'

/** Page order, top to bottom. Some ids render at a fixed spot: see FIXED_SPOT_WIDGETS. */
export const DEFAULT_WIDGET_ORDER = [
  'badges',
  'metrics',
  'savings-gauge',
  'deck-sankey',
  'deck-heatmap',
  'deck-radar',
  'deck-trends',
  'deck-portfolio',
  'deck-transactions',
  'category-chart',
  'recent-transactions',
  'upcoming-bills',
  'budget-alerts',
  'recurring-insights',
  'income-vs-expenses',
]

/**
 * Widgets the page places at their own spot whatever the saved order says: the badge rail, the
 * metrics, the savings gauge and the overview deck's panels. Only the rest, under Show more,
 * follow the order. Dashboard.tsx leaves these out of its ordered tail, and the Views dialog
 * gives them no drag handle, since dragging one would save an order that changes nothing.
 */
export const FIXED_SPOT_WIDGETS: readonly string[] = [
  'badges',
  'metrics',
  'savings-gauge',
  'deck-sankey',
  'deck-heatmap',
  'deck-radar',
  'deck-trends',
  'deck-portfolio',
  'deck-transactions',
]

export const hasFixedSpot = (id: string): boolean => FIXED_SPOT_WIDGETS.includes(id)

/** "Reset Default" turns everything on, which is not the same as the first-run set below. */
export const ALL_WIDGET_IDS = DEFAULT_WIDGET_ORDER

/** First run: enough to be useful without being a wall. */
export const DEFAULT_VISIBLE = [
  'badges',
  'metrics',
  'savings-gauge',
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
      // Ids this build no longer has are dropped: `savings-rate`, which the savings gauge
      // replaced, would otherwise stay in the Views list switching nothing on or off.
      const known = (ids: unknown[]): string[] =>
        ids.filter((id): id is string => typeof id === 'string' && ALL_WIDGET_IDS.includes(id))
      const visible: string[] =
        parsed.visibleWidgets && Array.isArray(parsed.visibleWidgets)
          ? known(parsed.visibleWidgets)
          : [...DEFAULT_VISIBLE]
      const savedOrder =
        parsed.widgetOrder && Array.isArray(parsed.widgetOrder) ? known(parsed.widgetOrder) : []
      const order: string[] = savedOrder.length > 0 ? savedOrder : [...DEFAULT_WIDGET_ORDER]
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
