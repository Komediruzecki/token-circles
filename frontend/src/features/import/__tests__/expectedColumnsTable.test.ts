/**
 * The "Expected columns" table is the import's contract. It once listed Date and Description as
 * required when only Amount hard-fails a row: a blank description imports outright, a contract
 * the worker pins in `import-blank-description.test.ts` because a stricter local rule once
 * silently dropped 291 rows, and a blank date imports as today, with a warning.
 *
 * Date is marked required again, by decision (4 Nov 2026), because Map columns stars it: a sheet
 * without dates would put every row on today. Its row still says what a blank date cell does.
 * Description stays optional here although Map columns stars it too, because a blank one imports.
 *
 * This reads the rendered claims out of the source and holds them to that, and keeps the table's
 * column list in step with the downloadable template so the two cannot drift apart.
 */
/* eslint-disable security/detect-non-literal-fs-filename -- fixed repo paths only */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = resolve(__dirname, '..')

/** [column, required] pairs, straight out of the table's <tbody>. */
function tableClaims(): Array<[string, string]> {
  const tsx = readFileSync(resolve(SRC, 'ImportDataEntry.tsx'), 'utf8')
  const start = tsx.indexOf('data-test-id="import-expected-columns"')
  const body = tsx.slice(tsx.indexOf('<tbody>', start), tsx.indexOf('</tbody>', start))
  const rows: Array<[string, string]> = []
  for (const row of body.split('<tr>').slice(1)) {
    const cells = [...row.matchAll(/<td>([^<]*)<\/td>/g)].map((m) => m[1]!.trim())
    if (cells.length >= 2) rows.push([cells[0]!, cells[1]!])
  }
  return rows
}

describe('the Expected columns table', () => {
  it('marks Date and Amount as required, and nothing else', () => {
    const required = tableClaims()
      .filter(([, req]) => req === 'Yes')
      .map(([col]) => col)
    // Amount is the one field whose absence skips the row. Date is the column Map columns stars
    // with it; a blank Description imports, and everything else has a default or is optional.
    expect(required).toEqual(['Date', 'Amount'])
  })

  it('requires only columns Map columns stars, Date among them', async () => {
    const { FIELD_NAMES } = await import('../../../../../shared/importMapping')
    const starred = new Set(FIELD_NAMES.filter((f) => f.required).map((f) => f.label))
    const required = tableClaims()
      .filter(([, req]) => req === 'Yes')
      .map(([col]) => col)
    for (const col of required) expect(starred, col).toContain(col)
    expect(starred).toContain('Date')
  })

  it("says what a blank date cell does, in Date's row", () => {
    const tsx = readFileSync(resolve(SRC, 'ImportDataEntry.tsx'), 'utf8')
    const row = tsx.slice(
      tsx.indexOf('<td>Date</td>'),
      tsx.indexOf('</tr>', tsx.indexOf('<td>Date</td>'))
    )
    expect(row).toContain('a blank cell imports as today, and the row is flagged')
  })

  it('lists exactly the columns the downloadable template has', () => {
    const template = readFileSync(resolve(SRC, 'sampleTemplate.ts'), 'utf8')
    const headerBlock = template.slice(
      template.indexOf('TEMPLATE_HEADER'),
      template.indexOf(']', template.indexOf('TEMPLATE_HEADER'))
    )
    const templateCols = [...headerBlock.matchAll(/'([^']+)'/g)].map((m) => m[1]!)
    const tableCols = tableClaims().map(([col]) => col)
    expect(new Set(tableCols)).toEqual(new Set(templateCols))
  })

  it('names a default or consequence for every optional column with one', () => {
    const claims = new Map(tableClaims().map(([col, req]) => [col, req] as const))
    const tsx = readFileSync(resolve(SRC, 'ImportDataEntry.tsx'), 'utf8')
    // The columns whose behaviour-when-missing is non-obvious must say it in parentheses.
    for (const col of ['Currency', 'Type', 'Amount Local']) {
      expect(claims.get(col), `${col} should be listed`).toBe('No')
      const row = tsx.slice(
        tsx.indexOf(`<td>${col}</td>`),
        tsx.indexOf('</tr>', tsx.indexOf(`<td>${col}</td>`))
      )
      expect(row, `${col} row should explain its default in parentheses`).toMatch(/\([^)]+\)/)
    }
  })
})
