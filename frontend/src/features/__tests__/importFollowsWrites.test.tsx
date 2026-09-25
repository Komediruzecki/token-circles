/**
 * The Import page's lists follow the writes that change them — made on the page, on another page,
 * or by the flow Connected sources drives — and profile switches and resume, once per write.
 *
 * The page mounts once per session (#317). The import history, the category suggestions and the
 * connected sources loaded once, in onMount: a profile switch left the previous profile's on the
 * page, and an auto sync, which imports through Connected sources' own flow, never reached the
 * history at all. The account pickers reloaded on every visit instead, whether anything had
 * changed or not, and after no write made while the page was open — an import that created an
 * account left it out of the pickers until the next visit.
 */
import { createRoot } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { bumpProfileVersion, setPage } from '../../core/appStore'
import {
  __resetDataVersionsForTest,
  invalidateAllEntities,
  invalidateEntity,
  invalidateForRequest,
} from '../../core/dataVersions'

interface LogRow {
  id: number
  source: string
  imported: number
  duplicates_skipped: number
  accounts_created: number
  categories_created: number
  details: string | null
  created_at: string
}

const SOURCE = {
  id: 1,
  profile_id: 1,
  kind: 'google_sheet',
  label: 'Main',
  config: { url: 'https://docs.google.com/spreadsheets/d/abc123/edit', sheetName: 'Sheet1' },
  mapping: { date: 'Date', amount: 'Amount', description: 'Description' },
  category_types: null,
  schedule: 'manual',
  last_synced_at: null,
}

const logRow = (id: number, source: string): LogRow => ({
  id,
  source,
  imported: 3,
  duplicates_skipped: 0,
  accounts_created: 0,
  categories_created: 0,
  details: null,
  created_at: '2026-09-01 10:00:00',
})

/** What the server holds. */
let accounts: { id: number; name: string; bank_name: string | null }[] = []
let logs: LogRow[] = []
/** Every GET, by path. */
let reads: string[] = []
const readsOf = (path: string) => reads.filter((p) => p === path).length

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })

function serve(path: string, method: string, init?: RequestInit): Response {
  if (method === 'GET') {
    reads.push(path)
    if (path === '/api/accounts') return json(accounts)
    if (path === '/api/categories') return json([{ id: 1, name: 'Groceries' }])
    if (path === '/api/import-logs') return json(logs)
    if (path === '/api/import-sources') return json([SOURCE])
    return json([])
  }
  if (path === '/api/accounts') {
    const { name } = JSON.parse(init?.body as string) as { name: string }
    accounts = [...accounts, { id: 42, name, bank_name: null }]
    return json({ id: 42 })
  }
  if (path === '/api/import/googlesheet') {
    return json({
      headers: ['Date', 'Amount', 'Description'],
      rows: [['2026-08-01', '5.00', 'Coffee']],
      sheetNames: ['Sheet1'],
      selectedSheet: 'Sheet1',
    })
  }
  if (path === '/api/import/execute') return json({ imported: 1, duplicates: 0, skipped: 0 })
  if (path === '/api/import-logs') {
    logs = [logRow(8, 'Google Sheet (Sheet1)'), ...logs]
    return json({ ok: true })
  }
  if (path.startsWith('/api/import-logs/')) {
    const id = Number(path.split('/').pop())
    logs = logs.filter((l) => l.id !== id)
    return json({ deleted: 3 })
  }
  if (path.startsWith('/api/import-sources/')) return json(SOURCE)
  return json({ ok: true })
}

/** The server, plus what apiFetch does after every request: bump the counters its URL names. */
async function fakeApiFetch(url: string, init?: RequestInit): Promise<Response> {
  const method = (init?.method ?? 'GET').toUpperCase()
  const response = serve(url.split('?')[0], method, init)
  invalidateForRequest(url, method, response.ok)
  return response
}

vi.mock('../../core/apiFetch', () => ({
  apiFetch: (url: string, init?: RequestInit) => fakeApiFetch(url, init),
}))

