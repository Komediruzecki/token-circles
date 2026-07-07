/**
 * Bank statement import — shared types.
 *
 * The subsystem turns a bank's raw CSV/XLS statement into the app's canonical
 * import row shape (see `canonical.ts`), which the existing column-mapping →
 * preview → `/api/import/execute` pipeline consumes unchanged. Adding a bank is
 * a matter of implementing `BankAdapter` and registering it in `registry.ts`.
 */

/** Supported bank identifiers. Extend by adding an adapter + a registry entry. */
export type BankId = 'revolut' | 'erste' | 'pbz'

/**
 * Transaction type in the app's canonical vocabulary. `/api/import/execute`
 * lowercases these and matches 'income' | 'expense' | 'transfer'.
 */
export type CanonicalType = 'Expense' | 'Income' | 'Transfer'

/** One decoded-but-untransformed row from a statement (a matrix row of cells). */
export type RawRow = string[]

/**
 * A single normalized transaction in the app's canonical import shape. Field
 * names map 1:1 to the app's import FIELD_NAMES so the existing auto-detection
 * and execute pipeline consume them without changes.
 */
export interface CanonicalTxn {
  /** yyyy-mm-dd preferred (the app re-normalizes, but adapters emit ISO). */
  date: string
  type: CanonicalType
  /** Source/primary account name — links to an existing app account by name. */
  meansOfPayment: string
  /** Category name, or the destination account name for a resolved transfer. */
  category: string
  /** Absolute value; the app applies Math.abs and derives direction from `type`. */
  amount: number
  currency: string
  description: string
  beneficiary?: string
  payor?: string
  notes?: string
}

/** Statement-level metadata sniffed during parsing (used for account routing). */
export interface StatementMeta {
  iban?: string
  currency?: string
  /** Last 4 digits of the account/card, when present in the statement. */
  accountLast4?: string
  holder?: string
}

/** A parsed statement: the raw data rows plus sniffed metadata. */
export interface ParsedStatement {
  rows: RawRow[]
  meta: StatementMeta
}

/** Input handed to `BankAdapter.detect()` for signature matching. */
export interface DetectInput {
  filename: string
  /** First few KB decoded as UTF-8 (best-effort; empty/garbage for binary files). */
  textPreview: string
  /** Raw bytes, for magic-number sniffing (e.g. the XLS OLE header). */
  bytes: Uint8Array
}

/** A category keyword rule: match any keyword in the text → assign `category`. */
export interface CategoryRule {
  category: string
  keywords: string[]
}
export type CategoryRuleSet = CategoryRule[]

/** Transfer-detection configuration. */
export interface TransferRuleSet {
  /** Account names the user owns — both endpoints of an internal transfer. */
  ownAccounts: string[]
  /** Description keywords that indicate a transfer (e.g. 'top-up', 'transfer'). */
  keywords: string[]
  /**
   * Map a counterpart signature (a lowercased keyword or a card's last 4 digits)
   * to a known account name, so a two-sided transfer can name its other endpoint.
   * E.g. { '1399': 'Erste Current', 'ibkr': 'IB' }.
   */
  counterparts: Record<string, string>
}

/** Context passed to `BankAdapter.transform()`. */
export interface TransformContext {
  /** The app account this statement belongs to (auto-resolved or user-picked). */
  targetAccount: string
  categoryRules: CategoryRuleSet
  transferRules: TransferRuleSet
  /** The user's known account names — for counterpart resolution + account typing. */
  knownAccounts: string[]
}

/**
 * A pluggable bank adapter. Adding a bank = implement this and register it.
 * `parse` and `transform` are split so parsing (I/O-ish, format-specific) is
 * independently testable from the business transform.
 */
export interface BankAdapter {
  id: BankId
  label: string
  /** Accepted file extensions (lowercase, no dot), e.g. ['csv'] or ['xls']. */
  accept: string[]
  /** Confidence in [0, 1] that this file belongs to this bank. */
  detect(input: DetectInput): number
  /** Decode + split the file into a raw table plus statement metadata. */
  parse(bytes: Uint8Array, filename: string): Promise<ParsedStatement>
  /** Transform raw rows into canonical transactions. */
  transform(parsed: ParsedStatement, ctx: TransformContext): CanonicalTxn[]
}
