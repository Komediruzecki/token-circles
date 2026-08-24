/**
 * The "Expected columns" table is the import's contract, and it lied: Date and Description were
 * listed as required when only Amount hard-fails a row — a missing date imports as today (with a
 * warning) and a blank description imports outright, a contract the worker pins in
 * `import-blank-description.test.ts` precisely because a stricter local rule once silently
 * dropped 291 rows.
 *
 * This reads the rendered claims out of the source and holds them to that reality, and keeps the
 * table's column list in step with the downloadable template so the two cannot drift apart.
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
  it('marks Amount, and only Amount, as required', () => {
    const required = tableClaims()
      .filter(([, req]) => req === 'Yes')
      .map(([col]) => col)
    // Amount is the one field whose absence skips the row. Date falls back to today (flagged),
    // a blank Description imports, and everything else has a default or is plain optional.
    expect(required).toEqual(['Amount'])
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
    for (const col of ['Date', 'Currency', 'Type', 'Amount Local']) {
      expect(claims.get(col), `${col} should be listed`).toBe('No')
      const row = tsx.slice(
        tsx.indexOf(`<td>${col}</td>`),
        tsx.indexOf('</tr>', tsx.indexOf(`<td>${col}</td>`))
      )
      expect(row, `${col} row should explain its default in parentheses`).toMatch(/\([^)]+\)/)
    }
  })
})
