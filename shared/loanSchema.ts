/**
 * A loan, its rate periods and its extra payments, as the Loans page, the local-first router and
 * the Worker accept them.
 *
 * One set of rules and one set of messages, so both runtimes refuse the same body for the same
 * reason, in the same words, and the Loans forms run the same check before they send anything.
 * The two used to disagree (docs/plans/2026-10-07-form-errors.md, "Other entities"):
 *
 * - Local-first required every field of a loan, in zod's words; the Worker checked none. A loan
 *   without a name answered 500 there, and one without a rate was saved at 5 %.
 * - Local-first stored the body as it came, keys the app never reads included, and the Worker
 *   stored a rate period's rate or months as whatever was sent.
 * - An extra payment was checked by both, one field at a time, and an amount with three decimals
 *   was rounded rather than refused.
 *
 * The rules:
 *
 * - A loan's name is required, at most 100 characters.
 * - The amount borrowed is more than zero, at most two decimal places, below one trillion.
 * - The interest rate is required: a number from 0 to 100. 0 is an interest-free loan. A rate is a
 *   percentage, not money, so it keeps every decimal it is given (6.875 %).
 * - The term is a whole number of monthly payments from 1 to MAX_TERM_MONTHS, the most the
 *   schedule amortises.
 * - The date of the first payment is required, a real date, YYYY-MM-DD.
 * - A rate period charges its rate, a number from 0 to 100, from one of the loan's payments to a
 *   later one, or to the end of the loan when its last payment is left empty (or 0, as older
 *   versions sent it). A loan carries its rate periods as a list, `rate_periods`; a missing or
 *   empty list is none.
 * - An extra payment goes with one of the loan's payments, and is an amount more than zero, at
 *   most two decimal places, with an optional note.
 * - A field an edit leaves out is left alone, and so is one it sends back unchanged (decision 2).
 *   A rate period an edit sends back unchanged is kept as it is stored; one it adds or changes is
 *   checked. Unknown keys are dropped.
 *
 * A refusal of a rate period in a loan's list is said at `rate_periods.<index>.<field>`, the
 * period's place in the list sent, so a form can mark the field in that row.
 */
import { asNumber, asRecord, holds, isBlank, readDate, readMoney, readText } from './fieldReaders';
import type { MoneyWords, Read } from './fieldReaders';
import { MAX_TERM_MONTHS } from './loanSchedule';
import { toCents } from './money';
import type { Checked, FieldErrors } from './refusal';

export const LOAN_NAME_MAX = 100;
/** The highest rate a loan or a rate period may charge, in percent a year. */
export const LOAN_RATE_MAX = 100;

/** The words for each refusal. A form shows them under the field; a summary joins them. */
export const LOAN_MESSAGES = {
  name: 'Give the loan a name.',
  nameLength: `Keep the name to ${LOAN_NAME_MAX} characters or fewer.`,
  principal: 'Enter the amount you borrowed.',
  principalNumber: 'Enter the amount as a number, like 15000.',
  amountPositive: 'Enter an amount more than zero.',
  principalCents: 'Use at most two decimal places, like 15000.50.',
  amountMax: 'Enter an amount below one trillion.',
  rate: 'Enter the interest rate, or 0 for an interest-free loan.',
  rateNumber: 'Enter the rate as a number, like 4.5.',
  rateRange: `Enter a rate from 0 to ${LOAN_RATE_MAX}.`,
  term: 'Enter the term in months, like 60.',
  termRange: `Enter a whole number of months from 1 to ${MAX_TERM_MONTHS}.`,
  startDate: 'Choose the date the first payment is due.',
  startDateReal: 'Enter a real date, written like 2026-03-15.',
  ratePeriods: 'Send the rate periods as a list.',
  periodRate: 'Enter the rate for these payments.',
  extraMonth: 'Choose which payment the extra payment goes with.',
  extraAmount: 'Enter the amount of the extra payment.',
  extraAmountNumber: 'Enter the amount as a number, like 1000.',
  extraAmountCents: 'Use at most two decimal places, like 1000.50.',
  note: 'Write the note as text.',
} as const;

