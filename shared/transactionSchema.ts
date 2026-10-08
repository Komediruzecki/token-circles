/**
 * A transaction as the forms, the local-first router and the Worker accept it.
 *
 * One set of rules and one set of messages, so both runtimes refuse the same body for the same
 * reason, in the same words, and the Transactions form can run the same check before it sends
 * anything. The two used to disagree (docs/plans/2026-10-07-form-errors.md, "Other entities"):
 * local-first refused a `deduction`, a body without a description or a `category_id` key, and a
 * date that was not YYYY-MM-DD; the Worker refused none of those but checked two decimals, which
 * local-first did not. And each said it in its own words: zod's issue list on the Worker, a bare
 * "Validation failed" in local-first.
 *
 * - A blank optional field takes its default, on a create and on an edit: no description is an
 *   empty one, no date is today on the person's calendar, no currency is the caller's default, no
 *   exchange rate is 1, no category or account is none.
 * - The type and a positive amount, at most two decimal places, are required.
 * - A field an edit leaves out is left alone, and so is one it sends back unchanged (decision 2).
 * - A transfer needs the account the money leaves and a different one it goes to.
 * - Checks that need the database (an account or a category of another profile) stay in the
 *   local handler and the Worker route, with their words from here.
 *
 * The forms ask for more than the runtimes do: the Transactions form also wants a description, a
 * date, and a category and an account for income and expenses (features/transactionForm.ts).
 * Imports, the MCP tools and API clients send rows without them, so the runtimes do not.
 */
import { TRANSACTION_TYPES } from './transactionInvariant';
import type { Checked, FieldErrors } from './refusal';

export type TransactionType = (typeof TRANSACTION_TYPES)[number];

/** Far above any real household's amount, and below where a double stops holding cents. */
export const TRANSACTION_AMOUNT_MAX = 1_000_000_000_000;

/** The words for each refusal. A form shows them under the field; a summary joins them. */
export const TRANSACTION_MESSAGES = {
  type: 'Choose Expense, Income or Transfer.',
  amount: 'Enter the amount.',
  amountNumber: 'Enter the amount as a number, like 12.50.',
  amountPositive: 'Enter an amount more than zero.',
  amountCents: 'Use at most two decimal places, like 12.50.',
  amountMax: 'Enter an amount below one trillion.',
  amountLocal: 'Enter the local amount as a number more than zero, or leave it blank.',
  exchangeRate: 'Enter the exchange rate as a number more than zero, or leave it blank.',
  date: 'Enter a real date, written like 2026-03-31.',
  currency: 'Choose a currency from the list.',
  category: 'Choose a category from the list, or leave it uncategorized.',
  account: 'Choose one of your accounts from the list.',
  transferFrom: 'Choose the account the money comes from.',
  transferTo: 'Choose the account the money goes to.',
  transferSame: 'Choose a different account from the one the money comes from.',
  description: 'Write the description as text.',
  beneficiary: 'Write the beneficiary as text.',
  payor: 'Write the payor as text.',
  notes: 'Write the notes as text.',
  meansOfPayment: 'Write the means of payment as text.',
  reconciled: 'Set reconciled to true or false.',
} as const;

/** What a blank field means where it depends on who asks. */
export interface TransactionDefaults {
  /**
   * Today on the person's calendar, YYYY-MM-DD: the date of a transaction sent without one. The
   * Worker reads it from the request's time zone (worker/src/local-date.ts), the browser from its
   * own clock (frontend/src/utils/period.ts, localToday).
   */
  today: string;
  /** The currency of a transaction sent without one. */
  currency: string;
}

/** The fields a transaction body may carry, in the order the form shows them. */
export interface TransactionInput {
  type: TransactionType;
  description: string;
  amount: number;
  currency: string;
  date: string;
  category_id: number | null;
  transfer_account_id: number | null;
  account_id: number | null;
  beneficiary: string;
  payor: string;
  amount_local: number | null;
  exchange_rate: number;
  notes: string;
  means_of_payment: string;
}

