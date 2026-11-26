/**
 * Settings > Exports > PDF reports: the year a report is made for is the year the picker shows.
 *
 * The panel seeds its year from the app's focus period, from the month that period starts in.
 * "All time" starts on 1970-01-01, so the seed was 1970. No year select offers 1970, so the browser
 * showed the first option (this year) while the panel kept 1970: picking this year changed nothing,
 * and the annual report came out as "Annual Financial Report — 1970" with every figure at zero.
 * The same split happened for any seeded year without transactions, which the picker does not offer.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { setPage } from '../../core/appStore'
import { __resetDataVersionsForTest } from '../../core/dataVersions'
import { setPeriod } from '../../core/periodStore'
import { setSettingsTab } from '../../core/settingsStore'
import { fromPill, MONTH_NAMES } from '../../utils/period'
import type { MockInstance } from 'vitest'

const THIS_YEAR = new Date().getFullYear()

const made = vi.hoisted(() => [] as Array<[string, unknown]>)
let serverYears: number[] = []

vi.mock('../../core/apiFetch', () => ({
  apiFetch: vi.fn(async (url: string) => {
    let body: unknown = {}
    if (url.startsWith('/api/analytics/distinct-years')) body = { years: [...serverYears] }
    else if (url.startsWith('/api/profiles')) body = []
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }),
}))

/** The generators, recording what each was asked for. */
vi.mock('../../core/storage/clientPdfReports', () => {
  const pdf = (kind: string) =>
    vi.fn(async (what: unknown) => {
      made.push([kind, what])
      return new Blob(['%PDF-1.3'], { type: 'application/pdf' })
    })
  return {
    generateAnnualPdf: pdf('annual'),
    generateMonthlyPdf: pdf('monthly'),
    generateTaxSummaryPdf: pdf('tax'),
    generatePlSummaryPdf: pdf('pl'),
  }
})

const flush = () => new Promise((r) => setTimeout(r, 0))
const settle = async () => {
  for (let i = 0; i < 4; i++) await flush()
}

let host: HTMLDivElement
let dispose: (() => void) | undefined
let anchorClick: MockInstance<() => void> | undefined

beforeAll(async () => {
  await import('../Settings')
}, 120_000)

beforeEach(() => {
  __resetDataVersionsForTest()
  serverYears = [THIS_YEAR, THIS_YEAR - 1]
  made.length = 0
  localStorage.clear()
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
  URL.createObjectURL = vi.fn(() => 'blob:report')
  URL.revokeObjectURL = vi.fn()
  // jsdom cannot follow the download link: keep its click from trying.
  anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  host = document.createElement('div')
  document.body.appendChild(host)
})

afterEach(() => {
  dispose?.()
  dispose = undefined
  host.remove()
  vi.unstubAllGlobals()
  anchorClick?.mockRestore()
  localStorage.clear()
})

async function openReports() {
  setPage('settings')
  setSettingsTab('exports')
  const { default: Settings } = await import('../Settings')
  dispose = render(() => <Settings />, host)
  await settle()
}

function generateButton(): HTMLButtonElement {
  const button = [...host.querySelectorAll('button')].find((b) =>
    b.textContent?.includes('Generate PDF Report')
  )
  expect(button, 'the PDF reports card did not render').toBeDefined()
  return button as HTMLButtonElement
}

/** A select of the PDF reports card, by its label. */
function select(name: string): HTMLSelectElement {
  const label = [...generateButton().parentElement!.querySelectorAll('label')].find(
    (l) => l.textContent === name
  )
  expect(label, `no "${name}" select`).toBeDefined()
  return label!.nextElementSibling as HTMLSelectElement
}

function choose(name: string, value: string) {
  const el = select(name)
  el.value = value
  el.dispatchEvent(new Event('change', { bubbles: true }))
}

async function generate() {
  generateButton().click()
  await settle()
}

const hint = () => host.querySelector('[data-test-id="report-so-far"]')

describe('the year a PDF report is made for', () => {
  it('is this year when the app is on All time, not 1970', async () => {
    setPeriod(fromPill('all'))
    await openReports()
    choose('Report Type', 'annual')
    expect(select('Year').value).toBe(String(THIS_YEAR))
    await generate()
    expect(made).toEqual([['annual', THIS_YEAR]])
  })

  it('is the year the picker shows when the app was on a year without transactions', async () => {
    setPeriod({ mode: 'month', year: THIS_YEAR - 5, month: 3 })
    await openReports()
    choose('Report Type', 'tax')
    const shown = Number(select('Year').value)
    await generate()
    expect(made).toEqual([['tax', shown]])
    expect(shown).toBe(THIS_YEAR)
  })

  it('opens on the year the app was on when that year has transactions', async () => {
    setPeriod({ mode: 'month', year: THIS_YEAR - 1, month: 3 })
    await openReports()
    choose('Report Type', 'annual')
    expect(select('Year').value).toBe(String(THIS_YEAR - 1))
    await generate()
    expect(made).toEqual([['annual', THIS_YEAR - 1]])
  })

  it('opens the monthly report on this month when the app is on All time', async () => {
    setPeriod(fromPill('all'))
    await openReports()
    expect(select('Month').value).toBe(String(new Date().getMonth() + 1))
  })

  it('follows a year picked by hand', async () => {
    setPeriod(fromPill('all'))
    await openReports()
    choose('Report Type', 'annual')
    choose('Year', String(THIS_YEAR - 1))
    await generate()
    expect(made).toEqual([['annual', THIS_YEAR - 1]])
  })
})

describe('the annual report for this year', () => {
  const month = new Date().getMonth()
  const soFar = month === 0 ? 'January' : `January to ${MONTH_NAMES[month]}`

  it('says it covers the months so far', async () => {
    setPeriod(fromPill('all'))
    await openReports()
    choose('Report Type', 'annual')
    expect(hint()?.textContent).toBe(`${THIS_YEAR} so far: ${soFar}.`)
  })

  it('says so for the full-year monthly report too', async () => {
    setPeriod(fromPill('thisMonth'))
    await openReports()
    choose('Month', '0')
    expect(hint()?.textContent).toBe(`${THIS_YEAR} so far: ${soFar}.`)
  })

  it('says nothing for a past year', async () => {
    setPeriod(fromPill('all'))
    await openReports()
    choose('Report Type', 'annual')
    choose('Year', String(THIS_YEAR - 1))
    expect(hint()).toBeNull()
  })
})