const M = LOAN_MESSAGES;

/** Where a rate period may start: one of the loan's payments, 1 to `last`. */
export function periodStartMessage(last: number): string {
  return `Enter a payment from 1 to ${last}.`;
}

/** Where a rate period may end: from its first payment to the loan's last, or at the end. */
export function periodEndMessage(first: number, last: number): string {
  return `Enter a payment from ${first} to ${last}, or leave it empty for the end of the loan.`;
}

/** A stretch of payments charged at its own rate, as both runtimes store one. */
export interface RatePeriodFields {
  rate: number;
  start_month: number;
  /** The last payment at this rate; null runs to the end of the loan. */
  end_month: number | null;
}

/** The fields a loan body may carry. */
export interface LoanFields {
  name: string;
  principal: number;
  interest_rate: number;
  term_months: number;
  start_date: string;
  rate_periods: RatePeriodFields[];
}

/** What an edit changes: any of a loan's fields, the rate periods as the whole new list. */
export type LoanEdit = Partial<LoanFields>;

/** An extra payment, as both runtimes store one. */
export interface ExtraPaymentFields {
  /** The payment it goes with, counting the first as 1. */
  month: number;
  amount: number;
  note: string;
}

type Scalar = Exclude<keyof LoanFields, 'rate_periods'>;

const PRINCIPAL: MoneyWords = {
  missing: M.principal,
  number: M.principalNumber,
  range: M.amountPositive,
  cents: M.principalCents,
  max: M.amountMax,
};

const EXTRA_AMOUNT: MoneyWords = {
  missing: M.extraAmount,
  number: M.extraAmountNumber,
  range: M.amountPositive,
  cents: M.extraAmountCents,
  max: M.amountMax,
};

/** A rate in percent a year: a number from 0 to LOAN_RATE_MAX, every decimal kept. */
function readRate(raw: unknown, missing: string): Read<number> {
  if (isBlank(raw)) return { error: missing };
  const rate = asNumber(raw);
  if (rate === null) return { error: M.rateNumber };
  if (rate < 0 || rate > LOAN_RATE_MAX) return { error: M.rateRange };
  return { value: rate === 0 ? 0 : rate };
}

/** A whole number from `first` to `last`, or null when it is not one. */
function wholeWithin(raw: unknown, first: number, last: number): number | null {
  const n = asNumber(raw);
  return n !== null && Number.isInteger(n) && n >= first && n <= last ? n : null;
}

/** The term, a whole number of payments the schedule can amortise. */
function readTerm(raw: unknown): Read<number> {
  if (isBlank(raw)) return { error: M.term };
  const term = wholeWithin(raw, 1, MAX_TERM_MONTHS);
  return term === null ? { error: M.termRange } : { value: term };
}

const READERS: { [K in Scalar]: (raw: unknown) => Read<LoanFields[K]> } = {
  name: (raw) => {
    if (typeof raw !== 'string' || raw.trim() === '') return { error: M.name };
    const name = raw.trim();
    return name.length > LOAN_NAME_MAX ? { error: M.nameLength } : { value: name };
  },
  principal: (raw) => readMoney(raw, PRINCIPAL),
  interest_rate: (raw) => readRate(raw, M.rate),
  term_months: readTerm,
  start_date: (raw) => {
    const read = readDate(raw, M.startDateReal);
    if ('error' in read) return read;
    return read.value === null ? { error: M.startDate } : { value: read.value };
  },
};

const SCALARS = Object.keys(READERS) as Scalar[];

/**
 * The last payment a rate period or an extra payment may name: the loan's term, within what the
 * schedule amortises. A loan without a usable term falls back to MAX_TERM_MONTHS, so the period is
 * judged on its own and the term is refused at its own field.
 */