const addToast = vi.fn()
vi.mock('../../core/toastStore', async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>()
  return { ...original, addToast: (...a: unknown[]) => addToast(...a) }
})

vi.mock('../../core/confirmStore', async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>()
  return { ...original, showConfirm: vi.fn(async () => true) }
})

const READERS = [
  { reader: 'the account pickers', path: '/api/accounts', follows: ['accounts'] },
  { reader: 'the category suggestions', path: '/api/categories', follows: ['categories'] },
  { reader: 'the import history', path: '/api/import-logs', follows: ['import-logs'] },
  { reader: 'the connected sources', path: '/api/import-sources', follows: ['import-sources'] },
]

let host: HTMLDivElement
let dispose: (() => void) | undefined

const flush = () => new Promise((r) => setTimeout(r, 0))
const settle = async () => {
  for (let i = 0; i < 4; i++) await flush()
}

async function waitFor(predicate: () => boolean, label: string, turns = 80): Promise<void> {
  for (let i = 0; i < turns; i++) {
    if (predicate()) return
    await flush()
  }
  throw new Error(`timed out waiting for: ${label}`)
}

// Loading the page module (the import flow, the bank adapters) is the slow part of a mount. Done
// once up front, so a loaded machine cannot push the first test past its timeout — a mount that
// outlives its test keeps counting reads into the next one.
beforeAll(async () => {
  await import('../Import')
  await import('../import/ImportDataEntry')
}, 120_000)

beforeEach(() => {
  __resetDataVersionsForTest()
  accounts = [{ id: 1, name: 'Current account', bank_name: null }]
  logs = [logRow(7, 'statement.csv')]
  reads = []
  addToast.mockClear()
  localStorage.clear()
  host = document.createElement('div')
  document.body.appendChild(host)
})

afterEach(() => {
  dispose?.()
  dispose = undefined
  host?.remove()
  localStorage.clear()
})

async function mountImport() {
  setPage('import')
  const { default: Import } = await import('../Import')
  dispose = render(() => <Import />, host)
  await settle()
}

const byLabel = (label: string) =>
  host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
const byText = (text: string) =>
  [...host.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent?.trim() === text
  )
const historyEntries = () =>
  [...host.querySelectorAll('h2')].find((h) => h.textContent === 'Recent Imports')
    ? [...host.querySelectorAll('details')].length
    : 0

describe.each(READERS)('$reader', ({ path, follows }) => {
  it('reads once on mount', async () => {
    await mountImport()
    expect(readsOf(path)).toBe(1)
  })

  it.each(follows)('refetches once when %s is written elsewhere', async (tag) => {
    await mountImport()
    invalidateEntity(tag)
    await settle()
    expect(readsOf(path)).toBe(2)
  })

  it('refetches once when the app resumes', async () => {
    await mountImport()
    invalidateAllEntities()
    await settle()
    expect(readsOf(path)).toBe(2)
  })

  it('refetches once on a profile switch', async () => {
    await mountImport()
    bumpProfileVersion()
    await settle()
    expect(readsOf(path)).toBe(2)
  })

  it('defers while Import is hidden and refetches once on the next show', async () => {
    await mountImport()
    setPage('dashboard')
    await flush()
    for (const tag of follows) invalidateEntity(tag)
    invalidateAllEntities()
    await settle()
    expect(readsOf(path)).toBe(1)

    setPage('import')
    await settle()
    expect(readsOf(path)).toBe(2)
  })

  it('does not reload on a plain revisit', async () => {
    await mountImport()
    setPage('dashboard')
    await flush()
    setPage('import')
    await settle()
    expect(readsOf(path)).toBe(1)
  })
})

