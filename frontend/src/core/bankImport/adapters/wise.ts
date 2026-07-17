/**
 * Wise (TransferWise) adapter — the per-currency balance statement CSV.
 *
 * UTF-8, comma-delimited, header on row 1, first column "TransferWise ID" in
 * every vintage (19 → 20 → 23 columns between ~2022 and 2026), so columns are
 * resolved by name:
 *   "TransferWise ID",Date,"Date Time",Amount,Currency,Description,
 *   "Payment Reference","Running Balance",…,"Payer Name","Payee Name",
 *   "Payee Account Number",Merchant,…,"Transaction Type","Transaction Details Type"
 * `Date` is DD-MM-YYYY (day-first, hyphens); amounts dot-decimal, signed
 * (negative = outflow); `Currency` is constant per file. Top-ups are the user
 * funding Wise from their own bank → forced transfers.
 * Filename: statement_<id>_<CCY>_<from>_<to>.csv
 *
 * Format sources: genuine statement exports (drive-lah/finance-api, uabean
 * fixtures), ofxstatement-transferwise, jlabath/wiseconvert (%d-%m-%Y), Wise
 * balance-statement API docs; cross-checked against bank2ynab.conf (MIT).
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

export const wiseAdapter: BankAdapter = {
  id: 'wise',
  label: 'Wise',
  accept: ['csv'],

  detect(input: DetectInput): number {
    const head = (input.textPreview.split(/\r?\n/, 1)[0] ?? '').toLowerCase().replace(/["\s]/g, '')
    if (head.startsWith('transferwiseid,date')) return 0.97
    // Full export shape (statement_<id>_<CCY>_<from>_<to>.csv) — a loose
    // prefix would catch date-fragment names like "statement_2026_jan_…".
    if (/^statement_\d+_[a-z]{3}_\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.csv$/i.test(input.filename))
      return 0.7
    return 0
  },

  async parse(bytes: Uint8Array, _filename: string): Promise<ParsedStatement> {
    const text = decodeText(bytes, 'utf-8')
    const rows = splitDelimited(text, ',').filter((r) => r.some((c) => c))
    const col = indexHeader(rows[0] ?? [])
    const currency = rows[1]?.[col.currency ?? -1]
    return { rows, meta: { currency } }
  },

  transform(parsed: ParsedStatement, ctx: TransformContext): CanonicalTxn[] {
    const [header, ...data] = parsed.rows
    if (!header) return []
    const col = indexHeader(header)
    const out: CanonicalTxn[] = []
    for (const r of data) {
      const date = normalizeDate(r[col.date ?? -1])
      if (!date) continue
      const amount = parseDotNumber(r[col.amount ?? -1] || '0')
      const description = r[col.description ?? -1] || ''
      const merchant = r[col.merchant ?? -1] || ''
      const payeeName = r[col.payeename ?? -1] || ''
      const payerName = r[col.payername ?? -1] || ''
      const counterparty = merchant || (amount < 0 ? payeeName : payerName)
      const reference = r[col.paymentreference ?? -1] || ''
      const raw: RawTxn = {
        date,
        amount,
        currency: r[col.currency ?? -1] || parsed.meta.currency || '',
        description,
        counterparty,
        beneficiary: amount < 0 ? counterparty || undefined : undefined,
        payor: amount > 0 ? counterparty || undefined : undefined,
        notes: reference || undefined,
        // "Topped up account" = the user funding Wise from their own bank.
        forceTransfer: description.toLowerCase().startsWith('topped up'),
        dedupKey: r.join('\x01'),
      }
      out.push(buildTxn(raw, ctx))
    }
    return out
  },
}
