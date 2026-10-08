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
 */
import { isCalendarDate } from './transactionSchema';
import type { Checked, FieldErrors } from './refusal';

export const ACCOUNT_TYPES = ['giro', 'savings', 'ib', 'cash'] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const ACCOUNT_NAME_MAX = 100;
export const DEFAULT_ACCOUNT_TYPE: AccountType = 'giro';

/** The type names v4 replaced, which rows older versions stored still hold. */
export const LEGACY_ACCOUNT_TYPES: Readonly<Record<string, AccountType>> = {
  checking: 'giro',
  investment: 'ib',
  retirement: 'ib',
};

/** The words for each refusal. A form shows them under the field; a summary joins them. */
export const ACCOUNT_MESSAGES = {
  name: 'Give the account a name.',
  nameLength: `Keep the name to ${ACCOUNT_NAME_MAX} characters or fewer.`,
  type: 'Choose Giro, Savings, Investment or Cash.',
  balance: 'Enter the balance as a number, like 1250.50.',
  startingBalance: 'Enter the starting balance as a number, like 1250.50.',
  startingDate: 'Enter a real date, written like 2026-03-31, or leave it blank.',
  currency: 'Use a three-letter currency code, like EUR.',
  bankName: 'Write the bank name as text.',
  notes: 'Write the notes as text.',
} as const;

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
    if (isBlank(raw)) return { value: DEFAULT_ACCOUNT_TYPE };
    const type = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
    if ((ACCOUNT_TYPES as readonly string[]).includes(type)) return { value: type as AccountType };
    const renamed = Object.prototype.hasOwnProperty.call(LEGACY_ACCOUNT_TYPES, type)
      ? LEGACY_ACCOUNT_TYPES[type]
      : undefined;
    return renamed ? { value: renamed } : { error: M.type };
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
};

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
