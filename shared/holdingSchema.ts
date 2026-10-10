/**
 * A holding as the Portfolio page, the local-first router and the Worker accept it: a number of
 * shares of one ticker, bought on a date at a price per share.
 *
 * One set of rules and one set of messages, so both runtimes refuse the same body for the same
 * reason, in the same words, and the Portfolio dialog runs the same check before it sends anything.
 * The two used to disagree (docs/plans/2026-10-07-form-errors.md, slice 5):
 *
 * - The Worker refused a body without one of the four fields in one sentence, "ticker, shares,
 *   purchase_price, and purchase_date are required", at no field, and took anything else it was
 *   given: a price below zero, a date of "soon", a ticker of any length.
 * - Local-first's zod schema refused a ticker over 10 characters and a date not written
 *   YYYY-MM-DD, in zod's words, and ran on an edit as if it were a new holding, so an edit had to
 *   send every field.
 * - An edit on the Worker wrote every field, and one it could not read answered 500; a blank
 *   ticker or date kept the stored one without a word.
 *
 * The rules:
 *
 * - The ticker is required: trimmed, in capitals, at most 20 characters ("VWCE.DE" and "BRK-B"
 *   are tickers too).
 * - Shares and the price per share are more than zero and below one trillion, with no limit on
 *   decimal places: a broker sells a fraction of a share, and prices in fractions of a cent.
 * - The purchase date is required, a real date written YYYY-MM-DD.
 * - Notes are text.
 * - A field an edit leaves out is left alone, and so is one it sends back unchanged (decision 2).
 */
import { asNumber, asRecord, holds, isBlank, MONEY_MAX, readText, type Read } from './fieldReaders';
import { isCalendarDate } from './transactionSchema';
import type { Checked, FieldErrors } from './refusal';

export const HOLDING_TICKER_MAX = 20;

/** The words for each refusal. A form shows them under the field; a summary joins them. */
export const HOLDING_MESSAGES = {
  ticker: 'Enter the ticker symbol.',
  tickerLength: `Keep the ticker to ${HOLDING_TICKER_MAX} characters or fewer.`,
  shares: 'Enter the number of shares.',
  sharesNumber: 'Enter the shares as a number, like 10 or 2.5.',
  sharesPositive: 'Enter more than zero shares.',
  sharesMax: 'Enter fewer than one trillion shares.',
  price: 'Enter the price you paid per share.',
  priceNumber: 'Enter the price as a number, like 101.25.',
  pricePositive: 'Enter a price more than zero.',
  priceMax: 'Enter a price below one trillion.',
  date: 'Choose the date you bought the shares.',
  dateReal: 'Enter a real date, written like 2026-02-10.',
  notes: 'Write the notes as text.',
  notFound: 'Holding not found',
} as const;

const M = HOLDING_MESSAGES;

/** The fields a holding body may carry, as the form and the columns both name them. */
export interface HoldingInput {
  ticker: string;
  shares: number;
  purchase_price: number;
  purchase_date: string;
  notes: string;
}

type Field = keyof HoldingInput;

/** What to say about a number of shares or a price that cannot be stored. */
interface QuantityWords {
  missing: string;
  number: string;
  positive: string;
  max: string;
}

/** A number more than zero and below one trillion, with any number of decimal places. */
const quantity =
  (words: QuantityWords) =>
  (raw: unknown): Read<number> => {
    if (isBlank(raw)) return { error: words.missing };
    const n = asNumber(raw);
    if (n === null) return { error: words.number };
    if (n <= 0) return { error: words.positive };
    if (n >= MONEY_MAX) return { error: words.max };
    return { value: n };
  };

const READ: { [K in Field]: (raw: unknown) => Read<HoldingInput[K]> } = {
  ticker: (raw) => {
    const text = typeof raw === 'number' && Number.isFinite(raw) ? String(raw) : raw;
    if (typeof text !== 'string' || text.trim() === '') return { error: M.ticker };
    const ticker = text.trim().toUpperCase();
    return ticker.length > HOLDING_TICKER_MAX ? { error: M.tickerLength } : { value: ticker };
  },
  shares: quantity({
    missing: M.shares,
    number: M.sharesNumber,
    positive: M.sharesPositive,
    max: M.sharesMax,
  }),
  purchase_price: quantity({
    missing: M.price,
    number: M.priceNumber,
    positive: M.pricePositive,
    max: M.priceMax,
  }),
  purchase_date: (raw) => {
    if (isBlank(raw)) return { error: M.date };
    const date = typeof raw === 'string' ? raw.trim() : '';
    return isCalendarDate(date) ? { value: date } : { error: M.dateReal };
  },
  notes: (raw) => readText(raw, M.notes),
};

const FIELDS: readonly Field[] = ['ticker', 'shares', 'purchase_price', 'purchase_date', 'notes'];

function readFields(
  record: Record<string, unknown>,
  only?: ReadonlySet<string>
): { value: Partial<HoldingInput>; fields: FieldErrors } {
  const value: Partial<Record<Field, unknown>> = {};
  const fields: FieldErrors = {};
  for (const field of FIELDS) {
    if (only && !only.has(field)) continue;
    const result = READ[field](record[field]);
    if ('error' in result) fields[field] = result.error;
    else value[field] = result.value;
  }
  return { value: value as Partial<HoldingInput>, fields };
}

/** A new holding: every field, read and trimmed, or why not. Unknown keys are dropped. */
export function checkHoldingCreate(body: unknown): Checked<HoldingInput> {
  const { value, fields } = readFields(asRecord(body));
  return Object.keys(fields).length > 0
    ? { ok: false, fields }
    : { ok: true, value: value as HoldingInput };
}

/**
 * An edit of a stored holding: the fields whose value the body changes, or why not.
 *
 * A field sent with the value the row already holds is neither checked nor written, so a holding
 * an older version stored (a ticker over 20 characters, a price below zero) can still have its
 * notes changed. `stored` is the row as either runtime holds it.
 */
export function checkHoldingEdit(
  body: unknown,
  stored: Readonly<Record<string, unknown>>
): Checked<Partial<HoldingInput>> {
  const record = asRecord(body);
  const changed = new Set<string>();
  for (const field of FIELDS) {
    const raw = record[field];
    if (raw !== undefined && !holds(READ[field], raw, stored[field])) changed.add(field);
  }
  const { value, fields } = readFields(record, changed);
  return Object.keys(fields).length > 0 ? { ok: false, fields } : { ok: true, value };
}

/**
 * A number of shares or a price the app works out (a merged position's shares, its average
 * price), or shows in a field, without the error floating point leaves on a sum or a division:
 * 0.1 + 0.2 shares are 0.3, and 101.69999999999999 / 10 is 10.17. Eight decimal places keep any
 * fraction of a share a broker sells.
 */
export function toHoldingPrecision(value: number): number {
  return Number(value.toFixed(8));
}
