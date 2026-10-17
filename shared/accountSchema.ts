/**
 * An account as the forms, the local-first router and the Worker accept it.
 *
 * One set of rules and one set of messages, so both runtimes refuse the same body for the same
 * reason, in the same words, and the Accounts form can run the same check before it sends
 * anything. The two used to disagree (docs/plans/2026-10-07-form-errors.md, "Other entities"):
 *
 * - Local-first refused a body without a type. The Worker made any type it did not know a giro
 *   account, so a typo or a type it never offered became one without a word.
 * - The Worker read a balance with parseFloat: "12abc" was 12, and "abc" a balance of zero. An
 *   edit with a blank name or an unknown type dropped that field and answered that it saved.
 * - Local-first stored the body as it came, keys the app never reads included, and a new
 *   account's current balance apart from its starting balance, which the next recompute undid.
 * - Local-first refused a currency that is not a three-letter code; the Worker stored the base
 *   currency in its place.
 *
 * The rules:
 *
 * - A name is required, at most 100 characters.
 * - A blank optional field takes its default: no type is a giro account, no bank name or notes
 *   are empty, no starting date is none. The type names older versions stored (checking,
 *   investment, retirement) are read as the types that replaced them.
 * - A new account's balance is its starting balance, since it has no transactions yet. A body may
 *   send either one; the starting balance wins, as the Worker always had it.
 * - A field an edit leaves out is left alone, and so is one it sends back unchanged (decision 2).
 *   An edit cannot blank a balance: there is no account without one.
 * - A currency, when the body names one, is a three-letter code. Which one it may be is up to
 *   the runtime: both keep one base currency per profile and answer another with a 409 of their
 *   own (worker/src/base-currency.ts, frontend/src/core/storage/baseCurrency.ts). No currency is
 *   the base currency.
 * - A credit card, and a Giro account's overdraft, can carry a limit and a yearly interest rate
 *   (migration 0037). No other type takes either, and an edit that makes the account another type
 *   clears both. The balance stays signed: money owed on a card is a balance below zero.
 */
import { isCalendarDate } from './transactionSchema';
import type { Checked, FieldErrors } from './refusal';

/**
 * The account types the app has: the one list every writer checks, in both runtimes (the
 * accounts routes and handlers, the import, the MCP's create_account). The app's readers keep a
 * type that is not on it and show it as a plain account (frontend/src/core/accountTypes.ts), so a
 * type a later build adds does not empty this build's account list.
 */
export const ACCOUNT_TYPES = ['giro', 'savings', 'ib', 'cash', 'credit'] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

/**
 * The types that can owe money up to a limit, at a rate: a credit card, and a Giro account with
 * an overdraft. Only these take `credit_limit` and `credit_rate`.
 */
export const CREDIT_LINE_TYPES: readonly AccountType[] = ['credit', 'giro'];

/** Whether an account of this stored type can carry a limit and an interest rate. */
export function takesCreditLine(type: unknown): boolean {
  return (CREDIT_LINE_TYPES as readonly string[]).includes(storedAccountType(type));
}

export const ACCOUNT_NAME_MAX = 100;
export const DEFAULT_ACCOUNT_TYPE: AccountType = 'giro';

/** The type names v4 replaced, which rows older versions stored still hold. */
export const LEGACY_ACCOUNT_TYPES: Readonly<Record<string, AccountType>> = {
  checking: 'giro',
  investment: 'ib',
  retirement: 'ib',
};

/**
 * A stored type as the app reads it back: none is a giro account, a name v4 replaced is the type
 * that replaced it, and any other is kept as it is. A type this build does not have (one a later
 * build adds, or one an API client stored before the writers checked) shows as a plain account,
 * and an edit sends it back unchanged.
 */
export function storedAccountType(stored: unknown): string {
  if (isBlank(stored)) return DEFAULT_ACCOUNT_TYPE;
  const type = String(stored);
  return Object.prototype.hasOwnProperty.call(LEGACY_ACCOUNT_TYPES, type)
    ? LEGACY_ACCOUNT_TYPES[type]
    : type;
}

/** What each type is, in the words an API client reads (the MCP's create_account describes them). */
export const ACCOUNT_TYPE_WORDS: Readonly<Record<AccountType, string>> = {
  giro: 'a current account',
  savings: 'a savings account',
  ib: 'an investment account',
  cash: 'cash',
  credit: 'a credit card',
};

/** Whether `value` is one of the types the app has, exactly as it stores them. */
export function isAccountType(value: unknown): value is AccountType {
  return typeof value === 'string' && (ACCOUNT_TYPES as readonly string[]).includes(value);
}

