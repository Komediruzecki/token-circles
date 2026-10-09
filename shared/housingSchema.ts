/**
 * A housing expense as the Housing page, the local-first router and the Worker accept it.
 *
 * One set of rules and one set of messages, so both runtimes refuse the same body for the same
 * reason, in the same words, and the Housing dialog runs the same check before it sends anything.
 * The two used to disagree (docs/plans/2026-10-07-form-errors.md, slice 5):
 *
 * - Local-first's API schema for housing was registered under /api/housings, a path nothing
 *   calls, so neither runtime checked more than "a name and an amount above zero", in one
 *   sentence at no field.
 * - An expense posted without a due month fell due in January on the Worker and in the current
 *   month in local-first (the contract's `housing-due-month-default`).
 * - An edit on the Worker wrote every field whether it was sent or not: a body without a name
 *   broke the row's NOT NULL rule and answered 500, and the type could not be changed at all.
 * - The answers differed (`housing-answer-shape`): 200 and 201 for a create, autopay as 0 or 1
 *   and as true or false, and local-first kept copies of the form's fields (property_name,
 *   due_day, due_month) beside the stored ones.
 *
 * The rules:
 *
 * - A name is required, at most 100 characters. It comes as `property_name`, the name the Housing
 *   form and the Worker's API always used, or `name`, the column.
 * - The type is one of the six the form offers; blank is other.
 * - The monthly amount is more than zero, at most two decimal places, below one trillion.
 * - The due month is 1 to 12; blank is the person's current month, what the form starts on. The
 *   due day is 1 to 31; blank is 1. They are stored together as `due_date`, "MM-DD".
 * - Autopay is on or off; blank is off. Notes are text.
 * - A field an edit leaves out is left alone, and so is one it sends back unchanged (decision 2).
 */
import {
  asId,
  asRecord,
  holds,
  isBlank,
  readFlag,
  readMoney,
  readText,
  type MoneyWords,
  type Read,
} from './fieldReaders';
import type { Checked, FieldErrors } from './refusal';

export const HOUSING_TYPES = [
  'rent',
  'mortgage',
  'hoa',
  'property_tax',
  'insurance',
  'other',
] as const;
export type HousingType = (typeof HOUSING_TYPES)[number];
export const HOUSING_NAME_MAX = 100;

/** The words for each refusal. A form shows them under the field; a summary joins them. */
export const HOUSING_MESSAGES = {
  name: 'Name the property or the payment.',
  nameLength: `Keep the name to ${HOUSING_NAME_MAX} characters or fewer.`,
  type: 'Choose Rent, Mortgage, HOA Fees, Property Tax, Insurance or Other.',
  amount: 'Enter the monthly amount.',
  amountNumber: 'Enter the amount as a number, like 1200.50.',
  amountPositive: 'Enter an amount more than zero.',
  amountCents: 'Use at most two decimal places, like 1200.50.',
  amountMax: 'Enter an amount below one trillion.',
  dueMonth: 'Choose the month it is due.',
  dueDay: 'Enter a day of the month from 1 to 31.',
  autopay: 'Turn autopay on or off.',
  notes: 'Write the notes as text.',
  notFound: 'Housing expense not found',
} as const;

const M = HOUSING_MESSAGES;

/** The fields a housing body may carry, as the form names them. */
export interface HousingInput {
  property_name: string;
  type: HousingType;
  monthly_amount: number;
  due_month: number;
  due_day: number;
  autopay: boolean;
  notes: string;
}

/** What a blank field means where it depends on the person. */
export interface HousingDefaults {
  /** The month a body without one falls due in: the person's current month, 1 to 12. */
  month: number;
}

/** A row as it is stored: the columns both runtimes keep and answer. */
export interface HousingRow {
  name: string;
  type: string;
  monthly_amount: number;
  due_date: string;
  autopay: boolean;
  notes: string;
}

type Field = keyof HousingInput;

const AMOUNT: MoneyWords = {
  missing: M.amount,
  number: M.amountNumber,
  range: M.amountPositive,
  cents: M.amountCents,
  max: M.amountMax,
};

/** A whole number from `min` to `max`, or `blank` when none is given. */
const wholeIn =
  (min: number, max: number, blank: () => number, message: string) =>
  (raw: unknown): Read<number> => {
    if (isBlank(raw)) return { value: blank() };
    const n = asId(raw);
    return n !== null && n >= min && n <= max ? { value: n } : { error: message };
  };

function readers(defaults: HousingDefaults): {
  [K in Field]: (raw: unknown) => Read<HousingInput[K]>;
} {
  return {
    property_name: (raw) => {
      if (typeof raw !== 'string' || raw.trim() === '') return { error: M.name };
      const name = raw.trim();
      return name.length > HOUSING_NAME_MAX ? { error: M.nameLength } : { value: name };
    },
    type: (raw) => {
      if (isBlank(raw)) return { value: 'other' };
      const type = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
      return (HOUSING_TYPES as readonly string[]).includes(type)
        ? { value: type as HousingType }
        : { error: M.type };
    },
    monthly_amount: (raw) => readMoney(raw, AMOUNT),
    due_month: wholeIn(1, 12, () => defaults.month, M.dueMonth),
    due_day: wholeIn(1, 31, () => 1, M.dueDay),
    autopay: (raw) => readFlag(raw, M.autopay, false),
    notes: (raw) => readText(raw, M.notes),
  };
}

