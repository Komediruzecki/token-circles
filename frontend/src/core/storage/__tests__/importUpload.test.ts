/**
 * Local-first's `POST /api/import/upload`, through `routeApiRequest`, the router `apiFetch` calls.
 *
 * It answered an upload session and each row as an object keyed by its column
 * ({ session_id, filename, rows, row_count }), where the Worker answers the header row, the rows
 * under it as lists of cells, and the workbook's sheets. The Import page reads the Worker's
 * answer, so a file upload in local-first stopped at the upload step with "Cannot read properties
 * of undefined (reading '0')". Now both read the file with shared/importUpload.ts: the same answer
 * for a CSV file and for a workbook, every cell as text (a date cell as its day), a sheet chosen
 * by uploading again with its name, and the same refusals at the `file` field. The old
 * pick-a-sheet step, `POST /api/import/file-sheet`, answers 410 Gone as the Worker's does.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { IMPORT_UPLOAD_MESSAGES as M } from '../../../../../shared/importUpload'

let routeApiRequest: (url: string, init?: RequestInit) => Promise<Response>

beforeAll(async () => {
  routeApiRequest = (await import('../localApiRouter')).routeApiRequest
}, 120_000)

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('finance_storage_mode', 'serverless')
  localStorage.setItem('currentProfileId', '1')
})

const CSV = 'Date,Description,Amount\n2026-03-01,Salary,2500\n\n2026-03-02,Groceries,-45.50\n'

function workbook(): Uint8Array<ArrayBuffer> {
  const book = XLSX.utils.book_new()
  const march = XLSX.utils.aoa_to_sheet([
    ['Date', 'Description', 'Amount'],
    ['2026-03-01', 'Rent', -900],
    [],
    ['2026-03-05', 'Refund', 12.5],
  ])
  // A date as Excel keeps one: the day's serial number, shown in a date format.
  march.A4 = { t: 'n', v: 46086, z: 'yyyy-mm-dd' }
  XLSX.utils.book_append_sheet(book, march, 'March')
  XLSX.utils.book_append_sheet(
    book,
    XLSX.utils.aoa_to_sheet([
      ['Datum', 'Omschrijving', 'Bedrag'],
      ['2026-04-01', 'Huur', -900],
    ]),
    'April'
  )
  return new Uint8Array(XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer)
}

async function upload(
  file: File | null,
  sheetName?: string
): Promise<{ status: number; body: unknown }> {
  const form = new FormData()
  if (file) form.append('file', file)
  if (sheetName) form.append('sheetName', sheetName)
  const res = await routeApiRequest('/api/import/upload', { method: 'POST', body: form })
  return { status: res.status, body: await res.json() }
}

describe('POST /api/import/upload in local-first', () => {
  it('answers a CSV file as the Worker does: its header row, its rows, one sheet', async () => {
    expect(await upload(new File([CSV], 'statement.csv', { type: 'text/csv' }))).toEqual({
      status: 200,
      body: {
        headers: ['Date', 'Description', 'Amount'],
        rows: [
          ['2026-03-01', 'Salary', '2500'],
          ['2026-03-02', 'Groceries', '-45.50'],
        ],
        selectedSheet: 'CSV',
        sheetNames: ['CSV'],
      },
    })
  })

  it('answers the first sheet of a workbook as text, with every sheet named, and no blank row', async () => {
    const file = new File([workbook()], 'statement.xlsx')
    expect(await upload(file)).toEqual({
      status: 200,
      body: {
        headers: ['Date', 'Description', 'Amount'],
        rows: [
          ['2026-03-01', 'Rent', '-900'],
          ['2026-03-05', 'Refund', '12.5'],
        ],
        selectedSheet: 'March',
        sheetNames: ['March', 'April'],
      },
    })
  })

  it('answers the sheet an upload names, and the first one for a name it does not have', async () => {
    const file = () => new File([workbook()], 'statement.xlsx')
    expect((await upload(file(), 'April')).body).toMatchObject({
      headers: ['Datum', 'Omschrijving', 'Bedrag'],
      rows: [['2026-04-01', 'Huur', '-900']],
      selectedSheet: 'April',
    })
    expect((await upload(file(), 'May')).body).toMatchObject({ selectedSheet: 'March' })
  })

  it('refuses no file, and a file over 10 MB, at the file', async () => {
    expect(await upload(null)).toEqual({
      status: 400,
      body: { error: M.file, fields: { file: M.file } },
    })
    const big = new File([new Uint8Array(11 * 1024 * 1024)], 'big.csv', { type: 'text/csv' })
    expect(await upload(big)).toEqual({
      status: 413,
      body: { error: M.tooLarge, fields: { file: M.tooLarge } },
    })
  })
})

describe('POST /api/import/file-sheet in local-first', () => {
  it('answers 410 Gone, as the Worker does', async () => {
    const res = await routeApiRequest('/api/import/file-sheet', {
      method: 'POST',
      body: JSON.stringify({ session_id: 'upload-1' }),
    })
    expect(res.status).toBe(410)
    expect(await res.json()).toEqual({
      error: 'Re-upload via /api/import/upload with a sheetName field (stateless Worker flow).',
    })
  })
})
