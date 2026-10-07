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
 *   extra     every extra payment dated month k, and every repeating one due in it, added together,
 *             paid with the installment and capped at what is still owed. The balance never goes
 *             below zero.
 *
 * A balance within half a cent of zero counts as repaid. Paying the balance the screen shows,
 * rounded to the cent, ends the loan that month, and an installment that would leave a fraction
 * of a cent pays that fraction too, so no loan gets a last month for less than a cent. The end
 * month an extra payment sets, which a later rate change spreads the balance over, counts the
 * same way. What is recorded is what was owed, so the totals stay exact.
 *
 * What an extra payment does, by its mode:
 *
 *   - 'shorten', "Finish sooner", the default and what every saved extra payment does: the
 *     installment stays the same and the loan ends sooner, in the month the balance runs out at it.
 *   - 'lower', "Pay less each month": the end month stays, and the installment becomes the one
 *     that repays the balance by it.
 *
 * Extra payments of both modes in one month apply finish-sooner ones first, then pay-less ones,
 * spread over the end month the first ones set. A mode other than 'lower' is 'shorten'.
 *
 * A repeating extra payment (`extra_rules`) pays its amount every `every_months` months from
 * `from_month`, up to `to_month` when it has one, until the loan is repaid. It is the same as
 * listing each of those payments as an extra payment of its own, in its mode. Its months must be
 * whole numbers of at least 1 and its amount a positive number; a rule that breaks either pays
 * nothing, as an extra payment with a month outside the loan does.
 *
 * What a rate change does, by `on_rate_change`:
 *
 *   - 'keep-term', the default: the new installment repays the balance by the loan's current end
 *     date, the original term or the earlier month that extra payments have brought it forward to.
 *   - 'keep-installment': the installment stays and the end month moves to wherever the balance
 *     runs out at it. The rate of month 1 sets the first installment under either option.
 *
 * A loan can then never be repaid: when a rate change leaves an installment that no longer covers
 * the interest, or one that would take past MAX_TERM_MONTHS. A later rate change or extra payment
 * can bring the end month back within reach; when nothing does, `amortizeLoan` says from which
 * month the loan is never repaid, and its rows stop before that month. Under 'keep-term' this
 * cannot happen: the installment is always set to repay the loan by its end month.
 *
 * Under 'keep-installment' a pay-less extra payment can cost more interest than none at all. It
 * sets the installment that repays the balance by the end month at the rate of its month, and a
 * later rise keeps that lower installment, so the loan runs longer at the higher rate. Under
 * 'keep-term', and for finish-sooner extra payments under either option, an extra payment never
 * adds interest.
 *
 * Dates are calendar arithmetic on the start date's year, month and day, with the day clamped to
 * the length of shorter months: a loan starting on 31 January is due on 28 February (29 in a leap
 * year), then on 31 March. No Date object is involved, so no timezone can move a due date.
 *
 * A loan with none of the scenario fields (modes, `extra_rules`, `on_rate_change`) gets exactly
 * the schedule it got before they existed, to the last bit: the arithmetic of that path is
 * unchanged.
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

/**
 * What an extra payment does to the rest of the loan: 'shorten' ("Finish sooner") keeps the
 * installment and ends the loan sooner; 'lower' ("Pay less each month") keeps the end month and
 * lowers the installment.
 */
export type ExtraMode = 'shorten' | 'lower';

/** What a rate change keeps: the end month (the installment is recomputed), or the installment. */
export type RateChangeOption = 'keep-term' | 'keep-installment';

/** A payment on top of the installment, made in the same month as it. */
export interface LoanPrepayment {
  /** The month it is paid in, counting the first payment as month 1. */
  month: number;
  amount: number;
  note?: string | null;
  /** 'shorten' when absent, which is what every extra payment stored so far does. */
  mode?: ExtraMode | null;
}

/**
 * An extra payment that repeats: `amount` every `every_months` months from `from_month`, up to
 * and including `to_month` when there is one, until the loan is repaid.
 */
