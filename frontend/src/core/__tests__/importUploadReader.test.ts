/**
 * The upload reader both runtimes run (shared/importUpload.ts), with SheetJS behind a spy.
 *
 * - A workbook saved as .xlsx is a zip, read from the index at its end: an upload is checked to
 *   be a complete file before it is read, and one that is not is refused at `file`.
 * - A file with no header row is refused at `file`: the page did nothing with it, and said
 *   nothing. An empty first sheet gives way to the first sheet with one.
 * - A number cell is written so the import reads it as the number it is: written plainly, 7.534
 *   reads like 7,534 with a thousands separator, which a number cell cannot have.
 */
import { describe, expect, it, vi } from 'vitest'
import * as XLSX from 'xlsx'
import { checkImportRowNumbers } from '../../../../shared/importRowChecks'
import { IMPORT_UPLOAD_MESSAGES as M, readUploadedSheet } from '../../../../shared/importUpload'
import type { SheetReader } from '../../../../shared/importUpload'

/** SheetJS, and a spy on its read. */
function spied(): { xlsx: SheetReader; read: ReturnType<typeof vi.fn> } {
  const read = vi.fn(XLSX.read)
  return { xlsx: { read, utils: XLSX.utils } as never, read }
}

function workbook(sheets: Record<string, unknown[][]>): Uint8Array {
  const book = XLSX.utils.book_new()
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), name)
  }
  return new Uint8Array(XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer)
}

const file = (bytes: Uint8Array, name = 'statement.xlsx', type = '') => ({
  name,
  type,
  size: bytes.length,
  bytes,
})

const LEDGER = [
  ['Date', 'Description', 'Amount'],
  ['2026-03-01', 'Rent', -900],
]

describe('an upload is checked to be a complete file before it is read', () => {
  it('reads a whole workbook', () => {
    const { xlsx, read } = spied()
    const answer = readUploadedSheet(xlsx, file(workbook({ March: LEDGER })))
    expect(answer).toMatchObject({
      ok: true,
      value: { headers: ['Date', 'Description', 'Amount'] },
    })
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('refuses a workbook cut short, without reading it', () => {
    const whole = workbook({ March: LEDGER })
    const { xlsx, read } = spied()
    expect(readUploadedSheet(xlsx, file(whole.slice(0, whole.length - 30)))).toEqual({
      ok: false,
      fields: { file: M.unreadable },
    })
    expect(read).not.toHaveBeenCalled()
  })
})

describe('a file with no header row', () => {
  it('is refused at the file, a CSV file or a workbook', () => {
    const blank = new TextEncoder().encode('\n,,\n')
    expect(readUploadedSheet(spied().xlsx, file(blank, 'empty.csv', 'text/csv'))).toEqual({
      ok: false,
      fields: { file: M.empty },
    })
    expect(readUploadedSheet(spied().xlsx, file(workbook({ Empty: [] })))).toEqual({
      ok: false,
      fields: { file: M.empty },
    })
  })

  it('gives way to the first sheet that has one', () => {
    const read = readUploadedSheet(spied().xlsx, file(workbook({ Notes: [], March: LEDGER })))
    expect(read).toMatchObject({
      ok: true,
      value: { selectedSheet: 'March', sheetNames: ['Notes', 'March'] },
    })
  })

  it('is refused at the file when it is the sheet asked for', () => {
    const bytes = workbook({ Notes: [], March: LEDGER })
    expect(readUploadedSheet(spied().xlsx, file(bytes), 'Notes')).toEqual({
      ok: false,
      fields: { file: M.emptySheet },
    })
  })
})

describe('a number cell', () => {
  it('is read by the import as the number it is', () => {
    const read = readUploadedSheet(
      spied().xlsx,
      file(
        workbook({
          March: [
            ['Date', 'Amount', 'Rate'],
            ['2026-03-01', -7.534, 7.5345],
          ],
        })
      )
    )
    if (!read.ok) throw new Error('not read')
    const [, amount, rate] = read.value.rows[0]!
    const checked = checkImportRowNumbers({ amount, amountLocal: '', exchangeRate: '' })
    expect(String(checked.amount)).toBe('-7.53')
    expect(checked.warnings).toEqual([
      `amount "${amount}" has more than two decimals — rounded to cents.`,
    ])
    expect(amount).toBe('-7.5340')
    // A number with more than three digits after the point is written as it is.
    expect(rate).toBe('7.5345')
  })
})
