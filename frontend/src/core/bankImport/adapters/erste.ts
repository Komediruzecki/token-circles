/**
 * Erste (Croatia) adapter.
 *
 * Format: Windows-1250 CSV, semicolon-delimited. Row 1 is a metadata line
 * ("Izvod prometa po računu HR… Valuta EUR …"), row 2 is the header, then data.
 * Columns (0-based):
 *   0 Redni broj | 1 Datum valute | 2 Datum izvršenja | 3 Opis plaćanja |
 *   4 Broj računa | 5 Isplate (debit) | 6 Uplate (credit) | 7 Stanje |
 *   8 PNB platitelja | 9 PNB primatelja | 10 Platitelj/Primatelj | 11 Mjesto |
 *   12 Referenca
 * Debit → expense, credit → income. Amounts are European-formatted (1.234,56).
 */
import { buildTxn } from '../classify'
import {
  decodeText,
  extractIban,
  normalizeDate,
  parseEuropeanNumber,
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

const COL = {
  seq: 0,
  valueDate: 1,
  execDate: 2,
  description: 3,
  account: 4,
  debit: 5,
  credit: 6,
  balance: 7,
  counterparty: 10,
  place: 11,
  reference: 12,
} as const

export const ersteAdapter: BankAdapter = {
  id: 'erste',
  label: 'Erste',
  accept: ['csv'],

  detect(input: DetectInput): number {
    const head = input.textPreview.slice(0, 400).toLowerCase()
    if (head.includes('izvod prometa po ra') || head.includes('redni broj;datum valute'))
      return 0.97
    if (/erste\s+izvadak/i.test(input.filename)) return 0.7
    return 0
  },

  async parse(bytes: Uint8Array, _filename: string): Promise<ParsedStatement> {
    const text = decodeText(bytes, 'windows-1250')
    const matrix = splitDelimited(text, ';')
    const metaLine = matrix[0]?.join(' ') || ''
    const currencyMatch = metaLine.match(/Valuta\s+([A-Z]{3})/)
    // Data rows: those whose first cell is a sequence number (skips meta, header,
    // and blank rows without hard-coding an offset).
    const rows = matrix.filter((r) => r.length >= 13 && /^\d+$/.test((r[COL.seq] || '').trim()))
    return {
      rows,
      meta: {
        currency: currencyMatch?.[1],
        iban: extractIban(metaLine),
      },
    }
  },

  transform(parsed: ParsedStatement, ctx: TransformContext): CanonicalTxn[] {
    const currency = parsed.meta.currency || 'EUR'
    const out: CanonicalTxn[] = []
    for (const r of parsed.rows) {
      const date = normalizeDate(r[COL.execDate]) || normalizeDate(r[COL.valueDate])
      if (!date) continue
      const debit = (r[COL.debit] || '').trim()
      const credit = (r[COL.credit] || '').trim()
      // Debit (Isplate) → money out (negative); otherwise credit (Uplate) → in.
      const amount = debit ? -parseEuropeanNumber(debit) : parseEuropeanNumber(credit)
      const counterparty = r[COL.counterparty] || ''
      const raw: RawTxn = {
        date,
        amount,
        currency,
        description: r[COL.description] || '',
        counterparty,
        beneficiary: amount < 0 ? counterparty : undefined,
        payor: amount > 0 ? counterparty : undefined,
        // Raw row WITHOUT the per-statement sequence number (col 0), which differs
        // between overlapping exports; the balance + reference still discriminate
        // genuinely distinct same-day rows.
        dedupKey: r.slice(1).join('\x01'),
      }
      out.push(buildTxn(raw, ctx))
    }
    return out
  },
}
