/**
 * Settings > Exports > PDF reports: the year picker follows transaction writes from anywhere,
 * profile switches and resume.
 *
 * It loaded its years once, in onMount. Settings stays mounted once visited (#317), so a
 * transaction saved in a year the picker did not have yet — or an import of an older year — left
 * that year out of it until a reload, and a profile switch left the previous profile's years on it.
 *
 * The endpoint reads only the transactions table, so `transactions` is the counter it follows.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { bumpProfileVersion, setPage } from '../../core/appStore'
import {
  __resetDataVersionsForTest,
  invalidateAllEntities,
  invalidateEntity,
  invalidateForRequest,
} from '../../core/dataVersions'
import { setSettingsTab } from '../../core/settingsStore'

const THIS_YEAR = new Date().getFullYear()

/** What the server has, and how often the picker asked. */
let serverYears: number[] = []
let yearReads = 0

vi.mock('../../core/apiFetch', () => ({
  apiFetch: vi.fn(async (url: string) => {
    let body: unknown = {}
    if (url.startsWith('/api/analytics/distinct-years')) {
      yearReads += 1
      body = { years: [...serverYears] }
    } else if (url.startsWith('/api/profiles')) {
      body = []
    }
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }),
}))

const flush = () => new Promise((r) => setTimeout(r, 0))
const settle = async () => {
  for (let i = 0; i < 4; i++) await flush()
}

let host: HTMLDivElement
let dispose: (() => void) | undefined

// Settings pulls in billing, passkeys and the rest of its tabs; loading it is the slow part of a
// mount. Done once up front, so a loaded machine cannot push the first test past its timeout — a
// mount that outlives its test keeps counting reads into the next one.
beforeAll(async () => {
  await import('../Settings')
}, 120_000)

beforeEach(() => {
  __resetDataVersionsForTest()
  serverYears = [THIS_YEAR, THIS_YEAR - 1]
  yearReads = 0
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
  host = document.createElement('div')
  document.body.appendChild(host)
})

afterEach(() => {
  dispose?.()
  dispose = undefined
  host.remove()
  vi.unstubAllGlobals()
  localStorage.clear()
})

/** Settings, visible, on the tab that holds the PDF reports card. */
async function openReports() {
  setPage('settings')
  setSettingsTab('exports')
  const { default: Settings } = await import('../Settings')
  dispose = render(() => <Settings />, host)
  await settle()
}

/** The Year select of the PDF reports card: the card's only select with a "Year" label. */
function yearSelect(): HTMLSelectElement {
  const generate = [...host.querySelectorAll('button')].find((b) =>
    b.textContent?.includes('Generate PDF Report')
  )
  expect(generate, 'the PDF reports card did not render').toBeDefined()
  const label = [...generate!.parentElement!.querySelectorAll('label')].find(
    (l) => l.textContent === 'Year'
  )
  return label!.nextElementSibling as HTMLSelectElement
}

const offeredYears = () => [...yearSelect().options].map((o) => Number(o.value))

describe('the PDF report year picker', () => {
  it('reads the years once on mount', async () => {
    await openReports()
    expect(yearReads).toBe(1)
    expect(offeredYears()).toEqual([THIS_YEAR, THIS_YEAR - 1])
  })

  it('refetches once when a transaction is written elsewhere', async () => {
    await openReports()
    invalidateForRequest('/api/transactions', 'POST', true)
    await settle()
    expect(yearReads).toBe(2)
  })

  it('refetches once for an import, which writes transactions', async () => {
    await openReports()
    invalidateForRequest('/api/import/execute', 'POST', true)
    await settle()
    expect(yearReads).toBe(2)
  })

  it('refetches once on a profile switch', async () => {
    await openReports()
    bumpProfileVersion()
    await settle()
    expect(yearReads).toBe(2)
  })

  it('refetches once when the app resumes', async () => {
    await openReports()
    invalidateAllEntities()
    await settle()
    expect(yearReads).toBe(2)
  })

  it('defers while Settings is hidden and refetches once on the next show', async () => {
    await openReports()
    setPage('transactions')
    await flush()
    invalidateEntity('transactions')
    invalidateAllEntities()
    await settle()
    expect(yearReads).toBe(1)

    setPage('settings')
    await settle()
    expect(yearReads).toBe(2)
  })

  it('offers a year a write added, and keeps the year that was picked', async () => {
    await openReports()
    const select = yearSelect()
    select.value = String(THIS_YEAR - 1)
    select.dispatchEvent(new Event('change'))
    await settle()

    // A transaction backdated seven years, saved on another page.
    serverYears = [THIS_YEAR, THIS_YEAR - 1, THIS_YEAR - 7]
    invalidateEntity('transactions')
    await settle()

    expect(offeredYears()).toEqual([THIS_YEAR, THIS_YEAR - 1, THIS_YEAR - 7])
    expect(yearSelect().value).toBe(String(THIS_YEAR - 1))
  })
})
