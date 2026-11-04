/**
 * A statement the setup wizard could not import by itself opens on the Import page
 * (import/importHandoff.ts): a table of any other kind on File Upload, read and on to matching its
 * columns, and a bank the app knows on Bank Imports. Run against the real local-first router on
 * fake-indexeddb.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { setCurrentProfile, setPage, setProfiles } from '../../core/appStore'
import { __resetDataVersionsForTest } from '../../core/dataVersions'
import { getDB } from '../../core/storage/idb'
import { handedImportFile, handFileToImport, takeHandedImportFile } from '../import/importHandoff'

const UNKNOWN_TABLE = 'When,What,How much\n2026-06-01,Groceries,-10.00\n2026-06-02,Bus,-2.50\n'
const REVOLUT =
  'Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance\n' +
  'CARD_PAYMENT,Current,2026-06-14 10:00:00,2026-06-14 10:00:00,Netflix,-13.99,0,EUR,COMPLETED,972.02\n'

let host: HTMLDivElement
let dispose: (() => void) | undefined

beforeAll(async () => {
  await Promise.all([import('../Import'), import('../../core/storage/localApiRouter')])
}, 120_000)

beforeEach(async () => {
  localStorage.clear()
  localStorage.setItem('finance_storage_mode', 'serverless')
  localStorage.setItem('currentProfileId', '1')
  localStorage.setItem('localCurrency', 'EUR')
  __resetDataVersionsForTest()
  const db = await getDB()
  for (const store of Array.from(db.objectStoreNames)) await db.clear(store)
  await db.add('profiles', { id: 1, name: 'Personal', created_at: '2026-01-01T00:00:00.000Z' })
  setProfiles([{ id: 1, name: 'Personal' }] as never)
  setCurrentProfile({ id: 1, name: 'Personal' } as never)
  takeHandedImportFile()
  host = document.createElement('div')
  document.body.appendChild(host)
})

afterEach(() => {
  dispose?.()
  dispose = undefined
  host.remove()
  takeHandedImportFile()
  setCurrentProfile(null)
  setPage('dashboard')
})

const byTestId = (id: string): HTMLElement | null =>
  host.querySelector<HTMLElement>(`[data-test-id="${id}"]`)

async function mountImport(): Promise<void> {
  const { default: Import } = await import('../Import')
  dispose = render(() => <Import />, host)
}

it('reads a table of any other kind on File Upload, on to matching its columns', async () => {
  handFileToImport(new File([UNKNOWN_TABLE], 'export.csv', { type: 'text/csv' }), 'file-upload')
  setPage('import')
  await mountImport()

  await vi.waitFor(() => {
    expect(byTestId('import-continue-preview')).not.toBeNull()
  })
  // The file's own columns, offered to match.
  for (const column of ['When', 'What', 'How much']) expect(host.textContent).toContain(column)
  // Taken once: a later visit to the page does not read it again.
  expect(handedImportFile()).toBeNull()
})

it('lists a bank statement on Bank Imports, whose rows only that tab shows', async () => {
  handFileToImport(new File([REVOLUT], 'revolut.csv', { type: 'text/csv' }), 'bank-imports')
  setPage('import')
  await mountImport()

  await vi.waitFor(() => {
    expect(byTestId('bank-file-row')?.textContent).toContain('revolut.csv')
  })
  expect(handedImportFile()).toBeNull()
})

it('waits for the page to show before it takes the file', async () => {
  setPage('dashboard')
  await mountImport()
  const file = new File([UNKNOWN_TABLE], 'export.csv', { type: 'text/csv' })
  handFileToImport(file, 'file-upload')
  await new Promise((resolve) => setTimeout(resolve, 50))
  expect(handedImportFile()).toEqual({ file, tab: 'file-upload', typed: [] })

  setPage('import')

  await vi.waitFor(() => {
    expect(byTestId('import-continue-preview')).not.toBeNull()
  })
  expect(handedImportFile()).toBeNull()
})

// Review M2, round 3: setup forgot its "Balance today" figures as it finished, before the file it
// handed over was imported here, so that import added up on top of the typed balance.
it("works the handed file's import back from the balance typed in setup", async () => {
  const db = await getDB()
  const id = (await db.add('accounts', {
    name: 'Main checking',
    type: 'giro',
    currency: 'EUR',
    balance: 1240.5,
    starting_balance: 1240.5,
    profile_id: 1,
  })) as number
  const statement =
    'Date,Description,Amount,Means of Payment\n' +
    '2026-06-01,Groceries,-10.00,Main checking\n' +
    '2026-06-02,Bus,-2.50,Main checking\n'
  handFileToImport(new File([statement], 'export.csv', { type: 'text/csv' }), 'file-upload', [
    { id, figure: 1240.5, asOf: '2026-07-01' },
  ])
  setPage('import')
  await mountImport()

  await vi.waitFor(() => {
    expect(byTestId('import-continue-preview')).not.toBeNull()
  })
  byTestId('import-continue-preview')!.click()
  await vi.waitFor(() => {
    expect(byTestId('import-execute-all')).not.toBeNull()
  })
  byTestId('import-execute-all')!.click()

  // Both entries are dated before the day the figure was typed: the account still reads it.
  await vi.waitFor(
    async () => {
      const account = (await db.get('accounts', id)) as {
        balance: number
        starting_balance: number
      }
      expect(account.balance).toBeCloseTo(1240.5, 6)
      expect(account.starting_balance).toBeCloseTo(1253, 6)
    },
    { timeout: 8_000 }
  )
}, 20_000)
