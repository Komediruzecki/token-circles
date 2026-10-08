/**
 * Loan scenarios: a what-if on top of a loan, and the facts that compare two schedules.
 *
 * The Loans page sets the loan as planned (A) beside a what-if (B). Both are loans run through the
 * one schedule in loanSchedule.ts: a what-if is extra payments, repeating extra payments and a
 * rate change added to the loan as it stands, never a second engine. Nothing here is stored, and
 * nothing here is worded: the page turns these numbers into its own sentences.
 *
 * Every month is a month of the loan, counting its first payment as month 1. A what-if is seen
 * from `fromMonth`, the month of the next payment: what has been paid already is history, and a
 * what-if starts no earlier. A template turns one choice, such as 10,000 in 12 months, into a
 * what-if. Its presets are worked out from the loan as it stands in that month and rounded to
 * amounts a person would type.
 *
 * Pure functions, used only in the browser for now: what-ifs are not stored yet.
 */
import { addCalendarMonths, amortizeLoan, MAX_TERM_MONTHS, rateStretches } from './loanSchedule';
import type {
  ExtraMode,
  LoanExtraRule,
  LoanInput,
  LoanPrepayment,
  LoanRatePeriod,
  ScheduleRow,
} from './loanSchedule';

// ── What-ifs ─────────────────────────────────────────────────────────────────

/** Extra payments and a rate change, added to a loan as it stands. */
export interface WhatIf {
  /** What the what-if's extra payments do: finish sooner, or pay less each month. */
  mode: ExtraMode;
  /** Extra payments made once. */
  once: { month: number; amount: number }[];
  /** Extra payments that repeat, as `LoanExtraRule` takes them, in the what-if's mode. */
  every: { amount: number; every_months: number; from_month: number; to_month?: number | null }[];
  /** Every rate from `from_month` on moved by `points` percentage points, never below zero. */
  rate?: { from_month: number; points: number } | null;
}

/** A month number the schedule can use: a whole number of at least 1. */
const monthOf = (n: number): number => (Number.isFinite(n) ? Math.max(1, Math.floor(n)) : 1);

/** Rounded to the cent. */
const cents = (amount: number): number => Math.round(amount * 100) / 100;

/**
 * The loan's rate periods with every rate from `fromMonth` on moved by `points`, never below
 * zero. Periods before the month keep their rates and end by it; from the month on, one period
 * per stretch of months at one rate says the rest.
 */
function ratesMoved(loan: LoanInput, fromMonth: number, points: number): LoanRatePeriod[] {
  const from = monthOf(fromMonth);
  const before: LoanRatePeriod[] = [];
  for (const p of loan.rate_periods ?? []) {
    const start = Number(p.start_month);
    if (!(start < from)) continue;
    const end = p.end_month ? Number(p.end_month) : NaN;
    const last = Number.isFinite(end) && end < from ? end : from - 1;
    if (last >= 1 && last >= start) before.push({ ...p, end_month: last });
  }
  const after = rateStretches(loan, from).map((s): LoanRatePeriod => ({
    // Rounded so that 3.9 + 1 is 4.9 on screen, not 4.8999999999999995.
    rate: Math.max(0, Math.round((s.rate + points) * 1e9) / 1e9),
    start_month: s.start,
    end_month: s.end,
  }));
  return [...before, ...after];
}

/**
 * The loan with the what-if added: its extra payments after the loan's own, in the what-if's
 * mode, and its rate change. The loan itself is not changed.
 */
export function applyWhatIf(loan: LoanInput, whatIf: WhatIf): LoanInput {
  const { mode, rate } = whatIf;
  return {
    ...loan,
    prepayments: [
      ...(loan.prepayments ?? []),
      ...whatIf.once.map((p): LoanPrepayment => ({ month: p.month, amount: p.amount, mode })),
    ],
    extra_rules: [
      ...(loan.extra_rules ?? []),
      ...whatIf.every.map((r): LoanExtraRule => ({ ...r, mode })),
    ],
    rate_periods:
      rate && Number.isFinite(rate.points) && rate.points !== 0
        ? ratesMoved(loan, rate.from_month, rate.points)
        : loan.rate_periods,
  };
}

// ── Facts ────────────────────────────────────────────────────────────────────

/**
 * The month of the first payment due after `today` (YYYY-MM-DD): a payment due today counts as
 * made, as `loanStatus` counts it. Month 1 when the start date cannot be read, so no payment has
 * fallen due. Null once the loan is repaid, and for a loan with no schedule.
 */
