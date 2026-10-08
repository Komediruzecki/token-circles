/**
 * A savings goal, and a contribution to one, as the Goals page, the local-first router and the
 * Worker accept them.
 *
 * One set of rules and one set of messages, so both runtimes refuse the same body for the same
 * reason, in the same words, and the Goals dialog runs the same check before it sends anything.
 * The two used to disagree (docs/plans/2026-10-07-form-errors.md, "Other entities"):
 *
 * - Local-first required a target more than zero; the Worker took zero, which no progress can be
 *   measured against.
 * - A goal saved without a monthly amount or a tracking date stored 0 and today on the Worker, and
 *   null and nothing in local-first (the contract's `goal-unsent-defaults`).
 * - A contribution the Worker could not read as a number added nothing and answered that it had;
 *   local-first added it as text, so 100 and "50" made "10050".
 * - Local-first stored the body as it came, keys the app never reads included.
 *
 * The rules:
 *
 * - A name is required, at most 100 characters.
 * - The target is more than zero; what is saved so far and the monthly amount are zero or more.
 *   Each is at most two decimal places, below one trillion.
 * - The target date is a real date or blank for none. It may come as `deadline`, the column, or
 *   `target_date`, the name the Goals form uses.
 * - A category is optional; whether it is the profile's is the runtime's question, answered as a
 *   400 at `category_id`. A category goal counts its category's transactions from the tracking
 *   date, which is today when a new goal gives none.
 * - A field an edit leaves out is left alone, and so is one it sends back unchanged (decision 2).
 * - A contribution is an amount more than zero, at most two decimal places.
 */
import {
  asNumber,
  asRecord,
  holds,
  readDate,
  readId,
  readMoney,
  readText,
  type MoneyWords,
  type Read,
} from './fieldReaders';
import type { Checked, FieldErrors } from './refusal';

export const GOAL_NAME_MAX = 100;

/** The words for each refusal. A form shows them under the field; a summary joins them. */
export const GOAL_MESSAGES = {
  name: 'Give the goal a name.',
  nameLength: `Keep the name to ${GOAL_NAME_MAX} characters or fewer.`,
  target: 'Enter the amount you want to save.',
  targetNumber: 'Enter the target as a number, like 5000.',
  targetPositive: 'Enter a target more than zero.',
  cents: 'Use at most two decimal places, like 250.50.',
  amountMax: 'Enter an amount below one trillion.',
  current: 'Enter what you have saved as a number of zero or more, like 250.00.',
  monthly: 'Enter the monthly amount as a number of zero or more, like 200, or leave it blank.',
  deadline: 'Enter a real date, written like 2026-12-31, or leave it blank.',
  category: 'Choose a category from the list, or leave it blank.',
  trackingStart: 'Enter a real date, written like 2026-03-01, or leave it blank.',
  notes: 'Write the notes as text.',
  contribution: 'Enter the amount to add.',
  contributionNumber: 'Enter the amount as a number, like 50.00.',
  contributionPositive: 'Enter an amount more than zero.',
} as const;

const M = GOAL_MESSAGES;

/** What a blank field means where it depends on who asks. */
export interface GoalDefaults {
  /** Today on the person's calendar, YYYY-MM-DD: where a new goal starts counting. */
  today: string;
}

/** The fields a goal body may carry. */
export interface GoalInput {
  name: string;
  target_amount: number;
  current_amount: number;
  deadline: string | null;
  notes: string;
  category_id: number | null;
  monthly_contribution: number;
  tracking_start_date: string | null;
}

type Field = keyof GoalInput;

const money = (missing: string, number: string, range: string): MoneyWords => ({
  missing,
  number,
  range,
  cents: M.cents,
  max: M.amountMax,
});
const TARGET = money(M.target, M.targetNumber, M.targetPositive);
const CURRENT = money(M.current, M.current, M.current);
const MONTHLY = money(M.monthly, M.monthly, M.monthly);
const CONTRIBUTION = money(M.contribution, M.contributionNumber, M.contributionPositive);

/** An amount that may be zero, and is zero when blank. */
const zeroOrMore =
  (words: MoneyWords) =>
  (raw: unknown): Read<number> =>
    raw === undefined || raw === null || raw === '' ? { value: 0 } : readMoney(raw, words, true);

const READERS: { [K in Field]: (raw: unknown) => Read<GoalInput[K] | null> } = {
  name: (raw) => {
    if (typeof raw !== 'string' || raw.trim() === '') return { error: M.name };
    const name = raw.trim();
    return name.length > GOAL_NAME_MAX ? { error: M.nameLength } : { value: name };
  },
  target_amount: (raw) => readMoney(raw, TARGET),
  current_amount: zeroOrMore(CURRENT),
  deadline: (raw) => readDate(raw, M.deadline),
  notes: (raw) => readText(raw, M.notes),
  category_id: (raw) => readId(raw, M.category, true),
  monthly_contribution: zeroOrMore(MONTHLY),
  tracking_start_date: (raw) => readDate(raw, M.trackingStart),
};

const FIELDS = Object.keys(READERS) as Field[];

/** The body's fields, with `target_date` read as the deadline when `deadline` is not sent. */
function bodyOf(body: unknown): Record<string, unknown> {
  const record = { ...asRecord(body) };
  if (record.deadline === undefined && record.target_date !== undefined) {
    record.deadline = record.target_date;
  }
  return record;
}

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

/** A new goal: every field, defaults filled in, or why not. Unknown keys are dropped. */
export function checkGoalCreate(body: unknown, defaults: GoalDefaults): Checked<GoalInput> {
  const { value, fields } = readFields(bodyOf(body));
  if (Object.keys(fields).length > 0) return { ok: false, fields };
  return {
    ok: true,
    value: {
      ...(value as GoalInput),
      tracking_start_date: (value.tracking_start_date as string | null) ?? defaults.today,
    },
  };
}

/**
 * An edit of a stored goal: only the fields whose value the body changes, or why not.
 *
 * A field sent with the value the row already holds is neither checked nor written, so a goal an
 * older version stored with a target of zero or a name over 100 characters can still have its
 * date changed: the Goals form sends every field it shows on every save. A blank monthly amount is
 * zero; a blank tracking date is none, and the goal counts from the day it was made.
 *
 * `stored` is the row as either runtime holds it, or the values a form opened with.
 */
export function checkGoalEdit(body: unknown, stored: object): Checked<Partial<GoalInput>> {
  const record = bodyOf(body);
  const row = stored as Readonly<Record<string, unknown>>;
  const kept: Record<string, unknown> = {
    ...row,
    deadline: row.deadline ?? row.target_date ?? null,
  };
  const changed = new Set<string>();
  for (const field of FIELDS) {
    const raw = record[field];
    if (raw !== undefined && !holds(READERS[field], raw, kept[field])) changed.add(field);
  }
  const { value, fields } = readFields(record, changed);
  return Object.keys(fields).length > 0
    ? { ok: false, fields }
    : { ok: true, value: value as Partial<GoalInput> };
}

/** A contribution: the amount to add, more than zero. */
export function checkContribution(body: unknown): Checked<{ amount: number }> {
  const read = readMoney(asRecord(body).amount, CONTRIBUTION);
  return 'error' in read
    ? { ok: false, fields: { amount: read.error } }
    : { ok: true, value: { amount: read.value } };
}

/** `current` plus `amount`, to the cent: 0.1 + 0.2 is 0.3, not 0.30000000000000004. */
export function addToSaved(current: unknown, amount: number): number {
  return Math.round(((asNumber(current) ?? 0) + amount) * 100) / 100;
}
