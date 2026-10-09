/**
 * A file uploaded on the Import page, through the real local-first router on fake-indexeddb: the
 * page's own flow (createImportFlow), from the upload to the import.
 *
 * In local-first the upload stopped at the upload step: the page read `sheetNames[0]`, and the
 * router answered an upload session without sheets ("Cannot read properties of undefined (reading
 * '0')"). In both modes the page then jumped to the mapping step without detecting the columns, as
 * a pasted CSV and a Google Sheet do; choosing another sheet of a workbook marked its tab and left
 * the first sheet's rows in place; and a workbook's numbers reached the preview as numbers, whose
 * duplicate check called trim() on them and stopped. Now an upload detects the columns, a sheet
 * change uploads the file again with that sheet named, and every cell is text
 * (shared/importUpload.ts).
 */
import { createRoot } from 'solid-js'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { IMPORT_UPLOAD_MESSAGES as M } from '../../../../../shared/importUpload'
import { __resetDataVersionsForTest } from '../../../core/dataVersions'
import { getDB } from '../../../core/storage/idb'
import type { ImportFlow } from '../importFlow'
import type { UploadForm } from '../uploadForm'

let flow: ImportFlow
let form: UploadForm
let dispose: () => void

beforeAll(async () => {
  await Promise.all([
    import('../importFlow'),
    import('../uploadForm'),
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
  await db.put('settings', { key: 'currency', value: 'EUR' })
  const { createImportFlow } = await import('../importFlow')
  const { createUploadForm } = await import('../uploadForm')
  createRoot((done) => {
    dispose = done
    flow = createImportFlow({ initialTab: 'file-upload', autoResetAfterImport: false })
    form = createUploadForm(flow)
  })
})

afterEach(() => {
  dispose()
})

function choose(file: File): void {
  flow.handleFileSelect({ target: { files: [file] } } as unknown as Event)
}

async function settled(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await waitUntil(() => !flow.loading(), 'the upload to finish')
}

async function waitUntil(predicate: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 400; i++) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error(`timed out waiting for ${what}`)
}

async function stored(): Promise<{ date: string; description: string; amount: number }[]> {
  const rows = (await (await getDB()).getAll('transactions')) as {
    date: string
    description: string
    amount: number
  }[]
  return rows
    .map(({ date, description, amount }) => ({ date, description, amount }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

const CSV = [
  'Date,Description,Amount',
  '2026-03-01,Salary,2500',
  '2026-03-02,Groceries,-45.50',
  '2026-03-03,Coffee,-3.20',
].join('\n')

function workbook(): Uint8Array<ArrayBuffer> {
  const book = XLSX.utils.book_new()
  const march = XLSX.utils.aoa_to_sheet([
    ['Date', 'Description', 'Amount'],
    ['2026-03-01', 'Rent', -900],
  ])
  // A date as Excel keeps one: the day's serial number, shown in a date format.
  march.A2 = { t: 'n', v: 46082, z: 'yyyy-mm-dd' }
  XLSX.utils.book_append_sheet(book, march, 'March')
  XLSX.utils.book_append_sheet(
    book,
    XLSX.utils.aoa_to_sheet([
      ['Date', 'Description', 'Amount'],
      ['2026-04-01', 'Rent', -900],
      ['2026-04-03', 'Refund', 12.5],
    ]),
    'April'
  )
  return new Uint8Array(XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer)
}

describe('a file uploaded on the Import page in local-first', () => {
  it('goes on to the mapping step with the columns detected, then previews and imports', async () => {
    choose(new File([CSV], 'statement.csv', { type: 'text/csv' }))
    await settled()

    expect(flow.error()).toBeNull()
    expect(flow.activeStep()).toBe('mapping')
    expect(flow.currentHeaders()).toEqual(['Date', 'Description', 'Amount'])
    expect(flow.currentRows()).toHaveLength(3)
    expect(flow.columnMapping()).toMatchObject({ date: 0, description: 1, amount: 2 })

    await flow.goToPreview()
    expect(flow.activeStep()).toBe('preview')
    await flow.handleImport('all')
    await waitUntil(() => !flow.loading(), 'the import')

    expect(flow.error()).toBeNull()
    expect(await stored()).toEqual([
      { date: '2026-03-01', description: 'Salary', amount: 2500 },
      { date: '2026-03-02', description: 'Groceries', amount: 45.5 },
      { date: '2026-03-03', description: 'Coffee', amount: 3.2 },
    ])
  })

  it('reads a workbook as text, its date cells as their day, through the preview', async () => {
    choose(new File([workbook()], 'statement.xlsx'))
    await settled()

    expect(flow.error()).toBeNull()
    expect(flow.uploadResult()?.sheetNames).toEqual(['March', 'April'])
    expect(flow.currentRows()).toEqual([['2026-03-01', 'Rent', '-900']])
    await flow.goToPreview()
    expect(flow.activeStep()).toBe('preview')
    await flow.handleImport('all')
    await waitUntil(() => !flow.loading(), 'the import')
    expect(await stored()).toEqual([{ date: '2026-03-01', description: 'Rent', amount: 900 }])
  })

  it('reads the sheet a person chooses, by uploading the file again', async () => {
    choose(new File([workbook()], 'statement.xlsx'))
    await settled()
    flow.chooseUploadedSheet('April')
    await settled()

    expect(flow.selectedSheet()).toBe('April')
    expect(flow.currentRows()).toEqual([
      ['2026-04-01', 'Rent', '-900'],
      ['2026-04-03', 'Refund', '12.5'],
    ])
  })

  it('says why a file is refused, in the words both runtimes use', async () => {
    choose(new File([new Uint8Array(11 * 1024 * 1024)], 'big.csv', { type: 'text/csv' }))
    await settled()

    expect(flow.activeStep()).toBe('upload')
    expect(flow.error()).toBe(
      'That file is over 10 MB. Split it into smaller files and upload each one.'
    )
  })

  it('forgets the file read before when another is picked, though that one is refused', async () => {
    form.pick(new File([CSV], 'march.csv', { type: 'text/csv' }))
    await settled()
    expect(flow.uploadResult()?.filename).toBe('march.csv')
    // Back on the upload step, with March's sheet and the way on to the mapping step.
    flow.setActiveStep('upload')

    form.pick(new File([new Uint8Array(11 * 1024 * 1024)], 'april.xlsx'))
    await settled()

    expect(form.error('file')).toBe(M.tooLarge)
    expect(flow.uploadResult()).toBeNull()
    expect(flow.currentHeaders()).toEqual([])
    expect(flow.currentRows()).toEqual([])
  })

  it('refuses a file with no header row at the file, rather than doing nothing', async () => {
    form.pick(new File(['\n \n'], 'empty.csv', { type: 'text/csv' }))
    await settled()

    expect(form.error('file')).toBe(M.empty)
    expect(flow.activeStep()).toBe('upload')
    expect(flow.uploadResult()).toBeNull()
  })
})
