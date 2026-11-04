/**
 * The circles on the Dashboard: the savings gauge and Your next step.
 *
 * Both are worked out for the active profile, while the cards around them add up every profile
 * selected (review A6). With more than one selected, both name the profile they are about; with
 * one, the whole page is that profile and neither does.
 *
 * The gauge sits under the metrics, unless the saved order puts it among the widgets under Show
 * more, where a layout saved with the old Savings rate card had that card (review A7).
 */
import { render } from 'solid-js/web'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { placeCircle } from '../../../../shared/guidance/circles'
import { ledgerRows, ledgerStatus } from '../../../../shared/guidance/ledger'
import { nextStepOf, nextStepOnceHidden } from '../../../../shared/guidance/nextStep'
import { facts, words } from '../../core/__tests__/guidanceFixtures'
import { bumpProfileVersion, setPage, setProfiles } from '../../core/appStore'
import { ALL_WIDGET_IDS, WIDGET_STORAGE_KEY } from '../../core/dashboardWidgets'
import { setPeriod } from '../../core/periodStore'
import type { GuidanceView } from '../../core/guidance'

vi.mock('../../core/api', async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>()
  const empty = async (url: string) => {
    const path = url.split('?')[0]
    if (path === '/api/analytics/sankey') return { nodes: [], links: [] }
    if (path === '/api/analytics/daily-heatmap') return { dates: {} }
    if (path === '/api/budgets/alerts') return { alerts: [] }
    return []
  }
  const typed: Record<string, () => Promise<unknown>> = {
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
  }
  return {
    ...original,
    apiGet: vi.fn(empty),
    apiHouseholdGet: vi.fn(empty),
    showToast: vi.fn(),
    toast: vi.fn(),
    api: new Proxy(typed, { get: (target, name: string) => target[name] ?? (async () => []) }),
  }
})

/** The circles for profile 2, as the store would answer them. */
const VIEW: GuidanceView = (() => {
  const f = facts()
  const placement = placeCircle(f, { freeMoney: false })
  return {
    profileId: 2,
    snapshot: {} as never,
    inputs: { profileId: 2, answers: {}, withdrawalRatePct: 4, currency: 'EUR', holdings: 0 },
    gate: false,
    region: { region: 'EU27', reason: 'fallback', via: null },
    facts: f,
    placement,
    rows: ledgerRows(placement, f, words),
    status: ledgerStatus(placement, f, words),
    next: nextStepOf({ placement, facts: f, orientation: [], words }),
    nextOnceHidden: nextStepOnceHidden({ placement, facts: f, orientation: [], words }),
    words,
  }
})()

vi.mock('../../core/guidance', () => ({ useGuidance: () => () => VIEW, takeAnswers: vi.fn() }))
// Getting started hidden, so its place holds Your next step.
vi.mock('../../core/gettingStarted', () => ({
  gettingStartedRecord: () => ({ hidden: true }),
  gettingStartedKnown: () => true,
  loadGettingStarted: vi.fn(async () => null),
}))

let host: HTMLDivElement
let dispose: (() => void) | undefined
const flush = () => new Promise((r) => setTimeout(r, 0))
const settle = async () => {
  await flush()
  await flush()
  await flush()
}

// Loading the page module (charts, d3) is the slow part of a mount: once, up front.
beforeAll(async () => {
  await import('../Dashboard')
}, 60_000)

beforeEach(() => {
  localStorage.setItem(WIDGET_STORAGE_KEY, JSON.stringify({ visibleWidgets: ALL_WIDGET_IDS }))
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
  setPeriod({ mode: 'month', year: 2026, month: 9, preset: 'all' })
  setProfiles([
    { id: 2, name: 'Holiday house' },
    { id: 3, name: 'Side business' },
  ] as never)
  localStorage.setItem('currentProfileId', '2')
  host = document.createElement('div')
  document.body.appendChild(host)
})

