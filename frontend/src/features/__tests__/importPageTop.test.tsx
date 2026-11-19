/**
 * The top of the Import page after an import, and the Google Sheets tab (maff, 19 Nov): a tab
 * picker of one under an empty link, an error banner a screen above the field it was about, and
 * the balances and the subscription offer pushing the import methods out of view. Run against the
 * real local-first router on fake-indexeddb, with only Google's side stubbed.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import * as XLSX from 'xlsx'
import { setCurrentProfile, setPage, setProfiles } from '../../core/appStore'
import { __resetDataVersionsForTest } from '../../core/dataVersions'
import { getDB } from '../../core/storage/idb'
import { removeToast, toasts } from '../../core/toastStore'

const LINK = 'https://docs.google.com/spreadsheets/d/example-ledger/edit#gid=0'
const ACCOUNTS = ['Example Checking', 'Example Savings', 'Example Card']
const CSV =
  'Date,Description,Amount,Means of Payment\n' +
  '2026-08-01,Example coffee,-5.00,Example Checking\n' +
  '2026-08-02,Example lunch,-12.40,Example Savings\n' +
  '2026-08-03,Example books,-20.00,Example Card\n'

/** Google, as local-first's sheet reader meets it: the published CSV of the ledger. */
async function google(input: RequestInfo | URL): Promise<Response> {
  const url = String(input instanceof Request ? input.url : input)
  if (url.includes('/d/example-ledger/') && !url.includes('/gviz/')) {
    return new Response(CSV, { status: 200 })
  }
  return new Response('<!DOCTYPE html><title>Sign in</title>', { status: 401 })
}

let host: HTMLDivElement
let dispose: (() => void) | undefined

beforeAll(async () => {
  await Promise.all([import('../Import'), import('../../core/storage/localApiRouter')])
}, 120_000)

beforeEach(async () => {
  localStorage.clear()
  localStorage.setItem('finance_storage_mode', 'serverless')
  localStorage.setItem('currentProfileId', '1')
  localStorage.setItem('selectedProfileIds', '[1]')
  localStorage.setItem('localCurrency', 'EUR')
  __resetDataVersionsForTest()
  const db = await getDB()
  for (const store of Array.from(db.objectStoreNames)) await db.clear(store)
  await db.add('profiles', { id: 1, name: 'Personal', created_at: '2026-01-01T00:00:00.000Z' })
  for (const [i, name] of ACCOUNTS.entries()) {
    await db.add('accounts', {
      name,
      type: 'giro',
      currency: 'EUR',
      balance: 100 + i,
      starting_balance: 100 + i,
      profile_id: 1,
    })
  }
  setProfiles([{ id: 1, name: 'Personal' }] as never)
  setCurrentProfile({ id: 1, name: 'Personal' } as never)
  for (const toast of toasts()) removeToast(toast.id)
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
  setCurrentProfile(null)
  setPage('dashboard')
})

const byTestId = (id: string): HTMLElement | null =>
  host.querySelector<HTMLElement>(`[data-test-id="${id}"]`)

async function mountImport(): Promise<void> {
  setPage('import')
  const { default: Import } = await import('../Import')
  dispose = render(() => <Import />, host)
  await vi.waitFor(() => {
    expect(byTestId('import-tab-google-sheets')).not.toBeNull()
  })
}

function type(control: HTMLInputElement, text: string): void {
  control.value = text
  control.dispatchEvent(new InputEvent('input', { bubbles: true }))
}

/** Read the ledger from its link, and import it as its columns were matched. */
async function importTheSheet(): Promise<void> {
  byTestId('import-tab-google-sheets')!.click()
  await vi.waitFor(() => {
    expect(byTestId('import-sheet-url')).not.toBeNull()
  })
  type(byTestId('import-sheet-url') as HTMLInputElement, LINK)
  byTestId('import-sheet-fetch')!.click()
  await vi.waitFor(
    () => {
      expect(byTestId('import-continue-preview')).not.toBeNull()
    },
    { timeout: 8_000 }
  )
  byTestId('import-continue-preview')!.click()
  await vi.waitFor(
    () => {
      expect(byTestId('import-execute-all')).not.toBeNull()
    },
    { timeout: 8_000 }
  )
  byTestId('import-execute-all')!.click()
  await vi.waitFor(
    () => {
      expect(byTestId('import-result')?.textContent).toContain('Imported 3 transactions')
    },
    { timeout: 8_000 }
  )
}

