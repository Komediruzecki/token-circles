/**
 * Revolut adapter.
 *
 * Format: UTF-8 CSV, comma-delimited, header on row 1:
 *   Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance
 * Amounts are JS-formatted (dot decimal), negative = outflow. PENDING rows are
 * skipped (they get superseded by a COMPLETED row later). Top-ups and transfers
 * are flagged as transfers; the counterpart account is resolved from the "*NNNN"
 * card suffix via transfer rules.
 */
import { buildTxn } from '../classify'
import { decodeText, normalizeDate, parseDotNumber, splitDelimited } from '../parse'
import type { RawTxn } from '../classify'
import type {
  BankAdapter,
  CanonicalTxn,
  DetectInput,
  ParsedStatement,
  TransformContext,
} from '../types'

const HEADER_SIGNATURE = 'type,product,started date,completed date,description,amount'

const COL = {
  type: 0,
  product: 1,
  started: 2,
  completed: 3,
  description: 4,
  amount: 5,
  fee: 6,
  currency: 7,
  state: 8,
  balance: 9,
} as const

export const revolutAdapter: BankAdapter = {
  id: 'revolut',
  label: 'Revolut',
  accept: ['csv'],

  detect(input: DetectInput): number {
    const head = input.textPreview.slice(0, 400).toLowerCase().replace(/\s+/g, ' ')
    if (head.replace(/, /g, ',').includes(HEADER_SIGNATURE)) return 0.98
    if (/account-statement_.*\.csv$/i.test(input.filename)) return 0.6
    return 0
  },

  async parse(bytes: Uint8Array, _filename: string): Promise<ParsedStatement> {
    const text = decodeText(bytes, 'utf-8')
    const matrix = splitDelimited(text, ',')
    // Drop the header row and any blank/short rows.
    const rows = matrix.slice(1).filter((r) => r.length >= 10 && r.some((c) => c))
    const currency = rows.find((r) => r[COL.currency])?.[COL.currency]
    return { rows, meta: { currency } }
  },

  transform(parsed: ParsedStatement, ctx: TransformContext): CanonicalTxn[] {
    const out: CanonicalTxn[] = []
    for (const r of parsed.rows) {
      const state = (r[COL.state] || '').toUpperCase()
      if (state !== 'COMPLETED') continue // ignore PENDING/REVERTED/DECLINED
      const date = normalizeDate(r[COL.completed]) || normalizeDate(r[COL.started])
      if (!date) continue
      const kind = (r[COL.type] || '').toLowerCase()
      const raw: RawTxn = {
        date,
        amount: parseDotNumber(r[COL.amount] || '0'),
        currency: r[COL.currency] || parsed.meta.currency || 'EUR',
        description: r[COL.description] || '',
        counterparty: r[COL.description] || '',
        forceTransfer: kind.includes('topup') || kind.includes('transfer'),
        // Full raw row (incl. Started/Completed timestamps + Balance) → distinct
        // same-day transactions aren't treated as duplicates of each other.
        dedupKey: r.join('\x01'),
      }
      out.push(buildTxn(raw, ctx))
    }
    return out
  },
}
