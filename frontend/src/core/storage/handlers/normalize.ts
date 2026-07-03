/**
 * Response normalizers for the serverless (IndexedDB) handlers.
 *
 * The ApiClient validates every response against the schemas in src/schemas/models.ts.
 * Rows written by older seed/import code can miss now-required fields (categories without
 * icon/parent_id/created_at, transactions without beneficiary/payor/exchange_rate) or hold
 * legacy enum values (account type 'checking', renamed to 'giro' in v4). Without these
 * defaults every list call on such data fails zod validation — which is exactly how demo
 * mode broke. Normalizing at the read boundary fixes existing installs; the demo seeder
 * writes complete rows for new ones.
 */

type Row = Record<string, unknown>

/** v4 renamed account types (checking→giro, investment/retirement→ib); existing IndexedDB
 * rows seeded by older builds may still hold the legacy values. */
const LEGACY_ACCOUNT_TYPES: Record<string, string> = {
  checking: 'giro',
  investment: 'ib',
  retirement: 'ib',
}

export function normalizeCategory<T>(cat: T): T {
  return { icon: '', parent_id: null, created_at: '', ...(cat as Row) } as T
}

export function normalizeAccount<T>(acct: T): T {
  const a: Row = { notes: '', ...(acct as Row) }
  const type = String(a.type)
  if (type in LEGACY_ACCOUNT_TYPES) a.type = LEGACY_ACCOUNT_TYPES[type]
  return a as T
}

export function normalizeTransaction<T>(tx: T): T {
  return {
    beneficiary: '',
    payor: '',
    notes: '',
    amount_local: null,
    exchange_rate: 1,
    created_at: '',
    updated_at: '',
    ...(tx as Row),
  } as T
}
