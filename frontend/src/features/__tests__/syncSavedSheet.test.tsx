/**
 * A sheet saved from the card an import leaves, then synced from Connected sources: what the
 * next Sync books, and what the page says about it. Run against the real local-first router on
 * fake-indexeddb, with only Google's side stubbed.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { setCurrentProfile, setPage, setProfiles } from '../../core/appStore'
import { __resetDataVersionsForTest } from '../../core/dataVersions'
import { getDB } from '../../core/storage/idb'
import { removeToast, toasts } from '../../core/toastStore'

const LINK = 'https://docs.google.com/spreadsheets/d/example-ledger/edit#gid=0'

/** Unsigned amounts: the category says which way the money went. */
const FIRST =
  'Date,Description,Amount,Category\n' +
  '2026-08-01,Example coffee,5.00,Coffee\n' +
  '2026-08-02,Example pay,1000.00,Salary\n'
/** The same sheet a day later, with a row in a category the first import never saw. */
const LATER = `${FIRST  }2026-08-03,Example pills,12.00,Pharmacy\n`

let sheet = FIRST

/** Google, as local-first's sheet reader meets it: the published CSV of the ledger. */
async function google(input: RequestInfo | URL): Promise<Response> {
  const url = String(input instanceof Request ? input.url : input)
  if (url.includes('/d/example-ledger/') && !url.includes('/gviz/')) {
    return new Response(sheet, { status: 200 })
  }
  return new Response('<!DOCTYPE html><title>Sign in</title>', { status: 401 })
}

let host: HTMLDivElement
let dispose: (() => void) | undefined

beforeAll(async () => {
  await Promise.all([import('../Import'), import('../../core/storage/localApiRouter')])
}, 120_000)

beforeEach(async () => {
  sheet = FIRST
  localStorage.clear()
  localStorage.setItem('finance_storage_mode', 'serverless')
  localStorage.setItem('currentProfileId', '1')
  localStorage.setItem('selectedProfileIds', '[1]')
  localStorage.setItem('localCurrency', 'EUR')
  __resetDataVersionsForTest()
  const db = await getDB()
  for (const store of Array.from(db.objectStoreNames)) await db.clear(store)
  await db.add('profiles', { id: 1, name: 'Personal', created_at: '2026-01-01T00:00:00.000Z' })
  await db.add('accounts', {
    name: 'Example Checking',
    type: 'giro',
    currency: 'EUR',
    balance: 100,
    starting_balance: 100,
    profile_id: 1,
  })
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

/** Read the ledger from its link, and import all of it as its columns were matched. */
async function importTheSheet(expected: string): Promise<void> {
  byTestId('import-tab-google-sheets')!.click()
  await vi.waitFor(() => {
    expect(byTestId('import-sheet-url')).not.toBeNull()
  })
  type(byTestId('import-sheet-url') as HTMLInputElement, LINK)
  byTestId('import-sheet-fetch')!.click()
  await vi.waitFor(() => { expect(byTestId('import-continue-preview')).not.toBeNull(); }, {
    timeout: 8_000,
  })
  byTestId('import-continue-preview')!.click()
  await vi.waitFor(() => { expect(byTestId('import-execute-all')).not.toBeNull(); }, {
    timeout: 8_000,
  })
  byTestId('import-execute-all')!.click()
  await vi.waitFor(() => { expect(byTestId('import-result')?.textContent).toContain(expected); }, {
    timeout: 8_000,
  })
}

/** Save the sheet the import read, from the card, under a name. */
async function saveTheSheet(name: string): Promise<void> {
  const save = await vi.waitFor(() => {
    const found = byTestId('import-after-save-sheet')
    expect(found).not.toBeNull()
    return found!
  })
  type(byTestId('import-after-sheet-name') as HTMLInputElement, name)
  save.click()
  await vi.waitFor(() => { expect(byTestId('import-after-saved')).not.toBeNull(); })
}

/** The Sync button of a saved source, once Connected sources lists it. */
async function syncButton(name: string): Promise<HTMLElement> {
  return vi.waitFor(
    () => {
      const found = host.querySelector<HTMLElement>(`[aria-label="Auto sync ${name}"]`)
      expect(found).not.toBeNull()
      return found!
    },
    { timeout: 6_000 }
  )
}

/** Every transaction as [description, type, category name]. */
async function booked(): Promise<Array<[string, string, string | null]>> {
  const db = await getDB()
  const names = new Map(
    ((await db.getAll('categories')) as Array<{ id: number; name: string }>).map((c) => [
      c.id,
      c.name,
    ])
  )
  return (
    (await db.getAll('transactions')) as Array<{
      description: string
      type: string
      category_id: number
    }>
  ).map((t) => [t.description, t.type, names.get(t.category_id) ?? null])
}

describe('Sync of a sheet saved after an import', () => {
  /*
   * The saved sheet keeps the types the import used (Coffee an expense, Salary income). A row
   * added later in a category those types never named had no type at all, so its unsigned
   * amount made it income: 12.00 at the pharmacy, booked as money in.
   */
  it('books a row in a new category as a fresh import of the sheet would', async () => {
    await mountImport()
    await importTheSheet('Imported 2 transactions')
    await saveTheSheet('Example ledger')
    const sync = await syncButton('Example ledger')

    sheet = LATER
    sync.click()
    await vi.waitFor(async () => { expect(await booked()).toHaveLength(3); }, { timeout: 10_000 })

    expect(await booked()).toEqual([
      ['Example coffee', 'expense', 'Coffee'],
      ['Example pay', 'income', 'Salary'],
      ['Example pills', 'expense', 'Pharmacy'],
    ])
  }, 40_000)
})