export function nextPaymentMonth(loan: LoanInput, today: string): number | null {
  const { rows, neverPaysOffFrom } = amortizeLoan(loan);
  for (const row of rows) {
    if (row.date === '' || row.date > today) return row.month;
  }
  if (neverPaysOffFrom === null) return null;
  // Never repaid: the rows stop, and the payments go on.
  for (let month = rows.length + 1; month <= MAX_TERM_MONTHS; month++) {
    const date = addCalendarMonths(loan.start_date, month - 1);
    if (date === '' || date > today) return month;
  }
  return null;
}

/** A month the installment changes in, and what it changes to. */
export interface InstallmentChange {
  month: number;
  /** YYYY-MM-DD; null when the start date cannot be read. */
  date: string | null;
  installment: number;
}

/** What a schedule comes to, seen from `fromMonth`. Totals cover the whole loan. */
export interface ScenarioFacts {
  rows: ScheduleRow[];
  /** See `LoanAmortization.neverPaysOffFrom`. */
  neverPaysOffFrom: number | null;
  /** The month of the last payment; null when the loan is never repaid or has no schedule. */
  payoffMonth: number | null;
  /** Its date; null as well when the start date cannot be read. */
  payoffDate: string | null;
  totalInterest: number;
  /** Installments and extra payments. */
  totalPaid: number;
  /** Extra payments: no more than was owed when they were made. */
  totalExtra: number;
  /** The installment due in `fromMonth`; null when nothing is due that month. */
  installmentNow: number | null;
  /**
   * Every month after `fromMonth` whose installment differs from the month before. The last
   * payment is left out: it is only what is left, not a new installment.
   */
  installmentChanges: InstallmentChange[];
}

/** The facts of the loan's schedule, seen from `fromMonth`. */
export function runScenario(loan: LoanInput, fromMonth: number): ScenarioFacts {
  const from = monthOf(fromMonth);
  const { rows, neverPaysOffFrom } = amortizeLoan(loan);
  const repaid = neverPaysOffFrom === null && rows.length > 0;
  let totalInterest = 0;
  let totalPaid = 0;
  let totalExtra = 0;
  for (const row of rows) {
    totalInterest += row.interest;
    totalPaid += row.payment + row.prepayment;
    totalExtra += row.prepayment;
  }
  const installmentChanges: InstallmentChange[] = [];
  // rows[i] is month i + 1. A loan that is never repaid has no last payment to leave out.
  const end = repaid ? rows.length - 1 : rows.length;
  for (let i = Math.max(1, from); i < end; i++) {
    if (rows[i].payment !== rows[i - 1].payment) {
      installmentChanges.push({
        month: rows[i].month,
        date: rows[i].date || null,
        installment: rows[i].payment,
      });
    }
  }
  const last = repaid ? rows[rows.length - 1] : null;
  return {
    rows,
    neverPaysOffFrom,
    payoffMonth: last ? last.month : null,
    payoffDate: last ? last.date || null : null,
    totalInterest,
    totalPaid,
    totalExtra,
    installmentNow: rows[from - 1]?.payment ?? null,
    installmentChanges,
  };
}

/** B against A: each a subtraction, positive when B is better or pays more. */
export interface ScenarioComparison {
  /** Months B ends before A; null when either is never repaid or has no schedule. */
  monthsSooner: number | null;
  /** Interest B avoids against A; null when either is never repaid. */
  interestSaved: number | null;
  /** Extra payments B makes on top of A's. */
  extraPaid: number;
  /** B's installment now less A's; null when either has none due. */
  installmentNowChange: number | null;
}

export function compareScenarios(a: ScenarioFacts, b: ScenarioFacts): ScenarioComparison {
  const bothEnd = a.payoffMonth !== null && b.payoffMonth !== null;
  return {
    monthsSooner: bothEnd ? a.payoffMonth! - b.payoffMonth! : null,
    interestSaved: bothEnd ? a.totalInterest - b.totalInterest : null,
    extraPaid: b.totalExtra - a.totalExtra,
    installmentNowChange:
      a.installmentNow !== null && b.installmentNow !== null
        ? b.installmentNow - a.installmentNow
        : null,
  };
}

