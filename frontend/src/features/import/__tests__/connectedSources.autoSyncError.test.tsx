/**
 * Auto sync is headless — no preview, no confirmation, just a toast at the end. That makes the
 * error path the whole UI: handleImport swallows failures into flow.error(), and if Auto sync
 * doesn't surface that, a rejected import ends with the spinner stopping and nothing else. The
 * user reads that silence as "the button does nothing".
 *
 * A failure is said at the source's row, as an alert, until the next try (review of 19 Nov,
 * finding 8): a toast was gone in six seconds, from the corner of the screen. A failed import in
 * the preview modal is said in the modal, above its buttons.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { IMPORT_SOURCE_MESSAGES } from '../../../../../shared/importSourceSchema'
import { setPage } from '../../../core/appStore'

const SHARED = 'https://docs.google.com/spreadsheets/d/abc123/edit'

const source = {
  id: 1,
  profile_id: 7,
  kind: 'google_sheet',
  label: 'Main',
  config: { url: SHARED, sheetName: 'Sheet1' },
  mapping: { date: 'Date', amount: 'Amount', description: 'Description' },
  category_types: null,
  schedule: 'manual',
  last_synced_at: null,
}

/** Set per-test to make POST /api/import/execute fail. */
let executeShouldFail = false
/** Set per-test to make the sheet's read fail. */
let fetchShouldFail = false

const apiFetch = vi.fn(async (url: string, init?: RequestInit) => {
  const method = init?.method ?? 'GET'
  if (url === '/api/import-sources' && method === 'GET') {
    return new Response(JSON.stringify([source]), { status: 200 })
  }
  if (url === '/api/import/googlesheet' && method === 'POST') {
    if (fetchShouldFail) {
      return new Response(JSON.stringify({ error: 'The sheet is not shared with anyone' }), {
        status: 422,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    return new Response(
      JSON.stringify({
        headers: ['Date', 'Amount', 'Description'],
        rows: [['2026-08-01', '5.00', 'Coffee']],
        sheetNames: ['Sheet1'],
        selectedSheet: 'Sheet1',
      }),
      { status: 200 }
    )
  }
  if (url === '/api/import/execute' && method === 'POST') {
    if (executeShouldFail) {
      return new Response(JSON.stringify({ error: 'Rows were rejected by the server' }), {
        status: 422,
      })
    }
    return new Response(JSON.stringify({ imported: 1, duplicates: 0, skipped: 0 }), {
      status: 200,
    })
  }
  if (url === '/api/import-logs' && method === 'POST') {
    return new Response(JSON.stringify({ ok: true }), { status: 200 })
  }
  return new Response('{}', { status: 200 })
})

const addToast = vi.fn()
vi.mock('../../../core/apiFetch', () => ({
  apiFetch: (...a: unknown[]) => apiFetch(...(a as [string])),
}))
vi.mock('../../../core/toastStore', () => ({ addToast: (...a: unknown[]) => addToast(...a) }))
// importFlow pulls toast/getLocalCurrency from core/api; keep them inert.
vi.mock('../../../core/api', () => ({ toast: vi.fn(), getLocalCurrency: () => 'EUR' }))

const flush = () => new Promise((r) => setTimeout(r, 0))

/**
 * Wait for a condition rather than a fixed number of macrotask turns. Counting turns ties the
 * test to how many awaits the implementation happens to have, and on a loaded machine the work
 * simply takes more of them — which showed up as a flake, not a real failure.
 */
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
  executeShouldFail = false
  fetchShouldFail = false
  source.config.url = SHARED
  apiFetch.mockClear()
  addToast.mockClear()
  host = document.createElement('div')
  document.body.appendChild(host)
})

afterEach(() => {
  dispose?.()
  host?.remove()
})

const syncButton = () =>
  host.querySelector<HTMLButtonElement>('button[aria-label="Auto sync Main"]')

const rowError = () => host.querySelector<HTMLElement>('[data-test-id="source-error"]')

async function mount() {
  // The list loads through refetchOnActive, which only fetches while the Import page is the visible
  // one. In the app the section mounts only there; here we have to say so.
  setPage('import')
  const { ConnectedSources } = await import('../ConnectedSources')
  dispose = render(() => <ConnectedSources />, host)
  await waitFor(() => syncButton() !== null, 'the saved source to render its Auto sync button')
}

/** Sync, and wait for its end: a toast when it worked, the row's alert when it did not. */
async function sync(): Promise<HTMLButtonElement> {
  const btn = syncButton()!
  const toasts = addToast.mock.calls.length
  btn.click()
  await waitFor(
    () => addToast.mock.calls.length > toasts || (rowError() !== null && !btn.disabled),
    'the sync to report an outcome'
  )
  return btn
}

describe('Auto sync error surfacing', () => {
  it("says the import's error at the source's row, not in a toast", async () => {
    executeShouldFail = true
    await mount()
    const btn = await sync()

    expect(rowError()?.getAttribute('role')).toBe('alert')
    expect(rowError()?.textContent).toContain('Rows were rejected by the server')
    expect(addToast).not.toHaveBeenCalled()
    // The button is usable again for a retry.
    expect(btn.disabled).toBe(false)
  })

  it("says a sheet it could not read at the source's row, and the next try clears it", async () => {
    fetchShouldFail = true
    await mount()
    await sync()
    expect(rowError()?.textContent).toContain('The sheet is not shared with anyone')
    expect(addToast).not.toHaveBeenCalled()

    fetchShouldFail = false
    await sync()

    expect(rowError()).toBeNull()
    expect(addToast.mock.calls.some(([, kind]) => kind === 'success')).toBe(true)
  })

  // Only the API could save one (Add a sheet reads the sheet first), but a source saved with a link
  // from Publish to web says which link would work, where its Sync said the read failed.
  it("says a published link's words at the source's row, and asks no runtime to read it", async () => {
    source.config.url = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vExampleOnly/pubhtml'
    await mount()
    await sync()

    expect(rowError()?.textContent).toBe(IMPORT_SOURCE_MESSAGES.published)
    expect(apiFetch.mock.calls.map(([url]) => url)).not.toContain('/api/import/googlesheet')
    expect(addToast).not.toHaveBeenCalled()
  })

  it('does not add an error when the import succeeds', async () => {
    await mount()
    await sync()
    expect(rowError()).toBeNull()
    expect(addToast.mock.calls.filter(([, kind]) => kind === 'error')).toHaveLength(0)
    // The success path still reports through onImported's toast.
    expect(addToast.mock.calls.some(([, kind]) => kind === 'success')).toBe(true)
  })
})

describe('Fetch and preview error surfacing', () => {
  it('says a failed import in the modal, above its buttons', async () => {
    executeShouldFail = true
    await mount()
    host.querySelector<HTMLButtonElement>('button[aria-label="Fetch and preview Main"]')!.click()
    const importButton = () =>
      [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((b) =>
        b.textContent?.startsWith('Import selected')
      ) ?? null
    await waitFor(() => importButton() !== null && !importButton()!.disabled, 'the preview')

    importButton()!.click()
    const alert = () =>
      document.querySelector<HTMLElement>('[role="dialog"] [data-test-id="import-preview-error"]')
    await waitFor(() => alert() !== null, 'the error in the modal')

    expect(alert()!.getAttribute('role')).toBe('alert')
    expect(alert()!.textContent).toContain('Rows were rejected by the server')
    // Above the buttons: it comes before them in the modal's footer.
    expect(
      alert()!.compareDocumentPosition(importButton()!) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(rowError()).toBeNull()
  })
})
