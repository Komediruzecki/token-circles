/**
 * A sheet saved from the card an import leaves, then synced from Connected sources: what the
 * next Sync books, and what the page says about it (review of 19 Nov, findings 1, 7 and 9). Run
 * against the real local-first router on fake-indexeddb, with only Google's side stubbed.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { bumpProfileVersion, setCurrentProfile, setPage, setProfiles } from '../../core/appStore'
import { acceptConfirm, confirmRequests } from '../../core/confirmStore'
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
const LATER = `${FIRST}2026-08-03,Example pills,12.00,Pharmacy\n`

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

/**
 * Read the ledger from its link and import it as its columns were matched: all of it, or with
 * its first `leaveOut` rows unticked.
 */
async function importTheSheet(expected: string, leaveOut = 0): Promise<void> {
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
  if (leaveOut > 0) {
    const rows = [...host.querySelectorAll<HTMLInputElement>('tbody input[type="checkbox"]')]
    for (const row of rows.slice(0, leaveOut)) row.click()
    byTestId('import-execute-selected')!.click()
  } else {
    byTestId('import-execute-all')!.click()
  }
  await vi.waitFor(
    () => {
      expect(byTestId('import-result')?.textContent).toContain(expected)
    },
    { timeout: 8_000 }
  )
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
  await vi.waitFor(() => {
    expect(byTestId('import-after-saved')).not.toBeNull()
  })
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
    await vi.waitFor(
      async () => {
        expect(await booked()).toHaveLength(3)
      },
      { timeout: 10_000 }
    )

    expect(await booked()).toEqual([
      ['Example coffee', 'expense', 'Coffee'],
      ['Example pay', 'income', 'Salary'],
      ['Example pills', 'expense', 'Pharmacy'],
    ])
  }, 40_000)
})

describe('the card after an import', () => {
  // The card said "Imported 2 transactions" after a Sync whose toast said "1 imported, 2 skipped".
  it("says what a Sync did, once the Sync's import is in", async () => {
    await mountImport()
    await importTheSheet('Imported 2 transactions')
    await saveTheSheet('Example ledger')
    const sync = await syncButton('Example ledger')

    sheet = LATER
    sync.click()
    await vi.waitFor(
      () => {
        expect(byTestId('import-result')?.textContent).toBe(
          'Imported 1 transaction (2 already imported, skipped)'
        )
      },
      { timeout: 10_000 }
    )
  }, 40_000)

  it('goes when its import is deleted in Recent Imports', async () => {
    await mountImport()
    await importTheSheet('Imported 2 transactions')
    const remove = await vi.waitFor(
      () => {
        const found = [...host.querySelectorAll('button')].find(
          (b) => b.textContent === 'Delete import'
        )
        expect(found).toBeDefined()
        return found!
      },
      { timeout: 8_000 }
    )

    remove.click()
    const asked = await vi.waitFor(() => {
      expect(confirmRequests()).toHaveLength(1)
      return confirmRequests()[0]
    })
    await acceptConfirm(asked.id)

    await vi.waitFor(() => {
      expect(byTestId('import-after')).toBeNull()
    })
  }, 40_000)

  it('stays through a quick-add, with its Save sheet offer', async () => {
    await mountImport()
    await importTheSheet('Imported 2 transactions')
    await vi.waitFor(() => {
      expect(byTestId('import-after-save-sheet')).not.toBeNull()
    })

    // What the floating add button's save does (App.tsx), as far as this page can tell.
    bumpProfileVersion()
    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(byTestId('import-after')).not.toBeNull()
    expect(byTestId('import-after-save-sheet')).not.toBeNull()
  }, 40_000)
  it('reads its balances again after a quick-add', async () => {
    sheet =
      'Date,Description,Amount,Category,Means of Payment\n' +
      '2026-08-01,Example coffee,-5.00,Coffee,Example Checking\n'
    await mountImport()
    await importTheSheet('Imported 1 transaction')
    await vi.waitFor(
      () => {
        expect(byTestId('import-balance-today')?.textContent).toContain('95')
      },
      { timeout: 8_000 }
    )

    // The quick-add's entry, as the account holds it after: 10.00 more out.
    const db = await getDB()
    const accounts = (await db.getAll('accounts')) as Array<{ name: string; balance: number }>
    const checking = accounts.find((a) => a.name === 'Example Checking')!
    await db.put('accounts', { ...checking, balance: checking.balance - 10 })
    bumpProfileVersion()

    await vi.waitFor(
      () => {
        expect(byTestId('import-balance-today')?.textContent).toContain('85')
      },
      { timeout: 8_000 }
    )
    expect(byTestId('import-after')).not.toBeNull()
  }, 40_000)
})

describe("the card's Save sheet offer", () => {
  it('says Sync brings in every row not in Token Circles yet', async () => {
    await mountImport()
    await importTheSheet('Imported 2 transactions')

    const row = await vi.waitFor(() => {
      const found = byTestId('import-after-sheet')
      expect(found).not.toBeNull()
      return found!
    })
    expect(row.textContent).toContain(
      "Keep it in Connected sources. Sync brings in every row of the sheet that isn't in Token Circles yet."
    )
    expect(row.textContent).not.toContain('left out')
  }, 40_000)

  it('counts the rows this import left out, which the first Sync brings in', async () => {
    await mountImport()
    await importTheSheet('Imported 1 transaction', 1)

    const row = await vi.waitFor(() => {
      const found = byTestId('import-after-sheet')
      expect(found).not.toBeNull()
      return found!
    })
    expect(row.textContent).toContain('That includes the one row this import left out.')
  }, 40_000)

  it('counts a copy Import only new left out, as the first Sync brings it in', async () => {
    // Two coffees on one day, written the same: the import dedupes one for one, so Sync books
    // the second.
    sheet =
      'Date,Description,Amount,Category\n' +
      '2026-08-01,Example coffee,-5.00,Coffee\n' +
      '2026-08-01,Example coffee,-5.00,Coffee\n' +
      '2026-08-02,Example pay,1000.00,Salary\n'
    await mountImport()
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
    const onlyNew = await vi.waitFor(
      () => {
        const found = byTestId('import-execute-new')
        expect(found).not.toBeNull()
        return found!
      },
      { timeout: 8_000 }
    )
    onlyNew.click()
    await vi.waitFor(
      () => {
        expect(byTestId('import-result')?.textContent).toContain('Imported 2 transactions')
      },
      { timeout: 8_000 }
    )
    const row = await vi.waitFor(() => {
      const found = byTestId('import-after-sheet')
      expect(found).not.toBeNull()
      return found!
    })
    expect(row.textContent).toContain('That includes the one row this import left out.')

    // Saved, its first Sync brings in that one row and nothing else.
    await saveTheSheet('Example ledger')
    ;(await syncButton('Example ledger')).click()
    await vi.waitFor(
      () => {
        expect(byTestId('import-result')?.textContent).toBe(
          'Imported 1 transaction (2 already imported, skipped)'
        )
      },
      { timeout: 8_000 }
    )
    expect((await booked()).map(([description]) => description).sort()).toEqual([
      'Example coffee',
      'Example coffee',
      'Example pay',
    ])
  }, 40_000)
})
