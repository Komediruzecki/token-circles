/**
 * PBZ (Privredna banka Zagreb) adapter.
 *
 * Format: legacy binary .xls (OLE/BIFF), parsed via the bundled xlsx. The sheet
 * opens with metadata rows (TRANSAKCIJSKI RAČUN, IBAN, OD/DO period), then a
 * header row `DATUM | VRSTA TRANSAKCIJE | OPIS PLAĆANJA | IZNOS | VALUTA`, then
 * data. Rather than hard-code the header offset (it varies between exports),
 * data rows are detected as those with a real date in column 0 and a numeric
 * amount in column 3. IZNOS is negative for outflow; VALUTA may carry padding.
 */
import { buildTxn } from '../classify'
import { extractIban, normalizeDate, parseFlexibleNumber, parseXls } from '../parse'
import type { RawTxn } from '../classify'
import type {
  BankAdapter,
  CanonicalTxn,
  DetectInput,
  ParsedStatement,
  TransformContext,
} from '../types'

const COL = { date: 0, kind: 1, description: 2, amount: 3, currency: 4 } as const

/** OLE compound-file magic (D0 CF 11 E0) — the signature of a real .xls. */
function isOleFile(bytes: Uint8Array): boolean {
  return bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0
}

export const pbzAdapter: BankAdapter = {
  id: 'pbz',
  label: 'PBZ',
  accept: ['xls', 'xlsx'],

  detect(input: DetectInput): number {
    if (/izvj|transakcij|pbz/i.test(input.filename)) return 0.95
    if (isOleFile(input.bytes)) return 0.6
    return 0
  },

  async parse(bytes: Uint8Array, _filename: string): Promise<ParsedStatement> {
    const matrix = await parseXls(bytes)
    // Sniff IBAN + currency from the metadata rows before the data starts.
    const header = matrix.slice(0, 8).flat().join(' ')
    const rows = matrix.filter(
      (r) => r.length > COL.amount && !!normalizeDate(r[COL.date]) && r[COL.amount].trim() !== ''
    )
    const currency = rows.find((r) => r[COL.currency]?.trim())?.[COL.currency]?.trim()
    return { rows, meta: { iban: extractIban(header), currency } }
  },

  transform(parsed: ParsedStatement, ctx: TransformContext): CanonicalTxn[] {
    const out: CanonicalTxn[] = []
    for (const r of parsed.rows) {
      const date = normalizeDate(r[COL.date])
      if (!date) continue
      const description = (r[COL.description] || '').trim()
      const raw: RawTxn = {
        date,
        amount: parseFlexibleNumber(r[COL.amount] || '0'),
        currency: (r[COL.currency] || '').trim() || parsed.meta.currency || 'EUR',
        description,
        counterparty: description,
        // PBZ has no per-row time or id, so the full row (date, type, opis, amount)
        // is the best available signature — two same-day identical rows can't be
        // told apart from a true duplicate.
        dedupKey: r.join('\x01'),
      }
      out.push(buildTxn(raw, ctx))
    }
    return out
  },
}
