/**
 * How the budget, savings goal and bill checks read a body's values: a number, an id, a date, an
 * amount of money, a yes or no, or text, each with the words for what is wrong with it.
 *
 * Plain TypeScript, like every shared check, because the Worker and the browser both import it
 * (docs/plans/2026-10-07-form-errors.md). The transaction and account checks keep their own copies
 * of the first few; these are the same rules.
 */
import { hasCents, isCalendarDate } from './transactionSchema';

/** A value read from a body, or the words for why it could not be. */
export type Read<T> = { value: T } | { error: string };

/** Far above any real household's amount, and below where a double stops holding cents. */
export const MONEY_MAX = 1_000_000_000_000;

export const isBlank = (raw: unknown): boolean =>
  raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '');

/** A number, or a string that is one ("12.50"). Not parseFloat: "12abc" is not 12. */
export function asNumber(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  const number = Number(raw.trim());
  return Number.isFinite(number) ? number : null;
}

/** A positive whole number, or null: an id the body or the row gives. */
export function asId(raw: unknown): number | null {
  const id = asNumber(raw);
  return id !== null && Number.isInteger(id) && id > 0 ? id : null;
}

/** The body as a record of fields; anything else has none. */
export function asRecord(body: unknown): Record<string, unknown> {
  return body !== null && typeof body === 'object' && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {};
}

/** What to say about an amount of money that cannot be stored. */
export interface MoneyWords {
  /** Nothing was given where an amount is required. */
  missing: string;
  /** Not a number. */
  number: string;
  /** Below the least it may be: zero, or for some amounts anything up to zero. */
  range: string;
  /** More than two decimal places. */
  cents: string;
  /** One trillion or more. */
  max: string;
}

/**
 * An amount of money: a number (or a string that is one), at most two decimal places, below one
 * trillion, and more than zero, or zero or more with `zero`.
 */
export function readMoney(raw: unknown, words: MoneyWords, zero = false): Read<number> {
  if (isBlank(raw)) return { error: words.missing };
  const amount = asNumber(raw);
  if (amount === null) return { error: words.number };
  if (amount < 0 || (amount === 0 && !zero)) return { error: words.range };
  if (amount >= MONEY_MAX) return { error: words.max };
  if (!hasCents(amount)) return { error: words.cents };
  return { value: amount };
}

/** An id the person picks from a list, or null for none when `optional`. */
export function readId(raw: unknown, message: string, optional: boolean): Read<number | null> {
  if (isBlank(raw)) return optional ? { value: null } : { error: message };
  const id = asId(raw);
  return id !== null ? { value: id } : { error: message };
}

/** A date written YYYY-MM-DD that exists, or null for a blank one. */
export function readDate(raw: unknown, message: string): Read<string | null> {
  if (isBlank(raw)) return { value: null };
  const text = typeof raw === 'string' ? raw.trim() : '';
  return isCalendarDate(text) ? { value: text } : { error: message };
}

/** Yes or no: a boolean, 1 or 0, or the words true and false. Blank is `blank`. */
export function readFlag(raw: unknown, message: string, blank: boolean): Read<boolean> {
  if (isBlank(raw)) return { value: blank };
  if (raw === true || raw === 1 || raw === 'true' || raw === '1') return { value: true };
  if (raw === false || raw === 0 || raw === 'false' || raw === '0') return { value: false };
  return { error: message };
}

/** Text, trimmed. Missing is empty. */
export function readText(raw: unknown, message: string): Read<string> {
  if (raw === undefined || raw === null) return { value: '' };
  return typeof raw === 'string' ? { value: raw.trim() } : { error: message };
}

/**
 * Whether an edit's `raw` says what the row already holds, read the way `read` reads the field: an
 * amount sent as "250.5" is the 250.5 the row holds, and 1 is the `true` a flag reads it as. A value
 * the field refuses is the same only as it is stored, give or take the space around it.
 */
export function holds(
  read: (raw: unknown) => Read<unknown>,
  raw: unknown,
  stored: unknown
): boolean {
  if (raw === stored) return true;
  if (typeof raw === 'string' && typeof stored === 'string' && raw.trim() === stored.trim()) {
    return true;
  }
  const sent = read(raw);
  const kept = read(stored);
  return 'value' in sent && 'value' in kept && sent.value === kept.value;
}
