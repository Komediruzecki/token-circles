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
import type * as ApiFetchModule from '../../core/apiFetch'

/** Set to answer an import with a server error, as a failed one is answered. */
const executeFails = vi.hoisted(() => ({ on: false }))

vi.mock('../../core/apiFetch', async (importOriginal) => {
  const real = await importOriginal<typeof ApiFetchModule>()
  return {
    ...real,
    apiFetch: (url: string, init?: RequestInit) =>
      executeFails.on && url === '/api/import/execute'
        ? Promise.resolve(new Response('{"error":"Example import failure"}', { status: 500 }))
        : real.apiFetch(url, init),
  }
})

const LINK = 'https://docs.google.com/spreadsheets/d/example-ledger/edit#gid=0'
const ACCOUNTS = ['Example Checking', 'Example Savings', 'Example Card']
const CSV =
  'Date,Description,Amount,Means of Payment\n' +
  '2026-08-01,Example coffee,-5.00,Example Checking\n' +
  '2026-08-02,Example lunch,-12.40,Example Savings\n' +
  '2026-08-03,Example books,-20.00,Example Card\n'

/** A second sheet, kept in Connected sources. */
const OTHER_LINK = 'https://docs.google.com/spreadsheets/d/example-other/edit#gid=0'
const OTHER_CSV =
  'Date,Description,Amount,Means of Payment\n' +
  '2026-08-04,Example tea,-3.10,Example Checking\n' +
  '2026-08-05,Example cinema,-9.00,Example Checking\n'

/** Google, as local-first's sheet reader meets it: the published CSV of each sheet. */
async function google(input: RequestInfo | URL): Promise<Response> {
  const url = String(input instanceof Request ? input.url : input)
  if (url.includes('/d/example-ledger/') && !url.includes('/gviz/')) {
    return new Response(CSV, { status: 200 })
  }
  if (url.includes('/d/example-other/') && !url.includes('/gviz/')) {
    return new Response(OTHER_CSV, { status: 200 })
  }
  return new Response('<!DOCTYPE html><title>Sign in</title>', { status: 401 })
}

let host: HTMLDivElement
let dispose: (() => void) | undefined

beforeAll(async () => {
  await Promise.all([import('../Import'), import('../../core/storage/localApiRouter')])
}, 120_000)

