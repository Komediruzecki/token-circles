/**
 * The retirement plan (the planner's assumptions), as the Retirement page, the local-first router
 * and the Worker accept it on a save: `PUT /api/retirement/settings`.
 *
 * Reading a stored plan stays forgiving (`normalizeSettings` in ./retirementSettings.ts): a row an
 * older version wrote has to keep working. A save used to go through the same function, so what a
 * person typed was changed without a word on the way in:
 *
 * - A number outside its range was moved to the nearest end: a life expectancy of 30 was saved as
 *   40, inflation of -1 % as 0 %, a withdrawal rate of 0 % as 0.1 %.
 * - A lifestyle costing nothing was dropped, and a spending period whose end came before its start
 *   lost its end and became ongoing.
 * - A third decimal was rounded away, a share of the portfolio to a whole percent, and a blank name
 *   became "Lifestyle 2" or "Asset 3".
 * - A value it could not read at all was replaced by the default.
 *
 * Now a save checks every value against the same ranges and refuses what does not fit, at the
 * field, in words: a row's field is named `<list>.<index>.<field>`, as the form names it. A value
 * that fits is stored exactly as `normalizeSettings` would store it, so a plan read back and saved
 * unchanged always passes. A value left out (or null) takes its default, as it always has.
 */
import { isMonth, monthOrdinal } from './retirement';
import { normalizeSettings } from './retirementSettings';
import { asNumber } from './fieldReaders';
import type { Checked, FieldErrors } from './refusal';
import type { RetirementSettings } from './retirementSettings';

/** The words for each refusal. A form shows them under the field; a summary joins them. */
export const RETIREMENT_PLAN_MESSAGES = {
  mode: 'Choose simple or advanced.',
  flag: 'Choose on or off.',
  birthMonth: 'Choose the month and year you were born, or leave it blank.',
  lifeExpectancyAge: 'Enter an age from 40 to 120, in whole years.',
  netWorth: 'Enter your net worth as a number below one trillion, like 25000.',
  monthlyContribution: 'Enter what you put away each month as a number, like 500.',
  monthlyIncome: 'Enter your monthly income as a number of zero or more, like 3000.',
  monthlyExpenses: 'Enter your monthly spending as a number of zero or more, like 2000.',
  annualRaisePct: 'Enter a yearly pay rise from -50 to 100 percent, like 2.',
  annualReturnPct: 'Enter a yearly return from -50 to 50 percent, like 7.',
  annualInflationPct: 'Enter inflation from 0 to 50 percent, like 2.5.',
  safeWithdrawalRatePct: 'Enter a withdrawal rate from 0.1 to 20 percent, like 4.',
  cents: 'Use at most two decimal places, like 2.75.',
  list: 'Send this as a list.',
  stepMonth: 'Choose the month this pay starts.',
  stepAmount: 'Enter the monthly income from then as a number of zero or more, like 3500.',
  periodMonth: 'Choose the month this spending starts.',
  periodEnd: 'Choose an end on or after the start, or leave it ongoing.',
  periodAmount:
    'Enter the extra monthly spending as a number, like 300, or below zero for a saving.',
  assetName: 'Give this part of your portfolio a name.',
  assetWeight: 'Enter a share from 0 to 100, in whole percent.',
  assetReturn: 'Enter a yearly return from -50 to 50 percent, like 4.',
  lifestyleName: 'Give this lifestyle a name.',
  lifestyleSpend: "Enter what this lifestyle costs a month in today's money, more than zero.",
} as const;

const M = RETIREMENT_PLAN_MESSAGES;

type Raw = Record<string, unknown>;

/** Left out, or sent as null: the field takes its default. */
const unset = (raw: unknown): boolean => raw === undefined || raw === null;

const asRaw = (value: unknown): Raw =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Raw) : {};

interface NumberRule {
  min: number;
  max: number;
  /** Whole numbers only. */
  whole?: boolean;
  /** Above `min`, not at it. */
  aboveMin?: boolean;
  message: string;
}

/**
 * Whether `raw` fits `rule`: a number (or a string that is one) within the range, with at most two
 * decimal places, or a whole one. The words for why not, or null when it fits.
 */
function numberProblem(raw: unknown, rule: NumberRule): string | null {
  const value = asNumber(raw);
  if (value === null) return rule.message;
  if (value < rule.min || value > rule.max || (rule.aboveMin && value === rule.min)) {
    return rule.message;
  }
  if (rule.whole) return Number.isInteger(value) ? null : rule.message;
  return Math.round(value * 100) / 100 === value ? null : M.cents;
}

const RULES: Record<string, NumberRule> = {
  lifeExpectancyAge: { min: 40, max: 120, whole: true, message: M.lifeExpectancyAge },
  netWorth: { min: -1e12, max: 1e12, message: M.netWorth },
  monthlyContribution: { min: -1e9, max: 1e9, message: M.monthlyContribution },
  monthlyIncome: { min: 0, max: 1e9, message: M.monthlyIncome },
  monthlyExpenses: { min: 0, max: 1e9, message: M.monthlyExpenses },
  annualRaisePct: { min: -50, max: 100, message: M.annualRaisePct },
  annualReturnPct: { min: -50, max: 50, message: M.annualReturnPct },
  annualInflationPct: { min: 0, max: 50, message: M.annualInflationPct },
  safeWithdrawalRatePct: { min: 0.1, max: 20, message: M.safeWithdrawalRatePct },
};

