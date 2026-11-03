/**
 * Map columns names the file its columns are from (3 Nov test run): setup's Open in Import landed
 * there with the file setup could not read, and nothing on the page said which file that was. The
 * page's own flow, through the real local-first router on fake-indexeddb, then the step as drawn.
 */
import { createRoot } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { __resetDataVersionsForTest } from '../../../core/dataVersions'
import { getDB } from '../../../core/storage/idb'
import { ImportMappingStep, mappingSource } from '../ImportMappingStep'
import type { ImportFlow } from '../importFlow'

let flow: ImportFlow
let dispose: () => void
let host: HTMLDivElement | undefined
let unmount: (() => void) | undefined

beforeAll(async () => {
  await Promise.all([import('../importFlow'), import('../../../core/storage/localApiRouter')])
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
  await db.put('settings', { key: 'currency', value: 'EUR' })
  const { createImportFlow } = await import('../importFlow')
  createRoot((done) => {
    dispose = done
    flow = createImportFlow({ initialTab: 'file-upload', autoResetAfterImport: false })
  })
})

afterEach(() => {
  unmount?.()
  unmount = undefined
  host?.remove()
  host = undefined
  dispose()
})

async function settled(): Promise<void> {
  for (let i = 0; i < 400; i++) {
    await new Promise((resolve) => setTimeout(resolve, 5))
    if (!flow.loading()) return
  }
  throw new Error('timed out waiting for the upload')
}

/** The step as the Import page draws it, and the line that names the file, if any. */
function sourceLine(): string | null {
  host = document.createElement('div')
  document.body.appendChild(host)
  unmount = render(() => <ImportMappingStep flow={flow} />, host)
  return host.querySelector('[data-test-id="import-map-source"]')?.textContent ?? null
}

describe('Map columns', () => {
  it('names a file handed over as setup hands it, read with readFile', async () => {
    await flow.readFile(
      new File(['When,What,How much\n2026-06-01,Groceries,-10.00\n'], 'october-statement.csv', {
        type: 'text/csv',
      })
    )
    await settled()
    expect(flow.activeStep()).toBe('mapping')
    expect(sourceLine()).toBe('From october-statement.csv')
  })

  it('names the sheet of a workbook with more than one', async () => {
    const book = XLSX.utils.book_new()
    for (const name of ['March', 'April']) {
      XLSX.utils.book_append_sheet(
        book,
        XLSX.utils.aoa_to_sheet([
          ['Date', 'Description', 'Amount'],
          ['2026-03-01', 'Rent', -900],
        ]),
        name
      )
    }
    const bytes = new Uint8Array(
      XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
    )
    await flow.readFile(new File([bytes], 'budget.xlsx'))
    await settled()
    flow.chooseUploadedSheet('April')
    await settled()
    expect(sourceLine()).toBe('From budget.xlsx, sheet April')
  })

  it('names nothing for pasted text, which is no file', () => {
    expect(
      mappingSource({ filename: 'pasted-data.csv', sheetName: 'Pasted', sheetNames: ['Pasted'] })
    ).toBeNull()
    expect(mappingSource(null)).toBeNull()
    expect(
      mappingSource({
        filename: '3 statements',
        sheetName: 'Bank Import',
        sheetNames: ['Bank Import'],
      })
    ).toBe('3 statements')
  })
})
