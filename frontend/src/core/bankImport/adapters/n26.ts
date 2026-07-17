/**
 * N26 (Germany) adapter.
 *
 * Current format (post-2023 app relaunch): UTF-8 CSV, comma-delimited,
 * header on row 1 (quoting varies between exports — columns are resolved by
 * name, never raw string compare):
 *   "Booking Date","Value Date","Partner Name","Partner Iban",Type,
 *   "Payment Reference","Account Name","Amount (EUR)","Original Amount",
 *   "Original Currency","Exchange Rate"
 * Legacy format (until ~2023), incl. a German-header variant:
 *   "Date","Payee","Account number","Transaction type","Payment reference",
 *   "Amount (EUR)",…  /  "Datum","Empfänger","Kontonummer","Transaktionstyp",…
 * Dates are ISO; amounts dot-decimal, signed (negative = outflow); currency is
 * implicitly EUR. `Partner Iban` is the counterparty, not the account.
 *
 * Format sources: beancount-n26, you-need-a-parser (n26.ts), real export
 * fixtures in d-led/auto-ynab-csv and melledijkstra/gas-fire; cross-checked
 * against bank2ynab.conf (MIT).
 */
import { buildTxn } from '../classify'
import { decodeText, indexHeader, normalizeDate, parseDotNumber, splitDelimited } from '../parse'
import type { RawTxn } from '../classify'
import type {
  BankAdapter,
  CanonicalTxn,
  DetectInput,
  ParsedStatement,
  TransformContext,
} from '../types'

/** First column present per vintage, in lookup priority order. */
const DATE_KEYS = ['bookingdate', 'date', 'datum']
const PAYEE_KEYS = ['partnername', 'payee', 'empfänger']
const REF_KEYS = ['paymentreference', 'verwendungszweck']
const AMOUNT_KEYS = ['amount(eur)', 'betrag(eur)']

function pick(col: Record<string, number>, keys: string[]): number | undefined {
  for (const k of keys) if (col[k] !== undefined) return col[k]
  return undefined
}

export const n26Adapter: BankAdapter = {
  id: 'n26',
  label: 'N26',
  accept: ['csv'],

  detect(input: DetectInput): number {
    const head = (input.textPreview.split(/\r?\n/, 1)[0] ?? '').toLowerCase().replace(/["\s]/g, '')
    if (head.startsWith('bookingdate,valuedate,partnername')) return 0.97
    if (head.startsWith('date,payee,accountnumber,transactiontype')) return 0.95
    if (head.startsWith('datum,empfänger,kontonummer,transaktionstyp')) return 0.95
    // Word-bounded: "jan26.csv" / "plan26.csv" must NOT read as N26 —
    // month+year filenames are common and a false 0.6 would beat "unknown".
    if (/\bn26\b/i.test(input.filename)) return 0.6
    return 0
  },

  async parse(bytes: Uint8Array, _filename: string): Promise<ParsedStatement> {
    const text = decodeText(bytes, 'utf-8')
    const rows = splitDelimited(text, ',').filter((r) => r.some((c) => c))
    return { rows, meta: { currency: 'EUR' } }
  },

  transform(parsed: ParsedStatement, ctx: TransformContext): CanonicalTxn[] {
    const [header, ...data] = parsed.rows
    if (!header) return []
    const col = indexHeader(header)
    const dateIdx = pick(col, DATE_KEYS)
    const payeeIdx = pick(col, PAYEE_KEYS)
    const refIdx = pick(col, REF_KEYS)
    const amountIdx = pick(col, AMOUNT_KEYS)
    const out: CanonicalTxn[] = []
    for (const r of data) {
      const date = normalizeDate(r[dateIdx ?? -1])
      if (!date) continue
      const amount = parseDotNumber(r[amountIdx ?? -1] || '0')
      const payee = r[payeeIdx ?? -1] || ''
      const reference = r[refIdx ?? -1] || ''
      const raw: RawTxn = {
        date,
        amount,
        currency: 'EUR',
        description: reference || payee,
        counterparty: payee,
        beneficiary: amount < 0 ? payee : undefined,
        payor: amount > 0 ? payee : undefined,
        // Card rows carry no time/balance/reference, so two genuinely distinct
        // same-day/partner/amount purchases collide — the preview flags them
        // as duplicates (deselected) for the user to re-check.
        dedupKey: r.join('\x01'),
      }
      out.push(buildTxn(raw, ctx))
    }
    return out
  },
}
