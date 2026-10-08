/**
 * A bill (or a subscription) as the Bills page, the subscription dialogs, the local-first router
 * and the Worker accept it.
 *
 * One set of rules and one set of messages, so both runtimes refuse the same body for the same
 * reason, in the same words, and the Bills dialog runs the same check before it sends anything.
 * The two used to disagree (docs/plans/2026-10-07-form-errors.md, "Other entities"):
 *
 * - Local-first took an amount of 0, which the Worker refused, and any number of decimals.
 * - Local-first took a frequency from five values ('daily' too, which no screen offers); the
 *   Worker stored any text, and every rule that reads one fell back to monthly.
 * - A bill saved without a day of the month stored NULL on the Worker and 1 in local-first (the
 *   contract's `day-of-month-default`), so the same bill fell due on different days.
 * - An edit with a blank name, an amount that is not a number or a due date that is not a date was
 *   stored or dropped without a word.
 *
 * The rules:
 *
 * - A name is required, at most 100 characters.
 * - The amount is more than zero, at most two decimal places, below one trillion.
 * - The due date is required: a real date, YYYY-MM-DD. It may come as `dueDate`, the name the
 *   Bills form and the Worker's API always used, or `due_date`, the column. It is the first date
 *   the bill falls due; shared/billSchedule.ts works out every one after it.
 * - The frequency is weekly, biweekly, monthly or yearly, what the form offers; blank is monthly.
 * - The day of the month is 1 to 31, or blank for none: the due date's day is the bill's day.
 * - A category and an account are optional; whether each is the profile's is the runtime's
 *   question, answered as a 400 at `category_id` or `account_id`.
 * - The type is bill or subscription; blank is bill. Autopay is on or off; blank is off.
 * - A field an edit leaves out is left alone, and so is one it sends back unchanged (decision 2).
 */
import {
  asRecord,
  holds,
  readDate,
  readFlag,
  readId,
  readMoney,
  readText,
  type MoneyWords,
  type Read,
} from './fieldReaders';
import type { Checked, FieldErrors } from './refusal';

export const BILL_FREQUENCIES = ['weekly', 'biweekly', 'monthly', 'yearly'] as const;
export type BillFrequency = (typeof BILL_FREQUENCIES)[number];
export const BILL_TYPES = ['bill', 'subscription'] as const;
export type BillType = (typeof BILL_TYPES)[number];
export const BILL_NAME_MAX = 100;

/** The words for each refusal. A form shows them under the field; a summary joins them. */
export const BILL_MESSAGES = {
  name: 'Give the bill a name.',
  nameLength: `Keep the name to ${BILL_NAME_MAX} characters or fewer.`,
  amount: 'Enter the amount.',
  amountNumber: 'Enter the amount as a number, like 12.50.',
  amountPositive: 'Enter an amount more than zero.',
  amountCents: 'Use at most two decimal places, like 12.50.',
  amountMax: 'Enter an amount below one trillion.',
  dueDate: 'Choose the date it is due.',
  dueDateReal: 'Enter a real date, written like 2026-03-31.',
  frequency: 'Choose Monthly, Weekly, Biweekly or Yearly.',
  dayOfMonth: 'Enter a day of the month from 1 to 31, or leave it blank.',
  category: 'Choose a category from the list, or leave it blank.',
  account: 'Choose one of your accounts from the list, or leave it blank.',
  type: 'Choose Regular Bill or Subscription.',
  autopay: 'Turn autopay on or off.',
  active: 'Set the bill to active or paused.',
  notes: 'Write the notes as text.',
} as const;

const M = BILL_MESSAGES;

/** The fields a bill body may carry. */
export interface BillInput {
  name: string;
  amount: number;
  due_date: string;
  frequency: BillFrequency;
  day_of_month: number | null;
  category_id: number | null;
  account_id: number | null;
  notes: string;
  type: BillType;
  autopay: boolean;
}

/** What an edit may change: any of a new bill's fields, and whether it is active. */
export interface BillEdit extends Partial<BillInput> {
  is_active?: boolean;
}

type Field = keyof Required<BillEdit>;