/**
 * The type a body names, read as every writer reads it: none is a giro account, a name v4 replaced
 * is the type that replaced it, and neither case nor the space around it matters. Null for a type
 * the app does not have, which a writer refuses.
 */
export function readAccountType(raw: unknown): AccountType | null {
  if (isBlank(raw)) return DEFAULT_ACCOUNT_TYPE;
  const type = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (isAccountType(type)) return type;
  return Object.prototype.hasOwnProperty.call(LEGACY_ACCOUNT_TYPES, type)
    ? LEGACY_ACCOUNT_TYPES[type]
    : null;
}

/** The words for each refusal. A form shows them under the field; a summary joins them. */
export const ACCOUNT_MESSAGES = {
  name: 'Give the account a name.',
  nameLength: `Keep the name to ${ACCOUNT_NAME_MAX} characters or fewer.`,
  type: 'Choose Giro, Savings, Investment, Cash or Credit card.',
  balance: 'Enter the balance as a number, like 1250.50.',
  startingBalance: 'Enter the starting balance as a number, like 1250.50.',
  startingDate: 'Enter a real date, written like 2026-03-31, or leave it blank.',
  currency: 'Use a three-letter currency code, like EUR.',
  bankName: 'Write the bank name as text.',
  notes: 'Write the notes as text.',
  creditLimit: 'Enter the limit as an amount of 0 or more, like 2000, or leave it blank.',
  creditRate: 'Enter the rate as a percentage from 0 to 100, like 15.9, or leave it blank.',
  creditLimitType: 'Only a credit card or a Giro account has a limit.',
  creditRateType: 'Only a credit card or a Giro account has an interest rate.',
} as const;

/** An import's refusal of an account to create whose type the app does not have, in both runtimes. */
export function importedAccountTypeError(name: string): string {
  return `"${name}" has an account type the app does not have. ${ACCOUNT_MESSAGES.type}`;
}

/** The fields an account body may carry, in the order the form shows them. */
export interface AccountInput {
  name: string;
  type: AccountType;
  bank_name: string;
  starting_balance: number;
  starting_date: string | null;
  balance: number;
  /** The code the body asks for, upper-cased. Null for none: the base currency. */
  currency: string | null;
  notes: string;
  /**
   * How much a credit card lets you owe, or how far below zero a Giro account's overdraft goes,
   * as an amount of 0 or more. Null for none given.
   */
  credit_limit: number | null;
  /**
   * The yearly percentage charged on money owed on the account, like a loan's `interest_rate`.
   * Null for none given.
   */
  credit_rate: number | null;
}

type Read<T> = { value: T } | { error: string };
type Field = keyof AccountInput;

const M = ACCOUNT_MESSAGES;

const isBlank = (raw: unknown): boolean =>
  raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '');

/** A number, or a string that is one ("1250.50"). Not parseFloat: "12abc" is not 12. */
function asNumber(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  const number = Number(raw.trim());
  return Number.isFinite(number) ? number : null;
}

/** A balance, or null for a blank one: what that means depends on the create or the edit. */
const balanceReader =
  (message: string) =>
  (raw: unknown): Read<number | null> => {
    if (isBlank(raw)) return { value: null };
    const number = asNumber(raw);
    return number !== null ? { value: number } : { error: message };
  };

/** An amount or a percentage from `min` to `max`, or null for a blank one. */
const rangeReader =
  (message: string, min: number, max: number) =>
  (raw: unknown): Read<number | null> => {
    if (isBlank(raw)) return { value: null };
    const number = asNumber(raw);
    return number !== null && number >= min && number <= max
      ? { value: number }
      : { error: message };
  };

const textReader =
  (message: string) =>
  (raw: unknown): Read<string> => {
    if (raw === undefined || raw === null) return { value: '' };
    return typeof raw === 'string' ? { value: raw.trim() } : { error: message };
  };

const READERS: { [K in Field]: (raw: unknown) => Read<AccountInput[K] | null> } = {
  name: (raw) => {
    if (typeof raw !== 'string' || raw.trim() === '') return { error: M.name };
    const name = raw.trim();
    return name.length > ACCOUNT_NAME_MAX ? { error: M.nameLength } : { value: name };
  },
  type: (raw) => {
    const type = readAccountType(raw);
    return type ? { value: type } : { error: M.type };
  },
  bank_name: textReader(M.bankName),
  starting_balance: balanceReader(M.startingBalance),
  starting_date: (raw) => {
    if (isBlank(raw)) return { value: null };
    const date = typeof raw === 'string' ? raw.trim() : '';
    return isCalendarDate(date) ? { value: date } : { error: M.startingDate };
  },
  balance: balanceReader(M.balance),
  currency: (raw) => {
    if (isBlank(raw)) return { value: null };
    const code = typeof raw === 'string' ? raw.trim().toUpperCase() : '';
    return /^[A-Z]{3}$/.test(code) ? { value: code } : { error: M.currency };
  },
  notes: textReader(M.notes),
  credit_limit: rangeReader(M.creditLimit, 0, Number.MAX_SAFE_INTEGER),
  credit_rate: rangeReader(M.creditRate, 0, 100),
};