afterEach(() => {
  dispose?.()
  dispose = undefined
  host?.remove()
  localStorage.removeItem(WIDGET_STORAGE_KEY)
  localStorage.removeItem('dashboard_showMore')
  localStorage.removeItem('currentProfileId')
  localStorage.removeItem('selectedProfileIds')
  setProfiles([])
  vi.unstubAllGlobals()
})

async function mountDashboard() {
  setPage('dashboard')
  const { default: Dashboard } = await import('../Dashboard')
  dispose = render(() => <Dashboard />, host)
  await settle()
}

const named = () => ({
  gauge: host.querySelector('[data-test-id="savings-gauge-profile"]')?.textContent ?? null,
  step: host.querySelector('[data-test-id="next-step-profile"]')?.textContent ?? null,
})

describe('the profile the circles are about, on a Dashboard that adds up a household', () => {
  it('is named on the savings gauge and on Your next step', async () => {
    localStorage.setItem('selectedProfileIds', JSON.stringify([2, 3]))
    await mountDashboard()
    expect(host.querySelector('[data-test-id="savings-gauge"]')).not.toBeNull()
    expect(host.querySelector('[data-test-id="next-step-card"]')).not.toBeNull()
    expect(named()).toEqual({
      gauge: 'For Holiday house only',
      step: 'For Holiday house only',
    })
  })

  it('is not named while the Dashboard shows that profile alone, and follows the selection', async () => {
    localStorage.setItem('selectedProfileIds', JSON.stringify([2]))
    await mountDashboard()
    expect(host.querySelector('[data-test-id="savings-gauge"]')).not.toBeNull()
    expect(named()).toEqual({ gauge: null, step: null })

    // Settings > Household or the sidebar adds a profile: the stored selection, and the bump.
    localStorage.setItem('selectedProfileIds', JSON.stringify([2, 3]))
    bumpProfileVersion()
    await settle()
    expect(named()).toEqual({
      gauge: 'For Holiday house only',
      step: 'For Holiday house only',
    })
  })
})

describe('where the savings gauge sits', () => {
  /** Whether the gauge comes after the Show more button, in the widgets under it. */
  const gaugeUnderShowMore = () => {
    const gauge = host.querySelector('[data-test-id="savings-gauge"]')!
    const toggle = host.querySelector('[data-test-id="dashboard-show-more"]')!
    return Boolean(toggle.compareDocumentPosition(gauge) & Node.DOCUMENT_POSITION_FOLLOWING)
  }

  it('is under the metrics by default', async () => {
    localStorage.setItem('dashboard_showMore', '1')
    await mountDashboard()
    expect(host.querySelectorAll('[data-test-id="savings-gauge"]')).toHaveLength(1)
    expect(gaugeUnderShowMore()).toBe(false)
  })

  it('keeps the place the Savings rate card had in a layout saved with it', async () => {
    const order = ALL_WIDGET_IDS.filter((id) => id !== 'savings-gauge')
    order.splice(order.indexOf('upcoming-bills') + 1, 0, 'savings-rate')
    localStorage.setItem(
      WIDGET_STORAGE_KEY,
      JSON.stringify({
        visibleWidgets: ['metrics', 'upcoming-bills', 'savings-rate'],
        widgetOrder: order,
      })
    )
    localStorage.setItem('dashboard_showMore', '1')
    await mountDashboard()
    expect(host.querySelectorAll('[data-test-id="savings-gauge"]')).toHaveLength(1)
    expect(gaugeUnderShowMore()).toBe(true)
  })

  it('stays off in a layout that had the Savings rate card off', async () => {
    const order = ALL_WIDGET_IDS.filter((id) => id !== 'savings-gauge')
    order.splice(order.indexOf('upcoming-bills') + 1, 0, 'savings-rate')
    localStorage.setItem(
      WIDGET_STORAGE_KEY,
      JSON.stringify({ visibleWidgets: ['metrics', 'upcoming-bills'], widgetOrder: order })
    )
    localStorage.setItem('dashboard_showMore', '1')
    await mountDashboard()
    expect(host.querySelector('[data-test-id="savings-gauge"]')).toBeNull()
  })
})