const AMOUNT: MoneyWords = {
  missing: M.amount,
  number: M.amountNumber,
  range: M.amountPositive,
  cents: M.amountCents,
  max: M.amountMax,
};

/** One of `allowed`, case aside; blank is `blank`. */
const oneOf =
  <T extends string>(allowed: readonly T[], blank: T, message: string) =>
  (raw: unknown): Read<T> => {
    if (raw === undefined || raw === null || raw === '') return { value: blank };
    const text = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
    return (allowed as readonly string[]).includes(text)
      ? { value: text as T }
      : { error: message };
  };

const READERS: { [K in Field]: (raw: unknown) => Read<Required<BillEdit>[K] | null> } = {
  name: (raw) => {
    if (typeof raw !== 'string' || raw.trim() === '') return { error: M.name };
    const name = raw.trim();
    return name.length > BILL_NAME_MAX ? { error: M.nameLength } : { value: name };
  },
  amount: (raw) => readMoney(raw, AMOUNT),
  due_date: (raw) => {
    const read = readDate(raw, M.dueDateReal);
    return 'value' in read && read.value === null ? { error: M.dueDate } : read;
  },
  frequency: oneOf(BILL_FREQUENCIES, 'monthly', M.frequency),
  day_of_month: (raw) => {
    const read = readId(raw, M.dayOfMonth, true);
    return 'value' in read && read.value !== null && read.value > 31
      ? { error: M.dayOfMonth }
      : read;
  },
  category_id: (raw) => readId(raw, M.category, true),
  account_id: (raw) => readId(raw, M.account, true),
  notes: (raw) => readText(raw, M.notes),
  type: oneOf(BILL_TYPES, 'bill', M.type),
  autopay: (raw) => readFlag(raw, M.autopay, false),
  is_active: (raw) => readFlag(raw, M.active, true),
};

/** A new bill's fields; whether it is active is an edit's (a new bill is). */
const CREATE_FIELDS = (Object.keys(READERS) as Field[]).filter((field) => field !== 'is_active');
const EDIT_FIELDS = Object.keys(READERS) as Field[];

/** The body's fields, with `dueDate` read as the due date when `due_date` is not sent. */
function bodyOf(body: unknown): Record<string, unknown> {
  const record = { ...asRecord(body) };
  if (record.due_date === undefined && record.dueDate !== undefined) {
    record.due_date = record.dueDate;
  }
  return record;
}

function readFields(
  body: Record<string, unknown>,
  fieldsToRead: readonly Field[],
  only?: ReadonlySet<string>
): { value: Partial<Record<Field, unknown>>; fields: FieldErrors } {
  const value: Partial<Record<Field, unknown>> = {};
  const fields: FieldErrors = {};
  for (const field of fieldsToRead) {
    if (only && !only.has(field)) continue;
    const read = READERS[field](body[field]);
    if ('error' in read) fields[field] = read.error;
    else value[field] = read.value;
  }
  return { value, fields };
}

/** A new bill: every field, defaults filled in, or why not. Unknown keys are dropped. */
export function checkBillCreate(body: unknown): Checked<BillInput> {
  const { value, fields } = readFields(bodyOf(body), CREATE_FIELDS);
  return Object.keys(fields).length > 0
    ? { ok: false, fields }
    : { ok: true, value: value as BillInput };
}

/**
 * An edit of a stored bill: only the fields whose value the body changes, or why not.
 *
 * A field sent with the value the row already holds is neither checked nor written, so a bill an
 * older version stored with an amount of 0, three decimals or a frequency no screen offers can
 * still be renamed: the Bills form sends every field it shows on every save.
 *
 * `stored` is the row as either runtime holds it, or the values a form opened with.
 */
export function checkBillEdit(body: unknown, stored: object): Checked<BillEdit> {
  const record = bodyOf(body);
  const row = stored as Readonly<Record<string, unknown>>;
  const changed = new Set<string>();
  for (const field of EDIT_FIELDS) {
    const raw = record[field];
    if (raw !== undefined && !holds(READERS[field], raw, row[field])) changed.add(field);
  }
  const { value, fields } = readFields(record, EDIT_FIELDS, changed);
  return Object.keys(fields).length > 0
    ? { ok: false, fields }
    : { ok: true, value: value as BillEdit };
}