/** The flow starts over three seconds after an import: the methods are back. */
async function afterTheReset(): Promise<void> {
  await vi.waitFor(
    () => {
      expect(byTestId('import-sheet-url')).not.toBeNull()
    },
    { timeout: 6_000 }
  )
}

describe("the Google Sheets tab's tabs", () => {
  it('says the link picks the tab, and leaves no tab to choose behind after an import', async () => {
    await mountImport()
    await importTheSheet()
    await afterTheReset()

    // The link is empty again, and nothing offers to read "Sheet1" from it.
    expect((byTestId('import-sheet-url') as HTMLInputElement).value).toBe('')
    expect(
      [...host.querySelectorAll('button')].map((b) => b.textContent?.trim()).filter(Boolean)
    ).not.toContain('Sheet1')
    expect(host.textContent).not.toContain('Available sheets')
    expect(byTestId('import-sheet-help')?.textContent).toContain(
      'It reads the tab your link opens on: for another tab, open that tab and copy its link.'
    )
  }, 20_000)
})

describe("a workbook's sheets", () => {
  /** A workbook of two sheets, made up: March and April. */
  function workbook(): File {
    const book = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(
      book,
      XLSX.utils.aoa_to_sheet([
        ['Date', 'Description', 'Amount'],
        ['2026-03-02', 'Example rent', -700],
      ]),
      'March'
    )
    XLSX.utils.book_append_sheet(
      book,
      XLSX.utils.aoa_to_sheet([
        ['Date', 'Description', 'Amount'],
        ['2026-04-02', 'Example rent', -700],
      ]),
      'April'
    )
    const bytes = new Uint8Array(
      XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
    )
    return new File([bytes], 'example-ledger.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
  }

  // The choice sat on the upload step, which an upload that reads leaves at once for Map columns:
  // a workbook's other sheets could not be chosen on the page at all.
  it('are a labelled choice on Map columns, the one read pressed', async () => {
    await mountImport()
    byTestId('import-tab-file-upload')!.click()
    const input = await vi.waitFor(() => {
      const found = host.querySelector<HTMLInputElement>(
        '[data-test-id="import-upload-form"] input[type="file"]'
      )
      expect(found).not.toBeNull()
      return found!
    })
    Object.defineProperty(input, 'files', { value: [workbook()], configurable: true })
    input.dispatchEvent(new Event('change', { bubbles: true }))

    const group = await vi.waitFor(
      () => {
        const found = byTestId('import-map-sheets')
        expect(found).not.toBeNull()
        return found!
      },
      { timeout: 8_000 }
    )
    expect(group.getAttribute('role')).toBe('group')
    expect(document.getElementById(group.getAttribute('aria-labelledby') ?? '')?.textContent).toBe(
      'Sheet'
    )
    expect(group.textContent).toContain(
      'This workbook has 2 sheets. Choose another to match its columns instead.'
    )
    expect(byTestId('import-map-source')?.textContent).toBe('From example-ledger.xlsx, sheet March')
    const pressed = () =>
      [...group.querySelectorAll('button')].map((b) => [
        b.textContent,
        b.getAttribute('aria-pressed'),
      ])
    expect(pressed()).toEqual([
      ['March', 'true'],
      ['April', 'false'],
    ])

    host.querySelectorAll<HTMLButtonElement>('[data-test-id="import-map-sheets"] button')[1].click()
    await vi.waitFor(
      () => {
        expect(byTestId('import-map-source')?.textContent).toBe(
          'From example-ledger.xlsx, sheet April'
        )
      },
      { timeout: 8_000 }
    )
    expect(
      [...byTestId('import-map-sheets')!.querySelectorAll('button')].map((b) => [
        b.textContent,
        b.getAttribute('aria-pressed'),
      ])
    ).toEqual([
      ['March', 'false'],
      ['April', 'true'],
    ])
  }, 20_000)
})