describe('writes made on the page', () => {
  it('an auto sync shows in the history, and reloads each list it changes once', async () => {
    await mountImport()
    expect(historyEntries()).toBe(1)

    byLabel('Auto sync Main')!.click()
    await waitFor(() => addToast.mock.calls.length > 0, 'the sync to report an outcome')
    await waitFor(() => historyEntries() === 2, 'the history to show the sync')
    await settle()

    // The execute call may create accounts and categories; the log records the session; the
    // source's last-synced time is saved. One reload each, never a second for the same write.
    expect(readsOf('/api/import-logs')).toBe(2)
    expect(readsOf('/api/accounts')).toBe(2)
    expect(readsOf('/api/categories')).toBe(2)
    expect(readsOf('/api/import-sources')).toBe(2)
  })

  it('a preview reloads nothing, because it writes nothing', async () => {
    await mountImport()
    byLabel('Fetch and preview Main')!.click()
    await waitFor(() => !byLabel('Fetch and preview Main')?.disabled, 'the preview to finish')
    await settle()

    for (const { path } of READERS) expect(readsOf(path), path).toBe(1)
  })

  it('undoing an import reloads the history once, and the balances behind the pickers', async () => {
    await mountImport()
    byText('Delete import')!.click()
    await waitFor(() => historyEntries() === 0, 'the undone import to leave the history')
    await settle()

    expect(readsOf('/api/import-logs')).toBe(2)
    // The undo deletes transactions and recomputes balances.
    expect(readsOf('/api/accounts')).toBe(2)
    expect(readsOf('/api/categories')).toBe(1)
  })
})

/** Add a statement on the Bank Imports tab, then make a new account from its account picker. */
async function createAccountInPlace(name: string): Promise<HTMLSelectElement> {
  host.querySelector<HTMLButtonElement>('[data-test-id="import-tab-bank-imports"]')!.click()
  await settle()
  const input = host.querySelector<HTMLInputElement>('[data-test-id="bank-file-input"]')!
  const file = new File(['Date,Amount\n2026-08-01,5.00\n'], 'statement.csv', { type: 'text/csv' })
  Object.defineProperty(input, 'files', { value: [file], configurable: true })
  input.dispatchEvent(new Event('change', { bubbles: true }))
  await waitFor(
    () => host.querySelector('[data-test-id="bank-target-account"]') !== null,
    'the statement row'
  )

  const picker = host.querySelector<HTMLSelectElement>('[data-test-id="bank-target-account"]')!
  picker.value = '__create-account__'
  picker.dispatchEvent(new Event('change', { bubbles: true }))
  await settle()
  const nameInput = host.querySelector<HTMLInputElement>('[data-test-id="account-select-name"]')!
  nameInput.value = name
  nameInput.dispatchEvent(new Event('input', { bubbles: true }))
  host.querySelector<HTMLButtonElement>('[data-test-id="account-select-submit"]')!.click()
  await waitFor(
    () => host.querySelector('[data-test-id="account-select-create"]') === null,
    'the create form to close'
  )
  return host.querySelector<HTMLSelectElement>('[data-test-id="bank-target-account"]')!
}

const offered = (picker: HTMLSelectElement) => [...picker.options].map((o) => o.value)

describe('an account made in place from a statement row', () => {
  it('is offered and picked at once, and the pickers reload once', async () => {
    await mountImport()
    const picker = await createAccountInPlace('Savings')
    await settle()

    expect(offered(picker)).toContain('Savings')
    expect(picker.value).toBe('Savings')
    // The create bumps `accounts`, which the page follows. A reload of its own on top is a second
    // fetch for one write.
    expect(readsOf('/api/accounts')).toBe(2)
  })

  it('is offered on a surface that does not follow account writes, like the onboarding wizard', async () => {
    setPage('dashboard')
    const { ImportDataEntry } = await import('../import/ImportDataEntry')
    const { createImportFlow } = await import('../import/importFlow')
    dispose = createRoot((disposeRoot) => {
      const flow = createImportFlow({ initialTab: 'bank-imports' })
      flow.init()
      const unmount = render(() => <ImportDataEntry flow={flow} />, host)
      return () => {
        unmount()
        disposeRoot()
      }
    })
    await settle()

    const picker = await createAccountInPlace('Savings')
    await settle()

    expect(offered(picker)).toContain('Savings')
    expect(picker.value).toBe('Savings')
  })
})
