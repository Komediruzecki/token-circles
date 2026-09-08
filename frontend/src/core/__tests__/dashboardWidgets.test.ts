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

  it('does not hand out the module arrays for callers to mutate', () => {
    loadWidgetPrefs().order.push('nonsense')
    expect(DEFAULT_WIDGET_ORDER).not.toContain('nonsense')
  })
})
