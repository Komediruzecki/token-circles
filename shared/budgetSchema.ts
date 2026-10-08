/**
 * A budget as the Budgets and Categories pages, the local-first router and the Worker accept it.
 *
 * One set of rules and one set of messages, so both runtimes refuse the same body for the same
 * reason, in the same words, and the budget dialogs run the same check before they send anything.
 * The two used to disagree (docs/plans/2026-10-07-form-errors.md, "Other entities"): local-first
 * required an amount, a period and a start date and answered zod's words; the Worker checked only
 * that the category was the profile's, stored any amount, and answered a budget without a start
 * date with D1's NOT NULL error as a 500.
 *
 * The rules:
 *
 * - A budget is for one category, by id. Whether it is the profile's is the runtime's question,
 *   answered as a 400 at `category_id`, with these words.
 * - The amount is zero or more, at most two decimal places, below one trillion. Zero is a budget:
 *   spend nothing here.
 * - The period is monthly, weekly or yearly; blank is monthly.
 * - The start date is a real date, YYYY-MM-DD; blank is the first of the person's current month.
 *   The end date is a real date on or after it, or blank for none.
 * - Rollover is on or off; blank is off.
 * - A field an edit leaves out is left alone, and so is one it sends back unchanged (decision 2):
 *   a row stored with three decimals or a start date in another format can still be edited.
 *
 * Allocating (POST /api/budgets/allocate) sets one category's budget for a month: the category and
 * the amount by the same rules, and the month as YYYY-MM.
 */
import {
  asNumber,
  asRecord,
  holds,
  MONEY_MAX,
  readDate,
  readFlag,
  readId,
  readMoney,
  type MoneyWords,
  type Read,
} from './fieldReaders';
import { hasCents } from './transactionSchema';
import type { Checked, FieldErrors } from './refusal';

export const BUDGET_PERIODS = ['monthly', 'weekly', 'yearly'] as const;
export type BudgetPeriod = (typeof BUDGET_PERIODS)[number];

/** The words for each refusal. A form shows them under the field; a summary joins them. */
export const BUDGET_MESSAGES = {
  category: 'Choose the category this budget is for.',
  amount: 'Enter the budget amount.',
  amountNumber: 'Enter the amount as a number, like 250.00.',
  amountNegative: 'Enter an amount of zero or more.',
  amountCents: 'Use at most two decimal places, like 250.50.',
  amountMax: 'Enter an amount below one trillion.',
  period: 'Choose Monthly, Weekly or Yearly.',
  startDate: 'Enter a real date, written like 2026-03-01.',
  endDate: 'Enter an end date on or after the start date, or leave it blank.',
  rollover: 'Turn rollover on or off.',
  rolloverAmount: 'Enter the rollover amount as a number, like 25.00.',
  rolloverUsed: 'Enter the rollover used as a number of zero or more, like 25.00.',
  rolloverNothing: 'Turn rollover on or off, or give its amount.',
  month: 'Choose a month, written like 2026-03.',
} as const;

const M = BUDGET_MESSAGES;

/** What a blank field means where it depends on who asks. */
export interface BudgetDefaults {
  /**
   * The first of the person's current month, YYYY-MM-01: the start of a budget sent without one.
   * The Worker reads it from the request's time zone, the browser from its own clock.
   */
  monthStart: string;
}

/** The fields a budget body may carry. */
export interface BudgetInput {
  category_id: number;
  amount: number;
  period: BudgetPeriod;
  start_date: string;
  end_date: string | null;
  rollover_enabled: boolean;
}

/** What allocating a category's budget for a month carries. */
export interface AllocationInput {
  category_id: number;
  amount: number;
  period: BudgetPeriod;
}

/** What the rollover route may change. */
export interface RolloverInput {
  rollover_enabled?: boolean;
  rollover_amount?: number;
  rollover_used?: number;
}

type Field = keyof BudgetInput;

const AMOUNT: MoneyWords = {
  missing: M.amount,
  number: M.amountNumber,
  range: M.amountNegative,
  cents: M.amountCents,
  max: M.amountMax,
};

/** Each field read the same way on a create and on an edit; a blank start date is the caller's. */
const READERS: { [K in Field]: (raw: unknown) => Read<BudgetInput[K] | null> } = {
  category_id: (raw) => readId(raw, M.category, false),
  amount: (raw) => readMoney(raw, AMOUNT, true),
  period: (raw) => {
    if (raw === undefined || raw === null || raw === '') return { value: 'monthly' };
    const period = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
    return (BUDGET_PERIODS as readonly string[]).includes(period)
      ? { value: period as BudgetPeriod }
      : { error: M.period };
  },
  start_date: (raw) => readDate(raw, M.startDate),
  end_date: (raw) => readDate(raw, M.endDate),
  rollover_enabled: (raw) => readFlag(raw, M.rollover, false),
};

