/**
 * Sparkasse (Germany) adapter — the "CSV-CAMT" export (and its CSV-MT940
 * sibling, which shares the first five columns).
 *
 * Semicolon-delimited; classic exports are Windows-1252 with every field
 * quoted, newer portals emit UTF-8 (with BOM) unquoted — encoding is sniffed.
 * CSV-CAMT V2 header (17 columns, transliterated umlauts):
 *   "Auftragskonto";"Buchungstag";"Valutadatum";"Buchungstext";
 *   "Verwendungszweck";…;"Beguenstigter/Zahlungspflichtiger";
 *   "Kontonummer/IBAN";"BIC (SWIFT-Code)";"Betrag";"Waehrung";"Info"
 * Dates are DD.MM.YY (century pivot); the amount is signed, decimal comma, no
 * thousands separator. Rows with Info "Umsatz vorgemerkt" are pending and
 * skipped. "Auftragskonto" is the account's own IBAN.
 * Filename: YYYYMMDD-<Kontonummer>-umsatz.CSV
 *
 * Format sources: genuine exports (Athena1994/BankWebsite 2021,
 * WimpieRatte/FamilyThings 2025), camt-to-erpnext format spec, RechnungsFee
 * sample files; cross-checked against bank2ynab.conf (MIT).
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

export const sparkasseAdapter: BankAdapter = {
  id: 'sparkasse',
  label: 'Sparkasse',
  accept: ['csv'],

  detect(input: DetectInput): number {
    const head = (input.textPreview.split(/\r?\n/, 1)[0] ?? '').toLowerCase().replace(/["\s]/g, '')
    if (head.startsWith('auftragskonto;buchungstag;valutadatum;buchungstext')) return 0.97
    if (/-umsatz\.csv$/i.test(input.filename)) return 0.6
    return 0
  },

  async parse(bytes: Uint8Array, _filename: string): Promise<ParsedStatement> {
    const text = decodeTextSniffed(bytes)
    const rows = splitDelimited(text, ';').filter((r) => r.some((c) => c))
    const col = indexHeader(rows[0] ?? [])
    const first = rows[1]
    return {
      rows,
      meta: {
        iban: first?.[col.auftragskonto ?? -1] || undefined,
        currency: first?.[col.waehrung ?? -1] || undefined,
      },
    }
  },

  transform(parsed: ParsedStatement, ctx: TransformContext): CanonicalTxn[] {
    const [header, ...data] = parsed.rows
    if (!header) return []
    const col = indexHeader(header)
    const payeeIdx = col['beguenstigter/zahlungspflichtiger']
    const out: CanonicalTxn[] = []
    for (const r of data) {
      // "Umsatz vorgemerkt" = pending; it books again later with final values.
      if ((r[col.info ?? -1] || '').toLowerCase().includes('vorgemerkt')) continue
      const date =
        normalizeDate(r[col.buchungstag ?? -1]) || normalizeDate(r[col.valutadatum ?? -1])
      if (!date) continue
      const amount = parseEuropeanNumber(r[col.betrag ?? -1] || '0')
      const payee = r[payeeIdx ?? -1] || ''
      const purpose = r[col.verwendungszweck ?? -1] || ''
      const kind = r[col.buchungstext ?? -1] || ''
      const raw: RawTxn = {
        date,
        amount,
        currency: r[col.waehrung ?? -1] || parsed.meta.currency || 'EUR',
        description: purpose || kind,
        counterparty: payee,
        beneficiary: amount < 0 ? payee : undefined,
        payor: amount > 0 ? payee : undefined,
        // Kundenreferenz is often empty, so two genuinely distinct same-day/
        // payee/amount rows can collide — the preview flags them as duplicates
        // (deselected) for the user to re-check.
        dedupKey: r.join('\x01'),
      }
      out.push(buildTxn(raw, ctx))
    }
    return out
  },
}
