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
  expect(handedImportFile()).toEqual({ file, tab: 'file-upload' })

  setPage('import')

  await vi.waitFor(() => {
    expect(byTestId('import-continue-preview')).not.toBeNull()
  })
  expect(handedImportFile()).toBeNull()
})