export function lastPaymentOf(termMonths: unknown): number {
  const term = asNumber(termMonths);
  return term !== null && term >= 1 ? Math.min(Math.floor(term), MAX_TERM_MONTHS) : MAX_TERM_MONTHS;
}

/** An end month sent as nothing: empty, null, or 0, which older versions sent for the end. */
const isOpenEnd = (raw: unknown): boolean => isBlank(raw) || raw === 0 || raw === '0';

/**
 * One rate period, every field read, or what is wrong with each. A period that ends before it
 * starts is refused at its end, whose words name the payments it may end on.
 */
function readPeriod(raw: unknown, last: number): { value?: RatePeriodFields; fields: FieldErrors } {
  const body = asRecord(raw);
  const fields: FieldErrors = {};
  const rate = readRate(body.rate, M.periodRate);
  if ('error' in rate) fields.rate = rate.error;
  const start = isBlank(body.start_month) ? null : wholeWithin(body.start_month, 1, last);
  if (start === null) fields.start_month = periodStartMessage(last);
  let end: number | null = null;
  if (!isOpenEnd(body.end_month)) {
    end = wholeWithin(body.end_month, start ?? 1, last);
    if (end === null) fields.end_month = periodEndMessage(start ?? 1, last);
  }
  if (Object.keys(fields).length > 0) return { fields };
  return {
    value: { rate: (rate as { value: number }).value, start_month: start!, end_month: end },
    fields,
  };
}

/** A stored rate period as the rules read it, whatever shape a runtime keeps it in. */
function storedPeriod(raw: unknown): RatePeriodFields {
  const row = asRecord(raw);
  const end = isOpenEnd(row.end_month) ? null : asNumber(row.end_month);
  return {
    rate: asNumber(row.rate) ?? Number.NaN,
    start_month: asNumber(row.start_month) ?? Number.NaN,
    end_month: end,
  };
}

/** Whether a sent rate period says what a stored one holds: the same rate and the same months. */
function samePeriod(sent: unknown, stored: RatePeriodFields): boolean {
  const body = asRecord(sent);
  const end = isOpenEnd(body.end_month) ? null : asNumber(body.end_month);
  return (
    asNumber(body.rate) === stored.rate &&
    asNumber(body.start_month) === stored.start_month &&
    end === stored.end_month
  );
}

/**
 * A loan's rate periods: the list to store, or each refused field at `rate_periods.<i>.<field>`.
 * A period that `stored` already holds, matched by its rate and months, is kept as stored and not
 * checked; each stored period matches one sent period at most.
 */
function readPeriods(
  raw: unknown,
  last: number,
  stored: readonly unknown[] = []
): { value?: RatePeriodFields[]; fields: FieldErrors } {
  if (isBlank(raw)) return { value: [], fields: {} };
  if (!Array.isArray(raw)) return { fields: { rate_periods: M.ratePeriods } };
  const unused = stored.map(storedPeriod);
  const value: RatePeriodFields[] = [];
  const fields: FieldErrors = {};
  raw.forEach((sent, index) => {
    const kept = unused.findIndex((period) => samePeriod(sent, period));
    if (kept >= 0) {
      value.push(unused[kept]);
      unused.splice(kept, 1);
      return;
    }
    const read = readPeriod(sent, last);
    if (read.value) value.push(read.value);
    for (const [field, message] of Object.entries(read.fields)) {
      fields[`rate_periods.${index}.${field}`] = message;
    }
  });
  return Object.keys(fields).length > 0 ? { fields } : { value, fields };
}

/** Whether two lists of rate periods are the same periods in the same order. */
function samePeriods(a: readonly RatePeriodFields[], b: readonly unknown[]): boolean {
  return a.length === b.length && a.every((period, i) => samePeriod(period, storedPeriod(b[i])));
}

