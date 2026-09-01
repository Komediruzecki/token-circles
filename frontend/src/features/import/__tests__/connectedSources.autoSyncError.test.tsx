/**
 * Auto sync is headless — no preview, no confirmation, just a toast at the end. That makes the
 * error path the whole UI: handleImport swallows failures into flow.error(), and if Auto sync
 * doesn't surface that, a rejected import ends with the spinner stopping and nothing else. The
 * user reads that silence as "the button does nothing".
 */
import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const source = {
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

/** Set per-test to make POST /api/import/execute fail. */
let executeShouldFail = false

const apiFetch = vi.fn(async (url: string, init?: RequestInit) => {
  const method = init?.method ?? 'GET'
  if (url === '/api/import-sources' && method === 'GET') {
    return new Response(JSON.stringify([source]), { status: 200 })
  }
  if (url === '/api/import/googlesheet' && method === 'POST') {
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

let host: HTMLDivElement
let dispose: (() => void) | undefined

beforeEach(() => {
  executeShouldFail = false
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

async function mountAndSync() {
  const { ConnectedSources } = await import('../ConnectedSources')
  dispose = render(() => <ConnectedSources />, host)
  await waitFor(() => syncButton() !== null, 'the saved source to render its Auto sync button')
  const btn = syncButton()!
  btn.click()
  // fetch → mapping → execute are sequential awaits. Every outcome ends in exactly one toast —
  // that is the run's real completion signal, and the only one the user gets. (Waiting on the
  // button's busy state instead would pass instantly: the click has not disabled it yet.)
  await waitFor(() => addToast.mock.calls.length > 0, 'the sync to report an outcome')
  return btn
}

describe('Auto sync error surfacing', () => {
  it('toasts the import error when the execute step fails', async () => {
    executeShouldFail = true
    const btn = await mountAndSync()

    const errors = addToast.mock.calls.filter(([, kind]) => kind === 'error')
    expect(errors, 'a failed import must say so').toHaveLength(1)
    expect(String(errors[0]![0])).toContain('Rows were rejected by the server')
    // And no success/info toast claiming the sync happened.
    expect(addToast.mock.calls.some(([, kind]) => kind !== 'error')).toBe(false)
    // The button is usable again for a retry.
    expect(btn.disabled).toBe(false)
  })

  it('does not add an error toast when the import succeeds', async () => {
    await mountAndSync()
    expect(addToast.mock.calls.filter(([, kind]) => kind === 'error')).toHaveLength(0)
    // The success path still reports through onImported's toast.
    expect(addToast.mock.calls.some(([, kind]) => kind === 'success')).toBe(true)
  })
})
