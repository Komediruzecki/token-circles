/**
 * The Dashboard's Upcoming Bills card says when each bill falls due next.
 *
 * It said "Due {date} • Due in {daysUntil(date)}", and daysUntil already said "Due in", so a bill
 * read "Due in Due in 12 days". The date was due_date, the first one the bill was saved with, which
 * never moves: in October a bill first due in August read "Due Aug 20, 2026 • Due in 49 days
 * overdue". Both runtimes answer next_due_date (shared/billSchedule.ts); the card says that one.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ALL_WIDGET_IDS, WIDGET_STORAGE_KEY } from '../../core/dashboardWidgets'
import { __resetDataVersionsForTest } from '../../core/dataVersions'
import { setPeriod } from '../../core/periodStore'

const upcomingBills = [
  {
    id: 1,
    name: 'Power',
    amount: 60,
    due_date: '2026-08-20',
    next_due_date: '2026-10-20',
    days_until: 12,
    frequency: 'monthly',
  },
  {
    id: 2,
    name: 'Rent',
    amount: 900,
    due_date: '2026-09-08',
    next_due_date: '2026-10-08',
    days_until: 0,
    frequency: 'monthly',
  },
]

vi.mock('../../core/api', async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>()
  const empty = async () => []
  return {
    ...original,
    apiGet: vi.fn(async (url: string) => {
      const path = url.split('?')[0]
      if (path === '/api/analytics/sankey') return { nodes: [], links: [] }
      if (path === '/api/analytics/daily-heatmap') return { dates: {} }
      if (path === '/api/budgets/alerts') return { alerts: [] }
      return []
    }),
    apiHouseholdGet: vi.fn(empty),
    showToast: vi.fn(),
    toast: vi.fn(),
    api: new Proxy(
      {
        getDashboard: async () => ({
          totalIncome: 0,
          totalExpenses: 0,
          balance: 0,
          incomeByCategory: [],
          expenseByCategory: [],
          recentTransactions: [],
          upcomingBills,
        }),
        getDashboardCharts: async () => ({
          byCategory: [],
          monthly: [],
          cashFlow: [],
          currency: 'EUR',
        }),
        getNetWorth: async () => ({ totalNetWorth: 0, timeline: [] }),
      } as Record<string, unknown>,
      { get: (target, name: string) => target[name] ?? empty }
    ),
  }
})

let host: HTMLDivElement
let dispose: (() => void) | undefined

beforeAll(async () => {
  await import('../Dashboard')
}, 60_000)

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 8, 12))
  __resetDataVersionsForTest()
  localStorage.setItem(WIDGET_STORAGE_KEY, JSON.stringify({ visibleWidgets: ALL_WIDGET_IDS }))
  localStorage.setItem('dashboard_showMore', '1')
  Element.prototype.scrollIntoView = () => {}
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  }))
  setPeriod({ mode: 'month', year: 2026, month: 9 })
  host = document.createElement('div')
  document.body.appendChild(host)
})

afterEach(() => {
  dispose?.()
  dispose = undefined
  host.remove()
  localStorage.removeItem(WIDGET_STORAGE_KEY)
  localStorage.removeItem('dashboard_showMore')
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe("the Dashboard's Upcoming Bills", () => {
  it('says when each bill falls due next, once', async () => {
    const { default: Dashboard } = await import('../Dashboard')
    dispose = render(() => <Dashboard />, host)

    await vi.waitFor(() => {
      expect(host.textContent).toContain('Upcoming Bills')
      expect(host.textContent).toContain('Oct 20, 2026 • Due in 12 days')
    })
    expect(host.textContent).toContain('Oct 8, 2026 • Due today')
    expect(host.textContent).not.toContain('Due in Due in')
    expect(host.textContent).not.toContain('Aug 20')
  })
})
