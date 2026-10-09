/**
 * The two places a Google Sheet's link is typed, on the form kit, against the real local-first
 * router on fake-indexeddb. Only Google's side is stubbed: `fetch` answers for the sheets below.
 *
 * Connected Sources' "Add a sheet" (sheetSourceForm.ts) used to keep its button disabled until a
 * link was typed, send any link it was given, and end every failure in a toast ("Could not fetch
 * that sheet", "Could not save the source") with nothing marked. The Import page's link
 * (sheetLinkForm.ts) said its failures in the banner at the top of the page ("Please enter a Google
 * Sheets URL", "Invalid Google Sheets URL or ID"). Now a link that is not a sheet's, and a name too
 * long to keep, are marked at their field before anything is sent, in the words both runtimes use
 * (shared/importSourceSchema.ts); a sheet that cannot be read is marked at the link in the
 * runtime's words; and a refusal the server sends is marked at the field it names.
 */
import { createRoot } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { IMPORT_SOURCE_MESSAGES as M } from '../../../../../shared/importSourceSchema'
import { setPage } from '../../../core/appStore'
import { __resetDataVersionsForTest } from '../../../core/dataVersions'
import { getDB } from '../../../core/storage/idb'
import { removeToast, toasts } from '../../../core/toastStore'
import { SHEET_EMPTY } from '../importFlow'
import type { apiFetch as ApiFetch } from '../../../core/apiFetch'
import type { ImportFlow } from '../importFlow'

/** What reached the router, and an answer to give instead of the router's, once. */
const net = vi.hoisted(() => ({
  sent: [] as string[],
  answerOnce: null as null | { path: string; response: () => Response },
}))

vi.mock('../../../core/apiFetch', async (importOriginal) => {
  const real = await importOriginal<{ apiFetch: typeof ApiFetch }>()
  return {
    ...real,
    apiFetch: async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET'
      if (method !== 'GET') net.sent.push(`${method} ${url}`)
      if (net.answerOnce && method !== 'GET' && url === net.answerOnce.path) {
        const { response } = net.answerOnce
        net.answerOnce = null
        return response()
      }
      return real.apiFetch(url, init)
    },
  }
})

/** A sheet anyone with the link can read, and one shared with nobody. */
const LEDGER = 'https://docs.google.com/spreadsheets/d/ledger-sheet/edit#gid=0'
const PRIVATE = 'https://docs.google.com/spreadsheets/d/private-sheet/edit'
const EMPTY = 'https://docs.google.com/spreadsheets/d/empty-sheet/edit'
const CSV = 'Date,Amount,Description\n2026-08-01,-5.00,Coffee\n2026-08-02,-12.40,Lunch\n'
const GVIZ = `/*O_o*/
google.visualization.Query.setResponse(${JSON.stringify({
  table: {
    cols: [
      { id: 'A', label: 'Date' },
      { id: 'B', label: 'Amount' },
      { id: 'C', label: 'Description' },
    ],
    rows: [
      { c: [{ v: '2026-08-01' }, { v: -5 }, { v: 'Coffee' }] },
      { c: [{ v: '2026-08-02' }, { v: -12.4 }, { v: 'Lunch' }] },
    ],
  },
})});`

/** Google, as local-first's sheet reader meets it: every way in to the ledger works. */
async function google(input: RequestInfo | URL): Promise<Response> {
  const url = String(input instanceof Request ? input.url : input)
  if (url.includes('/d/ledger-sheet/')) {
    return new Response(url.includes('/gviz/') ? GVIZ : CSV, { status: 200 })
  }
  if (url.includes('/d/empty-sheet/')) {
    return new Response(url.includes('/gviz/') ? GVIZ.replace(/"rows":\[.*\]/, '"rows":[]') : '', {
      status: 200,
    })
  }
  return new Response('<!DOCTYPE html><title>Sign in</title>', { status: 401 })
}

let host: HTMLDivElement
let dispose: (() => void) | undefined

beforeAll(async () => {
  await Promise.all([
    import('../ConnectedSources'),
    import('../ImportDataEntry'),
    import('../../../core/storage/localApiRouter'),
  ])
}, 120_000)

beforeEach(async () => {
  localStorage.clear()
  localStorage.setItem('finance_storage_mode', 'serverless')
  localStorage.setItem('currentProfileId', '1')
  localStorage.setItem('selectedProfileIds', '[1]')
  __resetDataVersionsForTest()
  const db = await getDB()
  for (const store of Array.from(db.objectStoreNames)) await db.clear(store)
  await db.add('profiles', { id: 1, name: 'Household', created_at: '2026-01-01T00:00:00.000Z' })
  for (const toast of toasts()) removeToast(toast.id)
  net.sent.length = 0
  net.answerOnce = null
  vi.stubGlobal('fetch', vi.fn(google))
  Element.prototype.scrollIntoView = () => {}
  host = document.createElement('div')
  document.body.appendChild(host)
})

afterEach(() => {
  dispose?.()
  dispose = undefined
  host.remove()
  vi.unstubAllGlobals()
})

