/**
 * A retirement goal, as the Retirement page, the local-first router and the Worker accept one.
 *
 * One set of rules and one set of messages, so both runtimes refuse the same body for the same
 * reason, in the same words, and the goal dialog runs the same check before it sends anything.
 * Before, both runtimes checked only that a name and a target were sent, and filled every other
 * blank with a guess stored as if it had been typed:
 *
 * - `expected_return_rate || 7` read a 0 % return as a missing one and saved it as 7 %.
 * - A goal sent without ages was saved as a 30-year-old retiring at 65, and the planner then took
 *   that 30 as the person's age.
 * - The target, the amounts and the ages were stored as whatever was sent: text, a negative target,
 *   an age of 400.
 * - The Worker's edit reset every field it was not sent to its guess; local-first kept them.
 *
 * The rules:
 *
 * - A name is required, at most 100 characters.
 * - The target is more than zero; what is saved so far and the monthly contribution are zero or
 *   more, and zero when blank. Each is at most two decimal places, below one trillion.
 * - The target date is a real date, or blank for none. It may come as `deadline`, the column, or
 *   `target_date`, the name the Retirement page sends.
 * - The current age and the retirement age are whole numbers from 18 to 100, as the page has
 *   always asked for.
 * - The expected return is a number of percent a year from 0 to 20, as the page has always asked
 *   for; 0 is 0.
 * - A field an edit leaves out is left alone, and so is one it sends back unchanged (decision 2),
 *   so a goal an older version stored under no rules can still be renamed.
 */
import {
  asNumber,
  asRecord,
  holds,
  readDate,
  readMoney,
  readText,
  type MoneyWords,
  type Read,
} from './fieldReaders';
import type { Checked, FieldErrors } from './refusal';

export const RETIREMENT_GOAL_NAME_MAX = 100;
export const RETIREMENT_AGE_MIN = 18;
export const RETIREMENT_AGE_MAX = 100;
/** The highest yearly return the page lets a goal expect, in percent. */
export const RETIREMENT_RETURN_MAX = 20;

/** The words for each refusal. A form shows them under the field; a summary joins them. */
export const RETIREMENT_GOAL_MESSAGES = {
  name: 'Give the goal a name.',
  nameLength: `Keep the name to ${RETIREMENT_GOAL_NAME_MAX} characters or fewer.`,
  target: 'Enter the amount you want to retire with.',
  targetNumber: 'Enter the target as a number, like 750000.',
  targetPositive: 'Enter a target more than zero.',
  cents: 'Use at most two decimal places, like 250.50.',
  amountMax: 'Enter an amount below one trillion.',
  current: 'Enter what you have saved as a number of zero or more, like 42000, or leave it blank.',
  monthly:
    'Enter the monthly contribution as a number of zero or more, like 500, or leave it blank.',
  deadline: 'Enter a real date, written like 2050-01-01, or leave it blank.',
  currentAge: `Enter your age as a whole number from ${RETIREMENT_AGE_MIN} to ${RETIREMENT_AGE_MAX}.`,
  retirementAge: `Enter the age you want to retire at, a whole number from ${RETIREMENT_AGE_MIN} to ${RETIREMENT_AGE_MAX}.`,
  returnRate: 'Enter the return you expect each year, like 7, or 0 for none.',
  returnNumber: 'Enter the return as a number, like 6.5.',
  returnRange: `Enter a return from 0 to ${RETIREMENT_RETURN_MAX}.`,
  notes: 'Write the notes as text.',
} as const;

const M = RETIREMENT_GOAL_MESSAGES;

/** The fields a retirement goal body may carry, as the `retirement_goals` table stores them. */
export interface RetirementGoalInput {
  name: string;
  target_amount: number;
  current_amount: number;
  deadline: string | null;
  notes: string;
  current_age: number;
  retirement_age: number;
  monthly_contribution: number;
  expected_return_rate: number;
}

type Field = keyof RetirementGoalInput;

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

/** An amount that may be zero, and is zero when blank. */
const zeroOrMore =
  (words: MoneyWords) =>
  (raw: unknown): Read<number> =>
    raw === undefined || raw === null || raw === '' ? { value: 0 } : readMoney(raw, words, true);

/** An age in whole years, within what the page asks for. */
const age =
  (message: string) =>
  (raw: unknown): Read<number> => {
    const years = asNumber(raw);
    return years !== null &&
      Number.isInteger(years) &&
      years >= RETIREMENT_AGE_MIN &&
      years <= RETIREMENT_AGE_MAX
      ? { value: years }
      : { error: message };
  };

function readReturn(raw: unknown): Read<number> {
  if (raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '')) {
    return { error: M.returnRate };
  }
  const rate = asNumber(raw);
  if (rate === null) return { error: M.returnNumber };
  return rate >= 0 && rate <= RETIREMENT_RETURN_MAX ? { value: rate } : { error: M.returnRange };
}

const READERS: { [K in Field]: (raw: unknown) => Read<RetirementGoalInput[K]> } = {
  name: (raw) => {
    if (typeof raw !== 'string' || raw.trim() === '') return { error: M.name };
    const name = raw.trim();
    return name.length > RETIREMENT_GOAL_NAME_MAX ? { error: M.nameLength } : { value: name };
  },
  target_amount: (raw) => readMoney(raw, TARGET),
  current_amount: zeroOrMore(CURRENT),
  deadline: (raw) => readDate(raw, M.deadline),
  notes: (raw) => readText(raw, M.notes),
  current_age: age(M.currentAge),
  retirement_age: age(M.retirementAge),
  monthly_contribution: zeroOrMore(MONTHLY),
  expected_return_rate: readReturn,
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

/** A new retirement goal: every field, blanks filled in, or why not. Unknown keys are dropped. */
export function checkRetirementGoalCreate(body: unknown): Checked<RetirementGoalInput> {
  const { value, fields } = readFields(bodyOf(body));
  return Object.keys(fields).length > 0
    ? { ok: false, fields }
    : { ok: true, value: value as RetirementGoalInput };
}

/**
 * An edit of a stored retirement goal: only the fields whose value the body changes, or why not.
 *
 * A field sent with the value the row already holds is neither checked nor written, so a goal an
 * older version stored with an age of 0 or a target of zero can still be renamed: the Retirement
 * page sends every field it shows on every save. `stored` is the row as either runtime holds it,
 * or the values a form opened with.
 */
export function checkRetirementGoalEdit(
  body: unknown,
  stored: object
): Checked<Partial<RetirementGoalInput>> {
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
    : { ok: true, value: value as Partial<RetirementGoalInput> };
}
