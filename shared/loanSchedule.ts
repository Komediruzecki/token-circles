/**
 * Loan amortisation: the one schedule behind every loan figure in the app.
 *
 * The Worker (`POST /api/loans/:id/calculate`, `GET /api/loans`) and the browser-only storage
 * layer answer the same endpoints, and the Loans page, the amortisation table and the debt-free
 * badge read the same numbers, so the arithmetic lives here once. Before this module it existed
 * as two hand-copied engines plus three more copies of the annuity formula, and the copies agreed
 * with each other mostly because they shared their mistakes.
 *
 * One month k, starting with a balance B owed:
 *
 *   rate      the rate period covering month k, else the loan's own base rate
 *   interest  B * r, where r is the annual percentage / 100 / 12
 *   payment   the installment, or everything owed (B + interest) when that is less. The last
 *             month pays exactly what is left, so the payments add up to principal plus interest.
 *   extra     every extra payment dated month k, added together, paid with the installment and
 *             capped at what is still owed. The balance never goes below zero.
 *
 * A balance within half a cent of zero counts as repaid. Paying the balance the screen shows,
 * rounded to the cent, ends the loan that month, and an installment that would leave a fraction
 * of a cent pays that fraction too, so no loan gets a last month for less than a cent. The end
 * month an extra payment sets, which a later rate change spreads the balance over, counts the
 * same way. What is recorded is what was owed, so the totals stay exact.
 *
 * What moves the installment:
 *
 *   - An extra payment does not. The installment stays the same and the loan ends sooner.
 *   - A rate change does. The new installment repays the balance by the loan's current end date:
 *     the original term, or the earlier month that extra payments have brought it forward to.
 *
 * Dates are calendar arithmetic on the start date's year, month and day, with the day clamped to
 * the length of shorter months: a loan starting on 31 January is due on 28 February (29 in a leap
 * year), then on 31 March. No Date object is involved, so no timezone can move a due date.
 */

/** A stretch of months charged at its own annual rate. */
export interface LoanRatePeriod {
  /** Annual rate, in percent. */
  rate: number;
  /** First month it applies to, counting the first payment as month 1. */
  start_month: number;
  /** Last month it applies to, inclusive. Empty (null, undefined or 0) runs to the end. */
  end_month?: number | null;
}

/** A payment on top of the installment, made in the same month as it. */
export interface LoanPrepayment {
  /** The month it is paid in, counting the first payment as month 1. */
  month: number;
  amount: number;
  note?: string | null;
}

/** A loan as both runtimes store it, together with its rate periods and extra payments. */
export interface LoanInput {
  principal: number;
  /**
   * The loan's own annual rate, in percent. Every month no rate period covers is charged at it.
   * It is part of the input, rather than a period each caller has to remember to prepend, because
   * a caller that forgot it charged those months nothing.
   */
  interest_rate: number;
  /** YYYY-MM-DD: the date the first payment is due. Anything after the day is ignored. */
  start_date: string;
  term_months: number;
  rate_periods?: readonly LoanRatePeriod[] | null;
  prepayments?: readonly LoanPrepayment[] | null;
}

/** One month of the schedule, in the shape `POST /api/loans/:id/calculate` has always returned. */
export interface ScheduleRow {
  month: number;
  /** YYYY-MM-DD the payment is due; '' when the loan's start date cannot be read. */
  date: string;
  /** The installment paid this month: the full one, or what was left in the last month. */
  payment: number;
  /** The part of `payment` that repaid principal. Extra payments are counted in `prepayment`. */
  principal: number;
  interest: number;
  /** Still owed after this month's payment and extra payments. */
  balance: number;
  /** Extra payments applied this month: no more than was still owed. */
  prepayment: number;
  /** Annual rate charged this month, in percent. */
  rate: number;
  /** The notes of this month's extra payments, joined with '; '. */
  note: string;
}

