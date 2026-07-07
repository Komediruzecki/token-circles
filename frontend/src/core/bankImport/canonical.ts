/**
 * Bank statement import — canonical output shape.
 *
 * A canonical transaction serializes to a row whose headers the app's import
 * `autoDetectMapping` maps 1:1 onto its FIELD_NAMES. Emitting this exact header
 * set means the Bank Imports tab can hand `{ headers, rows }` straight to the
 * existing mapping → preview → execute flow with no backend changes.
 *
 * Header ↔ field alignment (see Import.tsx HEADER_VARIANTS):
 *   Date → date, Type → type, Means of Payment → means_of_payment,
 *   Category → category, Amount → amount, Currency → currency,
 *   Description → description, Beneficiary → beneficiary, Payor → payor,
 *   Notes → notes. Each is chosen so the first-match auto-detect is unambiguous.
 */
import type { CanonicalTxn } from './types'

export const CANONICAL_HEADERS = [
  'Date',
  'Type',
  'Means of Payment',
  'Category',
  'Amount',
  'Currency',
  'Description',
  'Beneficiary',
  'Payor',
  'Notes',
] as const

/** Serialize one canonical transaction into a row aligned with CANONICAL_HEADERS. */
export function txnToRow(t: CanonicalTxn): string[] {
  return [
    t.date,
    t.type,
    t.meansOfPayment,
    t.category,
    // Full precision; the app parses with parseFloat + Math.abs downstream.
    String(t.amount),
    t.currency,
    t.description,
    t.beneficiary ?? '',
    t.payor ?? '',
    t.notes ?? '',
  ]
}

/** Build a `{ headers, rows }` table (the shape the mapping step consumes). */
export function txnsToTable(txns: CanonicalTxn[]): { headers: string[]; rows: string[][] } {
  return { headers: [...CANONICAL_HEADERS], rows: txns.map(txnToRow) }
}
