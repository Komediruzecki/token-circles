/**
 * YNAB-format CSV adapter — the bridge format.
 *
 * YNAB's documented import CSV (help.ynab.com "Formatting a CSV File") comes in
 * two shapes, both with the header on row 1:
 *   Date,Payee,Category,Memo,Outflow,Inflow   (Category may be absent)
 *   Date,Payee,Memo,Amount                    (signed amount)
 * This is the de-facto interchange format of the budgeting world: bank2ynab
 * (github.com/bank2ynab/bank2ynab, MIT) converts 145+ banks' exports into it,
 * and most "export to YNAB" tools emit it — so accepting it here indirectly
 * covers every bank those tools support.
 *
 * Delimiter is comma (some EU tools write semicolon — sniffed from the header).
 * Dates pass through normalizeDate (ISO or DD.MM.YYYY / DD/MM/YYYY — day-first,
 * the European convention, when ambiguous). Amounts are parsed flexibly (dot or
 * comma decimals). A non-empty Category in the file wins over keyword rules —
 * it's the user's explicit categorization; a "Group: Category" value keeps only
 * the category part.
 */
import { buildTxn } from '../classify'
import {
  decodeText,
  indexHeader,
  normalizeDate,
  parseFlexibleNumber,
  splitDelimited,
} from '../parse'
import type { RawTxn } from '../classify'
import type {
  BankAdapter,
  CanonicalTxn,
  DetectInput,
  ParsedStatement,
  TransformContext,
} from '../types'

function normalizedHeaderLine(preview: string): string {
  const firstLine = preview.split(/\r?\n/, 1)[0] ?? ''
  return firstLine.toLowerCase().replace(/["\s]/g, '')
}

function sniffDelimiter(headerLine: string): ',' | ';' {
  return headerLine.includes(';') && !headerLine.includes(',') ? ';' : ','
}

export const ynabAdapter: BankAdapter = {
  id: 'ynab',
  label: 'YNAB',
  accept: ['csv'],

  detect(input: DetectInput): number {
    const head = normalizedHeaderLine(input.textPreview).replace(/;/g, ',')
    if (head === 'date,payee,category,memo,outflow,inflow') return 0.97
    if (head === 'date,payee,memo,outflow,inflow') return 0.95
    if (head === 'date,payee,memo,amount') return 0.85
    if (/ynab/i.test(input.filename)) return 0.6
    return 0
  },

  async parse(bytes: Uint8Array, _filename: string): Promise<ParsedStatement> {
    const text = decodeText(bytes, 'utf-8')
    const delimiter = sniffDelimiter(normalizedHeaderLine(text))
    const matrix = splitDelimited(text, delimiter)
    // Keep the header as row 0 — transform() resolves columns from it, so the
    // Category-less and signed-Amount variants both work.
    const rows = matrix.filter((r) => r.some((c) => c))
    return { rows, meta: {} }
  },

  transform(parsed: ParsedStatement, ctx: TransformContext): CanonicalTxn[] {
    const [header, ...data] = parsed.rows
    if (!header) return []
    const col = indexHeader(header)
    const out: CanonicalTxn[] = []
    for (const r of data) {
      const date = normalizeDate(r[col.date ?? -1])
      if (!date) continue
      const outflow = parseFlexibleNumber(r[col.outflow ?? -1] || '')
      const inflow = parseFlexibleNumber(r[col.inflow ?? -1] || '')
      const amount =
        col.outflow !== undefined || col.inflow !== undefined
          ? inflow - Math.abs(outflow)
          : parseFlexibleNumber(r[col.amount ?? -1] || '0')
      const payee = r[col.payee ?? -1] || ''
      const memo = r[col.memo ?? -1] || ''
      const raw: RawTxn = {
        date,
        amount,
        // YNAB files carry no currency; leave it empty and let the import
        // pipeline fall back to the app default.
        currency: '',
        description: memo || payee,
        counterparty: payee,
        dedupKey: r.join('\x01'),
      }
      const txn = buildTxn(raw, ctx)
      // The file's own Category (minus a "Group: " prefix) beats keyword rules.
      const fileCategory = (r[col.category ?? -1] || '').split(':').pop()?.trim()
      if (txn.type !== 'Transfer' && fileCategory) txn.category = fileCategory
      out.push(txn)
    }
    return out
  },
}
