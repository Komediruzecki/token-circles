import { beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_VISIBLE,
  DEFAULT_WIDGET_ORDER,
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

  it('drops the ids this build no longer has, and switches the gauge on in an older layout', () => {
    // A layout saved before the gauge: the old savings rate in the tail, and two ids never known.
    const before: unknown[] = DEFAULT_WIDGET_ORDER.filter((id) => id !== 'savings-gauge')
    before.splice(before.indexOf('upcoming-bills') + 1, 0, 'savings-rate', 'no-such-widget', 7)
    save({
      visibleWidgets: ['metrics', 'savings-rate', 'no-such-widget'] as string[],
      widgetOrder: before as string[],
    })
    const prefs = loadWidgetPrefs()
    expect(prefs.order).not.toContain('savings-rate')
    expect(prefs.order).not.toContain('no-such-widget')
    expect(prefs.order).not.toContain(7)
    expect(prefs.order.slice(0, 3)).toEqual(['badges', 'metrics', 'savings-gauge'])
    expect(prefs.visible).toEqual(['metrics', 'savings-gauge'])
  })

  it('starts from the defaults when a saved order holds nothing this build knows', () => {
    save({ visibleWidgets: ['metrics'], widgetOrder: ['savings-rate'] })
    expect(loadWidgetPrefs().order).toEqual(DEFAULT_WIDGET_ORDER)
  })

  it('does not hand out the module arrays for callers to mutate', () => {
    loadWidgetPrefs().order.push('nonsense')
    expect(DEFAULT_WIDGET_ORDER).not.toContain('nonsense')
  })
})