const FIELDS: readonly Field[] = [
  'property_name',
  'type',
  'monthly_amount',
  'due_month',
  'due_day',
  'autopay',
  'notes',
];

/** The body's fields, with `name` read as the name when `property_name` is not sent. */
function bodyOf(body: unknown): Record<string, unknown> {
  const record = { ...asRecord(body) };
  if (record.property_name === undefined && record.name !== undefined) {
    record.property_name = record.name;
  }
  return record;
}

function readFields(
  record: Record<string, unknown>,
  defaults: HousingDefaults,
  only?: ReadonlySet<string>
): { value: Partial<HousingInput>; fields: FieldErrors } {
  const read = readers(defaults);
  const value: Partial<Record<Field, unknown>> = {};
  const fields: FieldErrors = {};
  for (const field of FIELDS) {
    if (only && !only.has(field)) continue;
    const result = read[field](record[field]);
    if ('error' in result) fields[field] = result.error;
    else value[field] = result.value;
  }
  return { value: value as Partial<HousingInput>, fields };
}

/** A new housing expense: every field, defaults filled in, or why not. Unknown keys are dropped. */
export function checkHousingCreate(
  body: unknown,
  defaults: HousingDefaults
): Checked<HousingInput> {
  const { value, fields } = readFields(bodyOf(body), defaults);
  return Object.keys(fields).length > 0
    ? { ok: false, fields }
    : { ok: true, value: value as HousingInput };
}

/** "MM-DD" for a month and a day. */
export function housingDueDate(month: number, day: number): string {
  return `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * A stored row as the form names its fields: the name as `property_name`, and the stored "MM-DD"
 * as `due_month` and `due_day` (undefined when it holds none).
 */
export function housingFormFields(row: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const due = typeof row.due_date === 'string' ? /^(\d{2})-(\d{2})$/.exec(row.due_date) : null;
  return {
    property_name: row.name,
    type: row.type,
    monthly_amount: row.monthly_amount,
    due_month: due ? Number(due[1]) : undefined,
    due_day: due ? Number(due[2]) : undefined,
    autopay: row.autopay,
    notes: row.notes,
  };
}

/**
 * An edit of a stored row: the columns whose value the body changes, or why not.
 *
 * A field sent with the value the row already holds is neither checked nor written, so a row an
 * older version stored (a name over 100 characters, an amount with three decimals) can still have
 * its notes changed. A due month or day that changes writes `due_date` with the other one as it
 * was (1 for a day the row never had, and the person's month for such a month).
 *
 * `stored` is the row as either runtime holds it.
 */
export function checkHousingEdit(
  body: unknown,
  stored: Readonly<Record<string, unknown>>,
  defaults: HousingDefaults
): Checked<Partial<HousingRow>> {
  const record = bodyOf(body);
  const kept = housingFormFields(stored);
  const read = readers(defaults);
  const changed = new Set<string>();
  for (const field of FIELDS) {
    const raw = record[field];
    if (raw === undefined) continue;
    // A field the row holds nothing in (a due date never set) changes when the body gives one: a
    // blank would read as its default, which would make the edit look like no change.
    const was = kept[field];
    const same = was === undefined || was === null ? isBlank(raw) : holds(read[field], raw, was);
    if (!same) changed.add(field);
  }
  const { value, fields } = readFields(record, defaults, changed);
  if (Object.keys(fields).length > 0) return { ok: false, fields };
  const edit: Partial<HousingRow> = {};
  if (value.property_name !== undefined) edit.name = value.property_name;
  if (value.type !== undefined) edit.type = value.type;
  if (value.monthly_amount !== undefined) edit.monthly_amount = value.monthly_amount;
  if (value.autopay !== undefined) edit.autopay = value.autopay;
  if (value.notes !== undefined) edit.notes = value.notes;
  if (value.due_month !== undefined || value.due_day !== undefined) {
    const month = value.due_month ?? (kept.due_month as number | undefined) ?? defaults.month;
    const day = value.due_day ?? (kept.due_day as number | undefined) ?? 1;
    edit.due_date = housingDueDate(month, day);
  }
  return { ok: true, value: edit };
}

/** A new expense's row: the columns both runtimes store. */
export function housingRowOf(input: HousingInput): HousingRow {
  return {
    name: input.property_name,
    type: input.type,
    monthly_amount: input.monthly_amount,
    due_date: housingDueDate(input.due_month, input.due_day),
    autopay: input.autopay,
    notes: input.notes,
  };
}

/** The keys a listed row answers, in both runtimes. */
export const HOUSING_ANSWER_KEYS = [
  'id',
  'profile_id',
  'name',
  'type',
  'monthly_amount',
  'due_date',
  'autopay',
  'notes',
  'created_at',
] as const;

/** A stored row as both runtimes list it: its columns, with autopay as true or false. */
export function housingAnswer(row: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const answer: Record<string, unknown> = {};
  for (const key of HOUSING_ANSWER_KEYS) answer[key] = row[key] ?? null;
  answer.autopay = row.autopay === true || row.autopay === 1;
  return answer;
}
