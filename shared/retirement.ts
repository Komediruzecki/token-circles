/**
 * Retirement projection.
 *
 * A month-by-month cashflow model: income (with planned steps and annual raises) minus
 * expenses (inflated, plus planned one-off periods), accumulated into a portfolio that
 * compounds monthly, compared against a target derived from the spending you want to fund.
 *
 * It lives in shared/ because the Cloudflare Worker and the browser-only storage layer both
 * answer the same endpoint, and the two hand-written copies they had before disagreed with
 * each other AND with the chart the page drew from their output.
 *
 * Two traps this module exists to avoid, both of which were live in the code it replaces:
 *
 *   1. Compounding a separate "gains" bucket. `gains += balance * rate` accumulates simple
 *      interest: the gains themselves never earn anything. Over 35 years that understates
 *      the result by roughly half. The balance itself has to be the thing that compounds.
 *
 *   2. Converting an annual rate to a monthly one by dividing, or worse by rooting the
 *      percentage number itself. `POW(5.78, 1/12) * 0.01` is 1.157%/month — 14.8%/year, not
 *      5.78%. The monthly equivalent of an annual rate is `(1 + r)^(1/12) - 1`.
 *
 * Inflation is handled by projecting in nominal terms and discounting back, so both views
 * come from one pass: `netWorthReal` is the same portfolio expressed in today's money, and a
 * target inflated to month m is crossed exactly when real net worth reaches today's target.
 * Setting `annualInflationPct` to 0 collapses the two views, which is what the UI's
 * "adjust for inflation" toggle does.
 */

/** A month as `YYYY-MM`. Days never matter here and carrying them invites timezone bugs. */
export type Month = string;

export interface IncomeStep {
  /** First month this income applies, `YYYY-MM`. */
  fromMonth: Month;
  /** Gross monthly income from that month on. */
  monthlyAmount: number;
}

export interface ExpensePeriod {
  fromMonth: Month;
  /** Last month inclusive. Omit for "from then on". */
  toMonth?: Month;
  /** Extra monthly spend on top of the baseline, in today's money. */
  monthlyAmount: number;
}

export interface Lifestyle {
  id: string;
  label: string;
  /** What that lifestyle costs per month in today's money. */
  monthlySpendToday: number;
}

export interface AllocationSlice {
  label: string;
  /** Share of the portfolio, in percent. */
  weightPct: number;
  /** Expected nominal annual return, in percent. */
  annualReturnPct: number;
  /** Cash: no nominal return, but it loses purchasing power at the inflation rate. */
  erodesWithInflation?: boolean;
}

export interface RetirementInput {
  /** Month the projection starts from; row 0 is this month's opening position. */
  startMonth: Month;
  /** `YYYY-MM` of birth. Only used to label rows with an age. */
  birthMonth?: Month;
  /** Projection stops the month the age is reached. Ignored when `horizonMonths` is set. */
  lifeExpectancyAge?: number;
  /** Explicit horizon, overriding `lifeExpectancyAge`. */
  horizonMonths?: number;

  /** Opening portfolio value. */
  netWorth: number;
  /** Baseline monthly income before steps and raises. */
  monthlyIncome: number;
  /** Baseline monthly spend in today's money, before inflation and planned periods. */
  monthlyExpenses: number;

  /** Nominal annual return on the portfolio, in percent. */
  annualReturnPct: number;
  /** Annual inflation, in percent. 0 turns the real/nominal distinction off. */
  annualInflationPct: number;
  /** Annual pay rise, in percent, applied once a year. */
  annualRaisePct?: number;
  /** Month the raise lands, 1-12. Defaults to January. */
  raiseMonth?: number;

  incomeSteps?: IncomeStep[];
  expensePeriods?: ExpensePeriod[];

  /** Withdrawal rate the target is derived from, in percent. 4 means the 4% rule (25x). */
  safeWithdrawalRatePct: number;
  /** One target per lifestyle you might retire into. */
  lifestyles: Lifestyle[];
}