const failureToasts = () =>
  toasts()
    .filter((t) => t.type === 'error' || t.type === 'warning')
    .map((t) => t.message)
const successToasts = () =>
  toasts()
    .filter((t) => t.type === 'success')
    .map((t) => t.message)

const describedBy = (el: HTMLElement): string =>
  (el.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent ?? '')
    .join(' | ')

const byTestId = (id: string) => host.querySelector<HTMLElement>(`[data-test-id="${id}"]`)
const inputOf = (id: string) => byTestId(id) as HTMLInputElement
const buttonOf = (id: string) => byTestId(id) as HTMLButtonElement

const labelOf = (control: HTMLElement) =>
  host.querySelector<HTMLLabelElement>(`label[for="${control.id}"]`)?.textContent

function type(control: HTMLInputElement, text: string): void {
  control.value = text
  control.dispatchEvent(new InputEvent('input', { bubbles: true }))
}

function submit(button: HTMLButtonElement): void {
  button.click()
}

async function storedSources(): Promise<Record<string, unknown>[]> {
  return (await (await getDB()).getAll('import_sources')) as Record<string, unknown>[]
}

describe('Connected Sources: Add a sheet', () => {
  const urlInput = () => inputOf('source-url-input')
  const labelInput = () => inputOf('source-label-input')
  const save = () => buttonOf('source-save')

  async function openAdd(): Promise<void> {
    setPage('import')
    const { ConnectedSources } = await import('../ConnectedSources')
    dispose = render(() => <ConnectedSources />, host)
    const add = await vi.waitFor(() => {
      const button = Array.from(host.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('Add a sheet')
      )
      expect(button).toBeDefined()
      return button!
    })
    add.click()
    await vi.waitFor(() => {
      expect(byTestId('source-add-form')).not.toBeNull()
    })
    net.sent.length = 0
  }

  it('labels the link and the name', async () => {
    await openAdd()
    expect(labelOf(urlInput())).toBe('Google Sheets link')
    expect(labelOf(labelInput())).toBe('Name')
    expect(urlInput().required).toBe(true)
  })

  it('marks a link that is not a sheet, focuses it, and sends nothing', async () => {
    await openAdd()
    for (const link of ['', 'https://example.com/ledger.csv']) {
      type(urlInput(), link)
      submit(save())
      await vi.waitFor(() => {
        expect(urlInput().getAttribute('aria-invalid')).toBe('true')
      })
      expect(describedBy(urlInput())).toContain(M.url)
      expect(document.activeElement).toBe(urlInput())
    }
    expect(net.sent).toEqual([])
    expect(await storedSources()).toEqual([])
    expect(failureToasts()).toEqual([])
  })

  it('marks a name too long to keep, and sends nothing', async () => {
    await openAdd()
    type(urlInput(), LEDGER)
    type(labelInput(), 'x'.repeat(201))
    submit(save())
    await vi.waitFor(() => {
      expect(labelInput().getAttribute('aria-invalid')).toBe('true')
    })
    expect(describedBy(labelInput())).toContain(M.labelLength)
    expect(urlInput().getAttribute('aria-invalid')).toBeNull()
    expect(document.activeElement).toBe(labelInput())
    expect(net.sent).toEqual([])
    expect(failureToasts()).toEqual([])
  })

  it('marks a sheet that cannot be read at its link, in the words that say how to share it', async () => {
    await openAdd()
    type(urlInput(), PRIVATE)
    submit(save())
    await vi.waitFor(() => {
      expect(urlInput().getAttribute('aria-invalid')).toBe('true')
    })
    expect(describedBy(urlInput())).toContain('Could not access the Google Sheet from the browser.')
    expect(net.sent).toEqual(['POST /api/import/googlesheet'])
    expect(await storedSources()).toEqual([])
    expect(failureToasts()).toEqual([])
    expect(byTestId('source-add-form')).not.toBeNull()
  })

  it('marks a sheet with no header row at its link', async () => {
    await openAdd()
    type(urlInput(), EMPTY)
    submit(save())
    await vi.waitFor(() => {
      expect(describedBy(urlInput())).toContain(SHEET_EMPTY)
    })
    expect(await storedSources()).toEqual([])
    expect(failureToasts()).toEqual([])
  })

  it("marks the field a server's refusal names, its link under the link", async () => {
    await openAdd()
    // As the Worker refuses a source: the link is the source's `config.url`.
    net.answerOnce = {
      path: '/api/import-sources',
      response: () =>
        new Response(JSON.stringify({ error: M.url, fields: { 'config.url': M.url } }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        }),
    }
    type(urlInput(), LEDGER)
    submit(save())
    await vi.waitFor(() => {
      expect(urlInput().getAttribute('aria-invalid')).toBe('true')
    })
    expect(describedBy(urlInput())).toContain(M.url)
    expect(document.activeElement).toBe(urlInput())
    expect(net.sent).toEqual(['POST /api/import/googlesheet', 'POST /api/import-sources'])
    expect(await storedSources()).toEqual([])
    expect(failureToasts()).toEqual([])
  })

  it('saves the sheet with its columns by name, says so, and closes', async () => {
    await openAdd()
    type(urlInput(), ` ${LEDGER} `)
    type(labelInput(), '  Bank ledger ')
    submit(save())
    await vi.waitFor(() => {
      expect(byTestId('source-add-form')).toBeNull()
    })
    expect(net.sent).toEqual(['POST /api/import/googlesheet', 'POST /api/import-sources'])
    expect(await storedSources()).toEqual([
      expect.objectContaining({
        kind: 'google_sheet',
        label: 'Bank ledger',
        config: { url: LEDGER, sheetName: 'Sheet1' },
        mapping: expect.objectContaining({
          date: 'Date',
          amount: 'Amount',
          description: 'Description',
        }),
        schedule: 'manual',
      }),
    ])
    expect(successToasts()).toEqual(['Saved "Bank ledger". Sync it from here whenever you like.'])
    expect(failureToasts()).toEqual([])
    await vi.waitFor(() => {
      expect(host.querySelector('[aria-label="Auto sync Bank ledger"]')).not.toBeNull()
    })
  })

  it('names a sheet saved without a name after its tab, and opens empty the next time', async () => {
    await openAdd()
    type(urlInput(), LEDGER)
    submit(save())
    await vi.waitFor(() => {
      expect(byTestId('source-add-form')).toBeNull()
    })
    expect(await storedSources()).toEqual([expect.objectContaining({ label: 'Sheet1' })])
    Array.from(host.querySelectorAll('button'))
      .find((b) => b.textContent?.includes('Add a sheet'))!
      .click()
    await vi.waitFor(() => {
      expect(byTestId('source-add-form')).not.toBeNull()
    })
    expect(urlInput().value).toBe('')
    expect(labelInput().value).toBe('')
  })
})

