/**
 * Dashboard Views: the drag handles say what a drag can change.
 *
 * The page places the badge rail, the metrics, the savings gauge and the overview deck's panels
 * at their own spot, whatever the saved order says (Dashboard.tsx). Only the widgets under Show
 * more follow the order. The list gave every row a handle, so dragging Metrics Cards below
 * Budget Alerts was accepted, saved, and changed nothing on the page.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_WIDGET_ORDER, hasFixedSpot, WIDGET_STORAGE_KEY } from '../../core/dashboardWidgets'
import { DashboardSettings } from '../DashboardSettings'

const SRC = join(import.meta.dirname, '..', '..')

/** Placed by the page itself, top to bottom. */
const FIXED = [
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
/** Rendered under Show more, in the saved order. */
const UNDER_SHOW_MORE = [
  'category-chart',
  'recent-transactions',
  'upcoming-bills',
  'budget-alerts',
  'recurring-insights',
  'income-vs-expenses',
]

let dispose: (() => void) | undefined
let host: HTMLDivElement

function mount(): void {
  host = document.createElement('div')
  document.body.appendChild(host)
  dispose = render(() => <DashboardSettings />, host)
}

const row = (id: string): HTMLElement => {
  const el = host.querySelector<HTMLElement>(`[data-test-id="dashboard-views-row-${id}"]`)
  if (!el) throw new Error(`no Views row for ${id}`)
  return el
}

const rowIds = (): string[] =>
  Array.from(host.querySelectorAll<HTMLElement>('[data-test-id^="dashboard-views-row-"]')).map(
    (el) => el.dataset.testId!.replace('dashboard-views-row-', '')
  )

/** One drag event as a browser sends it, with the data a drag carries from start to drop. */
function dragEvent(type: string, el: Element, data: Map<string, string>): Event {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'dataTransfer', {
    value: {
      effectAllowed: '',
      dropEffect: '',
      setData: (key: string, value: string) => data.set(key, value),
      getData: (key: string) => data.get(key) ?? '',
    },
  })
  el.dispatchEvent(event)
  return event
}

/** Drags one row onto another and saves, as a person would, and returns the saved order. */
function dragOntoAndSave(from: string, onto: string): string[] {
  const data = new Map<string, string>()
  dragEvent('dragstart', row(from), data)
  dragEvent('dragover', row(onto), data)
  dragEvent('drop', row(onto), data)
  dragEvent('dragend', row(from), data)
  const save = Array.from(host.querySelectorAll('button')).find(
    (b) => b.textContent?.trim() === 'Save & Close'
  )
  save!.click()
  return JSON.parse(localStorage.getItem(WIDGET_STORAGE_KEY)!).widgetOrder
}

beforeEach(() => {
  localStorage.removeItem(WIDGET_STORAGE_KEY)
})

afterEach(() => {
  dispose?.()
  host.remove()
  localStorage.removeItem(WIDGET_STORAGE_KEY)
})

describe('Dashboard Views', () => {
  it('gives a drag handle only to the widgets Show more puts in your order', () => {
    mount()
    for (const id of FIXED) {
      expect(row(id).querySelector('[title="Drag to reorder"]'), id).toBeNull()
      expect(row(id).getAttribute('draggable'), id).not.toBe('true')
    }
    for (const id of UNDER_SHOW_MORE) {
      expect(row(id).querySelector('[title="Drag to reorder"]'), id).not.toBeNull()
      expect(row(id).getAttribute('draggable'), id).toBe('true')
    }
  })

  it('says which rows move, and that the others have a fixed spot', () => {
    mount()
    expect(host.textContent).toContain(
      'Drag a handle or use the arrows to reorder the widgets under Show more. The others have a fixed spot.'
    )
  })

  it('lists the widgets with a fixed spot first, in page order, whatever order was saved', () => {
    // A layout saved before this fix, with a Show more widget dragged to the very top.
    const mixed = [
      'category-chart',
      ...DEFAULT_WIDGET_ORDER.filter((id) => id !== 'category-chart'),
    ]
    localStorage.setItem(
      WIDGET_STORAGE_KEY,
      JSON.stringify({ visibleWidgets: DEFAULT_WIDGET_ORDER, widgetOrder: mixed })
    )
    mount()
    expect(rowIds()).toEqual([...FIXED, ...UNDER_SHOW_MORE])
  })

  it('takes no drop on a widget with a fixed spot, and saves the order unchanged', () => {
    mount()
    const data = new Map<string, string>()
    dragEvent('dragstart', row('recent-transactions'), data)
    // A cancelled dragover is how a row says "drop here"; a fixed row must not say it.
    expect(dragEvent('dragover', row('metrics'), data).defaultPrevented).toBe(false)
    expect(dragEvent('dragover', row('budget-alerts'), data).defaultPrevented).toBe(true)
    dragEvent('dragend', row('recent-transactions'), data)

    expect(dragOntoAndSave('recent-transactions', 'metrics')).toEqual(DEFAULT_WIDGET_ORDER)
  })

  it('moves a widget among the ones under Show more', () => {
    mount()
    const saved = dragOntoAndSave('income-vs-expenses', 'category-chart')
    // Dropped on Spending by Category, Income vs Expenses takes its place, ahead of it.
    const moved = UNDER_SHOW_MORE.filter((id) => id !== 'income-vs-expenses')
    moved.splice(moved.indexOf('category-chart'), 0, 'income-vs-expenses')
    expect(saved.filter((id) => !hasFixedSpot(id))).toEqual(moved)
    expect(rowIds()).toEqual([...FIXED, ...moved])
  })
})

describe('which widgets have a fixed spot', () => {
  it('is the list the page and the Views dialog both read', () => {
    expect(DEFAULT_WIDGET_ORDER.filter(hasFixedSpot)).toEqual(FIXED)
    const dashboard = readFileSync(join(SRC, 'features/Dashboard.tsx'), 'utf8')
    // The ordered tail under Show more leaves out exactly these.
    expect(dashboard).toMatch(/isWidgetVisible\(widgetId\) && !hasFixedSpot\(widgetId\)/)
  })

  it('leaves for the saved order exactly the widgets the ordered tail can render', () => {
    const dashboard = readFileSync(join(SRC, 'features/Dashboard.tsx'), 'utf8')
    const rendered = [...dashboard.matchAll(/case '([a-z-]+)':/g)].map((m) => m[1]).sort()
    expect(rendered).toEqual(DEFAULT_WIDGET_ORDER.filter((id) => !hasFixedSpot(id)).sort())
  })
})