export interface LoanSummary {
  /** Every payment and extra payment: principal plus total interest. */
  totalPaid: number;
  totalInterest: number;
  /** Interest the extra payments avoid, against the same loan without them. */
  interestSaved: number;
  /** Months the extra payments remove, against the same loan without them. */
  monthsSaved: number;
  /** Date of the last payment, or null when there is no schedule. */
  payoffDate: string | null;
  totalPayments: number;
  avgMonthlyPayment: number;
  /** The highest balance in the schedule: the one after the first payment. */
  maxBalance: number;
  originalTotalInterest: number;
  originalTotalPayments: number;
}

/** The body of `POST /api/loans/:id/calculate`, in both runtimes. */
export interface LoanCalculation {
  schedule: ScheduleRow[];
  summary: LoanSummary;
  comparison: { withPrepayments: LoanSummary; withoutPrepayments: LoanSummary };
}

/** Where a loan stands on a given day. `GET /api/loans` adds these fields to every loan. */
export interface LoanStatus {
  /** Owed after every payment due on or before the day, extra payments and rate changes included. */
  remaining_balance: number;
  /** The next payment due after the day; 0 once the loan is paid off. */
  monthly_payment: number;
  /** Date of the last payment, or null when there is no schedule. */
  payoff_date: string | null;
}

/**
 * The longest term the engine amortises. A century covers every loan anyone has; a longer term is
 * a typo or a malformed row, and is treated like a term of zero, an empty schedule, rather than
 * amortised month by month for as long as it asks.
 */
export const MAX_TERM_MONTHS = 1200;

/**
 * The most that can be left over and still count as repaid: what rounds to zero on a screen
 * that shows cents. See the module comment.
 */
const HALF_CENT = 0.005;

/**
 * The installment that repays `principal` in `months` equal monthly payments at an annual rate
 * of `annualRatePct` percent: P r (1+r)^n / ((1+r)^n - 1), with r = annualRatePct / 100 / 12.
 * Written as P r / (1 - (1+r)^-n) through expm1/log1p, which stays accurate for rates near zero.
 * 0 when there are no months to pay in.
 */
export function annuityPayment(principal: number, annualRatePct: number, months: number): number {
  if (!(months > 0)) return 0;
  const r = annualRatePct / 100 / 12;
  if (r === 0) return principal / months;
  return (principal * r) / -Math.expm1(-months * Math.log1p(r));
}