describe("the Import page's Google Sheets link", () => {
  const urlInput = () => inputOf('import-sheet-url')
  const fetchButton = () => buttonOf('import-sheet-fetch')

  async function openSheets(): Promise<ImportFlow> {
    setPage('import')
    const { ImportDataEntry } = await import('../ImportDataEntry')
    const { createImportFlow } = await import('../importFlow')
    let flow!: ImportFlow
    dispose = createRoot((disposeRoot) => {
      flow = createImportFlow({ initialTab: 'google-sheets' })
      flow.init()
      const unmount = render(() => <ImportDataEntry flow={flow} />, host)
      return () => {
        unmount()
        disposeRoot()
      }
    })
    await vi.waitFor(() => {
      expect(byTestId('import-sheet-url')).not.toBeNull()
    })
    net.sent.length = 0
    return flow
  }

  it('labels the link', async () => {
    await openSheets()
    expect(labelOf(urlInput())).toBe('Google Sheets link')
  })

  it('marks a link that is not a sheet, focuses it, sends nothing, and leaves the banner empty', async () => {
    const flow = await openSheets()
    for (const link of ['', 'docs.google.com/my-ledger']) {
      type(urlInput(), link)
      submit(fetchButton())
      await vi.waitFor(() => {
        expect(urlInput().getAttribute('aria-invalid')).toBe('true')
      })
      expect(describedBy(urlInput())).toContain(M.url)
      expect(document.activeElement).toBe(urlInput())
    }
    expect(net.sent).toEqual([])
    expect(flow.error()).toBeNull()
    expect(failureToasts()).toEqual([])
  })

  it('marks a sheet that cannot be read at its link, not in the banner', async () => {
    const flow = await openSheets()
    type(urlInput(), PRIVATE)
    submit(fetchButton())
    await vi.waitFor(() => {
      expect(urlInput().getAttribute('aria-invalid')).toBe('true')
    })
    expect(describedBy(urlInput())).toContain('Could not access the Google Sheet from the browser.')
    expect(net.sent).toEqual(['POST /api/import/googlesheet'])
    expect(flow.error()).toBeNull()
    expect(flow.activeStep()).toBe('upload')
    expect(failureToasts()).toEqual([])
  })

  it('takes a sheet it can read to the mapping step, its columns read', async () => {
    const flow = await openSheets()
    type(urlInput(), LEDGER)
    submit(fetchButton())
    await vi.waitFor(() => {
      expect(flow.activeStep()).toBe('mapping')
    })
    expect(flow.currentHeaders()).toEqual(['Date', 'Amount', 'Description'])
    expect(urlInput().getAttribute('aria-invalid')).toBeNull()
    expect(flow.error()).toBeNull()
    expect(failureToasts()).toEqual([])
  })

  it('empties the link, and its mark, when the flow starts over', async () => {
    const flow = await openSheets()
    type(urlInput(), 'not a link')
    submit(fetchButton())
    await vi.waitFor(() => {
      expect(urlInput().getAttribute('aria-invalid')).toBe('true')
    })
    flow.resetForm()
    await vi.waitFor(() => {
      expect(urlInput().value).toBe('')
    })
    expect(urlInput().getAttribute('aria-invalid')).toBeNull()
  })
})
