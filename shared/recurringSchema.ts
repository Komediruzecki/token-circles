/**
 * A recurring rule as the Recurring section, the local-first router and the Worker accept it: a
 * transaction to add on a schedule, from its next date on.
 *
 * One set of rules and one set of messages, so both runtimes refuse the same body for the same
 * reason, in the same words, and the Recurring dialog runs the same check before it sends
 * anything. The two used to disagree (docs/plans/2026-10-07-form-errors.md, slice 5):
 *
 * - Local-first's zod schema required a description, a type and a frequency from its lists and a
 *   next date, and said so in zod's terms. The Worker required none of them, stored any type or
 *   frequency it was sent, and refused only what the transaction rules refuse, in one sentence at
 *   no field.
 * - A rule saved without a day of the month stored NULL on the Worker and 1 in local-first (the
 *   contract's `day-of-month-default`).
 * - A link to another profile's category or account was refused with 403 on the Worker and 400 in
 *   local-first, at no field (`foreign-link-status`). An edit on the Worker checked every link the
 *   rule held, whether the edit sent it or not.
 * - A rule was paused with `active` on the Worker and `is_active` in local-first, and each ignored
 *   the other's (`recurring-pause`).
 *
 * The rules:
 *
 * - A description is required.
 * - The amount is more than zero, at most two decimal places, below one trillion.
 * - The type is expense, income or transfer, what the form offers; blank is expense.
 * - The frequency is daily, weekly, monthly or yearly; blank is monthly.
 * - The day of the month is 1 to 31, or blank for none: the next date's day is the rule's day.
 *   It may come as `day`, the name local-first also read.
 * - The next date is required: a real date, YYYY-MM-DD.
 * - A category and an account are optional; whether each is the profile's is the runtime's
 *   question, answered as a 400 at its field. A transfer needs the account the money comes from
 *   and a different one it goes to; any other type goes to no account.
 * - Notes are text. An edit can pause a rule with `active`, or `is_active` as local-first named it.
 * - A field an edit leaves out is left alone, and so is one it sends back unchanged (decision 2).
 */
import {
  asId,
  asRecord,
  holds,
  isBlank,
  readDate,
  readFlag,
  readId,
  readMoney,
  readText,
  type MoneyWords,
  type Read,
} from './fieldReaders';
import type { Checked, FieldErrors } from './refusal';

export const RECURRING_TYPES = ['expense', 'income', 'transfer'] as const;
export type RecurringType = (typeof RECURRING_TYPES)[number];
export const RECURRING_FREQUENCIES = ['daily', 'weekly', 'monthly', 'yearly'] as const;
export type RecurringFrequency = (typeof RECURRING_FREQUENCIES)[number];

/** The words for each refusal. A form shows them under the field; a summary joins them. */
export const RECURRING_MESSAGES = {
  description: 'Describe the payment, like Rent or Salary.',
  amount: 'Enter the amount.',
  amountNumber: 'Enter the amount as a number, like 12.50.',
  amountPositive: 'Enter an amount more than zero.',
  amountCents: 'Use at most two decimal places, like 12.50.',
  amountMax: 'Enter an amount below one trillion.',
  type: 'Choose Expense, Income or Transfer.',
  frequency: 'Choose Daily, Weekly, Monthly or Yearly.',
  dayOfMonth: 'Enter a day of the month from 1 to 31, or leave it blank.',
  nextDate: 'Choose the date it is next due.',
  nextDateReal: 'Enter a real date, written like 2026-03-31.',
  category: 'Choose a category from the list, or leave it blank.',
  account: 'Choose one of your accounts from the list, or leave it blank.',
  transferAccount: 'Choose one of your accounts from the list.',
  transferFrom: 'Choose the account the money comes from.',
  transferTo: 'Choose the account the money goes to.',
  transferSame: 'Choose a different account from the one the money comes from.',
  notes: 'Write the notes as text.',
  active: 'Set the rule to active or paused.',
  notFound: 'Recurring transaction not found',
  populated: 'This period is already in your transactions.',
  unreadableNextDate: "This rule's next date can't be read. Edit the rule and set its date again.",
} as const;

const M = RECURRING_MESSAGES;

/** The fields a new rule's body may carry, in the order the form shows them. */
export interface RecurringInput {
  description: string;
  amount: number;
  type: RecurringType;
  frequency: RecurringFrequency;
  day_of_month: number | null;
  next_date: string;
  account_id: number | null;
  transfer_account_id: number | null;
  category_id: number | null;
  notes: string;
}

/** What an edit may change: any of a new rule's fields, and whether it is active. */
export interface RecurringEdit extends Partial<RecurringInput> {
  active?: boolean;
}

type Field = keyof Required<RecurringEdit>;

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
    if (isBlank(raw)) return { value: blank };
    const text = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
    return (allowed as readonly string[]).includes(text)
      ? { value: text as T }
      : { error: message };
  };

const READERS: { [K in Field]: (raw: unknown) => Read<Required<RecurringEdit>[K]> } = {
  description: (raw) =>
    typeof raw === 'string' && raw.trim() !== '' ? { value: raw.trim() } : { error: M.description },
  amount: (raw) => readMoney(raw, AMOUNT),
  type: oneOf(RECURRING_TYPES, 'expense', M.type),
  frequency: oneOf(RECURRING_FREQUENCIES, 'monthly', M.frequency),
  day_of_month: (raw) => {
    const read = readId(raw, M.dayOfMonth, true);
    return 'value' in read && read.value !== null && read.value > 31
      ? { error: M.dayOfMonth }
      : read;
  },
  next_date: (raw) => {
    const read = readDate(raw, M.nextDateReal);
    return 'value' in read && read.value === null ? { error: M.nextDate } : (read as Read<string>);
  },
  account_id: (raw) => readId(raw, M.account, true),
  transfer_account_id: (raw) => readId(raw, M.transferAccount, true),
  category_id: (raw) => readId(raw, M.category, true),
  notes: (raw) => readText(raw, M.notes),
  active: (raw) => readFlag(raw, M.active, true),
};