const FIELDS = Object.keys(READERS) as Field[];

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

/** A new budget: every field, defaults filled in, or why not. Unknown keys are dropped. */
export function checkBudgetCreate(body: unknown, defaults: BudgetDefaults): Checked<BudgetInput> {
  const { value, fields } = readFields(asRecord(body));
  const start = (value.start_date as string | null | undefined) ?? defaults.monthStart;
  const end = value.end_date as string | null | undefined;
  if (end && start && end < start && !fields.start_date) fields.end_date = M.endDate;
  if (Object.keys(fields).length > 0) return { ok: false, fields };
  return {
    ok: true,
    value: { ...(value as BudgetInput), start_date: start, end_date: end ?? null },
  };
}

/**
 * An edit of a stored budget: only the fields whose value the body changes, or why not.
 *
 * A field sent with the value the row already holds is neither checked nor written. What the edit
 * changes is checked like anything else, and an edit cannot blank the category, the amount or the
 * start date: there is no budget without them. An end date is checked against the start date the
 * budget will have.
 *
 * `stored` is the row as either runtime holds it, or the values a form opened with.
 */
export function checkBudgetEdit(body: unknown, stored: object): Checked<Partial<BudgetInput>> {
  const record = asRecord(body);
  const row = stored as Readonly<Record<string, unknown>>;
  const changed = new Set<string>();
  for (const field of FIELDS) {
    const raw = record[field];
    if (raw !== undefined && !holds(READERS[field], raw, row[field])) changed.add(field);
  }
  const { value, fields } = readFields(record, changed);
  if (value.start_date === null) fields.start_date = M.startDate;
  if (changed.has('start_date') || changed.has('end_date')) {
    const start = changed.has('start_date') ? value.start_date : row.start_date;
    const end = changed.has('end_date') ? value.end_date : row.end_date;
    if (
      typeof start === 'string' &&
      typeof end === 'string' &&
      end < start &&
      !fields.start_date &&
      !fields.end_date
    ) {
      fields.end_date = M.endDate;
    }
  }
  return Object.keys(fields).length > 0
    ? { ok: false, fields }
    : { ok: true, value: value as Partial<BudgetInput> };
}

/** Allocating a category's budget for a month: the category, the amount and the period. */
export function checkAllocation(body: unknown): Checked<AllocationInput> {
  const { value, fields } = readFields(
    asRecord(body),
    new Set(['category_id', 'amount', 'period'])
  );
  return Object.keys(fields).length > 0
    ? { ok: false, fields }
    : { ok: true, value: value as unknown as AllocationInput };
}

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** The month an allocation is for, YYYY-MM; none is `current`, the person's month. */
export function checkBudgetMonth(
  month: string | null | undefined,
  current: string
): Checked<string> {
  if (month === undefined || month === null || month.trim() === '')
    return { ok: true, value: current };
  return MONTH.test(month.trim())
    ? { ok: true, value: month.trim() }
    : { ok: false, fields: { month: M.month } };
}

/** The rollover route's body: at least one of on or off, the amount, and the amount used. */
export function checkRollover(body: unknown): Checked<RolloverInput> {
  const record = asRecord(body);
  const value: RolloverInput = {};
  const fields: FieldErrors = {};
  if (record.rollover_enabled !== undefined) {
    const read = readFlag(record.rollover_enabled, M.rollover, false);
    if ('error' in read) fields.rollover_enabled = read.error;
    else value.rollover_enabled = read.value;
  }
  if (record.rollover_amount !== undefined) {
    const amount = asNumber(record.rollover_amount);
    if (amount !== null && Math.abs(amount) < MONEY_MAX && hasCents(amount)) {
      value.rollover_amount = amount;
    } else fields.rollover_amount = M.rolloverAmount;
  }
  if (record.rollover_used !== undefined) {
    const used = asNumber(record.rollover_used);
    if (used !== null && used >= 0 && used < MONEY_MAX && hasCents(used)) {
      value.rollover_used = used;
    } else fields.rollover_used = M.rolloverUsed;
  }
  if (Object.keys(fields).length > 0) return { ok: false, fields };
  if (Object.keys(value).length === 0)
    return { ok: false, fields: { rollover_enabled: M.rolloverNothing } };
  return { ok: true, value };
}
