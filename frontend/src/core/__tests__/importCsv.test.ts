import { describe, expect, it } from 'vitest'
import { parseImportCsv } from '../../../../shared/importCsv'

describe('parseImportCsv', () => {
  it('keeps a quoted cell that contains commas in one column', () => {
    const { headers, rows } = parseImportCsv(
      'description,amount\n"411111XXXXXX2222, CLOUDFLARE 10,46 USD",9.45\n'
    )
    expect(headers).toEqual(['description', 'amount'])
    expect(rows).toEqual([['411111XXXXXX2222, CLOUDFLARE 10,46 USD', '9.45']])
  })

  // The defect both hand-rolled copies shared: they split on '\n' BEFORE tracking quotes, so a
  // multi-line cell (Google Sheets exports one exactly like this) was torn into fragments — the
  // real row vanished and one or two short, column-shifted junk rows took its place.
  it('keeps a quoted cell that contains a newline in one record', () => {
    const { headers, rows } = parseImportCsv(
      'description,amount\n"line one\nline two",12.50\nNext row,3\n'
    )
    expect(headers).toEqual(['description', 'amount'])
    expect(rows).toEqual([
      ['line one\nline two', '12.50'],
      ['Next row', '3'],
    ])
  })

  it('does not shift later rows when an earlier cell holds a newline', () => {
    const { rows } = parseImportCsv('a,b,c\n"x\ny",2,3\n4,5,6\n')
    expect(rows).toHaveLength(2)
    expect(rows[1]).toEqual(['4', '5', '6'])
  })

  it('unescapes a doubled quote inside a quoted field', () => {
    const { rows } = parseImportCsv('description,amount\n"He said ""hi""",5\n')
    expect(rows).toEqual([['He said "hi"', '5']])
  })

  it('preserves whitespace inside quotes and trims unquoted cells', () => {
    const { rows } = parseImportCsv('a,b\n"  padded  ",  bare  \n')
    expect(rows).toEqual([['  padded  ', 'bare']])
  })

  it('handles CRLF separators and drops blank records', () => {
    const { headers, rows } = parseImportCsv('a,b\r\n1,2\r\n\r\n3,4\r\n')
    expect(headers).toEqual(['a', 'b'])
    expect(rows).toEqual([
      ['1', '2'],
      ['3', '4'],
    ])
  })

  it('returns empty headers and no rows for empty text', () => {
    expect(parseImportCsv('')).toEqual({ headers: [], rows: [] })
  })

  // Spreadsheet exports routinely prefix a BOM. Left in place it rides along inside the first
  // header, which silently breaks a saved header→column mapping (those match names exactly).
  // An unquoted first header survives on its own, because unquoted cells are trimmed and JS
  // trim() happens to treat U+FEFF as whitespace; a QUOTED one does not — the BOM arrives before
  // the opening quote, so without an explicit strip the quote is read as ordinary content and
  // the header comes out as `"description"`, quotes and all.
  it('strips a leading byte-order mark before an unquoted first header', () => {
    const { headers, rows } = parseImportCsv('﻿description,amount\nKonzum,135.93\n')
    expect(headers).toEqual(['description', 'amount'])
    expect(rows).toEqual([['Konzum', '135.93']])
  })

  it('strips a leading byte-order mark before a quoted first header', () => {
    const { headers } = parseImportCsv('﻿"description","amount"\nKonzum,135.93\n')
    expect(headers).toEqual(['description', 'amount'])
  })

  it('treats a quote inside an unquoted cell as content', () => {
    const { rows } = parseImportCsv('a,b\n12" pipe,3\n')
    expect(rows).toEqual([['12" pipe', '3']])
  })

  // Strict RFC 4180 calls a field with padding before the quote unquoted, but producers emit it
  // and the line-splitting parsers this replaced accepted it (they stripped the outer quotes
  // after trimming). The Worker ingests uploaded and emailed CSVs from arbitrary producers.
  it('accepts padding before an opening quote', () => {
    const { rows } = parseImportCsv('a,b\nx, "quoted, with comma"\n')
    expect(rows).toEqual([['x', 'quoted, with comma']])
  })
})