beforeEach(async () => {
  executeFails.on = false
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

/** Hands `files` to the file input inside the element with test id `scope`, as a pick does. */
function pick(scopeInput: HTMLInputElement, files: File[]): void {
  Object.defineProperty(scopeInput, 'files', { value: files, configurable: true })
  scopeInput.dispatchEvent(new Event('change', { bubbles: true }))
}

const follows = (a: Node, b: Node): boolean =>
  (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0

describe('the card an import leaves', () => {
  it('heads the page with the result, one row a next step, and keeps a long list shut', async () => {
    await mountImport()
    await importTheSheet()

    const card = byTestId('import-after')!
    expect(card.querySelector('[data-test-id="import-result"]')?.textContent).toBe(
      'Imported 3 transactions'
    )
    expect(byTestId('import-balances')).toBeNull()

    // Three accounts changed: one line saying so, the list behind Show balances.
    const toggle = await vi.waitFor(() => {
      const found = byTestId('import-after-balances-toggle')
      expect(found).not.toBeNull()
      return found!
    })
    expect(byTestId('import-after-balances')?.textContent).toContain('3 accounts changed.')
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(toggle.textContent).toBe('Show balances')
    expect(host.querySelectorAll('[data-test-id="import-balance-row"]')).toHaveLength(0)
    toggle.click()
    await vi.waitFor(() => {
      expect(host.querySelectorAll('[data-test-id="import-balance-row"]')).toHaveLength(3)
    })
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(document.getElementById(toggle.getAttribute('aria-controls') ?? '')).not.toBeNull()

    // The scan, offered in a line with no dash in it.
    const scan = byTestId('import-scan-offer')!
    expect(scan.textContent).toContain(
      "Find the subscriptions and other regular payments in what you've imported."
    )
    expect(scan.textContent).not.toMatch(/[–—]/)
    expect(card.contains(scan)).toBe(true)

    // Once the flow starts over, the import methods come straight after the card.
    await afterTheReset()
    expect(byTestId('import-after')).toBe(card)
    expect(follows(card, byTestId('import-tab-google-sheets')!)).toBe(true)

    byTestId('import-after-dismiss')!.click()
    expect(byTestId('import-after')).toBeNull()
  }, 30_000)

  it('stays as it was when a Sync fails, an unsaved Save sheet offer included, and a Sync that lands takes it', async () => {
    const db = await getDB()
    await db.add('import_sources', {
      profile_id: 1,
      kind: 'google_sheet',
      label: 'Other ledger',
      config: { url: OTHER_LINK, sheetName: '' },
      mapping: {
        date: 'Date',
        description: 'Description',
        amount: 'Amount',
        means_of_payment: 'Means of Payment',
      },
      category_types: null,
      default_account_id: null,
      schedule: 'manual',
      last_synced_at: null,
      last_cursor: null,
      created_at: '2026-11-01T00:00:00.000Z',
      updated_at: '2026-11-01T00:00:00.000Z',
    })
    await mountImport()
    await importTheSheet()
    const name = await vi.waitFor(() => {
      const found = byTestId('import-after-sheet-name')
      expect(found).not.toBeNull()
      return found as HTMLInputElement
    })
    type(name, 'Example ledger')
    const card = byTestId('import-after')!
    const said = card.textContent
    await afterTheReset()
    // The other sheet's Sync, once it can be pressed: its row is drawn again after each one.
    const sync = async () => {
      const button = await vi.waitFor(() => {
        const found = host.querySelector<HTMLButtonElement>('[aria-label="Auto sync Other ledger"]')
        expect(found?.disabled).toBe(false)
        return found!
      })
      button.click()
    }

    // The other sheet's Sync fails: the card is the one it was, the name typed in it included.
    executeFails.on = true
    await sync()
    await vi.waitFor(
      () => {
        expect(byTestId('source-error')?.textContent).toContain('Example import failure')
      },
      { timeout: 8_000 }
    )
    expect(byTestId('import-after')).toBe(card)
    expect(card.textContent).toBe(said)
    expect(byTestId('import-after-save-sheet')).not.toBeNull()
    expect((byTestId('import-after-sheet-name') as HTMLInputElement).value).toBe('Example ledger')

    // One that lands takes the card, with its own result and its own balances.
    executeFails.on = false
    await sync()
    await vi.waitFor(
      () => {
        expect(byTestId('import-result')?.textContent).toBe('Imported 2 transactions')
      },
      { timeout: 8_000 }
    )
    expect(byTestId('import-after-save-sheet')).toBeNull()
    await vi.waitFor(() => {
      expect(byTestId('import-after-balances')?.textContent).toContain('1 account changed.')
    })

    // And one that brings nothing new: no balances from the import before it.
    await sync()
    await vi.waitFor(
      () => {
        expect(byTestId('import-result')?.textContent).toContain('No new transactions')
      },
      { timeout: 8_000 }
    )
    expect(byTestId('import-after-balances')).toBeNull()
  }, 30_000)

  it('says plainly when nothing was new, with nothing to do next', async () => {
    await mountImport()
    await importTheSheet()
    await afterTheReset()
    byTestId('import-tab-google-sheets')!.click()
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
        expect(byTestId('import-result')?.textContent).toBe(
          'No new transactions. All 3 rows were imported before, so they were skipped.'
        )
      },
      { timeout: 8_000 }
    )
    expect(byTestId('import-scan-offer')).toBeNull()
    expect(byTestId('import-after-balances')).toBeNull()
  }, 30_000)
})

describe("the flow's errors", () => {
  it('are said under the button that raised them, and go with their tab', async () => {
    await mountImport()
    byTestId('import-tab-bank-imports')!.click()
    const input = await vi.waitFor(() => {
      const found = byTestId('bank-file-input') as HTMLInputElement | null
      expect(found).not.toBeNull()
      return found!
    })
    pick(input, [
      new File(['Colour,Shape\nred,round\n'], 'example-notes.csv', { type: 'text/csv' }),
    ])
    await vi.waitFor(
      () => {
        expect(byTestId('bank-process-btn')).not.toBeNull()
      },
      { timeout: 8_000 }
    )
    byTestId('bank-process-btn')!.click()

    const error = await vi.waitFor(
      () => {
        const found = byTestId('import-error')
        expect(found).not.toBeNull()
        return found!
      },
      { timeout: 8_000 }
    )
    expect(error.textContent).toBe(
      'None of the files were recognized as a supported bank statement'
    )
    expect(error.getAttribute('role')).toBe('alert')
    // Under Process & continue, not over the import methods at the top of the page.
    expect(follows(byTestId('import-tab-bank-imports')!, error)).toBe(true)
    expect(follows(byTestId('bank-process-btn')!, error)).toBe(true)
    expect(byTestId('bank-process-btn')!.nextElementSibling).toBe(error)

    // Another method's form is not where a bank file's error belongs.
    byTestId('import-tab-google-sheets')!.click()
    await vi.waitFor(() => {
      expect(byTestId('import-sheet-url')).not.toBeNull()
    })
    expect(byTestId('import-error')).toBeNull()
  }, 30_000)

  it("say a sheet with nothing in it on Map columns, under the workbook's sheets", async () => {
    await mountImport()
    byTestId('import-tab-file-upload')!.click()
    const book = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(
      book,
      XLSX.utils.aoa_to_sheet([
        ['Date', 'Description', 'Amount'],
        ['2026-03-02', 'Example rent', -700],
      ]),
      'March'
    )
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([]), 'Notes')
    const bytes = new Uint8Array(
      XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
    )
    const input = await vi.waitFor(() => {
      const found = byTestId('import-file-input') as HTMLInputElement | null
      expect(found).not.toBeNull()
      return found!
    })
    pick(input, [new File([bytes], 'example-book.xlsx')])
    const sheets = await vi.waitFor(
      () => {
        const found = byTestId('import-map-sheets')
        expect(found).not.toBeNull()
        return found!
      },
      { timeout: 8_000 }
    )
    sheets.querySelectorAll('button')[1].click()

    const error = await vi.waitFor(
      () => {
        const found = byTestId('import-error')
        expect(found).not.toBeNull()
        return found!
      },
      { timeout: 8_000 }
    )
    expect(error.textContent).toBe('That sheet has no rows to import. Choose another sheet.')
    expect(byTestId('import-map-sheets')!.nextElementSibling).toBe(error)
  }, 30_000)
})

