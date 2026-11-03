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

/** The card the savings gauge replaced, still in layouts saved before it. */
const OLD_SAVINGS_RATE = 'savings-rate'
const GAUGE = 'savings-gauge'

/** Drawn by the page in the saved order, under Show more; the rest have a spot of their own. */
export const isTailWidget = (id: string): boolean =>
  id !== 'badges' && id !== 'metrics' && id !== GAUGE && !id.startsWith('deck-')

/**
 * The savings gauge sits under the metrics, unless the order puts it after one of the widgets
 * under Show more: then it is drawn there, at its place. A layout saved with the old Savings rate
 * card has the gauge where that card was, which by default was there; so does one rearranged in
 * Views.
 */
export function gaugeInTail(order: readonly string[]): boolean {
  const at = order.indexOf(GAUGE)
  return at > 0 && order.slice(0, at).some(isTailWidget)
}

/**
 * A layout saved with the old Savings rate card hands its place in the order and its switch to the
 * gauge that replaced it, so a card someone had switched off does not come back as the gauge.
 */
function carrySavingsRate(parsed: { visibleWidgets?: unknown; widgetOrder?: unknown }): {
  visible: unknown[] | null
  order: unknown[] | null
} {
  const visible = Array.isArray(parsed.visibleWidgets) ? [...parsed.visibleWidgets] : null
  const order = Array.isArray(parsed.widgetOrder) ? [...parsed.widgetOrder] : null
  const known =
    (order ?? []).includes(OLD_SAVINGS_RATE) || (visible ?? []).includes(OLD_SAVINGS_RATE)
  if (!known || (order ?? []).includes(GAUGE)) return { visible, order }
  if (order) {
    const at = order.indexOf(OLD_SAVINGS_RATE)
    if (at >= 0) order.splice(at, 1, GAUGE)
  }
  // No switches saved: the defaults then, under which the old card was off.
  if (!visible) return { visible: DEFAULT_VISIBLE.filter((id) => id !== GAUGE), order }
  const on = visible.includes(OLD_SAVINGS_RATE)
  const rest = visible.filter((id) => id !== OLD_SAVINGS_RATE && id !== GAUGE)
  return { visible: on ? [...rest, GAUGE] : rest, order }
}

export function loadWidgetPrefs(): WidgetPrefs {
  const saved = localStorage.getItem(WIDGET_STORAGE_KEY)
  if (saved) {
    try {
      const parsed = JSON.parse(saved)
      const carried = carrySavingsRate(parsed ?? {})
      // Ids this build no longer has are dropped: one would otherwise stay in the Views list
      // switching nothing on or off.
      const known = (ids: unknown[]): string[] =>
        ids.filter((id): id is string => typeof id === 'string' && ALL_WIDGET_IDS.includes(id))
      const visible: string[] = carried.visible ? known(carried.visible) : [...DEFAULT_VISIBLE]
      const savedOrder = carried.order ? known(carried.order) : []
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