export interface RetirementMonthRow {
  month: Month;
  /** Months since `startMonth`; row 0 is the opening position. */
  index: number;
  age: number | null;
  /** Income for the month after steps and raises (nominal). */
  income: number;
  /** Spend for the month after inflation and planned periods (nominal). */
  expenses: number;
  /** income - expenses. Negative means the portfolio is funding the shortfall. */
  saved: number;
  /** Portfolio at month end, nominal. */
  netWorth: number;
  /** The same portfolio in today's money. */
  netWorthReal: number;
  /** Cumulative saved since the start, nominal. Excludes investment growth. */
  cumulativeSaved: number;
}

export interface LifestyleResult extends Lifestyle {
  /** Portfolio needed to fund this lifestyle, in today's money. */
  targetToday: number;
  /** First month the portfolio can fund it, or null if never within the horizon. */
  crossing: {
    month: Month;
    index: number;
    age: number | null;
    /** Portfolio at that month, nominal. */
    netWorth: number;
    /** The target inflated to that month, which is what `netWorth` had to reach. */
    targetNominal: number;
  } | null;
}

export interface RetirementProjection {
  rows: RetirementMonthRow[];
  lifestyles: LifestyleResult[];
  /** Per-month compounding rate actually used, as a fraction. */
  monthlyReturnRate: number;
  monthlyInflationRate: number;
  /** The return net of inflation, via Fisher rather than subtraction. */
  realAnnualReturnPct: number;
  finalNetWorth: number;
  finalNetWorthReal: number;
  /** Sum of every month's saving. */
  totalSaved: number;
  /** Everything the portfolio gained that was not paid in. */
  totalGrowth: number;
}

/**
 * Hard ceiling on how many months a projection may run. No plan reaches it -- a lifetime is
 * under 1,500 months -- but callers that build a horizon from unvalidated input (the FIRE
 * endpoint takes a retirement age straight from the request body) would otherwise allocate
 * a row per month for as long as the arithmetic allowed.
 */
export const MAX_HORIZON_MONTHS = 12 * 150;

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isMonth(value: string): boolean {
  return MONTH_PATTERN.test(value);
}

/** Months since year 0, so months can be compared and differenced as plain integers. */
export function monthOrdinal(month: Month): number {
  const [y, m] = month.split('-');
  return Number(y) * 12 + (Number(m) - 1);
}

export function monthFromOrdinal(ordinal: number): Month {
  const year = Math.floor(ordinal / 12);
  const month = (ordinal % 12) + 1;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
}

export function addMonths(month: Month, count: number): Month {
  return monthFromOrdinal(monthOrdinal(month) + count);
}

/** 1-12. */
export function monthOfYear(month: Month): number {
  return Number(month.split('-')[1]);
}

/**
 * The monthly rate that compounds to `annualPct` over twelve months.
 * Not `annualPct / 12`, which is ~3% high at 8% over a year once compounded.
 */
export function monthlyRate(annualPct: number): number {
  return Math.pow(1 + annualPct / 100, 1 / 12) - 1;
}

/**
 * Return net of inflation, via Fisher: (1 + nominal) / (1 + inflation) - 1.
 * Subtracting instead overstates the real return, and the gap compounds: 8.1% against 3.5%
 * is 4.44% real, not 4.6%, which is ~11% of the final balance over 40 years.
 */
export function realAnnualReturnPct(nominalPct: number, inflationPct: number): number {
  return ((1 + nominalPct / 100) / (1 + inflationPct / 100) - 1) * 100;
}

/**
 * Portfolio return implied by an allocation. A slice marked `erodesWithInflation` (cash)
 * contributes minus the inflation rate rather than its nominal return.
 */
export function blendedReturnPct(slices: AllocationSlice[], inflationPct: number): number {
  let total = 0;
  for (const slice of slices) {
    const rate = slice.erodesWithInflation ? -inflationPct : slice.annualReturnPct;
    total += (slice.weightPct / 100) * rate;
  }
  return total;
}

/**
 * Portfolio needed to fund `monthlySpendToday` at `swrPct`. 4% means 25x.
 *
 * Note what raising the rate does: the target is spending divided by the rate, so a higher
 * withdrawal rate asks for a SMALLER pot and is therefore reached sooner. That is
 * arithmetic, not a shortcut — the rate is a claim about how much of the pot you can take
 * each year, and claiming more means needing less saved. Whether the claim survives
 * contact with reality is the separate question `yearsOfWithdrawals` answers.
 */