const STEP_AMOUNT: NumberRule = { min: 0, max: 1e9, message: M.stepAmount };
const PERIOD_AMOUNT: NumberRule = { min: -1e9, max: 1e9, message: M.periodAmount };
const ASSET_WEIGHT: NumberRule = { min: 0, max: 100, whole: true, message: M.assetWeight };
const ASSET_RETURN: NumberRule = { min: -50, max: 50, message: M.assetReturn };
const LIFESTYLE_SPEND: NumberRule = {
  min: 0,
  max: 1e9,
  aboveMin: true,
  message: M.lifestyleSpend,
};

/** A yes or no as the plan stores it: true or false, or the words. */
const isFlag = (raw: unknown): boolean =>
  typeof raw === 'boolean' || raw === 'true' || raw === 'false';

/** A month written `YYYY-MM`. */
const isMonthText = (raw: unknown): raw is string => typeof raw === 'string' && isMonth(raw);

/** A name: left out takes the default, but one sent must say something. */
const nameProblem = (raw: unknown, message: string): string | null =>
  unset(raw) || (typeof raw === 'string' && raw.trim() !== '') ? null : message;

/** Checks every row of the list `name`, or says it is not a list. */
function checkRows(
  body: Raw,
  name: string,
  fields: FieldErrors,
  row: (raw: Raw, mark: (field: string, message: string) => void) => void
): void {
  const raw = body[name];
  if (unset(raw)) return;
  if (!Array.isArray(raw)) {
    fields[name] = M.list;
    return;
  }
  raw.forEach((item, index) => {
    row(asRaw(item), (field, message) => {
      fields[`${name}.${index}.${field}`] = message;
    });
  });
}

/**
 * A plan to save: every value that is sent fits its range, or why not. The value is the plan as
 * `normalizeSettings` stores it, which for a plan that passes changes nothing a person typed: it
 * fills in what was left out, orders the pay steps and spending periods by month, and gives each
 * lifestyle an id of its own.
 */
export function checkRetirementPlan(body: unknown): Checked<RetirementSettings> {
  const plan = asRaw(body);
  const fields: FieldErrors = {};

  if (!unset(plan.mode) && plan.mode !== 'simple' && plan.mode !== 'advanced') {
    fields.mode = M.mode;
  }
  for (const flag of ['adjustForInflation', 'useAllocation']) {
    if (!unset(plan[flag]) && !isFlag(plan[flag])) fields[flag] = M.flag;
  }
  if (!unset(plan.birthMonth) && plan.birthMonth !== '' && !isMonthText(plan.birthMonth)) {
    fields.birthMonth = M.birthMonth;
  }
  for (const [field, rule] of Object.entries(RULES)) {
    if (unset(plan[field])) continue;
    const problem = numberProblem(plan[field], rule);
    if (problem) fields[field] = problem;
  }

  checkRows(plan, 'incomeSteps', fields, (step, mark) => {
    if (!isMonthText(step.fromMonth)) mark('fromMonth', M.stepMonth);
    const amount = unset(step.monthlyAmount)
      ? null
      : numberProblem(step.monthlyAmount, STEP_AMOUNT);
    if (amount) mark('monthlyAmount', amount);
  });

  checkRows(plan, 'expensePeriods', fields, (period, mark) => {
    const from = isMonthText(period.fromMonth) ? period.fromMonth : null;
    if (!from) mark('fromMonth', M.periodMonth);
    const to = period.toMonth;
    if (!unset(to) && to !== '') {
      if (!isMonthText(to)) mark('toMonth', M.periodEnd);
      else if (from && monthOrdinal(to) < monthOrdinal(from)) mark('toMonth', M.periodEnd);
    }
    const amount = unset(period.monthlyAmount)
      ? null
      : numberProblem(period.monthlyAmount, PERIOD_AMOUNT);
    if (amount) mark('monthlyAmount', amount);
  });

  checkRows(plan, 'allocation', fields, (slice, mark) => {
    const name = nameProblem(slice.label, M.assetName);
    if (name) mark('label', name);
    const weight = unset(slice.weightPct) ? null : numberProblem(slice.weightPct, ASSET_WEIGHT);
    if (weight) mark('weightPct', weight);
    const rate = unset(slice.annualReturnPct)
      ? null
      : numberProblem(slice.annualReturnPct, ASSET_RETURN);
    if (rate) mark('annualReturnPct', rate);
    if (!unset(slice.erodesWithInflation) && !isFlag(slice.erodesWithInflation)) {
      mark('erodesWithInflation', M.flag);
    }
  });

  checkRows(plan, 'lifestyles', fields, (lifestyle, mark) => {
    const name = nameProblem(lifestyle.label, M.lifestyleName);
    if (name) mark('label', name);
    const spend = numberProblem(lifestyle.monthlySpendToday, LIFESTYLE_SPEND);
    if (spend) mark('monthlySpendToday', spend);
  });

  return Object.keys(fields).length > 0
    ? { ok: false, fields }
    : { ok: true, value: normalizeSettings(plan) };
}