/**
 * The smallest extra payment each month from `fromMonth`, a multiple of `step`, that repays the
 * loan by `byMonth`, in finish-sooner mode. 0 when the loan already ends by then. Null when
 * `byMonth` is before `fromMonth`, or the loan has nothing to repay.
 *
 * More each month never ends a loan later, so the answer is found by doubling the amount until it
 * is enough, then halving the gap.
 */
export function monthlyExtraToFinishBy(
  loan: LoanInput,
  fromMonth: number,
  byMonth: number,
  step = 1
): number | null {
  const from = monthOf(fromMonth);
  if (!(byMonth >= from) || !(step > 0 && step < Infinity)) return null;
  /** The month the loan ends in with `steps` steps more each month; Infinity when it never does. */
  const endsWith = (steps: number): number => {
    const run = amortizeLoan(
      steps > 0
        ? {
            ...loan,
            extra_rules: [
              ...(loan.extra_rules ?? []),
              { amount: steps * step, every_months: 1, from_month: from },
            ],
          }
        : loan
    );
    return run.neverPaysOffFrom === null ? run.rows.length : Infinity;
  };
  const ends = endsWith(0);
  if (ends === 0) return null;
  if (ends <= byMonth) return 0;
  let low = 0;
  let high = 1;
  while (endsWith(high) > byMonth) {
    low = high;
    high *= 2;
    if (high * step > 1e15) return null;
  }
  while (high - low > 1) {
    const mid = Math.floor((low + high) / 2);
    if (endsWith(mid) <= byMonth) high = mid;
    else low = mid;
  }
  return cents(high * step);
}

// ── Templates ────────────────────────────────────────────────────────────────

/**
 * The amount nearest `x` among 1, 2 and 5 times a power of ten, and 25, 250, 2,500 and so on from
 * 25 up: amounts a person would type. A tie goes to the rounder amount, 1, 2 and 5 before 2.5.
 * 1 for an amount below 1; 0 for nothing, a negative amount or not a number.
 */
export function niceAmount(x: number): number {
  if (!(x > 0) || x === Infinity) return 0;
  if (x < 1) return 1;
  let power = 10 ** Math.floor(Math.log10(x));
  if (power * 10 <= x) power *= 10;
  if (power > x) power /= 10;
  const steps = power >= 10 ? [1, 2, 5, 10, 2.5] : [1, 2, 5, 10];
  let best = power;
  for (const s of steps) {
    if (Math.abs(s * power - x) < Math.abs(best - x)) best = s * power;
  }
  return best;
}

/** The kinds of what-if the page offers, in the order it offers them. */
export type TemplateId =
  | 'more-each-month'
  | 'round-up'
  | 'one-payment'
  | 'yearly-bonus'
  | 'extra-installment'
  | 'done-by'
  | 'rate-change';

export const TEMPLATE_IDS: readonly TemplateId[] = [
  'more-each-month',
  'round-up',
  'one-payment',
  'yearly-bonus',
  'extra-installment',
  'done-by',
  'rate-change',
];

/**
 * One what-if, as a person picks it. Months of the year run 1 (January) to 12; for a loan whose
 * start date cannot be read, month 12 of each year of the loan stands in for December.
 */
export type WhatIfChoice =
  /** `amount` more with every installment. */
  | { template: 'more-each-month'; amount: number }
  /** Pay `target` a month: the installment as it stands, and the difference as an extra. */
  | { template: 'round-up'; target: number }
  /** `amount` once, with the installment `inMonths` payments from now (1 is the next one). */
  | { template: 'one-payment'; amount: number; inMonths: number }
  /** `amount` once a year, in the month of the year given. */
  | { template: 'yearly-bonus'; amount: number; monthOfYear: number }
  /** One installment more a year, in the month of the year given. */
  | { template: 'extra-installment'; monthOfYear: number }
  /** Done `yearsEarlier` years before the loan as it stands: the smallest monthly extra that does it. */
  | { template: 'done-by'; yearsEarlier: number }
  /** Every rate from now on `points` percentage points higher, or lower when negative. */
  | { template: 'rate-change'; points: number };

type ChoiceFor<T extends TemplateId> = Extract<WhatIfChoice, { template: T }>;

/** The values a template offers for each field of its choice. */
export type PresetsFor<T extends TemplateId> = {
  [K in Exclude<keyof ChoiceFor<T>, 'template'>]: number[];
};

/**
 * How far one press of − or + moves each amount a template takes. Only the fields that hold money
 * have one; the others are picked from their presets.
 */