/** What an edit may change: any of a new transaction's fields, and whether it is reconciled. */
export interface TransactionEdit extends Partial<TransactionInput> {
  reconciled?: 0 | 1;
}

type Read<T> = { value: T } | { error: string };
type Reader<T> = (raw: unknown, defaults: TransactionDefaults) => Read<T>;

const M = TRANSACTION_MESSAGES;

const isBlank = (raw: unknown): boolean =>
  raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '');

/** A number, or a string that is one ("12.50"): what the Worker's `Number(amount)` always took. */
function asNumber(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  const number = Number(raw.trim());
  return Number.isFinite(number) ? number : null;
}

/** A positive whole number, or null: an id the body or the row gives. */
function asId(raw: unknown): number | null {
  const id = asNumber(raw);
  return id !== null && Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * Whether `amount` has no more than two decimal places. Exact for every amount these rules
 * accept: n/100 is the double nearest to the decimal that has those cents.
 */
export function hasCents(amount: number): boolean {
  return Math.round(amount * 100) / 100 === amount;
}

const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Whether `text` is a date that exists, written YYYY-MM-DD: 2026-02-29 is not one. */
export function isCalendarDate(text: string): boolean {
  const match = CALENDAR_DATE.exec(text);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (month < 1 || month > 12 || day < 1) return false;
  // Day 0 of the next month is the last day of this one. setUTCFullYear, not Date.UTC: Date.UTC
  // reads a two-digit year as 19xx.
  const last = new Date(0);
  last.setUTCFullYear(year, month, 0);
  return day <= last.getUTCDate();
}

const idReader =
  (message: string): Reader<number | null> =>
  (raw) => {
    if (isBlank(raw)) return { value: null };
    const id = asId(raw);
    return id !== null ? { value: id } : { error: message };
  };

const textReader =
  (message: string): Reader<string> =>
  (raw) => {
    if (raw === undefined || raw === null) return { value: '' };
    return typeof raw === 'string' ? { value: raw.trim() } : { error: message };
  };

const READERS: { [K in keyof Required<TransactionEdit>]: Reader<Required<TransactionEdit>[K]> } = {
  type: (raw) => {
    const type = typeof raw === 'string' ? raw.trim().toLowerCase() : raw;
    return (TRANSACTION_TYPES as readonly unknown[]).includes(type)
      ? { value: type as TransactionType }
      : { error: M.type };
  },
  description: textReader(M.description),
  amount: (raw) => {
    if (isBlank(raw)) return { error: M.amount };
    const amount = asNumber(raw);
    if (amount === null) return { error: M.amountNumber };
    if (amount <= 0) return { error: M.amountPositive };
    if (amount >= TRANSACTION_AMOUNT_MAX) return { error: M.amountMax };
    if (!hasCents(amount)) return { error: M.amountCents };
    return { value: amount };
  },
  currency: (raw, defaults) => {
    if (isBlank(raw)) return { value: defaults.currency };
    const code = typeof raw === 'string' ? raw.trim().toUpperCase() : '';
    return /^[A-Z]{3}$/.test(code) ? { value: code } : { error: M.currency };
  },
  date: (raw, defaults) => {
    if (isBlank(raw)) return { value: defaults.today };
    const text = typeof raw === 'string' ? raw.trim() : '';
    return isCalendarDate(text) ? { value: text } : { error: M.date };
  },
  category_id: idReader(M.category),
  transfer_account_id: idReader(M.account),
  account_id: idReader(M.account),
  beneficiary: textReader(M.beneficiary),
  payor: textReader(M.payor),
  amount_local: (raw) => {
    if (isBlank(raw)) return { value: null };
    const amount = asNumber(raw);
    return amount !== null && amount > 0 && amount < TRANSACTION_AMOUNT_MAX
      ? { value: amount }
      : { error: M.amountLocal };
  },
  exchange_rate: (raw) => {
    if (isBlank(raw)) return { value: 1 };
    const rate = asNumber(raw);
    return rate !== null && rate > 0 ? { value: rate } : { error: M.exchangeRate };
  },
  notes: textReader(M.notes),
  means_of_payment: textReader(M.meansOfPayment),
  reconciled: (raw) => {
    if (isBlank(raw)) return { value: 0 };
    if (raw === true || raw === 1 || raw === '1' || raw === 'true') return { value: 1 };
    if (raw === false || raw === 0 || raw === '0' || raw === 'false') return { value: 0 };
    return { error: M.reconciled };
  },
};

/** Every field of a new transaction. A create cannot set `reconciled`. */
const CREATE_FIELDS = (Object.keys(READERS) as (keyof TransactionEdit)[]).filter(
  (field) => field !== 'reconciled'
);
const EDIT_FIELDS = Object.keys(READERS) as (keyof TransactionEdit)[];

/** Fields whose value is a number, compared as one: "12.50" is the 12.5 a row holds. */
const NUMBER_FIELDS = new Set<string>(['amount', 'amount_local', 'exchange_rate']);

/** The fields that decide how a transaction moves money between accounts. */
const MONEY_FIELDS: (keyof TransactionEdit)[] = [
  'type',
  'amount',
  'amount_local',
  'account_id',
  'transfer_account_id',
];

function asRecord(body: unknown): Record<string, unknown> {
  return body !== null && typeof body === 'object' && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {};
}

function readFields(
  record: Record<string, unknown>,
  fields: readonly (keyof TransactionEdit)[],
  defaults: TransactionDefaults,
  partial: boolean
): { value: Record<string, unknown>; fields: FieldErrors } {
  const value: Record<string, unknown> = {};
  const errors: FieldErrors = {};
  for (const field of fields) {
    const raw = record[field];
    // On an edit, a field the body leaves out is not touched, so it is not checked either.
    if (partial && raw === undefined) continue;
    const read = (READERS[field] as Reader<unknown>)(raw, defaults);
    if ('error' in read) errors[field] = read.error;
    else value[field] = read.value;
  }
  return { value, fields: errors };
}

/** The money-moving fields of a whole row, as stored or as a body sends them. */
export interface TransactionMoney {
  type: unknown;
  amount: unknown;
  amount_local?: unknown;
  account_id?: unknown;
  transfer_account_id?: unknown;
}

/**
 * What is wrong with a whole row's money: the rules shared/transactionInvariant.ts keeps for the
 * balance arithmetic, at the field each is about. A transfer takes money out of one account and
 * puts it into another, so it needs both, and two different ones.
 *
 * The Worker runs this after it has resolved an account from the body's means of payment, so the
 * row it checks is the one it would store.
 */
export function transactionMoneyProblems(row: TransactionMoney): FieldErrors {
  const fields: FieldErrors = {};
  if (!(TRANSACTION_TYPES as readonly unknown[]).includes(row.type)) fields.type = M.type;
  const amount = asNumber(row.amount);
  if (amount === null || amount <= 0) fields.amount = M.amountPositive;
  if (!isBlank(row.amount_local)) {
    const local = asNumber(row.amount_local);
    if (local === null || local <= 0) fields.amount_local = M.amountLocal;
  }
  if (row.type === 'transfer') {
    const from = asId(row.account_id);
    const to = asId(row.transfer_account_id);
    if (from === null) fields.account_id = M.transferFrom;
    if (to === null) fields.transfer_account_id = M.transferTo;
    else if (from === to) fields.transfer_account_id = M.transferSame;
  }
  return fields;
}

/**
 * Each field of a new transaction on its own, defaults filled in, or why not. Unknown keys are
 * dropped. The Worker runs this, resolves accounts the body names, then
 * `transactionMoneyProblems`; everyone else runs `checkTransactionCreate`, which does both.
 */
export function checkTransactionFields(
  body: unknown,
  defaults: TransactionDefaults
): Checked<TransactionInput> {
  const read = readFields(asRecord(body), CREATE_FIELDS, defaults, false);
  return Object.keys(read.fields).length > 0
    ? { ok: false, fields: read.fields }
    : { ok: true, value: read.value as unknown as TransactionInput };
}

/** A new transaction: every field, defaults filled in, a transfer's two accounts, or why not. */
export function checkTransactionCreate(
  body: unknown,
  defaults: TransactionDefaults
): Checked<TransactionInput> {
  const read = readFields(asRecord(body), CREATE_FIELDS, defaults, false);
  // A field's own message comes first; the whole-row rules add only what no field said, so a
  // transfer with no amount and no destination has both marked at once.
  const fields: FieldErrors = { ...read.fields };
  for (const [field, message] of Object.entries(
    transactionMoneyProblems(read.value as unknown as TransactionMoney)
  )) {
    if (fields[field] === undefined) fields[field] = message;
  }
  return Object.keys(fields).length > 0
    ? { ok: false, fields }
    : { ok: true, value: read.value as unknown as TransactionInput };
}

/**
 * An edit of a stored transaction: only the fields whose value the body changes, defaults for the
 * blank ones, or why not.
 *
 * A field sent with the value the row already holds is neither checked nor written (decision 2).
 * Rows saved under older or other rules hold values these rules refuse: an amount with three
 * decimals, a date that is not YYYY-MM-DD, a transfer without a destination, an account of
 * another profile. The Transactions form sends every field on every save, so a description-only
 * edit of such a row would otherwise be refused for the rest.
 *
 * When the edit changes how the row moves money (its type, amount, local amount or accounts), the
 * row it leaves behind is checked as a whole, unchanged fields included: the balances are
 * reversed and applied again from it. A transfer made into anything else loses its destination.
 *
 * `stored` is the row as either runtime holds it, or the body a form opened with.
 */
export function checkTransactionEdit(
  body: unknown,
  stored: object,
  defaults: TransactionDefaults
): Checked<TransactionEdit> {
  const record = asRecord(body);
  const row = stored as Readonly<Record<string, unknown>>;
  const changed: Record<string, unknown> = {};
  for (const field of EDIT_FIELDS) {
    const raw = record[field];
    if (raw !== undefined && !holds(field, raw, row[field], defaults)) changed[field] = raw;
  }
  const read = readFields(changed, EDIT_FIELDS, defaults, true);
  if (Object.keys(read.fields).length > 0) return { ok: false, fields: read.fields };
  const patch = read.value as TransactionEdit;

  if (
    patch.type !== undefined &&
    patch.type !== 'transfer' &&
    patch.transfer_account_id === undefined &&
    !isBlank(row.transfer_account_id)
  ) {
    patch.transfer_account_id = null;
  }

  if (MONEY_FIELDS.some((field) => patch[field] !== undefined)) {
    const after = <K extends keyof TransactionEdit>(field: K): unknown =>
      patch[field] !== undefined ? patch[field] : row[field];
    const problems = transactionMoneyProblems({
      type: after('type'),
      amount: after('amount'),
      // A new amount with no local amount of its own moves the local amount along with it
      // (both runtimes), so the stored one is not the row's any more.
      amount_local:
        patch.amount_local !== undefined || patch.amount === undefined
          ? after('amount_local')
          : undefined,
      account_id: after('account_id'),
      transfer_account_id: after('transfer_account_id'),
    });
    if (Object.keys(problems).length > 0) return { ok: false, fields: problems };
  }
  return { ok: true, value: patch };
}

/**
 * Whether an edit's value for `field` says what the row holds. Both are read the way the field
 * reads a body: an amount sent as "12.50" is the 12.5 the row holds, an account sent as "7" is
 * the 7, and a description sent back without the stray spaces it was stored with is the same
 * description. A value these rules refuse is the same only as it is stored, except a number,
 * which is the same number however it is written.
 */
function holds(
  field: keyof TransactionEdit,
  raw: unknown,
  stored: unknown,
  defaults: TransactionDefaults
): boolean {
  if (raw === stored) return true;
  if (NUMBER_FIELDS.has(field)) {
    const sent = asNumber(raw);
    if (sent !== null && sent === asNumber(stored)) return true;
  }
  const reader = READERS[field] as Reader<unknown>;
  const sent = reader(raw, defaults);
  const kept = reader(stored, defaults);
  return 'value' in sent && 'value' in kept && sent.value === kept.value;
}
