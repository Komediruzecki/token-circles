/**
 * The Dashboard tour's Charts and Summary metrics steps have something to point at.
 *
 * Charts:
 * Its anchor, the net-worth and cash-flow charts, sits below "Show more", which starts closed. On
 * an account that had never opened it, the step found nothing, waited out the engine's 6s and
 * showed the missing-target notice. The tour walk still passed it: it judged the step 1.2s in, by
 * the highlight the Summary metrics step had left on screen.
 *
 * The page now opens Show more when the tour reaches that step, and leaves the person's saved
 * choice alone.
 *
 * Summary metrics: its anchor is the metric cards, which a person can hide in Views. With them
 * hidden the step found nothing and showed the missing-target notice. The page now shows the cards
 * while the tour is on that step, and only then; the saved Views choice is not touched.
 *
 * The account here is empty (every total zero, no history), which is the state the targeting
 * contract says an anchor must render in too.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ALL_WIDGET_IDS, WIDGET_STORAGE_KEY } from '../../core/dashboardWidgets'
import { __resetDataVersionsForTest } from '../../core/dataVersions'
import { setPeriod } from '../../core/periodStore'
import {
  endSpotlight,
  setSpotlightActive,
  setSpotlightStep,
  setTourSteps,
  SPOTLIGHT_TOURS,
} from '../../core/spotlightStore'

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
          upcomingBills: [],
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

const CHARTS = '[data-tour="dashboard-charts"]'
const METRICS = '[data-tour="dashboard-metrics"]'
const dashboardTour = SPOTLIGHT_TOURS.find((t) => t.id === 'dashboard')!
const chartsStep = dashboardTour.steps.findIndex((s) => s.targetSelector === CHARTS)
const metricsStep = dashboardTour.steps.findIndex((s) => s.targetSelector === METRICS)

let host: HTMLDivElement
let dispose: (() => void) | undefined

beforeAll(async () => {
  await import('../Dashboard')
}, 60_000)

beforeEach(() => {
  __resetDataVersionsForTest()
  localStorage.setItem(WIDGET_STORAGE_KEY, JSON.stringify({ visibleWidgets: ALL_WIDGET_IDS }))
  // Never opened: the state every new account starts in.
  localStorage.setItem('dashboard_showMore', '0')
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
  endSpotlight()
  dispose?.()
  dispose = undefined
  host.remove()
  localStorage.removeItem(WIDGET_STORAGE_KEY)
  localStorage.removeItem('dashboard_showMore')
  vi.unstubAllGlobals()
})

describe("the Dashboard tour's Charts step", () => {
  it('is a step of the Dashboard tour', () => {
    expect(chartsStep).toBeGreaterThan(0)
  })

  it('opens Show more so its charts are on the page, without saving that choice', async () => {
    const { default: Dashboard } = await import('../Dashboard')
    dispose = render(() => <Dashboard />, host)
    setTourSteps(dashboardTour.steps)
    setSpotlightStep(0)
    setSpotlightActive(true)

    // The page has loaded, and the steps before Charts leave Show more as the person left it.
    await vi.waitFor(() => {
      expect(host.querySelector('[data-tour="dashboard-metrics"]')).not.toBeNull()
    })
    setSpotlightStep(chartsStep - 1)
    expect(host.querySelector(CHARTS)).toBeNull()

    setSpotlightStep(chartsStep)
    await vi.waitFor(() => {
      expect(host.querySelector(CHARTS)).not.toBeNull()
    })
    expect(host.textContent).toContain('Net Worth Over Time')
    expect(host.querySelector('[data-test-id="dashboard-show-more"]')?.textContent).toContain(
      'Show less'
    )
    expect(localStorage.getItem('dashboard_showMore')).toBe('0')
  })
})

describe("the Dashboard tour's Summary metrics step", () => {
  const hiddenMetrics = JSON.stringify({
    visibleWidgets: ALL_WIDGET_IDS.filter((id) => id !== 'metrics'),
  })

  it('is a step of the Dashboard tour, between the period bar and Charts', () => {
    expect(metricsStep).toBeGreaterThan(0)
    expect(metricsStep).toBeLessThan(chartsStep)
  })

  it('shows metric cards hidden in Views while the tour is on it, and only then', async () => {
    localStorage.setItem(WIDGET_STORAGE_KEY, hiddenMetrics)
    const { default: Dashboard } = await import('../Dashboard')
    dispose = render(() => <Dashboard />, host)
    setTourSteps(dashboardTour.steps)
    setSpotlightStep(metricsStep - 1)
    setSpotlightActive(true)

    // The page has loaded, and the step before keeps the cards hidden, as the person chose.
    await vi.waitFor(() => {
      expect(host.querySelector('[data-test-id="dashboard-show-more"]')).not.toBeNull()
    })
    expect(host.querySelector(METRICS)).toBeNull()

    setSpotlightStep(metricsStep)
    await vi.waitFor(() => {
      expect(host.querySelector(METRICS)).not.toBeNull()
    })
    expect(host.querySelector('[data-test-id="dashboard-metric-networth"]')).not.toBeNull()

    // Past the step, and once the tour is over, the page is back to the person's own choice.
    setSpotlightStep(metricsStep + 1)
    await vi.waitFor(() => {
      expect(host.querySelector(METRICS)).toBeNull()
    })
    setSpotlightStep(metricsStep)
    await vi.waitFor(() => {
      expect(host.querySelector(METRICS)).not.toBeNull()
    })
    endSpotlight()
    await vi.waitFor(() => {
      expect(host.querySelector(METRICS)).toBeNull()
    })
    expect(localStorage.getItem(WIDGET_STORAGE_KEY)).toBe(hiddenMetrics)
  })
})