export type StepsFor<T extends TemplateId> = Partial<
  Record<Exclude<keyof ChoiceFor<T>, 'template'>, number>
>;

/** A template the loan can take, the values it offers, its steps, and the choice it starts on. */
export type TemplateOption = {
  [T in TemplateId]: {
    template: T;
    presets: PresetsFor<T>;
    steps: StepsFor<T>;
    first: ChoiceFor<T>;
  };
}[TemplateId];

/**
 * `value` moved one step in `direction`, to the next whole multiple of `step` that way: in steps
 * of 1,000, 1,234 goes up to 2,000 and down to 1,000. Never below `floor`, one step unless given.
 */
export function stepAmount(value: number, step: number, direction: 1 | -1, floor = step): number {
  if (!(step > 0) || !Number.isFinite(value)) return value;
  const steps = value / step;
  // A hair of tolerance, so 3,000 in steps of 1,000 counts as on a step despite float noise.
  const next = direction > 0 ? Math.floor(steps + 1e-9) + 1 : Math.ceil(steps - 1e-9) - 1;
  return Math.max(floor, next * step);
}

/**
 * Whether the template's extra payments can pay less each month: all but done-by, rate-change and
 * round-up. Round up names the amount paid each month. Paying less each month would lower the
 * installment under it, and the person would pay less than the amount it names.
 */
export function templateTakesMode(template: TemplateId): boolean {
  return template !== 'done-by' && template !== 'rate-change' && template !== 'round-up';
}

const MONTHS_OF_YEAR = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

function distinct(values: readonly number[]): number[] {
  return values.filter((v, i) => values.indexOf(v) === i);
}

/**
 * The templates the loan can take, seen from `fromMonth`, with presets worked out from the loan as
 * it stands in that month, `b` being the balance before its payment and `A` that payment:
 *
 *   more each month    5, 10 and 20 % of A
 *   round up           A rounded up to a tenth of A, at least 1 more, and one tenth above that
 *   one payment        1, 5 and 10 % of b, with the next payment or 6 or 12 payments from now
 *   yearly bonus       A and twice A, in December first
 *   extra installment  A, in December first
 *   done by            1, 2 or 5 years before the loan ends
 *   rate change        +1, +2 and -1 points, the last while the rate is at least 1 %
 *
 * every amount through `niceAmount` and below b. A choice that could not change anything is left
 * out: a payment after the loan's last, a yearly one with less than a year to go, an end date no
 * later than the next payment. Nothing at all once the loan is repaid or down to its last payment.
 *
 * Each amount also gets a step, what one press of − or + moves it by, from the same base as its
 * presets and through `niceAmount`: 5 % of A for more each month, a tenth of A for round up, 1 % of
 * b for one payment, A for a yearly bonus. A monthly extra moves in small steps, a one-off payment
 * on a large loan in large ones.
 */
export function templateOptions(loan: LoanInput, fromMonth: number): TemplateOption[] {
  const from = monthOf(fromMonth);
  const plan = runScenario(loan, from);
  const now = plan.rows[from - 1];
  if (!now || (plan.payoffMonth !== null && from >= plan.payoffMonth)) return [];
  const balance = from === 1 ? Number(loan.principal) : plan.rows[from - 2].balance;
  const installment = now.payment;
  const end = plan.payoffMonth ?? Infinity;
  const amounts = (base: number, shares: number[]) =>
    distinct(shares.map((s) => niceAmount(base * s))).filter((a) => a > 0 && a < balance);
  const stepOf = (base: number) => Math.max(1, niceAmount(base));

  const options: TemplateOption[] = [];

  const more = amounts(installment, [0.05, 0.1, 0.2]);
  if (more.length > 0) {
    options.push({
      template: 'more-each-month',
      presets: { amount: more },
      steps: { amount: stepOf(installment * 0.05) },
      first: { template: 'more-each-month', amount: more[0] },
    });
  }

  const unit = niceAmount(installment / 10);
  const target = Math.ceil((installment + 1) / unit) * unit;
  options.push({
    template: 'round-up',
    presets: { target: [target, target + unit] },
    steps: { target: Math.max(1, unit) },
    first: { template: 'round-up', target },
  });

  const once = amounts(balance, [0.01, 0.05, 0.1]);
  const inMonths = [1, 6, 12].filter((n) => from + n - 1 < end);
  if (once.length > 0 && inMonths.length > 0) {
    options.push({
      template: 'one-payment',
      presets: { amount: once, inMonths },
      steps: { amount: stepOf(balance * 0.01) },
      first: { template: 'one-payment', amount: once[0], inMonths: inMonths[0] },
    });
  }

  // A year to go before the last payment, so every month of the year comes round once.
  if (end - from >= 12) {
    const bonus = amounts(installment, [1, 2]);
    if (bonus.length > 0) {
      options.push({
        template: 'yearly-bonus',
        presets: { amount: bonus, monthOfYear: MONTHS_OF_YEAR },
        steps: { amount: stepOf(installment) },
        first: { template: 'yearly-bonus', amount: bonus[0], monthOfYear: 12 },
      });
    }
    options.push({
      template: 'extra-installment',
      presets: { monthOfYear: MONTHS_OF_YEAR },
      steps: {},
      first: { template: 'extra-installment', monthOfYear: 12 },
    });
  }

  if (plan.payoffMonth !== null) {
    const payoff = plan.payoffMonth;
    const years = [1, 2, 5].filter((y) => payoff - 12 * y > from);
    if (years.length > 0) {
      options.push({
        template: 'done-by',
        presets: { yearsEarlier: years },
        steps: {},
        first: { template: 'done-by', yearsEarlier: years[0] },
      });
    }
  }

  options.push({
    template: 'rate-change',
    presets: { points: now.rate >= 1 ? [1, 2, -1] : [1, 2] },
    steps: {},
    first: { template: 'rate-change', points: 1 },
  });
  return options;
}

