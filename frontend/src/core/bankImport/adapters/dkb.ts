/**
 * DKB (Deutsche Kreditbank) adapter.
 *
 * Current export (new banking, 2023+): UTF-8 (BOM), semicolon-delimited (a
 * comma variant exists), every field quoted, 4 preamble rows (account line,
 * blank, "Kontostand vom …", blank) before the header:
 *   "Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";
 *   "Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";…
 * The Visa flavor swaps in "Belegdatum";…;"Beschreibung";"Umsatztyp";"Betrag".
 * Legacy export (pre-2023): ISO-8859-1, header "Buchungstag";"Wertstellung";
 * "Buchungstext";"Auftraggeber / Begünstigter";…;"Betrag (EUR)";… after its own
 * preamble. The header row is located by content, never by fixed offset.
 * Dates are DD.MM.YY (new, century pivot) / DD.MM.YYYY (legacy); amounts are
 * German-formatted with thousands dots and, in the new export, a trailing " €"
 * ("-9,99 €", "100.000,00 €"). Rows with Status "Vorgemerkt" are pending and
 * skipped. The account's own IBAN sits in the preamble.
 * Filename (new): DD-MM-YYYY_Umsatzliste_Girokonto_<IBAN>.csv
 *
 * Format sources: dkb2homebank test files, beancount-dkb extractors (V1/V2,
 * encodings, both delimiters, %d.%m.%y, rstrip " €"), 2ynab DkbGirokonto
 * strategy; cross-checked against bank2ynab.conf (MIT).
 */
import { buildTxn } from '../classify'
import {
  decodeTextSniffed,
  indexHeader,
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

function pick(col: Record<string, number>, keys: string[]): number | undefined {
  for (const k of keys) if (col[k] !== undefined) return col[k]
  return undefined
}

/** First cell (normalized) that marks the header row, per vintage. */
const HEADER_FIRST_CELLS = ['buchungsdatum', 'buchungstag', 'belegdatum']

const normCell = (cell: string) => cell.toLowerCase().replace(/["\s]/g, '')

export const dkbAdapter: BankAdapter = {
  id: 'dkb',
  label: 'DKB',
  accept: ['csv'],

  detect(input: DetectInput): number {
    const head = input.textPreview.slice(0, 800).toLowerCase().replace(/["\s]/g, '')
    // New banking: preamble + Buchungsdatum/Umsatztyp header (giro or visa).
    // [;,] — parse() supports the comma-delimited variant, so detect must too.
    if (/(?:buchungsdatum|belegdatum)[;,]/.test(head) && head.includes('umsatztyp')) return 0.97
    // Legacy: "Auftraggeber / Begünstigter" is unique to DKB's old header
    // (Sparkasse uses Beguenstigter/Zahlungspflichtiger).
    if (head.includes('buchungstag') && head.includes('auftraggeber/beg')) return 0.95
    if (/umsatzliste_girokonto/i.test(input.filename)) return 0.7
    return 0
  },

  async parse(bytes: Uint8Array, _filename: string): Promise<ParsedStatement> {
    const text = decodeTextSniffed(bytes, 'iso-8859-1')
    const headerLineIdx = text
      .split(/\r?\n/)
      .findIndex((line) => HEADER_FIRST_CELLS.some((c) => normCell(line).startsWith(c)))
    const headerLine = headerLineIdx >= 0 ? text.split(/\r?\n/)[headerLineIdx] : ''
    const delimiter = headerLine.includes(';') ? ';' : ','
    const matrix = splitDelimited(text, delimiter)
    const headerRowAt = matrix.findIndex((r) => HEADER_FIRST_CELLS.includes(normCell(r[0] || '')))
    if (headerRowAt < 0) return { rows: [], meta: {} }
    // Own IBAN lives in the preamble ("Girokonto";"DE…" — possibly spaced).
    const preambleText = matrix
      .slice(0, headerRowAt)
      .map((r) => r.join(' '))
      .join(' ')
      .replace(/\s/g, '')
    // No \b anchors: after stripping spaces the IBAN abuts surrounding text
    // ("GirokontoDE88…"); (?!\d) still stops a longer digit run from matching.
    const iban = preambleText.match(/DE\d{20}(?!\d)/)?.[0]
    const rows = matrix.slice(headerRowAt).filter((r) => r.some((c) => c))
    return { rows, meta: { currency: 'EUR', iban } }
  },

  transform(parsed: ParsedStatement, ctx: TransformContext): CanonicalTxn[] {
    const [header, ...data] = parsed.rows
    if (!header) return []
    const col = indexHeader(header)
    const dateIdx = pick(col, ['buchungsdatum', 'buchungstag', 'belegdatum'])
    const amountIdx = pick(col, ['betrag(€)', 'betrag(eur)', 'betrag'])
    const purposeIdx = pick(col, ['verwendungszweck', 'beschreibung'])
    const payerIdx = col['zahlungspflichtige*r']
    const recipientIdx = col['zahlungsempfänger*in']
    const legacyPayeeIdx = col['auftraggeber/begünstigter']
    const out: CanonicalTxn[] = []
    for (const r of data) {
      // "Vorgemerkt" = pending; it books again later with final values.
      if ((r[col.status ?? -1] || '').toLowerCase() === 'vorgemerkt') continue
      const date = normalizeDate(r[dateIdx ?? -1]) || normalizeDate(r[col.wertstellung ?? -1])
      if (!date) continue
      const amount = parseEuropeanNumber((r[amountIdx ?? -1] || '0').replace(/€/g, '').trim())
      // New export: the counterparty is the recipient for outgoing money and
      // the payer for incoming; legacy has a single combined column.
      const payee =
        (amount < 0 ? r[recipientIdx ?? -1] : r[payerIdx ?? -1]) || r[legacyPayeeIdx ?? -1] || ''
      const raw: RawTxn = {
        date,
        amount,
        currency: 'EUR',
        description: r[purposeIdx ?? -1] || payee,
        counterparty: payee,
        beneficiary: amount < 0 ? payee || undefined : undefined,
        payor: amount > 0 ? payee || undefined : undefined,
        // Dates are day-granular and references often empty, so two genuinely
        // distinct same-day/payee/amount rows can collide — the preview flags
        // them as duplicates (deselected) for the user to re-check.
        dedupKey: r.join('\x01'),
      }
      out.push(buildTxn(raw, ctx))
    }
    return out
  },
}
