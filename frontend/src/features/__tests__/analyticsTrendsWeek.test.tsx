/**
 * The stacked trends' week belongs to its month of its year.
 *
 * The month select cleared the week and loaded the new month's weeks; the year select did
 * neither, so week 6 of March 2025 stayed picked in March 2026, which has five weeks, under the
 * week list of 2025.
 *
 * Compare sends the main view's week with its own month. A month that lacks the week answers no
 * days, and the chart draws the main month alone.
 *
 * This runs the real page against the real local-first router on fake-indexeddb.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { setPage } from '../../core/appStore'
import { __resetDataVersionsForTest } from '../../core/dataVersions'
import { setPeriod } from '../../core/periodStore'
import { getDB } from '../../core/storage/idb'

interface Drawn {
  labels: unknown[]
  datasets: Array<{ label?: string; data: unknown[] }>
}

// What each chart on the page was last given to draw, in the order the charts were made.
const charts = vi.hoisted(() => ({ drawn: [] as Array<() => Drawn> }))

vi.mock('../../components/Chart', () => ({
  default: (props: { data: { labels?: unknown[]; datasets: Drawn['datasets'] } }) => {
    charts.drawn.push(() => ({
      labels: [...(props.data.labels ?? [])],
      datasets: props.data.datasets.map((d) => ({ label: d.label, data: [...d.data] })),
    }))
    return null
  },
}))

const SUNDAY_TO_SATURDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

let host: HTMLDivElement
let dispose: (() => void) | undefined

const flush = () => new Promise((r) => setTimeout(r, 0))
const settle = async () => {
  for (let i = 0; i < 6; i++) await flush()
}

beforeAll(async () => {
  // Heavy imports, paid once here rather than inside the test's own waits.
  await Promise.all([import('../Analytics'), import('../../core/storage/localApiRouter')])
}, 120_000)

beforeEach(async () => {
  localStorage.clear()
  localStorage.setItem('finance_storage_mode', 'serverless')
  localStorage.setItem('currentProfileId', '1')
  __resetDataVersionsForTest()
  charts.drawn.length = 0
  const db = await getDB()
  for (const store of Array.from(db.objectStoreNames)) await db.clear(store)
  await db.add('profiles', { id: 1, name: 'Me', created_at: '2026-01-01T00:00:00.000Z' })
  await db.add('categories', {
    id: 1,
    profile_id: 1,
    name: 'Food',
    type: 'expense',
    color: '#2e7d32',
    icon: 'tag',
    parent_id: null,
  } as never)
  const spend = (id: number, amount: number, date: string) =>
    db.add('transactions', {
      id,
      profile_id: 1,
      description: `Food ${date}`,
      amount,
      amount_local: amount,
      type: 'expense',
      currency: 'EUR',
      exchange_rate: 1,
      category_id: 1,
      account_id: null,
      notes: '',
      date,
      created_at: '2026-01-01T09:00:00.000Z',
    } as never)
  await spend(1, 45.5, '2025-03-10')
  // Monday 31 March 2025, in week 6 of March (30 March to 5 April).
  await spend(2, 9.5, '2025-03-31')
  await spend(3, 7, '2025-02-03')
  // Monday 2 March 2026, in week 1 of March 2026 (1 to 7 March).
  await spend(4, 20, '2026-03-02')

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
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
  // The trends start in 2025: the page's year follows the focus period.
  setPeriod({ mode: 'month', year: 2025, month: 3, preset: 'all' })
  host = document.createElement('div')
  document.body.appendChild(host)
})

afterEach(() => {
  dispose?.()
  dispose = undefined
  host.remove()
  vi.unstubAllGlobals()
})

const selects = () => [...host.querySelectorAll('select')]
const selectWith = (option: string) =>
  selects().find((s) => [...s.options].some((o) => o.textContent === option))
const yearSelect = () =>
  host.querySelector<HTMLSelectElement>('[data-test-id="analytics-trends-year"]')!
const weekSelect = () => selectWith('All Weeks')

async function choose(select: HTMLSelectElement | undefined, value: string) {
  expect(select, `no select to choose ${value} in`).toBeDefined()
  select!.value = value
  select!.dispatchEvent(new Event('change'))
  await settle()
}

/** The stacked trends as it was last drawn: the chart whose datasets are the trends'. */
function trends(): Drawn | undefined {
  return charts.drawn
    .map((drawn) => drawn())
    .find((d) => d.datasets.some((ds) => ds.label?.startsWith('Food')))
}

/** Month view, March 2025, week 6: 30 March to 5 April. */
async function openWeek6OfMarch2025() {
  setPage('analytics')
  const { default: Analytics } = await import('../Analytics')
  dispose = render(() => <Analytics />, host)
  await vi.waitFor(
    () => {
      expect(yearSelect().value).toBe('2025')
    },
    { timeout: 10_000 }
  )
  await choose(selectWith('Month View'), 'month')
  await choose(yearSelect().nextElementSibling as HTMLSelectElement, '3')
  await vi.waitFor(() => {
    expect(weekSelect()?.options).toHaveLength(7)
  })
  await choose(weekSelect(), '6')
  await vi.waitFor(() => {
    expect(trends()?.labels).toEqual(SUNDAY_TO_SATURDAY)
  })
}

describe('the stacked trends week', () => {
  it("is cleared by a new year, and the week list is that year's month", async () => {
    await openWeek6OfMarch2025()
    expect(trends()?.datasets).toEqual([{ label: 'Food', data: [0, 9.5, 0, 0, 0, 0, 0] }])

    await choose(yearSelect(), '2026')

    await vi.waitFor(() => {
      expect([...weekSelect()!.options].map((o) => o.textContent)).toEqual([
        'All Weeks',
        'Week 1 (2026-03-01 - 2026-03-07)',
        'Week 2 (2026-03-08 - 2026-03-14)',
        'Week 3 (2026-03-15 - 2026-03-21)',
        'Week 4 (2026-03-22 - 2026-03-28)',
        'Week 5 (2026-03-29 - 2026-04-04)',
      ])
    })
    expect(weekSelect()!.selectedOptions[0]?.textContent).toBe('All Weeks')
    // The whole of March 2026, with its one day of spending.
    await vi.waitFor(() => {
      expect(trends()?.labels).toHaveLength(31)
    })
    expect(trends()?.labels[0]).toBe('March 1')
    expect(trends()?.datasets).toEqual([
      { label: 'Food', data: Array.from({ length: 31 }, (_, i) => (i === 1 ? 20 : 0)) },
    ])
  })

  it('compared with a month that lacks it, draws the main month alone', async () => {
    await openWeek6OfMarch2025()
    const compare = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Compare')
    expect(compare, 'no Compare button').toBeDefined()
    compare!.click()
    await settle()
    // February 2025 has five weeks.
    await choose(
      host.querySelector<HTMLSelectElement>('select[title="Select month to compare against"]')!,
      '2'
    )

    await vi.waitFor(() => {
      expect(trends()?.datasets.map((d) => d.label)).toEqual(['Food (Mar 2025)'])
    })
    expect(trends()).toEqual({
      labels: SUNDAY_TO_SATURDAY,
      datasets: [{ label: 'Food (Mar 2025)', data: [0, 9.5, 0, 0, 0, 0, 0] }],
    })
    expect(host.textContent).not.toContain('No category trend data available')
    // The compare answer arrived, with nothing in it: the note under the chart shows only then.
    expect(host.textContent).toContain('Dashed outlines show February 2025')
  })
})