/** UTC calendar date, YYYY-MM-DD: the "today" both runtimes measure a loan against. */
export function todayUtc(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

function parseDate(date: unknown): CalendarDate | null {
  if (typeof date !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28;
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

function shift(start: CalendarDate, months: number): string {
  const index = start.year * 12 + (start.month - 1) + months;
  const year = Math.floor(index / 12);
  const month = index - year * 12 + 1;
  const day = Math.min(start.day, daysInMonth(year, month));
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * `date` (YYYY-MM-DD) moved by a whole number of calendar months, its day clamped to the length of
 * the month it lands in: 2026-01-31 plus one month is 2026-02-28, plus two is 2026-03-31. Every
 * step is taken from `date` itself, so a clamped month never shortens the ones after it.
 * '' when `date` cannot be read.
 */
export function addCalendarMonths(date: string, months: number): string {
  const start = parseDate(date);
  return start && Number.isInteger(months) ? shift(start, months) : '';
}

interface Period {
  rate: number;
  start: number;
  end: number | null;
}

/** Usable rate periods, ordered by start month. The sort is stable, so ties keep input order. */
function periodsOf(list: LoanInput['rate_periods']): Period[] {
  const periods: Period[] = [];
  for (const p of list ?? []) {
    const rate = Number(p.rate);
    const start = Number(p.start_month);
    if (!Number.isFinite(rate) || !Number.isFinite(start)) continue;
    const end = p.end_month ? Number(p.end_month) : NaN;
    periods.push({ rate, start, end: Number.isFinite(end) ? end : null });
  }
  return periods.sort((a, b) => a.start - b.start);
}

/**
 * The rate charged in `month`: the covering period that starts latest (the one listed last among
 * equal starts), or the base rate when no period covers it. A period that has ended hands the
 * month back to whatever covers it next, the base rate included.
 */
function rateIn(month: number, baseRate: number, periods: readonly Period[]): number {
  let rate = baseRate;
  for (const p of periods) {
    if (p.start <= month && (p.end === null || month <= p.end)) rate = p.rate;
  }
  return rate;
}

interface MonthExtras {
  amount: number;
  notes: string[];
}

/**
 * Extra payments by month, added together. One with a month outside the loan or an amount that
 * is not a positive number pays nothing, so it is left out.
 */
function extrasOf(list: LoanInput['prepayments']): Map<number, MonthExtras> {
  const byMonth = new Map<number, MonthExtras>();
  for (const p of list ?? []) {
    const month = Number(p.month);
    const amount = Number(p.amount);
    if (!Number.isInteger(month) || month < 1 || !(amount > 0) || amount === Infinity) continue;
    const entry = byMonth.get(month) ?? { amount: 0, notes: [] };
    entry.amount += amount;
    if (p.note) entry.notes.push(String(p.note));
    byMonth.set(month, entry);
  }
  return byMonth;
}

/** The terms in force: what is paid each month, at which rate, until which month. */
interface Plan {
  installment: number;
  /** The annual rate the installment was set for. */
  rate: number;
  /** The month the loan is due to end in, at this installment. */
  endMonth: number;
}

/**
 * Installments needed to repay `balance` at `installment` a month, the last one possibly partial,
 * by the schedule's own rule that half a cent left counts as repaid: with h = HALF_CENT, the
 * smallest n with B_n = B (1+r)^n - A ((1+r)^n - 1) / r <= h, which is
 * ln((A - rh) / (A - rB)) / ln(1 + r), and (B - h) / A at 0 %. The 1e-9 keeps floating-point
 * noise on an exact count from adding a month.
 * Infinity when the installment does not cover the interest, which is never the case for an
 * installment set by `annuityPayment`.
 */
function installmentsToRepay(balance: number, annualRatePct: number, installment: number): number {
  const r = annualRatePct / 100 / 12;
  const exact =
    r === 0
      ? (balance - HALF_CENT) / installment
      : (Math.log1p((-r * HALF_CENT) / installment) - Math.log1p((-r * balance) / installment)) /
        Math.log1p(r);
  if (!(exact > 0) || !Number.isFinite(exact)) return Infinity;
  return Math.max(1, Math.ceil(exact - 1e-9));
}

/**
 * What an extra payment does to the rest of the loan. Today there is one answer: the installment
 * stays and the loan ends sooner, in the month the remaining balance runs out at that installment.
 * A per-payment choice to keep the end date and lower the installment instead would be a second
 * branch here and nothing else: `installment: annuityPayment(balance, plan.rate, plan.endMonth -
 * month)`, end month unchanged.
 */
function afterExtraPayment(plan: Plan, balance: number, month: number): Plan {
  const left = installmentsToRepay(balance, plan.rate, plan.installment);
  return { ...plan, endMonth: Math.min(plan.endMonth, month + left) };
}

/**
 * The amortisation schedule, extra payments and rate periods included. Empty for a loan with
 * nothing to repay or no usable term: a principal or term of zero, negative or not a number, or a
 * term over MAX_TERM_MONTHS.
 */
export function amortize(loan: LoanInput): ScheduleRow[] {
  const principal = Number(loan.principal);
  const term = Math.floor(Number(loan.term_months));
  if (!(principal > 0 && principal < Infinity) || !(term >= 1 && term <= MAX_TERM_MONTHS)) {
    return [];
  }
  const baseRate = Number.isFinite(Number(loan.interest_rate)) ? Number(loan.interest_rate) : 0;
  const periods = periodsOf(loan.rate_periods);
  const extras = extrasOf(loan.prepayments);
  const start = parseDate(loan.start_date);

  const schedule: ScheduleRow[] = [];
  let balance = principal;
  let plan: Plan | null = null;

  for (let month = 1; balance > 0 && month <= (plan?.endMonth ?? term); month++) {
    const rate = rateIn(month, baseRate, periods);
    if (plan === null || rate !== plan.rate) {
      // The first month, or a rate change: set the installment that clears the balance by the
      // current end date, from this month on.
      const endMonth: number = plan?.endMonth ?? term;
      plan = { rate, endMonth, installment: annuityPayment(balance, rate, endMonth - month + 1) };
    }

    const interest = balance * (rate / 100 / 12);
    const owed = balance + interest;
    // The last month pays what is owed: in the scheduled end month, or earlier when that is no
    // more than an installment and half a cent.
    const last = month >= plan.endMonth || owed <= plan.installment + HALF_CENT;
    const payment = last ? owed : plan.installment;
    const principalPaid = last ? balance : payment - interest;
    balance = last ? 0 : balance - principalPaid;

    let prepayment = 0;
    let note = '';
    const extra = extras.get(month);
    if (extra && balance > 0) {
      // Within half a cent of the balance pays it off, recorded as the balance it repaid.
      const paysOff = extra.amount >= balance - HALF_CENT;
      prepayment = paysOff ? balance : extra.amount;
      balance = paysOff ? 0 : balance - extra.amount;
      note = extra.notes.join('; ');
      if (balance > 0) plan = afterExtraPayment(plan, balance, month);
    }

    schedule.push({
      month,
      date: start ? shift(start, month - 1) : '',
      payment,
      principal: principalPaid,
      interest,
      balance,
      prepayment,
      rate,
      note,
    });
  }

  return schedule;
}

/** Date of the last payment, or null when there is no schedule or no readable start date. */
export function payoffDate(schedule: readonly ScheduleRow[]): string | null {
  return schedule.length > 0 ? schedule[schedule.length - 1].date || null : null;
}

function total(schedule: readonly ScheduleRow[], pick: (row: ScheduleRow) => number): number {
  let sum = 0;
  for (const row of schedule) sum += pick(row);
  return sum;
}

/** Totals for `schedule`, measured against `original`, the same loan without extra payments. */
export function summarize(
  schedule: readonly ScheduleRow[],
  original: readonly ScheduleRow[]
): LoanSummary {
  const totalInterest = total(schedule, (r) => r.interest);
  const originalTotalInterest = total(original, (r) => r.interest);
  return {
    totalPaid: total(schedule, (r) => r.payment + r.prepayment),
    totalInterest,
    interestSaved: originalTotalInterest - totalInterest,
    monthsSaved: original.length - schedule.length,
    payoffDate: payoffDate(schedule),
    totalPayments: schedule.length,
    avgMonthlyPayment:
      schedule.length > 0 ? total(schedule, (r) => r.payment) / schedule.length : 0,
    maxBalance: schedule.length > 0 ? schedule[0].balance : 0,
    originalTotalInterest,
    originalTotalPayments: original.length,
  };
}

/** Everything `POST /api/loans/:id/calculate` returns, from the loan as stored. */
export function calculateLoan(loan: LoanInput): LoanCalculation {
  const schedule = amortize(loan);
  const original = amortize({ ...loan, prepayments: [] });
  const summary = summarize(schedule, original);
  return {
    schedule,
    summary,
    comparison: { withPrepayments: summary, withoutPrepayments: summarize(original, original) },
  };
}

/**
 * Where the loan stands on `today` (YYYY-MM-DD): the balance after every payment due on or before
 * it, the next payment, and the payoff date. A loan whose start date cannot be read has had no
 * payment fall due.
 */
export function loanStatus(loan: LoanInput, today: string): LoanStatus {
  const schedule = amortize(loan);
  const principal = Number(loan.principal);
  let remaining = principal > 0 && principal < Infinity ? principal : 0;
  let next: ScheduleRow | undefined;
  for (const row of schedule) {
    if (row.date === '' || row.date > today) {
      next = row;
      break;
    }
    remaining = row.balance;
  }
  return {
    remaining_balance: remaining,
    monthly_payment: next ? next.payment : 0,
    payoff_date: payoffDate(schedule),
  };
}
