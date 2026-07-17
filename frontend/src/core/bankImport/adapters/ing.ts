/**
 * ING (Netherlands) adapter.
 *
 * Mijn ING offers the same 11 columns comma- or semicolon-delimited, every
 * field double-quoted, header language following the UI language:
 *   "Datum";"Naam / Omschrijving";"Rekening";"Tegenrekening";"Code";"Af Bij";
 *   "Bedrag (EUR)";"Mutatiesoort";"Mededelingen";"Saldo na mutatie";"Tag"
 *   ("Date";"Name / Description";…;"Debit/credit";"Amount (EUR)";…)
 * Legacy exports (pre ~2020) have the first nine columns only and spell
 * "MutatieSoort" — headers are matched case-insensitively by name.
 * Dates are compact ISO (YYYYMMDD); the amount is an unsigned decimal-comma
 * value whose direction comes from "Af Bij" (Af/Debit = out, Bij/Credit = in).
 * "Rekening" is the account's own IBAN; currency is implicitly EUR.
 * Filename: <IBAN>_DD-MM-YYYY_DD-MM-YYYY.csv
 *
 * Format sources: genuine Mijn ING export (opwolken/rekening-daan),
 * YNABGoingDutch and Bank-2-Budget test files, ING's own "afschriften
 * downloaden" help; cross-checked against bank2ynab.conf (MIT).
 */
import { buildTxn } from '../classify'
import {
  decodeText,
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

export const ingAdapter: BankAdapter = {
  id: 'ing',
  label: 'ING NL',
  accept: ['csv'],

  detect(input: DetectInput): number {
    const head = (input.textPreview.split(/\r?\n/, 1)[0] ?? '')
      .toLowerCase()
      .replace(/["\s]/g, '')
      .replace(/;/g, ',')
    if (head.startsWith('datum,naam/omschrijving,rekening')) return 0.97
    if (head.startsWith('date,name/description,account')) return 0.97
    if (/^nl\d{2}[a-z]{4}\d{10}_\d{2}-\d{2}-\d{4}/i.test(input.filename)) return 0.7
    return 0
  },

  async parse(bytes: Uint8Array, _filename: string): Promise<ParsedStatement> {
    const text = decodeText(bytes, 'utf-8')
    const headerLine = text.split(/\r?\n/, 1)[0] ?? ''
    const delimiter = headerLine.includes(';') ? ';' : ','
    const rows = splitDelimited(text, delimiter).filter((r) => r.some((c) => c))
    const col = indexHeader(rows[0] ?? [])
    const ownIban = rows[1]?.[pick(col, ['rekening', 'account']) ?? -1]
    return { rows, meta: { currency: 'EUR', iban: ownIban || undefined } }
  },

  transform(parsed: ParsedStatement, ctx: TransformContext): CanonicalTxn[] {
    const [header, ...data] = parsed.rows
    if (!header) return []
    const col = indexHeader(header)
    const dateIdx = pick(col, ['datum', 'date'])
    const nameIdx = pick(col, ['naam/omschrijving', 'name/description'])
    const directionIdx = pick(col, ['afbij', 'debit/credit'])
    const amountIdx = pick(col, ['bedrag(eur)', 'amount(eur)'])
    const memoIdx = pick(col, ['mededelingen', 'notifications'])
    const out: CanonicalTxn[] = []
    for (const r of data) {
      const date = normalizeDate(r[dateIdx ?? -1])
      if (!date) continue
      const direction = (r[directionIdx ?? -1] || '').toLowerCase()
      const magnitude = parseEuropeanNumber(r[amountIdx ?? -1] || '0')
      const amount = direction === 'af' || direction === 'debit' ? -magnitude : magnitude
      const name = r[nameIdx ?? -1] || ''
      const raw: RawTxn = {
        date,
        amount,
        currency: 'EUR',
        description: r[memoIdx ?? -1] || name,
        counterparty: name,
        beneficiary: amount < 0 ? name : undefined,
        payor: amount > 0 ? name : undefined,
        dedupKey: r.join('\x01'),
      }
      out.push(buildTxn(raw, ctx))
    }
    return out
  },
}
