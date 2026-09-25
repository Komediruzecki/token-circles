/**
 * Response normalizers for the serverless (IndexedDB) handlers.
 *
 * The ApiClient validates every response against the schemas in src/schemas/models.ts.
 * Rows written by older seed/import code can miss now-required fields (categories without
 * icon/parent_id/created_at, transactions without beneficiary/payor/exchange_rate, budgets,
 * goals and loans without created_at, bills without last_paid_date/next_due_date) or hold
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

/*
 * Budgets, goals, loans and bills. A Worker row has every D1 column, holding a value, its default
 * or NULL, so their schemas require these keys. Rows the demo seed and the local handlers wrote
 * before they filled them in lack them, and zod rejects an absent key even where it accepts null.
 */

export function normalizeBudget<T>(budget: T): T {
  return { end_date: null, created_at: '', ...(budget as Row) } as T
}

export function normalizeSavingsGoal<T>(goal: T): T {
  const g = goal as Row
  // The Goals form sends `target_date`, and the Worker stores it as `deadline`. Local goals
  // created before the handler did the same hold the date under `target_date` only.
  return { current_amount: 0, deadline: g.target_date || null, created_at: '', ...g } as T
}

export function normalizeLoan<T>(loan: T): T {
  return { created_at: '', ...(loan as Row) } as T
}

export function normalizeBill<T>(bill: T): T {
  return { category_id: null, last_paid_date: null, next_due_date: null, ...(bill as Row) } as T
}
