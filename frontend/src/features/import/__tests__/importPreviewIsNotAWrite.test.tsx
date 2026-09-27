/**
 * An import preview changes nothing, so it must not invalidate anything.
 *
 * The preview dry-runs the import against the server to learn which rows it would skip and which
 * categories it would create. It posts to the same route as the import itself, with `dry_run` in
 * the body — which apiFetch never sees. So every preview counted as an import: it bumped the
 * transactions and everything derived from them, and every page following those reloaded, or was
 * marked stale, for a write that never happened.
 *
 * Driven through Connected sources, whose "Fetch and preview" and "Auto sync" run the real flow.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { setPage } from '../../../core/appStore'
import {
  __resetDataVersionsForTest,
  entityVersion,
  invalidateForRequest,
} from '../../../core/dataVersions'

const SOURCE = {
  id: 1,
  profile_id: 7,
  kind: 'google_sheet',
  label: 'Main',
  config: { url: 'https://docs.google.com/spreadsheets/d/abc123/edit', sheetName: 'Sheet1' },
  mapping: { date: 'Date', amount: 'Amount', description: 'Description' },
  category_types: null,
  schedule: 'manual',
  last_synced_at: null,
}

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })

/** What each request would get from the server. */
function serve(url: string, method: string): Response {
  const path = url.split('?')[0]
  if (path === '/api/import-sources' && method === 'GET') return json([SOURCE])
  if (path === '/api/import/googlesheet') {
    return json({
      headers: ['Date', 'Amount', 'Description'],
      rows: [['2026-08-01', '5.00', 'Coffee']],
      sheetNames: ['Sheet1'],
      selectedSheet: 'Sheet1',
    })
  }
  if (path === '/api/import/execute') return json({ imported: 1, duplicates: 0, skipped: 0 })
  return json({ ok: true })
}

/** The server, plus what apiFetch does after every request: bump the counters its URL names. */
const apiFetch = vi.fn(async (url: string, init?: RequestInit) => {
  const method = (init?.method ?? 'GET').toUpperCase()
  const response = serve(url, method)
  invalidateForRequest(url, method, response.ok)
  return response
})

const addToast = vi.fn()
vi.mock('../../../core/apiFetch', () => ({
  apiFetch: (...a: unknown[]) => apiFetch(...(a as [string])),
}))
vi.mock('../../../core/toastStore', () => ({ addToast: (...a: unknown[]) => addToast(...a) }))
// importFlow pulls toast/getLocalCurrency from core/api; keep them inert.
vi.mock('../../../core/api', () => ({ toast: vi.fn(), getLocalCurrency: () => 'EUR' }))

const flush = () => new Promise((r) => setTimeout(r, 0))

async function waitFor(predicate: () => boolean, label: string, turns = 60): Promise<void> {
  for (let i = 0; i < turns; i++) {
    if (predicate()) return
    await flush()
  }
  throw new Error(`timed out waiting for: ${label}`)
}

// Loading the section (the import flow, the bank adapters) is the slow part of a mount. Done once
// up front, so a loaded machine cannot push the first test past its 5 s timeout.
beforeAll(async () => {
  await import('../ConnectedSources')
}, 120_000)

let host: HTMLDivElement
let dispose: (() => void) | undefined

beforeEach(() => {
  __resetDataVersionsForTest()
  apiFetch.mockClear()
  addToast.mockClear()
  host = document.createElement('div')
  document.body.appendChild(host)
})

afterEach(() => {
  dispose?.()
  host?.remove()
})

const button = (label: string) =>
  host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)

const posted = (path: string) =>
  apiFetch.mock.calls.filter(
    ([url, init]) => url.split('?')[0] === path && (init?.method ?? 'GET').toUpperCase() === 'POST'
  )

async function mountSources() {
  setPage('import')
  const { ConnectedSources } = await import('../ConnectedSources')
  dispose = render(() => <ConnectedSources />, host)
  await waitFor(() => button('Fetch and preview Main') !== null, 'the saved source to render')
}

/** What a transaction write moves. A preview must move none of it. */
const COUNTERS = ['transactions', 'accounts', 'categories', 'dashboard', 'analytics', 'budgets']
const versions = () => COUNTERS.map((tag) => entityVersion(tag))

describe('an import preview', () => {
  it('invalidates nothing, although it posts to the import route', async () => {
    await mountSources()
    const before = versions()

    button('Fetch and preview Main')!.click()
    await waitFor(() => posted('/api/import/execute').length > 0, 'the preview to dry-run')
    await flush()

    expect(versions()).toEqual(before)
  })

  it('leaves the import itself counted as the write it is', async () => {
    await mountSources()
    const before = versions()

    button('Auto sync Main')!.click()
    await waitFor(() => addToast.mock.calls.length > 0, 'the sync to report an outcome')

    // Auto sync imports without a preview: one execute, and it moves every counter.
    expect(posted('/api/import/execute')).toHaveLength(1)
    versions().forEach((version, i) => {
      expect(version, COUNTERS[i]).toBeGreaterThan(before[i])
    })
  })
})