/** A new loan: every field, its rate periods checked against its term, or why not. */
export function checkLoanCreate(body: unknown): Checked<LoanFields> {
  const record = asRecord(body);
  const value: Partial<LoanFields> = {};
  const fields: FieldErrors = {};
  for (const field of SCALARS) {
    const read = READERS[field](record[field]);
    if ('error' in read) fields[field] = read.error;
    else (value as Record<string, unknown>)[field] = read.value;
  }
  const periods = readPeriods(record.rate_periods, lastPaymentOf(value.term_months));
  Object.assign(fields, periods.fields);
  if (Object.keys(fields).length > 0) return { ok: false, fields };
  return { ok: true, value: { ...(value as LoanFields), rate_periods: periods.value ?? [] } };
}

/**
 * An edit of a stored loan: only the fields whose value the body changes, or why not.
 *
 * A field sent with the value the row already holds is neither checked nor written, so a loan an
 * older version stored with a name over 100 characters or a term the schedule cannot amortise can
 * still be renamed: the Loans form sends every field it shows on every save. Rate periods left out
 * of the body are left alone. Sent, they replace the stored ones: the result carries the new list
 * when it differs from the stored one, each period the loan already had kept as stored, each new or
 * changed one checked against the loan's term after the edit.
 *
 * `stored` is the loan as either runtime holds it, with its `rate_periods`, or the values a form
 * opened with.
 */
export function checkLoanEdit(body: unknown, stored: object): Checked<LoanEdit> {
  const record = asRecord(body);
  const row = stored as Readonly<Record<string, unknown>>;
  const value: LoanEdit = {};
  const fields: FieldErrors = {};
  for (const field of SCALARS) {
    const raw = record[field];
    if (raw === undefined || holds(READERS[field], raw, row[field])) continue;
    const read = READERS[field](raw);
    if ('error' in read) fields[field] = read.error;
    else (value as Record<string, unknown>)[field] = read.value;
  }
  if (record.rate_periods !== undefined) {
    const storedPeriods = Array.isArray(row.rate_periods) ? row.rate_periods : [];
    const last = lastPaymentOf(value.term_months ?? row.term_months);
    const periods = readPeriods(record.rate_periods, last, storedPeriods);
    Object.assign(fields, periods.fields);
    if (periods.value && !samePeriods(periods.value, storedPeriods)) {
      value.rate_periods = periods.value;
    }
  }
  return Object.keys(fields).length > 0 ? { ok: false, fields } : { ok: true, value };
}

/** A rate period added on its own (POST /api/loans/:id/rates), checked against the loan's term. */
export function checkRatePeriodCreate(
  body: unknown,
  termMonths: unknown
): Checked<RatePeriodFields> {
  const read = readPeriod(body, lastPaymentOf(termMonths));
  return read.value ? { ok: true, value: read.value } : { ok: false, fields: read.fields };
}

/**
 * A change to one stored rate period (PUT /api/loans/:id/rates/:rateId): only what it changes.
 * Its months are read as a pair: moving its start past an end the body leaves alone is refused at
 * the end, as a new period would be.
 */
export function checkRatePeriodEdit(
  body: unknown,
  stored: object,
  termMonths: unknown
): Checked<Partial<RatePeriodFields>> {
  const record = asRecord(body);
  const kept = storedPeriod(stored);
  const last = lastPaymentOf(termMonths);
  const sent = (field: keyof RatePeriodFields) => record[field] !== undefined;
  const merged = {
    rate: sent('rate') ? record.rate : kept.rate,
    start_month: sent('start_month') ? record.start_month : kept.start_month,
    end_month: sent('end_month') ? record.end_month : kept.end_month,
  };
  const changed = {
    rate: sent('rate') && asNumber(record.rate) !== kept.rate,
    start_month: sent('start_month') && asNumber(record.start_month) !== kept.start_month,
    end_month:
      sent('end_month') &&
      (isOpenEnd(record.end_month) ? null : asNumber(record.end_month)) !== kept.end_month,
  };
  const read = readPeriod(merged, last);
  const fields: FieldErrors = {};
  // The months are a pair: either one changed makes both the period's own question.
  const months = changed.start_month || changed.end_month;
  if (changed.rate && read.fields.rate) fields.rate = read.fields.rate;
  if (changed.start_month && read.fields.start_month) fields.start_month = read.fields.start_month;
  if (months && read.fields.end_month) fields.end_month = read.fields.end_month;
  if (Object.keys(fields).length > 0) return { ok: false, fields };
  const value: Partial<RatePeriodFields> = {};
  const rate = readRate(record.rate, M.periodRate);
  if (changed.rate && 'value' in rate) value.rate = rate.value;
  if (changed.start_month) value.start_month = asNumber(record.start_month) as number;
  if (changed.end_month) {
    value.end_month = isOpenEnd(record.end_month) ? null : (asNumber(record.end_month) as number);
  }
  return { ok: true, value };
}