export interface LoanExtraRule {
  amount: number;
  every_months: number;
  /** The month of the first payment, counting the loan's first payment as month 1. */
  from_month: number;
  /** The last month it may pay in. Absent (null or undefined) runs until the loan is repaid. */
  to_month?: number | null;
  /** 'shorten' when absent. */
  mode?: ExtraMode | null;
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
  /** Repeating extra payments. Not stored yet: the loan scenarios pass them. */
  extra_rules?: readonly LoanExtraRule[] | null;
  /** 'keep-term' when absent. Not stored yet: an engine option until it can be. */
  on_rate_change?: RateChangeOption | null;
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

/** A schedule, and whether it ends. */
export interface LoanAmortization {
  /** One row per month, up to the month the loan is repaid, or up to `neverPaysOffFrom`. */
  rows: ScheduleRow[];
  /**
   * The month from which the loan is never repaid: its installment no longer covers the interest,
   * or would take past MAX_TERM_MONTHS, and nothing later changes that. The rows stop before it.
   * Null for a loan that is repaid, and for one with no schedule at all.
   */
  neverPaysOffFrom: number | null;
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
  /**
   * Date of the next payment due after the day: null once the loan is paid off, and when the
   * start date cannot be read, so the schedule has no dates.
   */
  next_payment_date: string | null;
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

/** The loan's own rate: 0 when it is not a number, as the schedule charges it. */
function baseRateOf(loan: LoanInput): number {
  return Number.isFinite(Number(loan.interest_rate)) ? Number(loan.interest_rate) : 0;
}

/** Months charged at one rate: `start` to `end`, inclusive, `end` null for the rest of the loan. */
export interface RateStretch {
  start: number;
  end: number | null;
  rate: number;
}

/**
 * The rates the schedule charges from month `from` on, as stretches of months at one rate, in
 * order. Neighbouring stretches always differ in rate, and the last one runs to the end of the
 * loan. A `from` below 1, or not a number, counts from month 1.
 */
export function rateStretches(loan: LoanInput, from: number): RateStretch[] {
  const first = Number.isFinite(from) ? Math.max(1, Math.ceil(from)) : 1;
  const baseRate = baseRateOf(loan);
  const periods = periodsOf(loan.rate_periods);
  // The rate can only change in the first month of a period, or in the month after one ends.
  const edges = new Set([first]);
  for (const p of periods) {
    edges.add(Math.max(first, Math.ceil(p.start)));
    if (p.end !== null) edges.add(Math.max(first, Math.floor(p.end) + 1));
  }
  const stretches: RateStretch[] = [];
  for (const start of [...edges].sort((a, b) => a - b)) {
    const rate = rateIn(start, baseRate, periods);
    const last = stretches[stretches.length - 1];
    if (last && last.rate === rate) continue;
    if (last) last.end = start - 1;
    stretches.push({ start, end: null, rate });
  }
  return stretches;
}

/** One month's extra payments, added together by mode. */
interface MonthExtras {
  shorten: number;
  lower: number;
  notes: string[];
}

const modeOf = (mode: unknown): ExtraMode => (mode === 'lower' ? 'lower' : 'shorten');

/** A positive amount that is a number: what an extra payment must be to pay anything. */
const payable = (amount: number): boolean => amount > 0 && amount !== Infinity;

/** A whole number of at least 1: what every month number must be. */
const wholeMonth = (n: number): boolean => Number.isInteger(n) && n >= 1;

/**
 * Extra payments by month, added together in the order listed. One with a month outside the loan
 * or an amount that is not a positive number pays nothing, so it is left out.
 */
function extrasOf(list: LoanInput['prepayments']): Map<number, MonthExtras> {
  const byMonth = new Map<number, MonthExtras>();
  for (const p of list ?? []) {
    const month = Number(p.month);
    const amount = Number(p.amount);
    if (!wholeMonth(month) || !payable(amount)) continue;
    const entry = byMonth.get(month) ?? { shorten: 0, lower: 0, notes: [] };
    entry[modeOf(p.mode)] += amount;
    if (p.note) entry.notes.push(String(p.note));
    byMonth.set(month, entry);
  }
  return byMonth;
}

interface Rule {
  amount: number;
  every: number;
  from: number;
  /** Infinity for a rule with no last month. */
  to: number;
  mode: ExtraMode;
  note: string;
}

/** Usable repeating extra payments: whole months of at least 1 and a positive amount. */
function rulesOf(list: LoanInput['extra_rules']): Rule[] {
  const rules: Rule[] = [];
  for (const r of list ?? []) {
    const amount = Number(r.amount);
    const every = Number(r.every_months);
    const from = Number(r.from_month);
    const to = r.to_month === null || r.to_month === undefined ? Infinity : Number(r.to_month);
    if (!payable(amount) || !wholeMonth(every) || !wholeMonth(from)) continue;
    if (to !== Infinity && !wholeMonth(to)) continue;
    rules.push({
      amount,
      every,
      from,
      to,
      mode: modeOf(r.mode),
      note: r.note ? String(r.note) : '',
    });
  }
  return rules;
}

/**
 * Month k's extra payments: the ones dated k, then every rule due in k, in the order listed. A
 * loan without rules gets the dated ones exactly as they were added up.
 */
function extrasIn(
  month: number,
  dated: Map<number, MonthExtras>,
  rules: readonly Rule[]
): MonthExtras | undefined {
  const own = dated.get(month);
  let entry: MonthExtras | undefined;
  for (const rule of rules) {
    if (month < rule.from || month > rule.to || (month - rule.from) % rule.every !== 0) continue;
    entry ??= own ? { ...own, notes: [...own.notes] } : { shorten: 0, lower: 0, notes: [] };
    entry[rule.mode] += rule.amount;
    if (rule.note) entry.notes.push(rule.note);
  }
  return entry ?? own;
}

/** The terms in force: what is paid each month, at which rate, until which month. */
interface Plan {
  installment: number;
  /** The annual rate the installment was set for. */
  rate: number;
  /**
   * The month the loan is due to end in, at this installment. Past MAX_TERM_MONTHS, Infinity
   * included, when it is out of reach: see `amortizeLoan`.
   */
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
 * The terms from `month` on, charged at `rate`: the first month's, or a rate change's. `balance`
 * is what is owed before the month's payment. The first month, and every rate change under
 * 'keep-term', set the installment that repays the balance by the current end month. Under
 * 'keep-installment' a rate change keeps the installment, and the end month becomes the last of
 * the installments that repay the balance at it: out of reach when there is none.
 */
function termsFrom(
  plan: Plan | null,
  rate: number,
  balance: number,
  month: number,
  term: number,
  keepInstallment: boolean
): Plan {
  if (plan === null || !keepInstallment) {
    const endMonth: number = plan?.endMonth ?? term;
    return { rate, endMonth, installment: annuityPayment(balance, rate, endMonth - month + 1) };
  }
  const left = installmentsToRepay(balance, rate, plan.installment);
  return { rate, installment: plan.installment, endMonth: month - 1 + left };
}

/**
 * What an extra payment made in `month` does to the rest of the loan, `balance` being what is
 * still owed after it. Finish sooner: the installment stays, and the loan ends in the month the
 * balance runs out at it. Pay less each month: the end month stays, and the installment from the
 * next month on is the one that repays the balance by then.
 */
function afterExtraPayment(plan: Plan, balance: number, month: number, mode: ExtraMode): Plan {
  if (mode === 'lower') {
    return { ...plan, installment: annuityPayment(balance, plan.rate, plan.endMonth - month) };
  }
  const left = installmentsToRepay(balance, plan.rate, plan.installment);
  return { ...plan, endMonth: Math.min(plan.endMonth, month + left) };
}

/** The order a month's extra payments apply in: finish sooner first, then pay less. */
const MODES: readonly ExtraMode[] = ['shorten', 'lower'];

/**
 * The amortisation schedule, extra payments, repeating ones and rate periods included, and the
 * month from which the loan is never repaid, if there is one. Empty for a loan with nothing to
 * repay or no usable term: a principal or term of zero, negative or not a number, or a term over
 * MAX_TERM_MONTHS.
 */
export function amortizeLoan(loan: LoanInput): LoanAmortization {
  const principal = Number(loan.principal);
  const term = Math.floor(Number(loan.term_months));
  if (!(principal > 0 && principal < Infinity) || !(term >= 1 && term <= MAX_TERM_MONTHS)) {
    return { rows: [], neverPaysOffFrom: null };
  }
  const baseRate = baseRateOf(loan);
  const periods = periodsOf(loan.rate_periods);
  const dated = extrasOf(loan.prepayments);
  const rules = rulesOf(loan.extra_rules);
  const keepInstallment = loan.on_rate_change === 'keep-installment';
  const start = parseDate(loan.start_date);

  const schedule: ScheduleRow[] = [];
  let balance = principal;
  let plan: Plan | null = null;
  // The month since which the end month has been out of reach, for as long as it still is.
  let outOfReachSince: number | null = null;

  for (
    let month = 1;
    balance > 0 && month <= Math.min(plan?.endMonth ?? term, MAX_TERM_MONTHS);
    month++
  ) {
    const rate = rateIn(month, baseRate, periods);
    if (plan === null || rate !== plan.rate) {
      // The first month, or a rate change.
      plan = termsFrom(plan, rate, balance, month, term, keepInstallment);
      if (plan.endMonth <= MAX_TERM_MONTHS) outOfReachSince = null;
      else outOfReachSince ??= month;
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
    const extra = extrasIn(month, dated, rules);
    if (extra && balance > 0) {
      for (const mode of MODES) {
        const amount = extra[mode];
        if (!(amount > 0) || !(balance > 0)) continue;
        // Within half a cent of the balance pays it off, recorded as the balance it repaid.
        const paysOff = amount >= balance - HALF_CENT;
        prepayment += paysOff ? balance : amount;
        balance = paysOff ? 0 : balance - amount;
        if (balance > 0) {
          plan = afterExtraPayment(plan, balance, month, mode);
          if (plan.endMonth <= MAX_TERM_MONTHS) outOfReachSince = null;
          else outOfReachSince ??= month;
        }
      }
      note = extra.notes.join('; ');
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

  // Still owing once the loop is done means the end month stayed out of reach: the last month
  // under a reachable end month always pays everything that is owed.
  if (balance > 0) {
    const from = outOfReachSince ?? schedule.length + 1;
    return { rows: schedule.slice(0, from - 1), neverPaysOffFrom: from };
  }
  return { rows: schedule, neverPaysOffFrom: null };
}

/** The amortisation schedule: the rows of `amortizeLoan`. */
export function amortize(loan: LoanInput): ScheduleRow[] {
  return amortizeLoan(loan).rows;
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
  // The same loan without extra payments: neither the dated ones nor the repeating ones.
  const original = amortize({ ...loan, prepayments: [], extra_rules: [] });
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
    next_payment_date: next && next.date !== '' ? next.date : null,
    payoff_date: payoffDate(schedule),
  };
}
