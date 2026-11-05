/**
 * Dashboard Views: the widgets under Show more move with buttons as well as by drag.
 *
 * A drag was the only way to reorder them, so nobody could reorder them from the keyboard. Each of
 * those rows now has a Move up and a Move down button named for its widget. The widgets with a
 * fixed spot have neither.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_WIDGET_ORDER, hasFixedSpot, WIDGET_STORAGE_KEY } from '../../core/dashboardWidgets'
import { DashboardSettings } from '../DashboardSettings'

/** Under Show more, in the default order, with the names the rows show. */
const UNDER_SHOW_MORE: [string, string][] = [
  ['category-chart', 'Spending by Category'],
  ['recent-transactions', 'Recent Transactions'],
  ['upcoming-bills', 'Upcoming Bills'],
  ['budget-alerts', 'Budget Alerts'],
  ['recurring-insights', 'Recurring Insights'],
  ['income-vs-expenses', 'Income vs Expenses'],
]

let dispose: (() => void) | undefined
let host: HTMLDivElement

function mount(): void {
  host = document.createElement('div')
  document.body.appendChild(host)
  dispose = render(() => <DashboardSettings />, host)
}

const moveButton = (label: string): HTMLButtonElement | null =>
  host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)

const press = (label: string): void => {
  const button = moveButton(label)
  if (!button) throw new Error(`no button "${label}"`)
  // A keyboard user's Enter or Space on a focused button arrives as its click.
  button.focus()
  button.click()
}

/** The ids of the rows under Show more, as the dialog lists them. */
const movableRows = (): string[] =>
  Array.from(host.querySelectorAll<HTMLElement>('[data-test-id^="dashboard-views-row-"]'))
    .map((el) => el.dataset.testId!.replace('dashboard-views-row-', ''))
    .filter((id) => !hasFixedSpot(id))

function saveAndRead(): string[] {
  const save = Array.from(host.querySelectorAll('button')).find(
    (b) => b.textContent?.trim() === 'Save & Close'
  )
  save!.click()
  const order: string[] = JSON.parse(localStorage.getItem(WIDGET_STORAGE_KEY)!).widgetOrder
  return order
}

beforeEach(() => {
  localStorage.removeItem(WIDGET_STORAGE_KEY)
})

afterEach(() => {
  dispose?.()
  host.remove()
  localStorage.removeItem(WIDGET_STORAGE_KEY)
})

describe('Dashboard Views move buttons', () => {
  it('gives each widget under Show more a Move up and a Move down named for it, and no other row', () => {
    mount()
    const named = Array.from(host.querySelectorAll('button[aria-label^="Move "]')).map((b) =>
      b.getAttribute('aria-label')
    )
    expect(named).toEqual(
      UNDER_SHOW_MORE.flatMap(([, name]) => [`Move ${name} up`, `Move ${name} down`])
    )
  })

  it('turns off the move that would leave the list: up on the first, down on the last', () => {
    mount()
    for (const [i, [, name]] of UNDER_SHOW_MORE.entries()) {
      expect(moveButton(`Move ${name} up`)!.disabled, name).toBe(i === 0)
      expect(moveButton(`Move ${name} down`)!.disabled, name).toBe(i === UNDER_SHOW_MORE.length - 1)
    }
  })

  it('moves a widget one place at a time, and Save keeps that order', () => {
    mount()
    press('Move Budget Alerts up')
    expect(movableRows()).toEqual([
      'category-chart',
      'recent-transactions',
      'budget-alerts',
      'upcoming-bills',
      'recurring-insights',
      'income-vs-expenses',
    ])
    press('Move Spending by Category down')
    const expected = [
      'recent-transactions',
      'category-chart',
      'budget-alerts',
      'upcoming-bills',
      'recurring-insights',
      'income-vs-expenses',
    ]
    expect(movableRows()).toEqual(expected)
    const saved = saveAndRead()
    expect(saved.filter((id) => !hasFixedSpot(id))).toEqual(expected)
    // The widgets with a fixed spot keep theirs in the saved order.
    expect(saved.filter(hasFixedSpot)).toEqual(DEFAULT_WIDGET_ORDER.filter(hasFixedSpot))
  })

  it('keeps focus on the button pressed, and on the other one once the row reaches the end', () => {
    mount()
    press('Move Upcoming Bills up')
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Move Upcoming Bills up')
    press('Move Upcoming Bills up')
    // First now: its Move up is off, so focus stays in the row on Move down.
    expect(movableRows()[0]).toBe('upcoming-bills')
    expect(moveButton('Move Upcoming Bills up')!.disabled).toBe(true)
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Move Upcoming Bills down')
  })
})