export function targetFromSpend(monthlySpendToday: number, swrPct: number): number {
  if (swrPct <= 0) return Number.POSITIVE_INFINITY;
  return (monthlySpendToday * 12) / (swrPct / 100);
}

/**
 * How many years a pot survives if you draw `swrPct` of its starting value each year, in
 * today's money, while it earns `realReturnPct` a year after inflation.
 *
 * Infinity when growth covers the withdrawals — that is the whole meaning of a rate being
 * "safe". Otherwise, with s = swrPct/100, r = realReturnPct/100 and a starting pot P, the
 * withdrawal is a constant W = sP in real terms, so
 *
 *   B(n) = P(1+r)^n - W((1+r)^n - 1)/r
 *
 * and solving B(n) = 0 gives
 *
 *   n = ln(s / (s - r)) / ln(1 + r)
 *
 * P cancels: doubling the pot doubles the withdrawal, so the runway is unchanged. That is
 * why a bigger target does not buy you a longer retirement — only a lower rate does.
 */
export function yearsOfWithdrawals(swrPct: number, realReturnPct: number): number {
  const s = swrPct / 100;
  const r = realReturnPct / 100;
  // Drawing nothing, or drawing no more than the pot earns, never exhausts it.
  if (s <= 0 || s <= r) return Number.POSITIVE_INFINITY;
  // A total loss each year leaves nothing to draw a second time.
  if (r <= -1) return 0;
  // The formula is 0/0 at r = 0; its limit there is the plain 1/s.
  if (r === 0) return 1 / s;
  return Math.log(s / (s - r)) / Math.log(1 + r);
}

function horizonFor(input: RetirementInput): number {
  const clamp = (n: number) => Math.min(MAX_HORIZON_MONTHS, Math.max(0, Math.floor(n)));
  if (input.horizonMonths != null) return clamp(input.horizonMonths);
  // `lifeExpectancyAge` says when to stop, which only means something once we know when the
  // person started. With no birth month there is no age to count from, so the projection
  // falls back to a fixed span -- a caller that offers the field has to say so.
  if (input.lifeExpectancyAge != null && input.birthMonth) {
    const end = monthOrdinal(input.birthMonth) + input.lifeExpectancyAge * 12;
    return clamp(end - monthOrdinal(input.startMonth));
  }
  return 12 * 60;
}

function ageAt(birthMonth: Month | undefined, month: Month): number | null {
  if (!birthMonth) return null;
  return Math.floor((monthOrdinal(month) - monthOrdinal(birthMonth)) / 12);
}

/**
 * The step that begins this month, if any.
 *
 * A step sets the salary outright rather than only raising it. "I will earn 2,000 from
 * March" has to be able to mean a sabbatical or a career change, not only a promotion; an
 * earlier version accepted a step only when it beat what raises had already produced, so a
 * pay cut was silently discarded and the chart did not move when the user typed one. Raises
 * compound from whatever the step set, and a step landing in a raise month replaces that
 * year's raise.
 *
 * The last step wins when two share a month, so an edited duplicate behaves predictably.
 */
function stepStartingAt(steps: IncomeStep[], ordinal: number): number | null {
  let found: number | null = null;
  for (const step of steps) {
    if (isMonth(step.fromMonth) && monthOrdinal(step.fromMonth) === ordinal) {
      found = step.monthlyAmount;
    }
  }
  return found;
}

/** The last step that already began on or before the opening month, if any. */
function stepAlreadyInForce(steps: IncomeStep[], startOrdinal: number): number | null {
  let best: IncomeStep | null = null;
  for (const step of steps) {
    if (!isMonth(step.fromMonth)) continue;
    const start = monthOrdinal(step.fromMonth);
    if (start > startOrdinal) continue;
    if (!best || start > monthOrdinal(best.fromMonth)) best = step;
  }
  return best ? best.monthlyAmount : null;
}

function plannedExpenses(periods: ExpensePeriod[], ordinal: number): number {
  let total = 0;
  for (const period of periods) {
    // A half-typed month is not a start date. Comparing it anyway yields NaN, which fails
    // every comparison, so the period quietly applied from the beginning of time and the
    // projection lurched while the user was still typing into the field.
    if (!isMonth(period.fromMonth)) continue;
    if (monthOrdinal(period.fromMonth) > ordinal) continue;
    if (period.toMonth && isMonth(period.toMonth) && monthOrdinal(period.toMonth) < ordinal) {
      continue;
    }
    total += period.monthlyAmount;
  }
  return total;
}