const CREDIT_LINE_FIELDS = [
  ['credit_limit', M.creditLimitType],
  ['credit_rate', M.creditRateType],
] as const;

const FIELDS = Object.keys(READERS) as Field[];

function asRecord(body: unknown): Record<string, unknown> {
  return body !== null && typeof body === 'object' && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {};
}

/** Each field the body gives, read, or why not. `only` limits it to those keys. */
function readFields(
  body: Record<string, unknown>,
  only?: ReadonlySet<string>
): { value: Partial<Record<Field, unknown>>; fields: FieldErrors } {
  const value: Partial<Record<Field, unknown>> = {};
  const fields: FieldErrors = {};
  for (const field of FIELDS) {
    if (only && !only.has(field)) continue;
    const read = READERS[field](body[field]);
    if ('error' in read) fields[field] = read.error;
    else value[field] = read.value;
  }
  return { value, fields };
}

/**
 * A new account: every field, defaults filled in, or why not. Unknown keys are dropped. The
 * currency is the one asked for, which each runtime settles against the profile's base currency.
 */
export function checkAccountCreate(body: unknown): Checked<AccountInput> {
  const { value, fields } = readFields(asRecord(body));
  if (!fields.type && !takesCreditLine(value.type)) {
    for (const [field, message] of CREDIT_LINE_FIELDS) {
      if (value[field] !== null && value[field] !== undefined) fields[field] = message;
    }
  }
  if (Object.keys(fields).length > 0) return { ok: false, fields };
  const start = (value.starting_balance as number | null) ?? (value.balance as number | null) ?? 0;
  return {
    ok: true,
    value: { ...(value as AccountInput), starting_balance: start, balance: start },
  };
}

/**
 * An edit of a stored account: only the fields whose value the body changes, or why not.
 *
 * A field sent with the value the row already holds is neither checked nor written, so a row an
 * import or an older version stored with a name over 100 characters, a starting date that is not
 * YYYY-MM-DD or a type the app has renamed can still be edited: the Accounts form sends every
 * field it shows on every save. What the edit changes is checked like anything else.
 *
 * `stored` is the row as either runtime holds it, or the values a form opened with.
 */
export function checkAccountEdit(body: unknown, stored: object): Checked<Partial<AccountInput>> {
  const record = asRecord(body);
  const row = stored as Readonly<Record<string, unknown>>;
  const changed = new Set<string>();
  for (const field of FIELDS) {
    const raw = record[field];
    if (raw !== undefined && !holds(field, raw, row[field])) changed.add(field);
  }
  const { value, fields } = readFields(record, changed);
  // A blank balance means "work it out" on a create. On an edit there is nothing to work it from.
  if (value.balance === null) fields.balance = M.balance;
  if (value.starting_balance === null) fields.starting_balance = M.startingBalance;
  // A limit and a rate belong to a credit card or a Giro account. An edit that gives the account
  // another type takes away the ones it holds; one that sets either on another type is refused.
  if (!fields.type && !takesCreditLine(value.type ?? row.type)) {
    for (const [field, message] of CREDIT_LINE_FIELDS) {
      if (value[field] !== null && value[field] !== undefined) fields[field] = message;
      else if (value.type !== undefined && !isBlank(row[field])) value[field] = null;
    }
  }
  // A blank currency asks for nothing, so the row keeps the one it has.
  if (value.currency === null) delete value.currency;
  return Object.keys(fields).length > 0
    ? { ok: false, fields }
    : { ok: true, value: value as Partial<AccountInput> };
}

/**
 * Whether an edit's value for `field` says what the row holds. Both are read the way the field
 * reads a body: a balance sent as "1250.5", the text a form field holds, is the 1250.5 the row
 * holds. A value these rules refuse is the same only as it is stored, give or take the space
 * around it.
 */
function holds(field: Field, raw: unknown, stored: unknown): boolean {
  if (raw === stored) return true;
  if (typeof raw === 'string' && typeof stored === 'string' && raw.trim() === stored.trim()) {
    return true;
  }
  const sent = READERS[field](raw);
  const kept = READERS[field](stored);
  return 'value' in sent && 'value' in kept && sent.value === kept.value;
}