const EXTRA_READERS: {
  [K in keyof ExtraPaymentFields]: (raw: unknown, last: number) => Read<ExtraPaymentFields[K]>;
} = {
  month: (raw, last) => {
    const month = wholeWithin(raw, 1, last);
    return month === null ? { error: M.extraMonth } : { value: month };
  },
  amount: (raw) => readMoney(raw, EXTRA_AMOUNT),
  note: (raw) => readText(raw, M.note),
};

const EXTRA_FIELDS = Object.keys(EXTRA_READERS) as (keyof ExtraPaymentFields)[];

/** A new extra payment: the payment it goes with, within the loan's term, the amount and a note. */
export function checkExtraPaymentCreate(
  body: unknown,
  termMonths: unknown
): Checked<ExtraPaymentFields> {
  const record = asRecord(body);
  const last = lastPaymentOf(termMonths);
  const value: Partial<ExtraPaymentFields> = {};
  const fields: FieldErrors = {};
  for (const field of EXTRA_FIELDS) {
    const read = EXTRA_READERS[field](record[field], last);
    if ('error' in read) fields[field] = read.error;
    else (value as Record<string, unknown>)[field] = read.value;
  }
  return Object.keys(fields).length > 0
    ? { ok: false, fields }
    : { ok: true, value: value as ExtraPaymentFields };
}

/**
 * A change to a stored extra payment: only what it changes. One that goes with a payment past a
 * term since shortened keeps its month while its amount or note changes.
 */
export function checkExtraPaymentEdit(
  body: unknown,
  stored: object,
  termMonths: unknown
): Checked<Partial<ExtraPaymentFields>> {
  const record = asRecord(body);
  const row = stored as Readonly<Record<string, unknown>>;
  const last = lastPaymentOf(termMonths);
  const value: Partial<ExtraPaymentFields> = {};
  const fields: FieldErrors = {};
  for (const field of EXTRA_FIELDS) {
    const raw = record[field];
    const read = (r: unknown) => EXTRA_READERS[field](r, last);
    if (raw === undefined || holds(read, raw, row[field] ?? (field === 'note' ? '' : undefined))) {
      continue;
    }
    const checked = read(raw);
    if ('error' in checked) fields[field] = checked.error;
    else (value as Record<string, unknown>)[field] = checked.value;
  }
  return Object.keys(fields).length > 0 ? { ok: false, fields } : { ok: true, value };
}

/**
 * What a loan's list row says about its extra payments: how many, and their total to the cent. A
 * loan without any has a total of 0. The Worker's list summed them in SQL, which answers null for
 * no rows (the contract's `loan-total-prepaid-none`), and local-first answered 0.
 */
export function extraPaymentTotals(extras: readonly { amount?: unknown }[] | null | undefined): {
  total_prepaid: number;
  prepayment_count: number;
} {
  const list = extras ?? [];
  const total = list.reduce((sum, extra) => sum + (asNumber(extra.amount) ?? 0), 0);
  return { total_prepaid: toCents(total), prepayment_count: list.length };
}