/**
 * Run the projection.
 *
 * Row 0 is the opening position: no saving is applied and the portfolio is exactly
 * `netWorth`. From month 1 the portfolio compounds and that month's saving is added, which
 * is the ordering an end-of-month contribution implies.
 */
export function projectRetirement(input: RetirementInput): RetirementProjection {
  if (!isMonth(input.startMonth))
    throw new Error(`startMonth must be YYYY-MM, got ${input.startMonth}`);
  if (input.birthMonth && !isMonth(input.birthMonth)) {
    throw new Error(`birthMonth must be YYYY-MM, got ${input.birthMonth}`);
  }

  const horizon = horizonFor(input);
  const rMonthly = monthlyRate(input.annualReturnPct);
  const iMonthly = monthlyRate(input.annualInflationPct);
  const raisePct = input.annualRaisePct ?? 0;
  const raiseMonth = input.raiseMonth ?? 1;
  const steps = input.incomeSteps ?? [];
  const periods = input.expensePeriods ?? [];
  const startOrdinal = monthOrdinal(input.startMonth);

  const rows: RetirementMonthRow[] = [];
  let netWorth = input.netWorth;
  let income = stepAlreadyInForce(steps, startOrdinal) ?? input.monthlyIncome;
  let cumulativeSaved = 0;
  let totalSaved = 0;

  for (let index = 0; index <= horizon; index++) {
    const month = monthFromOrdinal(startOrdinal + index);
    const ordinal = startOrdinal + index;
    // Inflation compounds from the start month, so month 12 is exactly one annual step.
    const inflationFactor = Math.pow(1 + iMonthly, index);

    if (index > 0) {
      const step = stepStartingAt(steps, ordinal);
      if (step != null) income = step;
      else if (raisePct !== 0 && monthOfYear(month) === raiseMonth) income *= 1 + raisePct / 100;
    }

    const expenses = (input.monthlyExpenses + plannedExpenses(periods, ordinal)) * inflationFactor;
    const saved = index === 0 ? 0 : income - expenses;

    if (index > 0) {
      netWorth = netWorth * (1 + rMonthly) + saved;
      cumulativeSaved += saved;
      totalSaved += saved;
    }

    rows.push({
      month,
      index,
      age: ageAt(input.birthMonth, month),
      income,
      expenses,
      saved,
      netWorth,
      netWorthReal: netWorth / inflationFactor,
      cumulativeSaved,
    });
  }

  // A target inflated to month m is reached exactly when real net worth reaches today's
  // target, so one comparison covers both views.
  const lifestyles: LifestyleResult[] = input.lifestyles.map((lifestyle) => {
    const targetToday = targetFromSpend(lifestyle.monthlySpendToday, input.safeWithdrawalRatePct);
    const hit = rows.find((row) => row.netWorthReal >= targetToday);
    return {
      ...lifestyle,
      targetToday,
      crossing: hit
        ? {
            month: hit.month,
            index: hit.index,
            age: hit.age,
            netWorth: hit.netWorth,
            targetNominal: targetToday * Math.pow(1 + iMonthly, hit.index),
          }
        : null,
    };
  });

  const last = rows[rows.length - 1];
  return {
    rows,
    lifestyles,
    monthlyReturnRate: rMonthly,
    monthlyInflationRate: iMonthly,
    realAnnualReturnPct: realAnnualReturnPct(input.annualReturnPct, input.annualInflationPct),
    finalNetWorth: last.netWorth,
    finalNetWorthReal: last.netWorthReal,
    totalSaved,
    totalGrowth: last.netWorth - input.netWorth - totalSaved,
  };
}

/**
 * Same projection under a band of return assumptions, so a plan is read as a range rather
 * than a single number it will never land on.
 */
export function projectScenarios(
  input: RetirementInput,
  returns: { label: string; annualReturnPct: number }[]
): { label: string; annualReturnPct: number; projection: RetirementProjection }[] {
  return returns.map((scenario) => ({
    ...scenario,
    projection: projectRetirement({ ...input, annualReturnPct: scenario.annualReturnPct }),
  }));
}
