import { beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_VISIBLE,
  DEFAULT_WIDGET_ORDER,
  gaugeInTail,
  loadWidgetPrefs,
  WIDGET_STORAGE_KEY,
} from '../dashboardWidgets'

const save = (prefs: { visibleWidgets?: string[]; widgetOrder?: string[] }): void => {
  localStorage.setItem(WIDGET_STORAGE_KEY, JSON.stringify(prefs))
}

beforeEach(() => {
  localStorage.removeItem(WIDGET_STORAGE_KEY)
})

describe('loadWidgetPrefs', () => {
  it('starts everyone on the defaults', () => {
    expect(loadWidgetPrefs()).toEqual({ visible: DEFAULT_VISIBLE, order: DEFAULT_WIDGET_ORDER })
  })

  it('keeps a saved layout as it was', () => {
    save({ visibleWidgets: ['metrics'], widgetOrder: [...DEFAULT_WIDGET_ORDER].reverse() })
    const prefs = loadWidgetPrefs()
    expect(prefs.visible).toEqual(['metrics'])
    expect(prefs.order[0]).toBe('income-vs-expenses')
  })

  it('splices a new widget into a layout saved before it existed', () => {
    const before = DEFAULT_WIDGET_ORDER.filter((id) => id !== 'badges')
    save({ visibleWidgets: ['metrics', 'category-chart'], widgetOrder: before })
    const prefs = loadWidgetPrefs()
    expect(prefs.order).toContain('badges')
    expect(prefs.order.indexOf('badges')).toBe(DEFAULT_WIDGET_ORDER.indexOf('badges'))
    // On by default, so an existing user meets it switched on rather than missing.
    expect(prefs.visible).toContain('badges')
  })

  it('leaves a widget the user switched off switched off', () => {
    save({
      visibleWidgets: DEFAULT_VISIBLE.filter((id) => id !== 'badges'),
      widgetOrder: DEFAULT_WIDGET_ORDER,
    })
    expect(loadWidgetPrefs().visible).not.toContain('badges')
  })

  it('falls back on junk rather than throwing', () => {
    localStorage.setItem(WIDGET_STORAGE_KEY, '{not json')
    expect(loadWidgetPrefs().order).toEqual(DEFAULT_WIDGET_ORDER)
  })

  it('puts the savings gauge under the metrics, on by default, in place of the savings rate', () => {
    expect(DEFAULT_WIDGET_ORDER.indexOf('savings-gauge')).toBe(
      DEFAULT_WIDGET_ORDER.indexOf('metrics') + 1
    )
    expect(DEFAULT_VISIBLE).toContain('savings-gauge')
    expect(DEFAULT_WIDGET_ORDER).not.toContain('savings-rate')
  })

  it('drops the ids this build no longer has', () => {
    const before: unknown[] = [...DEFAULT_WIDGET_ORDER]
    before.splice(before.indexOf('upcoming-bills') + 1, 0, 'no-such-widget', 7)
    save({
      visibleWidgets: ['metrics', 'savings-gauge', 'no-such-widget'] as string[],
      widgetOrder: before as string[],
    })
    const prefs = loadWidgetPrefs()
    expect(prefs.order).toEqual(DEFAULT_WIDGET_ORDER)
    expect(prefs.visible).toEqual(['metrics', 'savings-gauge'])
  })

  // The gauge replaced the Savings rate card (review A7). A layout saved with that card keeps what
  // the person had: the gauge takes its place in the order, and its switch.
  /** A layout saved before the gauge: the old card where it sat by default, in the tail. */
  const OLD_ORDER = [
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

  it('keeps the gauge switched off where the Savings rate card was', () => {
    save({ visibleWidgets: ['metrics', 'upcoming-bills'], widgetOrder: OLD_ORDER })
    const prefs = loadWidgetPrefs()
    expect(prefs.visible).toEqual(['metrics', 'upcoming-bills'])
    expect(prefs.order).toEqual(
      OLD_ORDER.map((id) => (id === 'savings-rate' ? 'savings-gauge' : id))
    )
  })

  it('keeps the gauge switched on, at the place the Savings rate card had', () => {
    const moved = OLD_ORDER.filter((id) => id !== 'savings-rate')
    moved.splice(moved.indexOf('category-chart'), 0, 'savings-rate')
    save({ visibleWidgets: ['metrics', 'savings-rate'], widgetOrder: moved })
    const prefs = loadWidgetPrefs()
    expect(prefs.visible).toEqual(['metrics', 'savings-gauge'])
    expect(prefs.order.indexOf('savings-gauge')).toBe(moved.indexOf('savings-rate'))
    expect(prefs.order).not.toContain('savings-rate')
    expect(prefs.order).toHaveLength(DEFAULT_WIDGET_ORDER.length)
  })

  it('switches the gauge on for a layout that had the Savings rate card on but no order', () => {
    save({ visibleWidgets: ['metrics', 'savings-rate'] })
    const prefs = loadWidgetPrefs()
    expect(prefs.visible).toEqual(['metrics', 'savings-gauge'])
    expect(prefs.order).toEqual(DEFAULT_WIDGET_ORDER)
  })

  it('keeps the gauge off in a layout with the old order and no switches, as the card was', () => {
    save({ widgetOrder: OLD_ORDER })
    const prefs = loadWidgetPrefs()
    expect(prefs.visible).toEqual(DEFAULT_VISIBLE.filter((id) => id !== 'savings-gauge'))
    expect(prefs.order.indexOf('savings-gauge')).toBe(OLD_ORDER.indexOf('savings-rate'))
  })

  it('splices the gauge in, on, for a layout saved before the Savings rate card existed', () => {
    const older = OLD_ORDER.filter((id) => id !== 'savings-rate')
    save({ visibleWidgets: ['metrics'], widgetOrder: older })
    const prefs = loadWidgetPrefs()
    expect(prefs.order.slice(0, 3)).toEqual(['badges', 'metrics', 'savings-gauge'])
    expect(prefs.visible).toEqual(['metrics', 'savings-gauge'])
  })

  it('starts from the defaults when a saved order holds nothing this build knows', () => {
    save({ visibleWidgets: ['metrics'], widgetOrder: ['savings-rate'] })
    expect(loadWidgetPrefs().order).toEqual(DEFAULT_WIDGET_ORDER)
  })

  it('keeps the gauge under the metrics until the order puts it among the tail widgets', () => {
    expect(gaugeInTail(DEFAULT_WIDGET_ORDER)).toBe(false)
    // Among the deck's panels, which are drawn at their own spot, it stays at its own spot.
    const amongDeck = DEFAULT_WIDGET_ORDER.filter((id) => id !== 'savings-gauge')
    amongDeck.splice(amongDeck.indexOf('deck-radar'), 0, 'savings-gauge')
    expect(gaugeInTail(amongDeck)).toBe(false)
    const tail = DEFAULT_WIDGET_ORDER.filter((id) => id !== 'savings-gauge')
    tail.splice(tail.indexOf('upcoming-bills') + 1, 0, 'savings-gauge')
    expect(gaugeInTail(tail)).toBe(true)
    expect(gaugeInTail(['category-chart', 'savings-gauge'])).toBe(true)
    expect(gaugeInTail(['category-chart'])).toBe(false)
  })

  it('does not hand out the module arrays for callers to mutate', () => {
    loadWidgetPrefs().order.push('nonsense')
    expect(DEFAULT_WIDGET_ORDER).not.toContain('nonsense')
  })
})