/** A new rule's fields; whether it is active is an edit's (a new rule is). */
const CREATE_FIELDS = (Object.keys(READERS) as Field[]).filter((field) => field !== 'active');
const EDIT_FIELDS = Object.keys(READERS) as Field[];

/** The fields that decide which accounts a rule's transactions move money between. */
const ACCOUNT_FIELDS: readonly Field[] = ['type', 'account_id', 'transfer_account_id'];

/** The body's fields, with `day` read as the day of the month and `is_active` as `active`. */
function bodyOf(body: unknown): Record<string, unknown> {
  const record = { ...asRecord(body) };
  if (record.day_of_month === undefined && record.day !== undefined) {
    record.day_of_month = record.day;
  }
  if (record.active === undefined && record.is_active !== undefined) {
    record.active = record.is_active;
  }
  return record;
}

function readFields(
  record: Record<string, unknown>,
  fieldsToRead: readonly Field[],
  only?: ReadonlySet<string>
): { value: Partial<Record<Field, unknown>>; fields: FieldErrors } {
  const value: Partial<Record<Field, unknown>> = {};
  const fields: FieldErrors = {};
  for (const field of fieldsToRead) {
    if (only && !only.has(field)) continue;
    const read = READERS[field](record[field]);
    if ('error' in read) fields[field] = read.error;
    else value[field] = read.value;
  }
  return { value, fields };
}

/**
 * What is wrong with a rule's accounts, at the field each is about: a transfer takes money out of
 * one account and puts it into another, so it needs both, and two different ones.
 */
export function recurringAccountProblems(rule: {
  type?: unknown;
  account_id?: unknown;
  transfer_account_id?: unknown;
}): FieldErrors {
  if (rule.type !== 'transfer') return {};
  const fields: FieldErrors = {};
  const from = asId(rule.account_id);
  const to = asId(rule.transfer_account_id);
  if (from === null) fields.account_id = M.transferFrom;
  if (to === null) fields.transfer_account_id = M.transferTo;
  else if (from === to) fields.transfer_account_id = M.transferSame;
  return fields;
}

/** Each of `problems` that no field has a message for already. */
function addProblems(fields: FieldErrors, problems: FieldErrors): void {
  for (const [field, message] of Object.entries(problems)) {
    if (fields[field] === undefined) fields[field] = message;
  }
}

/**
 * A new rule: every field, defaults filled in, a transfer's two accounts, or why not. Unknown
 * keys are dropped, and a rule that is not a transfer goes to no account.
 */
export function checkRecurringCreate(body: unknown): Checked<RecurringInput> {
  const { value, fields } = readFields(bodyOf(body), CREATE_FIELDS);
  addProblems(fields, recurringAccountProblems(value));
  if (Object.keys(fields).length > 0) return { ok: false, fields };
  const rule = value as unknown as RecurringInput;
  if (rule.type !== 'transfer') rule.transfer_account_id = null;
  return { ok: true, value: rule };
}

/**
 * An edit of a stored rule: only the fields whose value the body changes, or why not.
 *
 * A field sent with the value the rule already holds is neither checked nor written, so a rule an
 * older version stored (no description, a frequency no screen offers, a type the form does not)
 * can still have its amount changed: the Recurring form sends every field on every save. When the
 * edit changes the type or an account, the rule it leaves behind is checked as a whole, and one
 * made into anything but a transfer goes to no account.
 *
 * `stored` is the rule as either runtime holds it, or the values a form opened with.
 */
export function checkRecurringEdit(body: unknown, stored: object): Checked<RecurringEdit> {
  const record = bodyOf(body);
  const row = bodyOf(stored);
  const changed = new Set<string>();
  for (const field of EDIT_FIELDS) {
    const raw = record[field];
    if (raw !== undefined && !holds(READERS[field], raw, row[field])) changed.add(field);
  }
  const { value, fields } = readFields(record, EDIT_FIELDS, changed);
  const edit = value as RecurringEdit;
  if (edit.type !== undefined && edit.type !== 'transfer' && !isBlank(row.transfer_account_id)) {
    edit.transfer_account_id = null;
  }
  // Only a transfer goes to a second account: one sent for any other rule is left out, and one an
  // older rule holds is cleared.
  const typeAfter = edit.type ?? row.type;
  if (typeAfter !== 'transfer' && !isBlank(edit.transfer_account_id)) {
    if (isBlank(row.transfer_account_id)) delete edit.transfer_account_id;
    else edit.transfer_account_id = null;
  }
  if (ACCOUNT_FIELDS.some((field) => changed.has(field))) {
    // The rule after the edit. A field the edit gets wrong has its own message already.
    const after = (field: Field): unknown =>
      fields[field] !== undefined ? undefined : field in edit ? edit[field] : row[field];
    addProblems(
      fields,
      recurringAccountProblems({
        type: after('type'),
        account_id: after('account_id'),
        transfer_account_id: after('transfer_account_id'),
      })
    );
  }
  return Object.keys(fields).length > 0 ? { ok: false, fields } : { ok: true, value: edit };
}

/**
 * Whether a stored rule is active: `active` as the Worker and now local-first store it, or
 * `is_active` on a rule an older local-first version stored. A rule with neither is active.
 */
export function recurringIsActive(row: Readonly<Record<string, unknown>>): boolean {
  const flag = row.active ?? row.is_active;
  return !(flag === 0 || flag === false || flag === '0' || flag === 'false');
}