describe('the sheet an import read', () => {
  it('is offered to Connected sources, and saved with its columns as matched', async () => {
    await mountImport()
    await importTheSheet()

    const save = await vi.waitFor(() => {
      const found = byTestId('import-after-save-sheet')
      expect(found).not.toBeNull()
      return found!
    })
    expect(byTestId('import-after-sheet')?.textContent).toContain(
      "Keep it in Connected sources. Sync brings in every row of the sheet that isn't in Token Circles yet."
    )
    type(byTestId('import-after-sheet-name') as HTMLInputElement, 'Example ledger')
    save.click()

    await vi.waitFor(() => {
      expect(byTestId('import-after-saved')?.textContent).toBe(
        `"Example ledger" is in Connected sources below. Sync brings in every row of the sheet that isn't in Token Circles yet.`
      )
    })
    expect(byTestId('import-after-save-sheet')).toBeNull()
    const db = await getDB()
    const sources = (await db.getAll('import_sources')) as Record<string, unknown>[]
    expect(sources).toHaveLength(1)
    expect(sources[0]).toMatchObject({
      kind: 'google_sheet',
      label: 'Example ledger',
      config: { url: LINK },
      schedule: 'manual',
      profile_id: 1,
      mapping: {
        date: 'Date',
        description: 'Description',
        amount: 'Amount',
        means_of_payment: 'Means of Payment',
      },
    })
    expect(typeof sources[0].last_synced_at).toBe('string')

    // Connected sources lists it once the flow starts over, with its Sync.
    await afterTheReset()
    await vi.waitFor(() => {
      expect(host.querySelector('[aria-label="Auto sync Example ledger"]')).not.toBeNull()
    })
  }, 30_000)

  it('says where a sheet saved before is, with nothing to save', async () => {
    const db = await getDB()
    await db.add('import_sources', {
      profile_id: 1,
      kind: 'google_sheet',
      label: 'Example saved sheet',
      config: { url: 'https://docs.google.com/spreadsheets/d/example-ledger/edit', sheetName: '' },
      mapping: null,
      category_types: null,
      default_account_id: null,
      schedule: 'manual',
      last_synced_at: null,
      last_cursor: null,
      created_at: '2026-11-01T00:00:00.000Z',
      updated_at: '2026-11-01T00:00:00.000Z',
    })
    await mountImport()
    await importTheSheet()

    await vi.waitFor(() => {
      expect(byTestId('import-after-saved')?.textContent).toBe(
        `"Example saved sheet" is in Connected sources below. Sync brings in every row of the sheet that isn't in Token Circles yet.`
      )
    })
    expect(byTestId('import-after-save-sheet')).toBeNull()
    expect(await db.count('import_sources')).toBe(1)
  }, 30_000)

  it('counts a sheet saved with no name as saved, and offers no second copy', async () => {
    const db = await getDB()
    await db.add('import_sources', {
      profile_id: 1,
      kind: 'google_sheet',
      label: '',
      config: { url: LINK, sheetName: '' },
      schedule: 'manual',
      created_at: '2026-11-01T00:00:00.000Z',
      updated_at: '2026-11-01T00:00:00.000Z',
    })
    await mountImport()
    await importTheSheet()

    await vi.waitFor(() => {
      expect(byTestId('import-after-saved')?.textContent).toBe(
        `"Google Sheet" is in Connected sources below. Sync brings in every row of the sheet that isn't in Token Circles yet.`
      )
    })
    expect(byTestId('import-after-save-sheet')).toBeNull()
  }, 30_000)

  it('has no row after an import from a file', async () => {
    await mountImport()
    byTestId('import-tab-file-upload')!.click()
    const input = await vi.waitFor(() => {
      const found = byTestId('import-file-input') as HTMLInputElement | null
      expect(found).not.toBeNull()
      return found!
    })
    pick(input, [new File([CSV], 'example-ledger.csv', { type: 'text/csv' })])
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
        expect(byTestId('import-result')?.textContent).toBe('Imported 3 transactions')
      },
      { timeout: 8_000 }
    )
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(byTestId('import-after-sheet')).toBeNull()
  }, 30_000)
})

describe('sourceForSheet', () => {
  const saved = (url: string) =>
    ({
      id: 7,
      profile_id: 1,
      kind: 'google_sheet',
      label: 'Example',
      config: { url },
      schedule: 'manual',
    }) as const

  it('matches the same spreadsheet and tab, a link with no gid being the first tab', async () => {
    const { sourceForSheet } = await import('../import/keepSheet')
    const at = (url: string) => sourceForSheet([saved(url)], LINK)?.label ?? null
    expect(at('https://docs.google.com/spreadsheets/d/example-ledger/edit#gid=0')).toBe('Example')
    expect(at('https://docs.google.com/spreadsheets/d/example-ledger/edit')).toBe('Example')
    expect(at('https://docs.google.com/spreadsheets/d/example-ledger/edit#gid=123')).toBeNull()
    expect(at('https://docs.google.com/spreadsheets/d/another-ledger/edit#gid=0')).toBeNull()
  })
})