/** The month of the year the loan's payment `month` falls in, 1 to 12. */
function monthOfYear(loan: LoanInput, month: number): number {
  const date = addCalendarMonths(loan.start_date, month - 1);
  return date ? Number(date.slice(5, 7)) : ((month - 1) % 12) + 1;
}

/** The first month from `from` on that falls in month `wanted` of the year. */
function firstMonthIn(loan: LoanInput, from: number, wanted: number): number {
  const target = ((((Math.floor(wanted) - 1) % 12) + 12) % 12) + 1;
  for (let month = from; month < from + 12; month++) {
    if (monthOfYear(loan, month) === target) return month;
  }
  return from;
}

/**
 * The what-if a choice makes of the loan, seen from `fromMonth`, its extra payments in `mode`.
 * Done-by and rate-change take no mode: done-by finishes sooner by definition, and a rate change
 * has no extra payments. A choice that would pay nothing gives a what-if with nothing in it.
 */
export function buildWhatIf(
  loan: LoanInput,
  fromMonth: number,
  choice: WhatIfChoice,
  mode: ExtraMode
): WhatIf {
  const from = monthOf(fromMonth);
  const none: WhatIf = {
    mode: templateTakesMode(choice.template) ? mode : 'shorten',
    once: [],
    every: [],
    rate: null,
  };
  const monthly = (amount: number): WhatIf =>
    amount > 0 ? { ...none, every: [{ amount, every_months: 1, from_month: from }] } : none;
  const yearly = (amount: number, wanted: number): WhatIf =>
    amount > 0
      ? {
          ...none,
          every: [{ amount, every_months: 12, from_month: firstMonthIn(loan, from, wanted) }],
        }
      : none;

  switch (choice.template) {
    case 'more-each-month':
      return monthly(choice.amount);
    case 'round-up': {
      const installment = runScenario(loan, from).installmentNow;
      return installment === null ? none : monthly(cents(choice.target - installment));
    }
    case 'one-payment':
      return choice.amount > 0 && choice.inMonths >= 1
        ? {
            ...none,
            once: [{ month: from + Math.floor(choice.inMonths) - 1, amount: choice.amount }],
          }
        : none;
    case 'yearly-bonus':
      return yearly(choice.amount, choice.monthOfYear);
    case 'extra-installment': {
      const installment = runScenario(loan, from).installmentNow;
      return installment === null ? none : yearly(cents(installment), choice.monthOfYear);
    }
    case 'done-by': {
      const payoff = runScenario(loan, from).payoffMonth;
      const extra =
        payoff === null
          ? null
          : monthlyExtraToFinishBy(loan, from, payoff - 12 * choice.yearsEarlier);
      return extra ? monthly(extra) : none;
    }
    case 'rate-change':
      return Number.isFinite(choice.points) && choice.points !== 0
        ? { ...none, rate: { from_month: from, points: choice.points } }
        : none;
  }
}
